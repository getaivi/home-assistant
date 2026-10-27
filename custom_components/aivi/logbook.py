"""Logbook lines for presses on a device ("Porch: Garage tile pressed")."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from types import MappingProxyType
from typing import Any

from homeassistant.components.logbook import (
    LOGBOOK_ENTRY_ENTITY_ID,
    LOGBOOK_ENTRY_MESSAGE,
    LOGBOOK_ENTRY_NAME,
)
from homeassistant.core import Event, HomeAssistant, callback

from .const import (
    CONF_BINDINGS,
    CONF_NAME,
    CONF_SLUG,
    CONF_TEMPLATE,
    DOMAIN,
    EVENT_ACTION,
    SUBENTRY_ACTIVITY,
    SUBENTRY_WIDGET,
)
from .sources import DegradingResolver
from .switchboard import (
    PRESSED,
    SWITCHBOARD_TEMPLATE,
    TOGGLE_ON,
    kind_of,
    press_event_type,
    tile_label,
)
from .templates import TemplateDef, registry_for

#: Where a toggle press came from, by the kind it names.
_SURFACES: dict[str, str] = {
    SUBENTRY_WIDGET: "the widget",
    SUBENTRY_ACTIVITY: "the Live Activity",
}

#: How a toggle press reads, by domain: (on, off).
_TOGGLE_WORDS: dict[str, tuple[str, str]] = {
    "cover": ("opened", "closed"),
    "valve": ("opened", "closed"),
    "lock": ("locked", "unlocked"),
}


@callback
def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: Callable[[str, str, Callable[[Event], dict[str, str]]], None],
) -> None:
    @callback
    def _describe(event: Event) -> dict[str, str]:
        return describe_press(hass, event.data)

    async_describe_event(DOMAIN, EVENT_ACTION, _describe)


def _pressed_binding(
    hass: HomeAssistant, kind: str, slug: str, entry_id: str | None
) -> tuple[MappingProxyType[str, Any], TemplateDef] | None:
    """The data and template of the ``kind`` binding for ``slug`` on the
    account that received the press (any account for events recorded
    without one) whose template routes presses."""
    registry = registry_for(hass, kind)
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry_id is not None and entry.entry_id != entry_id:
            continue
        for subentry in entry.subentries.values():
            if (
                subentry.subentry_type == kind
                and subentry.data.get(CONF_SLUG) == slug
                and (template := registry.get(str(subentry.data.get(CONF_TEMPLATE))))
                and template.routes is not None
            ):
                return subentry.data, template
    return None


def describe_press(hass: HomeAssistant, data: Mapping[str, Any]) -> dict[str, str]:
    """The logbook line for one ``aivi_action``: the binding's name,
    what the action did, and the entity behind it when bound here. A
    switchboard's actions are its tiles."""
    slug = str(data.get("slug") or "")
    action = str(data.get("action") or "")
    named = data.get("subject_kind")
    surface = (
        named if isinstance(named, str) and named in _SURFACES else SUBENTRY_WIDGET
    )
    name, label, entity_id = slug, action, None
    tile = surface == SUBENTRY_WIDGET
    entry_id = data.get("entry_id")
    found = _pressed_binding(
        hass, surface, slug, entry_id if isinstance(entry_id, str) else None
    )
    if found is not None:
        binding, template = found
        tile = template.slug == SWITCHBOARD_TEMPLATE
        name = str(binding.get(CONF_NAME) or slug)
        bindings = dict(binding.get(CONF_BINDINGS) or {})
        entity_id = template.routes(bindings).get(action) if template.routes else None
        if entity_id is not None:
            label = tile_label(bindings, entity_id, DegradingResolver(hass))
    kind = kind_of(entity_id) if entity_id else data.get("action_kind")
    event_type = press_event_type(kind, data.get("value"))
    if event_type is None or event_type == PRESSED:
        message = f"{label} tile pressed" if tile else f"{label} pressed"
    else:
        domain = entity_id.partition(".")[0] if entity_id else ""
        on, off = _TOGGLE_WORDS.get(domain, ("turned on", "turned off"))
        word = on if event_type == TOGGLE_ON else off
        message = f"{label} {word} from {_SURFACES[surface]}"
    described: dict[str, str] = {
        LOGBOOK_ENTRY_NAME: name,
        LOGBOOK_ENTRY_MESSAGE: message,
    }
    if entity_id is not None:
        described[LOGBOOK_ENTRY_ENTITY_ID] = entity_id
    return described
