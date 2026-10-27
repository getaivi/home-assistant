"""The remote template: a picture, one big reading, when the thing last
reported, up to three stats and one to five buttons, pressed like a
switchboard's tiles."""

from __future__ import annotations

import json
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)
from test_contract import assert_valid_request

from custom_components.aivi import engine, limits
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.metadata import describe_template
from custom_components.aivi.remote import bound_remote_actions, content_size
from custom_components.aivi.switchboard import (
    MAX_CONTENT_BYTES,
    TOGGLE_DOMAINS,
    press_service,
    state_text,
    toggle_answers,
    toggle_on,
)
from custom_components.aivi.templates import REMOTE, SWITCHBOARD
from helpers import (
    Resolver,
    account_entry,
    advance_past_debounce,
    tile_press,
    until,
    widget_subentry,
)

CAR = "https://cdn.example.com/cars/ioniq5-front.jpg"

STATES = {
    "sensor.car_battery": "78",
    "sensor.car_range": "312",
    "lock.car": "locked",
    "climate.car": "off",
    "cover.garage": "closed",
    "script.flash": "off",
    "button.trunk": "unknown",
}
ATTRS = {
    "sensor.car_battery": {"friendly_name": "Battery", "unit_of_measurement": "%"},
    "sensor.car_range": {"friendly_name": "Range", "unit_of_measurement": "km"},
    "lock.car": {"friendly_name": "Car lock", "last_sync": "2026-10-05T07:41:12Z"},
    "climate.car": {"friendly_name": "Climate"},
    "cover.garage": {"friendly_name": "Garage door", "device_class": "garage"},
    "script.flash": {"friendly_name": "Flash"},
    "button.trunk": {"friendly_name": "Trunk"},
}


def _resolve(bindings: dict[str, Any], **states: str) -> dict[str, Any] | None:
    return engine.resolve(
        REMOTE, bindings, Resolver(states={**STATES, **states}, attrs=ATTRS)
    )


def _car(**extra: Any) -> dict[str, Any]:
    return {
        "image": CAR,
        "image_fit": "cover",
        "value": "sensor.car_battery",
        "stats": ["sensor.car_range"],
        "actions": ["lock.car", "climate.car", "button.trunk", "script.flash"],
        "reported_at__attribute": "lock.car",
        "reported_at__attribute_name": "last_sync",
        **extra,
    }


def _valid(content: dict[str, Any]) -> None:
    assert_valid_request("patch", "/widgets/car", {"content": content})


def test_a_car_resolves_to_content_aivi_takes() -> None:
    content = _resolve(_car(icon="car.fill", accent="blue"))
    assert content is not None
    assert content["template"] == "remote"
    assert content["image"] == {"url": CAR, "fit": "cover"}
    assert content["value"] == {"value": "78%"}
    assert content["stats"] == [
        {"label": "Range", "value": {"value": "312"}, "unit": "km"}
    ]
    assert content["actions"] == [
        {
            "id": "lock_car",
            "label": "Car lock",
            "icon": "lock.fill",
            "state_text": {
                "on": "Locked",
                "off": "Unlocked",
                "turning_on": "Locking",
                "turning_off": "Unlocking",
            },
            "kind": "toggle",
            "on": True,
        },
        {
            "id": "climate_car",
            "label": "Climate",
            "icon": "thermometer.medium",
            "kind": "toggle",
            "on": False,
        },
        {"id": "button_trunk", "label": "Trunk", "icon": "hand.tap.fill"},
        {"id": "script_flash", "label": "Flash", "icon": "play.fill"},
    ]
    _valid(content)


def test_a_reading_and_one_button_is_the_least_content() -> None:
    content = _resolve({"value": "sensor.car_battery", "actions": ["cover.garage"]})
    assert content is not None
    assert set(content) == {"template", "value", "actions"}
    assert content["actions"][0]["icon"] == "door.garage.closed"
    _valid(content)
    # Without a button or a reading there is nothing to push.
    assert _resolve({"value": "sensor.car_battery"}) is None
    assert _resolve({"actions": ["cover.garage"]}) is None


def test_the_reading_carries_its_entitys_unit() -> None:
    resolver = Resolver(
        states={"sensor.t": "21.50", "sensor.p": "7.4", "cover.g": "closed"},
        attrs={
            "sensor.t": {"unit_of_measurement": "°C"},
            "sensor.p": {"unit_of_measurement": "kW"},
        },
        renders={"{{ x }}": "about 7"},
    )

    def reading(**bindings: Any) -> Any:
        content = engine.resolve(REMOTE, {"actions": ["cover.g"], **bindings}, resolver)
        assert content is not None
        return content["value"]

    assert reading(value="sensor.t") == {"value": "21.5°C"}
    assert reading(value="sensor.p") == {"value": "7.4 kW"}
    # A word, a template or a formatted value is sent as it reads.
    assert reading(value="cover.g") == {"value": "closed"}
    assert reading(value__template="{{ x }}") == {"value": "about 7"}
    assert reading(value="sensor.p", value__formatter="time_since") == {
        "value": "7.4",
        "formatter": "time_since",
    }


