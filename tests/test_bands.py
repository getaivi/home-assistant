"""Colors by value: a palette color chosen by the band an entity's reading
falls in, stored as data beside the slot's literal and resolved on the
same path as a template, clamped by the same palette check."""

from __future__ import annotations

from typing import Any

import pytest

from custom_components.aivi import blocks, engine
from custom_components.aivi.metadata import describe_template
from custom_components.aivi.sources import Bands, Source
from custom_components.aivi.sourcing import read_source
from custom_components.aivi.templates import GAUGE, STATUS
from helpers import Resolver, setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")

BATTERY = {
    "entity": "sensor.phone_battery",
    "limits": [20, 50],
    "values": ["red", "orange", "green"],
}


@pytest.mark.parametrize(
    ("raw", "usable"),
    [
        (BATTERY, True),
        ({**BATTERY, "limits": ["20", 50.5]}, True),
        ({**BATTERY, "limits": [50, 20]}, False),
        ({**BATTERY, "limits": [20, 20]}, False),
        ({**BATTERY, "limits": [20]}, False),
        ({**BATTERY, "limits": [20, "lots"]}, False),
        ({**BATTERY, "limits": [20, float("nan")]}, False),
        ({**BATTERY, "entity": ""}, False),
        ({**BATTERY, "values": ["red", 2, "green"]}, False),
        ({"entity": "sensor.x", "limits": [], "values": ["red"]}, False),
        (
            {"entity": "sensor.x", "limits": [1, 2, 3, 4, 5], "values": ["red"] * 6},
            False,
        ),
        ({"entity": "sensor.x", "limits": [1, 2, 3, 4], "values": ["red"] * 5}, True),
        ("sensor.x", False),
        (None, False),
    ],
)
def test_bands_are_read_only_when_usable(raw: Any, usable: bool) -> None:
    assert (Bands.parse(raw) is not None) is usable


def test_a_reading_picks_its_band() -> None:
    bands = Bands.parse(BATTERY)
    assert bands is not None
    picks = {r: bands.pick(r) for r in ("0", "19.9", "20", "49", "50", "100", "-3")}
    assert picks == {
        "0": "red",
        "19.9": "red",
        "20": "orange",
        "49": "orange",
        "50": "green",
        "100": "green",
        "-3": "red",
    }
    assert bands.pick("unavailable") is None
    assert bands.pick(None) is None
    assert bands.stored() == BATTERY


def test_bands_rank_below_a_template_and_above_an_entity() -> None:
    scope = {"x__bands": BATTERY, "x__entity": "sensor.color"}
    source = read_source("x", scope)
    assert source is not None
    assert source.source is Source.BANDS
    assert source.dependencies == {"sensor.phone_battery"}
    templated = read_source("x", {**scope, "x__template": "{{ 'blue' }}"})
    assert templated is not None
    assert templated.source is Source.TEMPLATE
    # Bands that are not usable are no source: the entity is read.
    broken = read_source("x", {**scope, "x__bands": {**BATTERY, "limits": [9]}})
    assert broken is not None
    assert broken.source is Source.ENTITY


def test_a_color_by_value_falls_back_to_its_literal_and_stays_in_the_palette() -> None:
    color = blocks.Color()

    def accent(reading: str | None, bands: dict[str, Any] = BATTERY) -> Any:
        states = {} if reading is None else {"sensor.phone_battery": reading}
        data = {"accent": "gray", "accent__bands": bands}
        return color.resolve("accent", data, Resolver(states=states))

    assert [accent(r) for r in ("12", "35", "64")] == ["red", "orange", "green"]
    # No reading to place: the fixed color.
    assert accent("unavailable") == "gray"
    assert accent(None) == "gray"
    # A value the palette does not have never reaches the wire.
    assert accent("64", {**BATTERY, "values": ["red", "orange", "#00FF00"]}) == "gray"


def test_every_color_of_a_widget_can_follow_a_reading() -> None:
    bindings = {
        "state": "sensor.phone_battery",
        "state__color__bands": BATTERY,
        "icon": "battery.100percent",
        "icon__color__bands": BATTERY,
        "icon__secondary_color__bands": {**BATTERY, "entity": "sensor.other"},
        "accent__bands": BATTERY,
    }
    resolver = Resolver(states={"sensor.phone_battery": "15", "sensor.other": "90"})
    content = engine.resolve(STATUS, bindings, resolver)
    assert content is not None
    assert content["state"] == {"value": "15", "text_color": "red"}
    assert content["icon"] == {
        "name": "battery.100percent",
        "primary_color": "red",
        "secondary_color": "green",
    }
    assert content["accent"] == "red"
    # The reading feeds the subscription, another entity too.
    assert engine.dependencies(STATUS, bindings) == {
        "sensor.phone_battery",
        "sensor.other",
    }
    # The metadata offers bands on palette colors only.
    sources = {
        use.address: use.slot.sources for use in engine.slot_uses(STATUS, bindings)
    }
    assert "bands" in sources["accent"]
    assert "bands" in sources["icon__tertiary_color"]
    assert "bands" not in sources["state"]


