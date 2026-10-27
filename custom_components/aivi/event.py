"""An event entity per binding that accepts input: it fires for every
press played back into Home Assistant, with the tile's details, so
automations can react to presses on the phone. An edit that leaves the
binding accepting no input makes it unavailable, as the account's event
stream sensor is once nothing accepts input."""

from __future__ import annotations

from typing import override

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .entity import binding_device
from .inputs import InputRecord, Outcome
from .runtime import AiviConfigEntry, Binding, signal_binding_changed

# Push-based platform: no coordinated updates to parallelize.
PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: AiviConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    runtime = entry.runtime_data
    added: set[str] = set()

    @callback
    def _add(subentry_id: str) -> None:
        binding = runtime.bindings.get(subentry_id)
        if binding is None or not binding.recorded_inputs or subentry_id in added:
            return
        added.add(subentry_id)
        async_add_entities(
            [PressesEvent(binding, binding_device(entry.subentries[subentry_id]))],
            config_subentry_id=subentry_id,
        )

    for subentry_id in runtime.bindings:
        _add(subentry_id)
    entry.async_on_unload(
        async_dispatcher_connect(hass, signal_binding_changed(entry.entry_id), _add)
    )


class PressesEvent(EventEntity):
    """Fires once per press that was played back, for the recorded event
    types the binding's template declares. Presses that expired, failed
    or were ignored do not fire; the panel lists them."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "presses"

    def __init__(self, binding: Binding, device: DeviceInfo) -> None:
        self._binding = binding
        self._attr_unique_id = f"{binding.subentry_id}_presses"
        self._attr_device_info = device
        self._attr_event_types = binding.recorded_inputs

    @property
    @override
    def available(self) -> bool:
        return self._binding.accepts_input

    @override
    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self._binding.add_record_listener(self._on_record))
        self.async_on_remove(self._binding.add_status_listener(self._on_status))

    @callback
    def _on_status(self) -> None:
        # A new template may declare other event types.
        if event_types := self._binding.recorded_inputs:
            self._attr_event_types = event_types
        self.async_write_ha_state()

    @callback
    def _on_record(self, record: InputRecord) -> None:
        if (
            record.outcome is not Outcome.PLAYED
            or not record.recorded
            or record.event_type not in self.event_types
        ):
            return
        if record.context is not None:
            # The press's context, so the logbook ties this to the press.
            self.async_set_context(record.context)
        self._trigger_event(record.event_type, record.entity_attributes())
        self.async_write_ha_state()
