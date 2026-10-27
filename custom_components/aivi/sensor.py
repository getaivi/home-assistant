"""Diagnostic sensors per binding: when it last pushed, and how its pushing
stands (with the last error), so QA, dashboards and automations can see
the integration working, or not, from inside Home Assistant. Per account:
how its subscription stands."""

from __future__ import annotations

from datetime import datetime
from typing import Any, override

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import SubscriptionState
from .entity import account_device, binding_device
from .push import PushManager, PushStatus
from .runtime import AiviConfigEntry, AiviRuntime, Binding, signal_binding_changed

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
        if binding is None or binding.manager is None or subentry_id in added:
            return
        added.add(subentry_id)
        device = binding_device(entry.subentries[subentry_id])
        async_add_entities(
            [LastPushedSensor(binding, device), PushStatusSensor(binding, device)],
            config_subentry_id=subentry_id,
        )

    async_add_entities([SubscriptionSensor(runtime, entry)])
    for subentry_id in runtime.bindings:
        _add(subentry_id)
    entry.async_on_unload(
        async_dispatcher_connect(hass, signal_binding_changed(entry.entry_id), _add)
    )


class _BindingSensor(SensorEntity):
    """A sensor reading one binding's push manager, whichever manager
    currently runs it."""

    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_should_poll = False
    _key: str

    def __init__(self, binding: Binding, device: DeviceInfo) -> None:
        self._binding = binding
        self._attr_translation_key = self._key
        self._attr_unique_id = f"{binding.subentry_id}_{self._key}"
        # One service device per binding, so diagnostics hang off
        # something recognizable in the registry.
        self._attr_device_info = device

    @property
    def _manager(self) -> PushManager | None:
        return self._binding.manager

    @property
    @override
    def available(self) -> bool:
        return self._manager is not None

    @override
    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._binding.add_status_listener(self.async_write_ha_state)
        )


class LastPushedSensor(_BindingSensor):
    """When this binding last pushed content to Aivi. Stays available while
    pushes fail: the last push still happened when it says."""

    _key = "last_pushed"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    @property
    @override
    def native_value(self) -> datetime | None:
        manager = self._manager
        return manager.last_pushed if manager is not None else None


class PushStatusSensor(_BindingSensor):
    """Whether this binding's pushes go through, and why not; the message
    of the last failure is the ``last_error`` attribute. While the content
    waits for a value, ``waiting_for`` names the field (or the fields of
    which one needs a value), by key."""

    _key = "push_status"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = [status.value for status in PushStatus]

    @property
    @override
    def native_value(self) -> str | None:
        manager = self._manager
        return manager.status.value if manager is not None else None

    @property
    @override
    def extra_state_attributes(self) -> dict[str, Any]:
        manager = self._manager
        if manager is None:
            return {"last_error": None, "waiting_for": None}
        waiting = manager.waiting
        return {
            "last_error": manager.last_error,
            "waiting_for": list(waiting.fields) if waiting is not None else None,
        }


class SubscriptionSensor(SensorEntity):
    """How the account's subscription stands, with when the paid period
    ends (and whether it renews then) or when it ended."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "subscription"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = [state.value for state in SubscriptionState]
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, runtime: AiviRuntime, entry: AiviConfigEntry) -> None:
        self._runtime = runtime
        self._attr_unique_id = f"{entry.entry_id}_subscription"
        self._attr_device_info = account_device(entry)

    @property
    @override
    def native_value(self) -> str:
        return self._runtime.subscription.state.value

    @property
    @override
    def extra_state_attributes(self) -> dict[str, Any]:
        status = self._runtime.subscription
        if status.state is SubscriptionState.ACTIVE:
            return {"expires_at": _iso(status.expires_at), "renews": status.renews}
        if status.state is SubscriptionState.EXPIRED:
            return {"expired_at": _iso(status.expired_at)}
        return {}

    @override
    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._runtime.add_listener(self._changed))

    @callback
    def _changed(self) -> None:
        self.async_write_ha_state()


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment is not None else None