def test_a_gauge_ring_by_value_is_one_color_whatever_happens() -> None:
    """The ring's one color follows the reading in bands; without a band
    it is the first color picked, and it never turns into a gradient."""
    heat = {
        "entity": "sensor.living_temp",
        "limits": [18, 25],
        "values": ["blue", "green", "red"],
    }
    bindings = {
        "value": "sensor.living_temp",
        "min_value": 10,
        "max_value": 30,
        "ring": ["cyan", "green", "orange"],
        "ring__bands": heat,
    }

    def ring(reading: str | None, **more: Any) -> dict[str, Any]:
        states = {"sensor.other": "1"}
        if reading is not None:
            states["sensor.living_temp"] = reading
        content = engine.resolve(GAUGE, {**bindings, **more}, Resolver(states=states))
        assert content is not None or reading is None
        return {k: v for k, v in (content or {}).items() if k in ("color", "gradient")}

    assert ring("12") == {"color": "blue"}
    assert ring("21.5") == {"color": "green"}
    assert ring("29") == {"color": "red"}
    # No reading to place: the first color picked, still one.
    content = engine.resolve(
        GAUGE,
        {**bindings, "value": "sensor.other"},
        Resolver(states={"sensor.other": "1", "sensor.living_temp": "unavailable"}),
    )
    assert content is not None
    assert content["color"] == "cyan"
    assert "gradient" not in content
    # Without bands the ramp is as it was.
    plain = {k: v for k, v in bindings.items() if k != "ring__bands"}
    content = engine.resolve(
        GAUGE, plain, Resolver(states={"sensor.living_temp": "21"})
    )
    assert content is not None
    assert content["gradient"] == ["cyan", "green", "orange"]
    assert "color" not in content
    assert engine.dependencies(GAUGE, bindings) == {"sensor.living_temp"}
    ring_meta = next(
        f for f in describe_template(GAUGE)["fields"] if f["key"] == "ring"
    )
    assert ring_meta["slots"][""]["sources"] == ["bands"]


async def test_the_preview_shows_a_color_by_value_and_previews_other_readings(
    hass, hass_ws_client
) -> None:
    await setup_account(hass)
    hass.states.async_set(
        "sensor.phone_battery",
        "64",
        {"device_class": "battery", "unit_of_measurement": "%"},
    )
    client = await hass_ws_client(hass)
    bindings = {
        "state": "sensor.phone_battery",
        "accent": "gray",
        "accent__bands": BATTERY,
    }

    async def preview(states: dict[str, str] | None = None) -> dict[str, Any]:
        msg: dict[str, Any] = {
            "type": "aivi/preview",
            "template": "status",
            "bindings": bindings,
        }
        if states is not None:
            msg["states"] = states
        await client.send_json_auto_id(msg)
        answer = await client.receive_json()
        assert answer["success"], answer
        return answer["result"]

    now = await preview()
    assert now["content"]["accent"] == "green"
    assert now["fields"]["accent"] == {"status": "ok", "value": "green"}
    # "Preview as": the widget at another reading, the value and its color
    # both, without touching Home Assistant.
    low = await preview({"sensor.phone_battery": "10"})
    assert low["content"]["accent"] == "red"
    assert low["content"]["state"]["value"] == "10"
    assert hass.states.get("sensor.phone_battery").state == "64"
    # No reading to place: the fixed color, and the field says so (the
    # widget itself waits for its state).
    gone = await preview({"sensor.phone_battery": "unavailable"})
    assert gone["content"] is None
    assert gone["fields"]["accent"] == {"status": "fallback", "reading": "unavailable"}


async def test_save_refuses_bands_on_something_that_is_not_an_entity(
    hass, hass_ws_client
) -> None:
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)
    save = {
        "type": "aivi/save",
        "entry_id": entry.entry_id,
        "slug": "phone",
        "name": "Phone",
        "template": "status",
    }
    await client.send_json_auto_id(
        {
            **save,
            "bindings": {
                "state": "sensor.phone_battery",
                "accent__bands": {**BATTERY, "entity": "not an entity"},
            },
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert "not an entity" in msg["error"]["message"]
    await client.send_json_auto_id(
        {
            **save,
            "bindings": {"state": "sensor.phone_battery", "accent__bands": BATTERY},
        }
    )
    msg = await client.receive_json()
    assert msg["success"], msg
