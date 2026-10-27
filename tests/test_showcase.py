"""The showcase template: a picture, a state mark, when the thing last
reported and one to six stats, held to what Aivi takes."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from test_contract import assert_valid_request

from contract.openapi import document
from custom_components.aivi import engine, limits
from custom_components.aivi.metadata import describe_template
from custom_components.aivi.showcase import (
    PICTURE_FITS,
    content_size,
    state_word,
    wire_moment,
)
from custom_components.aivi.sources import HassStateResolver
from custom_components.aivi.switchboard import MAX_CONTENT_BYTES
from custom_components.aivi.templates import SHOWCASE
from helpers import Resolver

CAR = "https://cdn.example.com/cars/ioniq5-side.png"

STATES = {
    "sensor.car_battery": "78",
    "sensor.car_range": "312",
    "sensor.car_odometer": "24180.0",
    "lock.car": "locked",
    "sensor.printer_job": "Printing",
    "sensor.gone": "unavailable",
}
ATTRS = {
    "sensor.car_battery": {"friendly_name": "Battery", "unit_of_measurement": "%"},
    "sensor.car_range": {"friendly_name": "Range", "unit_of_measurement": "km"},
    "sensor.car_odometer": {
        "friendly_name": "Odometer of the family car, a long name",
        "unit_of_measurement": "kilometres",
    },
    "lock.car": {
        "friendly_name": "Car lock",
        "entity_picture": CAR,
        "last_sync": "2026-10-05T09:41:12.734+02:00",
    },
}


def _resolve(bindings: dict[str, Any], **kw: Any) -> dict[str, Any] | None:
    resolver = Resolver(
        states={**STATES, **kw.get("states", {})},
        attrs={**ATTRS, **kw.get("attrs", {})},
    )
    return engine.resolve(SHOWCASE, bindings, resolver)


def _car(**extra: Any) -> dict[str, Any]:
    return {
        "image": CAR,
        "state": "lock.car",
        "state_icon": "lock.fill",
        "stats": ["sensor.car_battery", "sensor.car_range", "sensor.car_odometer"],
        **extra,
    }


def _valid(content: dict[str, Any]) -> None:
    assert_valid_request("patch", "/widgets/car", {"content": content})


def test_the_spec_example_resolves_and_is_valid() -> None:
    content = _resolve(
        _car(
            image_alt="Ioniq 5",
            badge="https://cdn.example.com/brands/hyundai.png",
            badge_alt="Hyundai",
            state__color="green",
            reported_at="lock.car",
            reported_at__attribute="last_sync",
            stats__options={"sensor.car_odometer": {"label": "Odometer", "unit": "km"}},
            icon="car.fill",
            accent="blue",
        )
    )
    assert content == {
        "template": "showcase",
        "image": {"url": CAR, "alt": "Ioniq 5"},
        "badge": {
            "url": "https://cdn.example.com/brands/hyundai.png",
            "alt": "Hyundai",
        },
        "state": {
            "text": {"value": "locked", "text_color": "green"},
            "icon": "lock.fill",
        },
        "reported_at": "2026-10-05T07:41:12Z",
        "stats": [
            {"label": "Battery", "value": {"value": "78"}, "unit": "%"},
            {"label": "Range", "value": {"value": "312"}, "unit": "km"},
            {"label": "Odometer", "value": {"value": "24180.0"}, "unit": "km"},
        ],
        "icon": "car.fill",
        "accent": "blue",
    }
    _valid(content)


def test_only_stats_is_the_least_content() -> None:
    content = _resolve({"stats": ["sensor.car_range"]})
    assert content == {
        "template": "showcase",
        "stats": [{"label": "Range", "value": {"value": "312"}, "unit": "km"}],
    }
    _valid(content)
    # Without a stat Aivi would refuse it, so nothing is pushed.
    assert _resolve({"stats": ["sensor.nothing_here"]}) is None
    assert _resolve({"image": CAR}) is None


def test_a_picture_goes_only_with_a_url_aivi_takes() -> None:
    for url in (
        "http://cdn.example.com/car.png",
        "/api/image/serve/car/512x512",
        "https://",
        "https://cdn.example.com/a car.png",
        "https://cdn.example.com/" + "a" * limits.IMAGE_URL,
    ):
        content = _resolve(_car(image=url, image_alt="Car", image_fit="cover"))
        assert content is not None
        assert "image" not in content, url
        _valid(content)


def test_a_cut_out_is_the_default_fit_and_left_out() -> None:
    contain = _resolve(_car(image_fit="contain"))
    assert contain is not None
    assert contain["image"] == {"url": CAR}
    cover = _resolve(_car(image_fit="cover"))
    assert cover is not None
    assert cover["image"] == {"url": CAR, "fit": "cover"}
    _valid(cover)
    assert _resolve(_car(image_fit="stretch"))["image"] == {"url": CAR}  # type: ignore[index]


def test_the_picture_follows_an_entity_picture() -> None:
    content = _resolve(
        _car(image="", image__entity="lock.car", image__attribute="entity_picture")
    )
    assert content is not None
    assert content["image"] == {"url": CAR}
    # A Home Assistant address the device can't fetch is left out.
    local = _resolve(
        _car(image="", image__entity="lock.car", image__attribute="entity_picture"),
        attrs={"lock.car": {"entity_picture": "/api/image/serve/car/512x512"}},
    )
    assert local is not None
    assert "image" not in local


def test_the_state_mark_is_one_short_word() -> None:
    long = _resolve(
        _car(), states={"lock.car": "  Locked\tand\nsecure, all doors shut  "}
    )
    assert long is not None
    word = long["state"]["text"]["value"]
    assert word == "Locked and secure, all d"
    assert len(word) <= limits.STATE_TEXT
    _valid(long)
    # A formatter has no place on a word.
    timed = _resolve(_car(state__formatter="time_since"))
    assert timed is not None
    assert "formatter" not in timed["state"]["text"]
    # No word, no mark: its icon alone is not sent.
    empty = _resolve(_car(), states={"lock.car": "   "})
    assert empty is not None
    assert "state" not in empty
    _valid(empty)
    assert state_word(None) is None
    assert state_word("\x00\x07") is None


def test_stats_keep_to_the_caps() -> None:
    six = [f"sensor.s{i}" for i in range(8)]
    content = _resolve(
        {
            "stats": six,
            "stats__options": {
                "sensor.s0": {
                    "label": "A label well past twenty-four",
                    "unit": "kilowatt-hours",
                },
                "sensor.s1": {"icon": "bolt.fill", "color": "green", "max": "100"},
                "sensor.s2": {"max": "-5"},
                "sensor.s3": {"max": "80"},
                "sensor.s4": {"color": "chartreuse"},
            },
        },
        states={
            "sensor.s0": "1.5e3",
            "sensor.s1": "78",
            "sensor.s2": "40",
            "sensor.s3": "Charging",
            "sensor.s4": "12",
            "sensor.s5": "unavailable",
            "sensor.s6": "1",
            "sensor.s7": "2",
        },
    )
    assert content is not None
    stats = content["stats"]
    assert len(stats) == limits.STATS
    assert stats[0] == {
        "label": "A label well past twenty"[: limits.STAT_LABEL],
        "value": {"value": "1500"},
        "unit": "kilowatt"[: limits.STAT_UNIT],
    }
    assert stats[1] == {
        "label": "sensor.s1",
        "value": {"value": "78", "text_color": "green"},
        "icon": "bolt.fill",
        "max": 100,
    }
    # A ceiling that is not above 0, or on a word, is not sent.
    assert "max" not in stats[2]
    assert "max" not in stats[3]
    assert stats[4]["value"] == {"value": "12"}
    # An unavailable reading keeps its stat, so the layout holds.
    assert stats[5]["value"] == {"value": "unavailable"}
    _valid(content)


def test_the_unit_follows_the_entity_unless_set() -> None:
    own = _resolve(
        {
            "stats": ["sensor.car_range"],
            "stats__options": {"sensor.car_range": {"unit": "mi"}},
        }
    )
    assert own is not None
    assert own["stats"][0]["unit"] == "mi"
    none = _resolve({"stats": ["sensor.printer_job"]})
    assert none is not None
    assert "unit" not in none["stats"][0]


async def test_reported_at_is_when_the_entity_last_reported(
    hass: HomeAssistant,
) -> None:
    moment = datetime(2026, 10, 5, 7, 41, 12, 734000, tzinfo=UTC)
    hass.states.async_set("sensor.car_range", "312", timestamp=moment.timestamp())
    content = engine.resolve(
        SHOWCASE,
        {"stats": ["sensor.car_range"], "reported_at": "sensor.car_range"},
        HassStateResolver(hass),
    )
    assert content is not None
    assert content["reported_at"] == "2026-10-05T07:41:12Z"
    # An unchanged reading still counts as a report.
    later = moment + timedelta(minutes=5)
    hass.states.async_set(
        "sensor.car_range", "312", force_update=True, timestamp=later.timestamp()
    )
    again = engine.resolve(
        SHOWCASE,
        {"stats": ["sensor.car_range"], "reported_at": "sensor.car_range"},
        HassStateResolver(hass),
    )
    assert again is not None
    assert again["reported_at"] == "2026-10-05T07:46:12Z"
    missing = engine.resolve(
        SHOWCASE,
        {"stats": ["sensor.car_range"], "reported_at": "sensor.nothing"},
        HassStateResolver(hass),
    )
    assert missing is not None
    assert "reported_at" not in missing


def test_reported_at_from_an_entity_needs_a_resolver_that_knows() -> None:
    # A plain resolver can't say when an entity reported; its state is
    # never read as a date.
    content = _resolve(_car(reported_at="sensor.car_battery"))
    assert content is not None
    assert "reported_at" not in content


def test_reported_at_from_a_template_or_attribute() -> None:
    resolver = Resolver(
        states=STATES,
        attrs=ATTRS,
        renders={"{{ x }}": "2026-10-05 09:41:12+02:00", "{{ bad }}": "soon"},
    )
    for template, expected in (
        ("{{ x }}", "2026-10-05T07:41:12Z"),
        ("{{ bad }}", None),
    ):
        content = engine.resolve(
            SHOWCASE, _car(reported_at__template=template), resolver
        )
        assert content is not None
        assert content.get("reported_at") == expected
    assert wire_moment(
        datetime(2026, 1, 1, 1, tzinfo=timezone(timedelta(hours=2)))
    ) == ("2025-12-31T23:00:00Z")


def test_the_measure_counts_what_aivi_stores() -> None:
    content = _resolve(_car(image_fit="cover"))
    assert content is not None
    stored = {
        "icon": None,
        "accent": None,
        "tap_url": None,
        **content,
        "image": {"url": CAR, "alt": None, "fit": "cover"},
        "stats": [
            {
                **s,
                "value": {
                    "value": s["value"]["value"],
                    "text_color": None,
                    "formatter": None,
                },
            }
            for s in content["stats"]
        ],
    }
    assert content_size(content) == len(json.dumps(stored, separators=(",", ":")))
    # Six full stats fit; long picture URLs do not.
    big = {
        **content,
        "stats": [
            {
                "label": "x" * limits.STAT_LABEL,
                "value": {"value": "1" * 20, "text_color": "green"},
                "unit": "u" * limits.STAT_UNIT,
                "icon": "i" * limits.ICON,
                "max": 100,
            }
        ]
        * limits.STATS,
    }
    assert content_size(big) < MAX_CONTENT_BYTES
    huge = {
        **big,
        "image": {"url": "https://a.example/" + "a" * 2000},
        "badge": {"url": "https://b.example/" + "b" * 2000},
    }
    assert content_size(huge) > MAX_CONTENT_BYTES
    # A word mark with a styled icon is measured as stored too.
    styled = {
        **content,
        "state": {"text": {"value": "OK"}, "icon": {"name": "lock.fill"}},
    }
    assert content_size(styled) > content_size(
        {**content, "state": {"text": {"value": "OK"}}}
    )


def test_the_panel_metadata() -> None:
    fields = {f["key"]: f for f in describe_template(SHOWCASE)["fields"]}
    assert fields["stats"]["kind"] == "rows"
    assert fields["stats"]["max"] == limits.STATS
    assert fields["stats"]["row_options"] == ["label", "unit", "icon", "color", "max"]
    assert fields["state"]["kind"] == "value"
    assert fields["state"]["formatter"] is False
    assert fields["reported_at"]["kind"] == "reported"
    assert fields["image"]["picture"] is True
    assert fields["image_fit"]["options"] == list(PICTURE_FITS)
    assert fields["image_fit"]["default"] == "contain"
    assert fields["stats"]["required"] is True


def test_the_fits_are_aivis() -> None:
    schemas = document()["components"]["schemas"]
    assert list(PICTURE_FITS) == schemas["HeroImage"]["properties"]["fit"]["enum"]