def test_buttons_and_stats_keep_to_the_caps() -> None:
    lights = [f"light.l{n}" for n in range(8)]
    sensors = [f"sensor.s{n}" for n in range(6)]
    content = engine.resolve(
        REMOTE,
        {"value": "sensor.s0", "actions": lights, "stats": sensors},
        Resolver(states={**dict.fromkeys(lights, "on"), **dict.fromkeys(sensors, "1")}),
    )
    assert content is not None
    assert len(content["actions"]) == limits.REMOTE_ACTIONS
    assert len(content["stats"]) == limits.REMOTE_STATS
    _valid(content)
    # Presses route to the buttons the content carries, nothing past them.
    routes = bound_remote_actions({"actions": lights})
    assert list(routes.values()) == lights[: limits.REMOTE_ACTIONS]
    assert REMOTE.routes is not None
    assert REMOTE.routes({"actions": lights}) == routes


def test_the_ids_are_the_switchboards() -> None:
    bindings = {"actions": ["lock.car", "climate.car"]}
    assert REMOTE.routes is not None and SWITCHBOARD.routes is not None
    assert REMOTE.routes(bindings) == SWITCHBOARD.routes(bindings)


# The spec's example (without its protected-action marks) and what Aivi
# stores for it, from the backend's own tests.
SPEC_EXAMPLE: dict[str, Any] = {
    "template": "remote",
    "image": {"url": CAR, "fit": "cover"},
    "reported_at": "2026-10-05T07:41:12Z",
    "value": {"value": "78%"},
    "stats": [{"label": "Range", "value": {"value": "312"}, "unit": "km"}],
    "actions": [
        {
            "id": "lock",
            "kind": "toggle",
            "label": "Locked",
            "icon": "lock.fill",
            "on": True,
            "state_text": {"on": "Locked", "off": "Unlocked"},
        },
        {
            "id": "climate",
            "kind": "toggle",
            "label": "Climate",
            "icon": "fan.fill",
            "on": False,
        },
        {"id": "trunk", "label": "Trunk", "icon": "car.side.rear.open.fill"},
    ],
    "icon": "car.fill",
    "accent": "blue",
}


def _stored_value(value: str) -> dict[str, Any]:
    return {"value": value, "text_color": None, "formatter": None}


def _stored_action(**fields: Any) -> dict[str, Any]:
    kind = fields.get("kind", "button")
    stored: dict[str, Any] = {
        "id": fields["id"],
        "label": fields["label"],
        "subtitle": None,
        "icon": fields["icon"],
        "color": None,
        "gradient": None,
        "image": None,
        "kind": kind,
    }
    if kind == "button":
        stored["active"] = False
    else:
        stored["on"] = fields["on"]
    if fields.get("state_text") is not None:
        stored["state_text"] = fields["state_text"]
    return stored


STORED_SPEC_EXAMPLE: dict[str, Any] = {
    "icon": "car.fill",
    "accent": "blue",
    "tap_url": None,
    "template": "remote",
    "image": {"url": CAR, "alt": None, "fit": "cover"},
    "reported_at": "2026-10-05T07:41:12Z",
    "value": _stored_value("78%"),
    "stats": [{"label": "Range", "value": _stored_value("312"), "unit": "km"}],
    "actions": [_stored_action(**action) for action in SPEC_EXAMPLE["actions"]],
}


def test_the_measure_counts_what_aivi_stores() -> None:
    _valid(SPEC_EXAMPLE)
    assert content_size(SPEC_EXAMPLE) == len(
        json.dumps(STORED_SPEC_EXAMPLE, separators=(",", ":"))
    )
    # A remote with no stats stores none, not an empty list.
    bare = {k: v for k, v in SPEC_EXAMPLE.items() if k != "stats"}
    stored = {k: v for k, v in STORED_SPEC_EXAMPLE.items() if k != "stats"}
    assert content_size({**bare, "stats": []}) == len(
        json.dumps(stored, separators=(",", ":"))
    )
    # Without state words, as a server that does not take them stores it.
    words = ',"state_text":{"on":"Locked","off":"Unlocked"}'
    assert content_size(SPEC_EXAMPLE, state_text=False) == (
        content_size(SPEC_EXAMPLE) - len(words)
    )
    # Five dressed buttons with long pictures go past the cap.
    dressed = {
        **SPEC_EXAMPLE,
        "actions": [
            {
                "id": f"a{n}",
                "label": "x" * limits.TILE_LABEL,
                "icon": "i" * limits.ICON,
                "image": {"url": "https://a.example/" + "p" * 700, "alt": "a" * 64},
            }
            for n in range(limits.REMOTE_ACTIONS)
        ],
    }
    assert content_size(dressed) > MAX_CONTENT_BYTES


