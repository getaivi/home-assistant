"""Per account: its event stream as a connectivity sensor, on while
presses on the phone can reach Home Assistant (it exists once the account
has a binding that accepts input, and is unavailable while it has none),
and a Health sensor (device class problem), on while something needs the
user's attention."""

from __future__ import annotations

from typing import Any, override

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import CONF_NAME
from .entity import account_device
from .runtime import AiviConfigEntry, AiviRuntime, signal_binding_changed
from .runtime.stream import REASON_AUTH

# Push-based platform: no coordinated updates to parallelize.
PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: AiviConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    runtime = entry.runtime_data
    added = False

    @callback
    def _add(_subentry_id: str | None = None) -> None:
        nonlocal added
        if added or not runtime.accepts_input:
            return
        added = True
        async_add_entities([EventStreamSensor(runtime, entry)])

    async_add_entities([ProblemSensor(runtime, entry)])
    _add()
    entry.async_on_unload(
        async_dispatcher_connect(hass, signal_binding_changed(entry.entry_id), _add)
    )


class EventStreamSensor(BinarySensorEntity):
    """Whether the account's event stream is connected, and if not, why."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "event_stream"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, runtime: AiviRuntime, entry: AiviConfigEntry) -> None:
        self._runtime = runtime
        self._attr_unique_id = f"{entry.entry_id}_event_stream"
        self._attr_device_info = account_device(entry)

    @property
    @override
    def available(self) -> bool:
        return self._runtime.stream_status() is not None

    @property
    @override
    def is_on(self) -> bool | None:
        status = self._runtime.stream_status()
        return bool(status["connected"]) if status is not None else None

    @property
    @override
    def extra_state_attributes(self) -> dict[str, Any]:
        status = self._runtime.stream_status() or {}
        return {
            key: status.get(key)
            for key in (
                "reason",
                "last_error",
                "connected_since",
                "reconnects",
                "last_event",
            )
        }

    @override
    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._runtime.inputs.add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()


class ProblemSensor(BinarySensorEntity):
    """On while something about the account needs the user: a widget or
    Live Activity whose pushes fail, a subscription that is not active, or
    an event stream stopped for a rejected token. A push that is being
    retried counts once its first retry failed too."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "problem"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, runtime: AiviRuntime, entry: AiviConfigEntry) -> None:
        self._runtime = runtime
        self._attr_unique_id = f"{entry.entry_id}_problem"
        self._attr_device_info = account_device(entry)
        self._written: tuple[bool, dict[str, Any]] | None = None

    def _problems(self) -> dict[str, Any]:
        """What is wrong; empty but for an empty ``problems`` when
        nothing is."""
        runtime = self._runtime
        problems: dict[str, Any] = {
            "problems": [
                {
                    "name": binding.data[CONF_NAME],
                    "slug": binding.slug,
                    "status": binding.manager.status.value,
                }
                for binding in runtime.bindings.values()
                if binding.manager is not None and binding.manager.failing
            ]
        }
        if not runtime.subscription.active:
            problems["subscription"] = runtime.subscription.state.value
        stream = runtime.stream_status()
        if stream is not None and stream["reason"] == REASON_AUTH:
            problems["event_stream"] = REASON_AUTH
        return problems

    @property
    @override
    def is_on(self) -> bool:
        problems = self._problems()
        return len(problems) > 1 or bool(problems["problems"])

    @property
    @override
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._problems()

    @override
    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._runtime.add_listener(self._changed))
        self.async_on_remove(self._runtime.inputs.add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        # The stream's listeners also hear every press: write only changes.
        written = (self.is_on, self._problems())
        if written != self._written:
            self._written = written
            self.async_write_ha_state()
