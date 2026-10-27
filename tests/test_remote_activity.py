"""The remote Live Activity: its content held to what Aivi takes, its
buttons pressed on the Lock Screen played back and answered past its
throttle, and its presses kept apart from a widget of the same slug."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import Event, HomeAssistant, callback
from pytest_homeassistant_custom_component.common import async_mock_service
from test_contract import assert_valid_request

from custom_components.aivi import engine, limits
from custom_components.aivi.api import ActivityInfo, WidgetInfo
from custom_components.aivi.const import EVENT_ACTION
from custom_components.aivi.logbook import describe_press
from custom_components.aivi.metadata import describe_template
from custom_components.aivi.templates import ACTIVITY_REMOTE
from helpers import (
    Resolver,
    account_entry,
    activity_subentry,
    advance_past_debounce,
    tile_press,
    until,
    widget_subentry,
)

CAR = "https://cdn.example.com/cars/ioniq5-side.png"

STATES = {
    "sensor.car_battery": "78",
    "sensor.car_range": "312",
    "lock.car": "locked",
    "switch.climate": "off",
    "script.horn": "off",
    "button.flash": "unknown",
}
ATTRS = {
    "sensor.car_battery": {"friendly_name": "Battery", "unit_of_measurement": "%"},
    "sensor.car_range": {"friendly_name": "Range", "unit_of_measurement": "km"},
    "lock.car": {"friendly_name": "Car lock"},
    "switch.climate": {"friendly_name": "Climate"},
}

BUTTONS = ["lock.car", "switch.climate", "script.horn"]


def _resolve(template: Any, bindings: dict[str, Any]) -> dict[str, Any] | None:
    return engine.resolve(template, bindings, Resolver(states=STATES, attrs=ATTRS))


def _car(**extra: Any) -> dict[str, Any]:
    return {
        "value": "sensor.car_battery",
        "actions": BUTTONS,
        "actions__options": {"lock.car": {"label": "Lock", "color": "green"}},
        "stats": ["sensor.car_range"],
        "image": CAR,
        **extra,
    }


def test_the_live_activity_resolves_and_is_valid() -> None:
    content = _resolve(
        ACTIVITY_REMOTE,
        {
            **_car(),
            "state": "lock.car",
            "unit": "%",
            "value_label": "charged",
            "progress": "sensor.car_battery",
            "bar_color": "green",
            "compact_value": "sensor.car_range",
            "accent": "blue",
            "icon": "car.fill",
        },
    )
    assert content is not None
    assert content["template"] == "remote"
    assert content["progress"] == {"style": "simple", "value": 0.78, "color": "green"}
    assert content["state"] == {"value": "locked"}
    assert content["unit"] == "%"
    assert content["image"] == {"url": CAR}
    # A Live Activity's buttons draw their label, symbol and color only.
    assert content["actions"][0] == {
        "id": "lock_car",
        "label": "Lock",
        "icon": "lock.fill",
        "color": "green",
        "kind": "toggle",
        "on": True,
    }
    assert_valid_request(
        "patch", "/activities/car", {"state": "ONGOING", "content": content}
    )


def test_the_live_activity_keeps_to_its_caps() -> None:
    long_url = "https://cdn.example.com/" + "a" * limits.ACTIVITY_IMAGE_URL
    bindings = {
        **_car(image=long_url),
        "actions__options": {
            "lock.car": {
                "label": "Lock",
                "subtitle": "Parked",
                "gradient": "red, blue",
                "image": CAR,
                "state_text_on": "Shut",
            }
        },
        "stats": ["sensor.car_range", "sensor.car_battery", "sensor.car_range"],
        "value": "sensor.car_battery",
        "value__formatter": "time_until",
    }
    content = _resolve(ACTIVITY_REMOTE, bindings)
    assert content is not None
    # Too long a picture URL for a push is left out, and so is a bar
    # without a reading.
    assert "image" not in content
    assert "progress" not in content
    assert len(content["actions"]) == limits.ACTIVITY_ACTIONS
    assert set(content["actions"][0]) == {"id", "label", "icon", "kind", "on"}
    assert len(content["stats"]) == limits.ACTIVITY_STATS
    many = [f"switch.s{n}" for n in range(5)]
    assert len(ACTIVITY_REMOTE.routes({"actions": many})) == limits.ACTIVITY_ACTIONS
    assert_valid_request(
        "patch", "/activities/car", {"state": "ONGOING", "content": content}
    )


def test_the_panel_metadata() -> None:
    activity = {f["key"]: f for f in describe_template(ACTIVITY_REMOTE)["fields"]}
    assert activity["actions"]["max"] == limits.ACTIVITY_ACTIONS
    assert activity["actions"]["row_options"] == ["label", "icon", "color"]
    assert "state_text" not in activity["actions"]
    assert set(describe_template(ACTIVITY_REMOTE)["inputs"][0]) >= {"type"}


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("vacuum", "Vacuum widget", "remote")]


@pytest.fixture
def activities() -> list[ActivityInfo]:
    return [ActivityInfo("vacuum", "Robot vacuum", "remote")]


async def _vacuum(hass: HomeAssistant, *, widget: bool = False) -> Any:
    hass.states.async_set("binary_sensor.cleaning", "on")
    hass.states.async_set("sensor.vacuum_battery", "68")
    hass.states.async_set("switch.vacuum_mop", "off", {"friendly_name": "Mop"})
    hass.states.async_set("script.vacuum_dock", "off", {"friendly_name": "Dock"})
    bindings = {
        "value": "sensor.vacuum_battery",
        "actions": ["switch.vacuum_mop", "script.vacuum_dock"],
    }
    subentries = [
        activity_subentry(
            "vacuum",
            "Robot vacuum",
            "remote",
            "binary_sensor.cleaning",
            bindings,
            throttle=600,
        )
    ]
    if widget:
        subentries.append(
            widget_subentry(
                "vacuum",
                "Vacuum widget",
                "remote",
                {"value": "sensor.vacuum_battery", "actions": ["script.vacuum_dock"]},
            )
        )
    entry = account_entry(hass, *subentries)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.mark.usefixtures("inject_fake_client")
async def test_a_live_activity_press_is_played_and_answered_past_the_throttle(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    bus_events: list[Event] = []

    @callback
    def _record(event: Event) -> None:
        bus_events.append(event)

    hass.bus.async_listen(EVENT_ACTION, _record)
    entry = await _vacuum(hass)
    assert len(fake_client.activity_pushes) == 1
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    # The throttle holds the activity for ten minutes after its last push.
    hass.states.async_set("sensor.vacuum_battery", "60")
    await advance_past_debounce(hass)
    assert len(fake_client.activity_pushes) == 1

    fake_client.emit(
        tile_press(
            "switch_vacuum_mop",
            slug="vacuum",
            surface="activity",
            kind="toggle",
            value=True,
            instance_id="card-1",
        )
    )
    await until(hass, lambda: len(turn_on) == 1, "the toggle")
    assert turn_on[0].data == {"entity_id": "switch.vacuum_mop"}
    assert bus_events[0].data["subject_kind"] == "activity"
    assert bus_events[0].data["instance_id"] == "card-1"

    # The answer to the press goes out at once, past the throttle.
    hass.states.async_set("switch.vacuum_mop", "on", {"friendly_name": "Mop"})
    await advance_past_debounce(hass)
    assert len(fake_client.activity_pushes) == 2
    slug, state, content = fake_client.activity_pushes[-1]
    assert (slug, state) == ("vacuum", "ONGOING")
    assert content["actions"][0]["on"] is True
    assert content["value"] == {"value": "60"}

    record = entry.runtime_data.inputs.log.records()[0]
    assert record.resource_kind == "activity"
    assert record.details["instance_id"] == "card-1"
    assert record.details["label"] == "Mop"


@pytest.mark.usefixtures("inject_fake_client")
async def test_a_slug_is_pressed_only_on_its_own_kind(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    entry = await _vacuum(hass, widget=True)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    # The mop is a button of the Live Activity only.
    fake_client.emit(
        tile_press("switch_vacuum_mop", slug="vacuum", kind="toggle", value=True)
    )
    fake_client.emit(tile_press("script_vacuum_dock", slug="vacuum", kind="button"))
    await until(hass, lambda: len(turn_on) == 1, "the widget's button")
    assert turn_on[0].data == {"entity_id": "script.vacuum_dock"}


async def test_logbook_lines_name_the_surface(hass: HomeAssistant) -> None:
    hass.states.async_set("switch.vacuum_mop", "off", {"friendly_name": "Mop"})
    hass.states.async_set("script.vacuum_dock", "off", {"friendly_name": "Dock"})
    entry = account_entry(
        hass,
        activity_subentry(
            "vacuum",
            "Robot vacuum",
            "remote",
            "binary_sensor.cleaning",
            {
                "value": "sensor.b",
                "actions": ["switch.vacuum_mop", "script.vacuum_dock"],
            },
        ),
    )
    toggle = {
        "subject_kind": "activity",
        "slug": "vacuum",
        "entry_id": entry.entry_id,
        "action": "switch_vacuum_mop",
        "action_kind": "toggle",
        "value": True,
    }
    assert describe_press(hass, toggle) == {
        "name": "Robot vacuum",
        "message": "Mop turned on from the Live Activity",
        "entity_id": "switch.vacuum_mop",
    }
    button = {**toggle, "action": "script_vacuum_dock", "action_kind": "button"}
    assert describe_press(hass, button)["message"] == "Dock pressed"
    # A widget of the same slug is not the Live Activity.
    assert describe_press(hass, {**button, "subject_kind": "widget"})["message"] == (
        "script_vacuum_dock tile pressed"
    )
