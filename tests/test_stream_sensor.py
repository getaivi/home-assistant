"""The account's event stream sensor: present while a binding accepts input,
and following the stream's health."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi import async_remove_config_entry_device
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import (
    DOMAIN,
)
from helpers import (
    LAPSED,
    entity_id_of,
    porch_subentry,
    setup_porch,
    stream_sensor_of,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("hall", "Hall", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
    ]


async def test_no_stream_sensor_without_a_binding_that_accepts_input(
    hass: HomeAssistant, entity_registry: er.EntityRegistry
) -> None:
    hass.states.async_set("sensor.washer_progress", "40")
    entry = await setup_porch(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    assert stream_sensor_of(entity_registry, entry) is None
    assert entry.runtime_data.stream_status() is None


async def test_stream_sensor_follows_the_stream(
    hass: HomeAssistant,
    entity_registry: er.EntityRegistry,
    device_registry: dr.DeviceRegistry,
    fake_client,
) -> None:
    async_mock_service(hass, "homeassistant", "turn_on")
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    sensor = stream_sensor_of(entity_registry, entry)
    assert sensor is not None
    registered = entity_registry.async_get(sensor)
    assert registered.entity_category is er.EntityCategory.DIAGNOSTIC
    assert registered.config_subentry_id is None
    device = device_registry.async_get(registered.device_id)
    assert device.identifiers == {(DOMAIN, entry.entry_id)}
    assert device.name == entry.title
    # The account's device stays while the account does.
    assert not await async_remove_config_entry_device(hass, entry, device)

    await until(hass, lambda: hass.states.get(sensor).state == "on", "connected")
    state = hass.states.get(sensor)
    assert state.attributes["device_class"] == "connectivity"
    assert state.attributes["reason"] is None
    assert state.attributes["connected_since"] is not None
    assert state.attributes["reconnects"] == 0

    fake_client.emit(tile_press("scene_movie", slug="porch", kind="button"))
    await until(
        hass, lambda: hass.states.get(sensor).attributes["last_event"], "last event"
    )

    # The server's routine close and a reconnect: still connected, no flap.
    flips: list[str] = []
    hass.bus.async_listen(
        "state_changed",
        lambda event: (
            flips.append(event.data["new_state"].state)
            if event.data["entity_id"] == sensor
            and event.data["old_state"].state != event.data["new_state"].state
            else None
        ),
    )
    fake_client.close_stream()
    await until(hass, lambda: runtime.inputs.health.reconnects == 1, "reconnect")
    assert flips == []
    assert hass.states.get(sensor).attributes["reconnects"] == 1

    # A stream that ends young is a failure: off, with the error.
    fake_client.close_stream()
    await until(hass, lambda: "off" in flips, "disconnected")
    state = hass.states.get(sensor)
    assert state.attributes["last_error"] == (
        "The event stream ended before delivering anything"
    )
    assert state.attributes["connected_since"] is None


async def test_stream_sensor_says_paused_while_the_subscription_lapsed(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    sensor = stream_sensor_of(entity_registry, entry)
    await until(hass, lambda: hass.states.get(sensor).state == "on", "connected")

    fake_client.subscription = LAPSED
    fake_client.close_stream()
    await until(hass, lambda: runtime.inactive is not None, "paused")
    await hass.async_block_till_done()
    state = hass.states.get(sensor)
    assert state.state == "off"
    assert state.attributes["reason"] == "subscription_inactive"
    assert state.attributes["last_error"]
    assert runtime.stream_status()["state"] == "paused"

    fake_client.subscription = None
    assert await runtime.async_check_subscription()
    await until(hass, lambda: hass.states.get(sensor).state == "on", "resumed")
    assert hass.states.get(sensor).attributes["reason"] is None


async def test_a_rejected_token_stops_the_stream(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    await until(hass, lambda: runtime.commands.health.connected, "open")
    fake_client.auth_ok = False
    fake_client.close_stream()
    await until(hass, lambda: runtime.inputs.health.ended, "stopped")
    status = runtime.stream_status()
    assert status["state"] == "stopped"
    assert status["reason"] == "auth_failed"


async def test_bindings_come_and_go_without_a_reload(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "40")
    entry = await setup_porch(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    runtime = entry.runtime_data
    assert stream_sensor_of(entity_registry, entry) is None

    porch = porch_subentry()
    subentry = ConfigSubentry(
        data=porch["data"],
        subentry_type=porch["subentry_type"],
        title=porch["title"],
        unique_id=None,
    )
    hass.config_entries.async_add_subentry(entry, subentry)
    await hass.async_block_till_done()
    assert entry.runtime_data is runtime
    sensor = stream_sensor_of(entity_registry, entry)
    presses = entity_id_of(entity_registry, "event", f"{subentry.subentry_id}_presses")
    assert sensor is not None and presses is not None
    await until(hass, lambda: hass.states.get(sensor).state == "on", "connected")

    # The last binding that accepts input goes: the sensor stays,
    # unavailable, and the presses entity goes with its binding.
    hass.config_entries.async_remove_subentry(entry, subentry.subentry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data is runtime
    assert hass.states.get(sensor).state == "unavailable"
    assert (
        entity_id_of(entity_registry, "event", f"{subentry.subentry_id}_presses")
        is None
    )
    assert runtime.commands is None


async def test_a_template_change_brings_and_takes_input_without_a_reload(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "40")
    display = widget_subentry(
        "porch", "Porch", "progress", {"progress": "sensor.washer_progress"}
    )
    entry = await setup_porch(hass, display)
    runtime = entry.runtime_data
    porch = next(iter(entry.subentries))
    status = entity_id_of(entity_registry, "sensor", f"{porch}_push_status")
    assert status is not None
    assert entity_id_of(entity_registry, "event", f"{porch}_presses") is None
    assert stream_sensor_of(entity_registry, entry) is None

    def _edit(data: Any) -> None:
        hass.config_entries.async_update_subentry(
            entry, entry.subentries[porch], data=data
        )

    # Now a switchboard: the presses entity and the stream sensor appear.
    _edit(porch_subentry()["data"])
    await hass.async_block_till_done()
    assert entry.runtime_data is runtime
    presses = entity_id_of(entity_registry, "event", f"{porch}_presses")
    sensor = stream_sensor_of(entity_registry, entry)
    assert presses is not None and sensor is not None
    assert hass.states.get(presses).state != "unavailable"
    await until(hass, lambda: hass.states.get(sensor).state == "on", "connected")
    assert hass.states.get(status).state == "ok"

    # Back to a display template: both stay, unavailable, as the stream
    # sensor does once nothing accepts input.
    _edit(display["data"])
    await hass.async_block_till_done()
    assert hass.states.get(presses).state == "unavailable"
    assert hass.states.get(sensor).state == "unavailable"
    assert runtime.commands is None
    assert hass.states.get(status).state == "ok"

    # And a switchboard again: the same entities come back.
    _edit(porch_subentry()["data"])
    await hass.async_block_till_done()
    assert entity_id_of(entity_registry, "event", f"{porch}_presses") == presses
    assert hass.states.get(presses).state != "unavailable"
    await until(hass, lambda: hass.states.get(sensor).state == "on", "reconnected")
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    fired: list[Event] = []
    hass.bus.async_listen(
        "state_changed",
        lambda event: (
            fired.append(event) if event.data["entity_id"] == presses else None
        ),
    )
    fake_client.emit(tile_press("light_porch", slug="porch", kind="toggle", value=True))
    await until(hass, lambda: fired, "the press fires")
    assert len(turn_on) == 1
