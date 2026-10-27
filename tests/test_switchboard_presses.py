"""The switchboard's whole loop: the bound entities are pushed as tiles, a
press comes back on the stream, the service runs, and the state change
pushes again."""

from __future__ import annotations

import uuid

import pytest
from homeassistant.core import Event, HomeAssistant, callback
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.commands import CommandStream
from custom_components.aivi.const import EVENT_ACTION
from helpers import (
    account_entry,
    advance_past_debounce,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


async def _living_room(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    hass.states.async_set("scene.movie", "scening", {"friendly_name": "Movie night"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom",
            "Living room",
            "switchboard",
            {"actions": ["light.porch", "scene.movie"]},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_presses_are_played_back_and_confirmed_by_the_state_change(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    bus_events: list[Event] = []

    @callback
    def _record(event: Event) -> None:
        bus_events.append(event)

    hass.bus.async_listen(EVENT_ACTION, _record)

    entry = await _living_room(hass)
    _, content = fake_client.last_push
    assert content["actions"] == [
        {
            "id": "light_porch",
            "label": "Porch light",
            "icon": "lightbulb.fill",
            "kind": "toggle",
            "on": False,
        },
        {"id": "scene_movie", "label": "Movie night", "icon": "sparkles"},
    ]
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    fake_client.emit(tile_press("light_porch", kind="toggle", value=True))
    await until(hass, lambda: len(turn_on) == 1, "the toggle")
    assert turn_on[0].data == {"entity_id": "light.porch"}

    # The publisher confirms the press: the light goes on, the widget
    # pushes again with the tile on.
    pushes = len(fake_client.pushes)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch light"})
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes + 1
    assert fake_client.last_push[1]["actions"][0]["on"] is True

    fake_client.emit(tile_press("light_porch", kind="toggle", value=False))
    await until(hass, lambda: len(turn_off) == 1, "the toggle off")
    assert turn_off[0].data == {"entity_id": "light.porch"}

    fake_client.emit(tile_press("scene_movie", kind="button"))
    await until(hass, lambda: len(turn_on) == 2, "the button")
    assert turn_on[1].data == {"entity_id": "scene.movie"}

    # Every press was also fired on the bus, with the envelope's facts.
    assert [e.data for e in bus_events] == [
        {
            "subject_kind": "widget",
            "slug": "livingroom",
            "entry_id": entry.entry_id,
            "action": "light_porch",
            "action_kind": "toggle",
            "value": True,
            "event_id": bus_events[0].data["event_id"],
            "request_id": bus_events[0].data["request_id"],
        },
        {
            "subject_kind": "widget",
            "slug": "livingroom",
            "entry_id": entry.entry_id,
            "action": "light_porch",
            "action_kind": "toggle",
            "value": False,
            "event_id": bus_events[1].data["event_id"],
            "request_id": bus_events[1].data["request_id"],
        },
        {
            "subject_kind": "widget",
            "slug": "livingroom",
            "entry_id": entry.entry_id,
            "action": "scene_movie",
            "action_kind": "button",
            "value": None,
            "event_id": bus_events[2].data["event_id"],
            "request_id": bus_events[2].data["request_id"],
        },
    ]
    assert uuid.UUID(bus_events[0].data["event_id"]).version == 5
    assert bus_events[0].data["request_id"].startswith("act_light_porch_")
    assert stream.health.last_event is not None


async def test_unbound_and_malformed_presses_reach_the_bus_only(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    bus_events: list[Event] = []
    hass.bus.async_listen(
        EVENT_ACTION, callback(lambda event: bus_events.append(event))
    )
    entry = await _living_room(hass)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    # A widget this instance publishes by other means, a tile it does not
    # know, a toggle without its requested state, and a press with no
    # action at all: none is played back, all but the last reach the bus.
    fake_client.emit(
        {
            **tile_press("porch", kind="toggle", value=True),
            "subject": {"kind": "widget", "slug": "hall"},
        }
    )
    fake_client.emit(tile_press("garage", kind="button"))
    fake_client.emit(tile_press("light_porch", kind="toggle"))
    fake_client.emit({**tile_press("x"), "data": {"kind": "button"}})
    # A last good one, so the wait has something to land on.
    fake_client.emit(tile_press("scene_movie", kind="button"))
    await until(hass, lambda: len(turn_on) == 1, "the trailing press")
    assert turn_on[0].data == {"entity_id": "scene.movie"}
    assert [(e.data["slug"], e.data["action"]) for e in bus_events] == [
        ("hall", "porch"),
        ("livingroom", "garage"),
        ("livingroom", "light_porch"),
        ("livingroom", "scene_movie"),
    ]


async def test_a_subject_of_another_kind_is_not_a_widget(
    hass: HomeAssistant, fake_client
) -> None:
    """Slugs are unique only within one kind: a press whose subject names
    another kind of resource with the widget's slug is dropped, checked
    against the event type rather than trusted to either field alone."""
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    bus_events: list[Event] = []
    hass.bus.async_listen(
        EVENT_ACTION, callback(lambda event: bus_events.append(event))
    )
    stream = CommandStream(
        hass, fake_client, routes={("widget", "test"): {"light_porch": "light.porch"}}
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "stream open")

    fake_client.emit(
        {
            **tile_press("light_porch", kind="toggle", value=True),
            "subject": {"kind": "activity", "slug": "test"},
        }
    )
    # A last good one: once it lands, everything before it was handled.
    fake_client.emit(
        {
            **tile_press("light_porch", kind="toggle", value=True),
            "subject": {"kind": "widget", "slug": "test"},
        }
    )
    await until(hass, lambda: len(turn_on) == 1, "the widget press")
    assert turn_on[0].data == {"entity_id": "light.porch"}
    assert [(e.data["slug"], e.data["action"]) for e in bus_events] == [
        ("test", "light_porch")
    ]
    await stream.async_stop()


async def test_a_failing_service_is_logged_not_fatal(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    """``homeassistant.turn_off`` is not registered: the toggle-off press
    fails, the stream stays open, and the next press still gets through."""
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    entry = await _living_room(hass)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    fake_client.emit(tile_press("light_porch", kind="toggle", value=False))
    fake_client.emit(tile_press("scene_movie", kind="button"))
    await until(hass, lambda: len(turn_on) == 1, "the press after the failure")
    assert "could not be played back" in caplog.text
    assert stream.health.connected


async def test_setup_with_only_a_switchboard_opens_the_stream(
    hass: HomeAssistant,
) -> None:
    entry = await _living_room(hass)
    assert entry.runtime_data.commands is not None
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
