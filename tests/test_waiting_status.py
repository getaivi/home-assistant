"""Content waiting for a value outside the editor: the push status
sensor's state and ``waiting_for``, diagnostics, the hub's status map
(``aivi/inputs/subscribe``), and the repairs a wait leaves alone."""

from __future__ import annotations

from datetime import timedelta

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi.const import DOMAIN
from custom_components.aivi.diagnostics import async_get_config_entry_diagnostics
from custom_components.aivi.push import PushStatus
from custom_components.aivi.values import ON_STATES, as_bool
from helpers import (
    account_entry,
    activity_subentry,
    advance_past_debounce,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")

WAITING = {
    "field": "progress",
    "fields": ["progress"],
    "entity_id": "sensor.washer_progress",
    "reading": "unknown",
}


async def _activity(hass: HomeAssistant, progress: str, throttle: int = 0):
    hass.states.async_set("binary_sensor.washer_running", "on")
    hass.states.async_set("sensor.washer_progress", progress)
    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.washer_running",
            {"progress": "sensor.washer_progress"},
            throttle=throttle,
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _status_sensor(entity_registry: er.EntityRegistry, entry) -> str:
    entity_id = entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{next(iter(entry.subentries))}_push_status"
    )
    assert entity_id is not None
    return entity_id


async def test_the_status_sensor_says_what_the_content_waits_for(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    entry = await _activity(hass, "unknown")
    sensor = _status_sensor(entity_registry, entry)
    state = hass.states.get(sensor)
    assert state.state == "waiting"
    assert state.attributes["waiting_for"] == ["progress"]
    assert state.attributes["last_error"] is None
    assert "waiting" in state.attributes["options"]
    (manager,) = entry.runtime_data.managers.values()
    # Not a failure: the binding is healthy and needs no attention.
    assert manager.available
    assert not manager.failing

    hass.states.async_set("sensor.washer_progress", "50")
    await advance_past_debounce(hass)
    state = hass.states.get(sensor)
    assert state.state == "ok"
    assert state.attributes["waiting_for"] is None


async def test_a_group_waits_for_all_its_fields(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    entry = account_entry(hass, widget_subentry("power", "Power", "energy", {}))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    state = hass.states.get(_status_sensor(entity_registry, entry))
    assert state.state == "waiting"
    assert {"grid_power", "home_power"} <= set(state.attributes["waiting_for"])


async def test_diagnostics_say_what_waits_and_what_is_held(
    hass: HomeAssistant, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    entry = await _activity(hass, "unknown")
    (widget,) = (await async_get_config_entry_diagnostics(hass, entry))["widgets"]
    assert widget["status"] == "waiting"
    assert widget["available"] is True
    assert widget["waiting"] == WAITING
    assert widget["held"] is None

    entry = await _activity(hass, "10", throttle=60)
    hass.states.async_set("sensor.washer_progress", "20")
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=5))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    (widget,) = (await async_get_config_entry_diagnostics(hass, entry))["widgets"]
    (manager,) = entry.runtime_data.managers.values()
    assert widget["status"] == "ok"
    assert widget["waiting"] is None
    assert widget["held"] == {
        "until": (manager.last_pushed + timedelta(seconds=60)).isoformat(),
        "interval": 60,
    }


async def test_the_hub_is_told_each_bindings_status(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    await async_setup_component(hass, "websocket_api", {})
    entry = await _activity(hass, "unknown")
    subentry_id = next(iter(entry.subentries))
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["success"]
    first = (await client.receive_json())["event"]
    assert first["status"] == {
        subentry_id: {"status": "waiting", "waiting": WAITING, "held": None}
    }

    hass.states.async_set("sensor.washer_progress", "50")
    await advance_past_debounce(hass)
    while True:
        update = (await client.receive_json())["event"]
        if update["status"][subentry_id]["status"] == "ok":
            break
    assert update["status"][subentry_id]["waiting"] is None


async def test_waiting_heals_no_repair(hass: HomeAssistant, fake_client) -> None:
    entry = await _activity(hass, "10")
    subentry_id = next(iter(entry.subentries))
    fake_client.reject_content = True
    hass.states.async_set("sensor.washer_progress", "20")
    await advance_past_debounce(hass)
    issues = ir.async_get(hass)
    issue = f"content_rejected_{subentry_id}"
    assert issues.async_get_issue(DOMAIN, issue) is not None
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    (manager,) = entry.runtime_data.managers.values()
    assert manager.status is PushStatus.WAITING
    assert issues.async_get_issue(DOMAIN, issue) is not None


async def test_a_paused_account_stays_paused_while_content_waits(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await _activity(hass, "10")
    (manager,) = entry.runtime_data.managers.values()
    manager.async_pause()
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.NO_SUBSCRIPTION
    assert manager.waiting is None


async def test_the_panel_gets_the_on_states(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    await async_setup_component(hass, "websocket_api", {})
    await _activity(hass, "10")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "aivi/templates"})
    reply = await client.receive_json()
    assert reply["success"]
    on_states = reply["result"]["on_states"]
    assert on_states == sorted(ON_STATES)
    assert "charging" in on_states
    assert all(as_bool(state) for state in on_states)
    assert as_bool(" Charging ")
    assert not as_bool("off")


async def test_a_held_change_ends_the_wait(
    hass: HomeAssistant, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    entry = await _activity(hass, "10", throttle=60)
    (manager,) = entry.runtime_data.managers.values()
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.WAITING
    hass.states.async_set("sensor.washer_progress", "20")
    await advance_past_debounce(hass)
    assert manager.held is not None
    assert manager.status is PushStatus.OK
    assert manager.waiting is None
