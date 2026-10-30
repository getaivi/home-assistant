"""A remote's buttons name an entity on a device by its own name, without
the device's in front, as its stats do; a switchboard's tiles mix devices
and keep the full name. The logbook and the panel's inputs feed say the
name the button shows."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.aivi import engine
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.logbook import describe_press
from custom_components.aivi.metadata import describe_template
from custom_components.aivi.remote import bound_remote_actions
from custom_components.aivi.sources import HassStateResolver
from custom_components.aivi.templates import (
    ACTIVITY_REMOTE,
    REMOTE,
    SHOWCASE,
    SWITCHBOARD,
)
from helpers import (
    account_entry,
    activity_subentry,
    tile_press,
    until,
    widget_subentry,
)

DOORS = "lock.car_doors"
HORN = "button.car_horn"
MAIN = "switch.car"
HEATER = "switch.car_heater"
LEGACY = "button.car_flash"
LOOSE = "script.welcome"
BUTTONS = [DOORS, HORN, MAIN, HEATER, LEGACY]


def _car(hass: HomeAssistant) -> None:
    """The "Car" device's entities, each with the ``friendly_name`` Home
    Assistant gives it, and a script on no device."""
    config = MockConfigEntry(domain="test")
    config.add_to_hass(hass)
    car = dr.async_get(hass).async_get_or_create(
        config_entry_id=config.entry_id, identifiers={("test", "car")}, name="Car"
    )
    registry = er.async_get(hass)

    def add(
        entity_id: str, name: str | None, friendly: str, *, own: bool = True
    ) -> None:
        domain, _, object_id = entity_id.partition(".")
        registry.async_get_or_create(
            domain,
            "test",
            object_id,
            device_id=car.id,
            has_entity_name=own,
            original_name=name,
            suggested_object_id=object_id,
        )
        hass.states.async_set(entity_id, "off", {"friendly_name": friendly})

    add(DOORS, "Doors", "Car Doors")
    add(HORN, "Horn", "Car Horn")
    # The device's main entity has no name of its own.
    add(MAIN, None, "Car")
    # Renamed by the user: Home Assistant shows the rename alone.
    add(HEATER, "Climate", "Heater")
    registry.async_update_entity(HEATER, name="Heater")
    # Named the old way, without has_entity_name.
    add(LEGACY, "Car flash lights", "Car flash lights", own=False)
    hass.states.async_set(LOOSE, "off", {"friendly_name": "Welcome home"})


def _labels(template: Any, bindings: dict[str, Any], hass: HomeAssistant) -> list:
    content = engine.resolve(
        template, {"value": "sensor.car_battery", **bindings}, HassStateResolver(hass)
    )
    assert content is not None
    return [action["label"] for action in content["actions"]]


async def test_remote_buttons_read_by_their_own_name(hass: HomeAssistant) -> None:
    _car(hass)
    hass.states.async_set("sensor.car_battery", "78")
    bindings = {
        "actions": [DOORS, HORN, MAIN, HEATER, LOOSE],
        "actions__options": {HORN: {"label": "Honk"}},
    }
    expected = ["Doors", "Honk", "Car", "Heater", "Welcome home"]
    assert _labels(REMOTE, bindings, hass) == expected
    assert _labels(REMOTE, {"actions": [LEGACY]}, hass) == ["Car flash lights"]
    # The Live Activity's buttons, three at most, read the same.
    assert _labels(ACTIVITY_REMOTE, bindings, hass) == expected[:3]
    assert _labels(ACTIVITY_REMOTE, {"actions": [HEATER, LOOSE]}, hass) == [
        "Heater",
        "Welcome home",
    ]


async def test_switchboard_tiles_keep_the_full_name(hass: HomeAssistant) -> None:
    _car(hass)
    content = engine.resolve(
        SWITCHBOARD, {"actions": [DOORS, HORN, MAIN]}, HassStateResolver(hass)
    )
    assert content is not None
    assert [tile["label"] for tile in content["actions"]] == [
        "Car Doors",
        "Car Horn",
        "Car",
    ]


def test_the_panel_metadata_names_the_rule() -> None:
    def naming(template: Any) -> dict[str, Any]:
        fields = describe_template(template)["fields"]
        return {f["key"]: f.get("naming") for f in fields if f["kind"] == "rows"}

    assert naming(REMOTE) == {"actions": "in_device", "stats": "in_device"}
    assert naming(ACTIVITY_REMOTE) == {"actions": "in_device", "stats": "in_device"}
    assert naming(SHOWCASE) == {"stats": "in_device"}
    assert naming(SWITCHBOARD) == {"actions": None}


async def test_the_logbook_says_the_buttons_name(hass: HomeAssistant) -> None:
    _car(hass)
    bindings = {"value": "sensor.car_battery", "actions": BUTTONS}
    entry = account_entry(
        hass,
        widget_subentry("car", "Car", "remote", bindings),
        widget_subentry("board", "Board", "switchboard", {"actions": BUTTONS}),
        activity_subentry("car", "Car trip", "remote", "binary_sensor.trip", bindings),
    )
    ids = {
        entity_id: action
        for action, entity_id in bound_remote_actions(bindings).items()
    }

    def message(slug: str, entity_id: str, kind: str = "widget") -> str:
        return describe_press(
            hass,
            {
                "subject_kind": kind,
                "slug": slug,
                "entry_id": entry.entry_id,
                "action": ids[entity_id],
                "action_kind": "button",
            },
        )["message"]

    assert message("car", DOORS) == "Doors pressed"
    assert message("car", MAIN) == "Car pressed"
    assert message("car", HEATER) == "Heater pressed"
    assert message("car", LEGACY) == "Car flash lights pressed"
    assert message("car", HORN, "activity") == "Horn pressed"
    assert message("board", DOORS) == "Car Doors tile pressed"


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("car", "Car", "remote")]


@pytest.mark.usefixtures("inject_fake_client")
async def test_the_inputs_feed_says_the_buttons_name(
    hass: HomeAssistant, fake_client
) -> None:
    async_mock_service(hass, "button", "press")
    _car(hass)
    hass.states.async_set("sensor.car_battery", "78")
    bindings = {"value": "sensor.car_battery", "actions": [HORN]}
    entry = account_entry(hass, widget_subentry("car", "Car", "remote", bindings))
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["actions"][0]["label"] == "Horn"
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    (action,) = bound_remote_actions(bindings)
    fake_client.emit(tile_press(action, slug="car", kind="button"))
    log = entry.runtime_data.inputs.log
    await until(hass, lambda: bool(log.records()), "the press")
    assert log.records()[0].details["label"] == "Horn"