def test_the_panel_metadata() -> None:
    described = describe_template(REMOTE)
    fields = {f["key"]: f for f in described["fields"]}
    assert fields["actions"]["kind"] == "rows"
    assert fields["actions"]["max"] == limits.REMOTE_ACTIONS
    assert fields["actions"]["required"] is True
    assert "state_text" in fields["actions"]
    assert fields["stats"]["max"] == limits.REMOTE_STATS
    assert fields["stats"]["required"] is False
    assert fields["value"]["kind"] == "value"
    assert fields["value"]["required"] is True
    assert fields["reported_at"]["kind"] == "reported"
    assert fields["image"]["picture"] is True
    assert [i["type"] for i in described["inputs"]] == [
        "toggle_on",
        "toggle_off",
        "pressed",
    ]


def test_a_thermostat_is_a_toggle_on_in_any_mode_but_off() -> None:
    assert "climate" in TOGGLE_DOMAINS
    for mode in ("heat", "cool", "heat_cool", "auto", "dry", "fan_only"):
        assert toggle_on("climate.car", mode) is True
        assert toggle_answers("climate.car", mode, True)
        assert not toggle_answers("climate.car", mode, False)
    assert toggle_on("climate.car", "off") is False
    assert toggle_answers("climate.car", "off", False)
    assert not toggle_answers("climate.car", "off", True)
    for state in ("unavailable", "unknown", None):
        assert toggle_on("climate.car", state) is False
        assert not toggle_answers("climate.car", state, True)
        assert not toggle_answers("climate.car", state, False)
    assert press_service("climate.car", True) == ("climate", "turn_on")
    assert press_service("climate.car", False) == ("climate", "turn_off")
    assert press_service("climate.car", None) is None
    # The app's own words: a thermostat has none of its own.
    assert state_text("climate.car", "heat", {}) is None


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("car", "Car", "remote")]


async def _car_remote(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("sensor.car_battery", "78", ATTRS["sensor.car_battery"])
    hass.states.async_set("lock.car", "locked", ATTRS["lock.car"])
    hass.states.async_set("climate.car", "off", ATTRS["climate.car"])
    hass.states.async_set("cover.garage", "closed", ATTRS["cover.garage"])
    hass.states.async_set("script.flash", "off", ATTRS["script.flash"])
    entry = account_entry(
        hass,
        widget_subentry(
            "car",
            "Car",
            "remote",
            {
                "value": "sensor.car_battery",
                "actions": ["lock.car", "climate.car", "cover.garage", "script.flash"],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


@pytest.mark.usefixtures("inject_fake_client")
async def test_presses_are_played_back_and_confirmed(
    hass: HomeAssistant, fake_client
) -> None:
    lock = async_mock_service(hass, "lock", "lock")
    unlock = async_mock_service(hass, "lock", "unlock")
    climate_on = async_mock_service(hass, "climate", "turn_on")
    open_cover = async_mock_service(hass, "cover", "open_cover")
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")

    entry = await _car_remote(hass)
    slug, content = fake_client.last_push
    assert slug == "car"
    assert content["template"] == "remote"
    assert [a["id"] for a in content["actions"]] == [
        "lock_car",
        "climate_car",
        "cover_garage",
        "script_flash",
    ]
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")

    fake_client.emit(tile_press("lock_car", slug="car", kind="toggle", value=False))
    await until(hass, lambda: len(unlock) == 1, "the unlock")
    assert unlock[0].data == {"entity_id": "lock.car"}

    fake_client.emit(tile_press("climate_car", slug="car", kind="toggle", value=True))
    await until(hass, lambda: len(climate_on) == 1, "the climate")
    assert climate_on[0].data == {"entity_id": "climate.car"}

    fake_client.emit(tile_press("cover_garage", slug="car", kind="toggle", value=True))
    await until(hass, lambda: len(open_cover) == 1, "the garage")

    fake_client.emit(tile_press("script_flash", slug="car", kind="button"))
    await until(hass, lambda: len(turn_on) == 1, "the script")
    assert turn_on[0].data == {"entity_id": "script.flash"}
    assert not lock

    # The thermostat starts heating: the remote pushes with it on.
    pushes = len(fake_client.pushes)
    hass.states.async_set("climate.car", "heat", ATTRS["climate.car"])
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes + 1
    assert fake_client.last_push[1]["actions"][1]["on"] is True

    # Every press is logged against the remote, with its button's label.
    rows = entry.runtime_data.inputs.log.rows()
    assert {row["label"] for row in rows} >= {"Car lock", "Climate", "Flash"}
    assert all(row["slug"] == "car" for row in rows)
