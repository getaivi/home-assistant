"""One binding subentry as the runtime runs it, and what is read from a
binding's subentry: its device, its content."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from typing import Any, cast

from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from ..api import AiviClient, AiviError
from ..const import (
    CONF_BINDINGS,
    CONF_SLUG,
    CONF_TEMPLATE,
    DOMAIN,
)
from ..inputs import InputRecord
from ..push import PushManager, resolve_content
from ..templates import TemplateDef, registry_for

_LOGGER = logging.getLogger(__name__)


def registered_device(
    registry: dr.DeviceRegistry, entry_id: str, subentry_id: str
) -> dr.DeviceEntry | None:
    """A binding's device. Identifiers are unique within a config entry
    only, so the lookup names the account. Home Assistant versions without
    ``async_get_device_by_identifier`` fall back to the lookup by identifier
    alone, which the newer one deprecates."""
    identifier = (DOMAIN, subentry_id)
    if not hasattr(registry, "async_get_device_by_identifier"):
        return registry.async_get_device(identifiers={identifier})
    return registry.async_get_device_by_identifier(identifier, entry_id)


def binding_model(subentry: ConfigSubentry) -> str:
    """The device model shown for a binding: its template and kind."""
    return f"{subentry.data[CONF_TEMPLATE]} {subentry.subentry_type}"


def signal_binding_changed(entry_id: str) -> str:
    """Dispatched with the subentry id when a binding gains or loses a
    manager or input, so the platforms add the entities it now needs."""
    return f"{DOMAIN}_{entry_id}_binding_changed"


class Binding:
    """One binding subentry as the runtime runs it. The record outlives
    its manager: an edit replaces the manager, while the binding's
    entities keep their listeners here."""

    def __init__(self, subentry: ConfigSubentry) -> None:
        self.subentry_id = subentry.subentry_id
        # What the binding was last built from: Home Assistant updates a
        # subentry in place.
        self.kind = subentry.subentry_type
        self.data = subentry.data
        self.template: TemplateDef | None = None
        self.manager: PushManager | None = None
        self._status_listeners: list[Callable[[], None]] = []
        self._record_listeners: list[Callable[[InputRecord], None]] = []

    @property
    def slug(self) -> str:
        return cast("str", self.data[CONF_SLUG])

    @property
    def bindings(self) -> dict[str, Any]:
        return dict(self.data.get(CONF_BINDINGS, {}))

    @property
    def accepts_input(self) -> bool:
        return self.manager is not None and bool(self.template and self.template.inputs)

    @property
    def pressable(self) -> bool:
        """Whether presses on the content come back to be played (a
        switchboard's tiles, a remote's buttons)."""
        return self.template is not None and self.template.routes is not None

    @property
    def resource(self) -> tuple[str, str]:
        """The kind and slug presses on the content name: slugs are unique
        only within one kind."""
        return (self.kind, self.slug)

    def routes(self) -> dict[str, str]:
        """Action id -> entity id, for the presses the content takes."""
        if self.template is None or self.template.routes is None:
            return {}
        return self.template.routes(self.bindings)

    @property
    def capabilities(self) -> tuple[bool, bool]:
        """Whether the binding runs a manager, and accepts input."""
        return self.manager is not None, self.accepts_input

    @property
    def recorded_inputs(self) -> list[str]:
        """The input event types that fire the binding's event entity."""
        if not self.accepts_input or self.template is None:
            return []
        return [event.type for event in self.template.inputs if event.recorded]

    @callback
    def stop(self) -> PushManager | None:
        """Stop the manager, if any, and return it."""
        manager, self.manager = self.manager, None
        if manager is not None:
            manager.async_stop()
        return manager

    @callback
    def add_status_listener(self, update: Callable[[], None]) -> Callable[[], None]:
        """Call ``update`` on every status change, across managers."""
        self._status_listeners.append(update)
        return lambda: self._status_listeners.remove(update)

    @callback
    def notify(self) -> None:
        for update in list(self._status_listeners):
            update()

    @callback
    def add_record_listener(
        self, update: Callable[[InputRecord], None]
    ) -> Callable[[], None]:
        """Call ``update`` with every record for the binding."""
        self._record_listeners.append(update)
        return lambda: self._record_listeners.remove(update)

    @callback
    def record(self, record: InputRecord) -> None:
        for update in list(self._record_listeners):
            update(record)


def pressable_managers(
    bindings: Mapping[str, Binding],
) -> dict[tuple[str, str], PushManager]:
    """The managers of the running bindings whose content is pressed, by
    kind and slug."""
    return {
        b.resource: b.manager
        for b in bindings.values()
        if b.pressable and b.manager is not None
    }


def binding_content(
    hass: HomeAssistant, kind: str, data: Mapping[str, Any]
) -> dict[str, Any] | None:
    """What a binding's subentry data resolves to now, or ``None``."""
    template = registry_for(hass, kind).get(data[CONF_TEMPLATE])
    if template is None:
        return None
    return resolve_content(hass, template, dict(data.get(CONF_BINDINGS, {})))


async def async_end_activity(
    client: AiviClient, slug: str, content: dict[str, Any]
) -> None:
    """End a Live Activity (``IDLE``), ignoring any failure."""
    try:
        await client.push_activity(slug, "IDLE", content)
    except AiviError as err:
        _LOGGER.debug("Could not end the Aivi activity %s: %s", slug, err)
