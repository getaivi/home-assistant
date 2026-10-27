"""What Aivi rejects is never sent: values are clamped or left out.

The palette is a closed enum on the wire: a color outside it gets a 422, a
permanent ``content_rejected`` repair issue that halts pushes."""

from __future__ import annotations

import pytest

from custom_components.aivi import blocks, engine, templates, values
from custom_components.aivi.templates import GAUGE, PROGRESS
from helpers import Resolver


def test_value_drops_a_text_color_outside_the_palette() -> None:
    resolver = Resolver(states={"sensor.x": "42"})
    out = blocks.Value().resolve(
        "v", {"v": "sensor.x", "v__color": "#ff0000"}, resolver
    )
    assert out == {"value": "42"}, "a non-palette color must not reach the wire"

    ok = blocks.Value().resolve("v", {"v": "sensor.x", "v__color": "red"}, resolver)
    assert ok == {"value": "42", "text_color": "red"}


def test_color_block_drops_anything_outside_the_palette() -> None:
    resolver = Resolver()
    assert blocks.Color().resolve("accent", {"accent": "cyan"}, resolver) == "cyan"
    assert blocks.Color().resolve("accent", {"accent": "#0ff"}, resolver) is None


def test_icon_clamps_its_colors_and_enums() -> None:
    resolver = Resolver()
    out = blocks.Icon().resolve(
        "icon",
        {
            "icon": "bolt",
            "icon__color": "#00ff00",
            "icon__secondary_color": "mint",
            "icon__rendering_mode": "not-a-mode",
        },
        resolver,
    )
    # Bad values are dropped; the icon itself survives.

    assert out == {"name": "bolt", "secondary_color": "mint"}


def test_content_is_tagged_with_its_template() -> None:
    content = engine.resolve(
        templates.STATUS, {"state": "s.x"}, Resolver(states={"s.x": "Open"})
    )
    assert content == {"template": "status", "state": {"value": "Open"}}


def test_a_monitor_column_without_its_value_is_left_out() -> None:
    resolver = Resolver(states={"s.r": "21"}, renders={})
    bindings = {
        "right_value": "s.r",
        "left_value": "s.missing",
        "left_header": "Inside",
        "left_footer": "°C",
        "right_header": "Outside",
    }
    content = engine.resolve(templates.ACTIVITY_MONITOR, bindings, resolver)
    assert content == {
        "template": "monitor",
        "right_column": {"value": {"value": "21"}, "header": "Outside"},
    }


def test_text_is_held_to_each_fields_cap() -> None:
    long = "x" * 300
    resolver = Resolver(states={"s.v": long, "s.t": long})
    gauge = engine.resolve(
        GAUGE,
        {
            "value": "s.n",
            "unit__entity": "s.t",
            "label": long,
        },
        Resolver(states={"s.n": "3", "s.t": long}),
    )
    assert gauge is not None
    assert (len(gauge["unit"]), len(gauge["label"])) == (16, 64)
    status = engine.resolve(templates.STATUS, {"state": "s.v"}, resolver)
    assert status is not None and len(status["state"]["value"]) == 128
    countdown = engine.resolve(
        templates.COUNTDOWN,
        {"target": "s.when", "expired_text": long},
        Resolver(states={"s.when": "2026-10-01T00:00:00+00:00"}),
    )
    assert countdown is not None and len(countdown["expired_text"]) == 64


def test_rows_are_capped_and_clamped() -> None:
    ids = [f"sensor.r{i}" for i in range(10)]
    resolver = Resolver(
        states={eid: "x" * 200 for eid in ids},
        attrs={eid: {"friendly_name": "n" * 100} for eid in ids},
    )
    content = engine.resolve(templates.LIST, {"rows": ids}, resolver)
    assert content is not None
    rows = content["rows"]
    assert len(rows) == 8
    assert {len(row["label"]) for row in rows} == {64}
    assert {len(row["value"]["value"]) for row in rows} == {128}
    battery = templates.BATTERY.fields[0].block
    assert blocks.depends(battery, "devices", {"devices": ids}) == set(ids[:8])


@pytest.mark.parametrize(
    ("state", "level"),
    [("100.4", 100), ("-3", 0), ("57.5", 57.5), ("nan", None), ("inf", None)],
)
def test_battery_levels_stay_in_range(state, level) -> None:
    resolver = Resolver(states={"sensor.b": state}, attrs={})
    content = engine.resolve(templates.BATTERY, {"devices": ["sensor.b"]}, resolver)
    if level is None:
        assert content is None
    else:
        assert content is not None
        assert content["devices"][0]["level"] == level


@pytest.mark.parametrize(
    ("state", "value"),
    [("100.4", 1), ("-2", 0), ("41", 0.41), ("nan", None), ("-inf", None)],
)
def test_progress_stays_between_zero_and_one(state, value) -> None:
    content = engine.resolve(
        PROGRESS, {"progress": "s.p"}, Resolver(states={"s.p": state})
    )
    if value is None:
        assert content is None
    else:
        assert content is not None and content["progress"]["value"] == value


def test_non_finite_numbers_are_unresolved() -> None:
    resolver = Resolver(states={"s.n": "inf"})
    assert engine.resolve(GAUGE, {"value": "s.n"}, resolver) is None
    content = engine.resolve(
        GAUGE,
        {"value": "s.ok", "min_value": "nan", "max_value": float("inf")},
        Resolver(states={"s.ok": "1"}),
    )
    assert content == {"template": "gauge", "value": 1}
    assert values.finite_number(True) is None
    assert values.finite_number("1e400") is None


def test_an_enum_outside_its_options_is_left_out() -> None:
    block = blocks.Enum(["left", "right"])
    assert block.resolve("p", {"p": "left"}, Resolver()) == "left"
    assert block.resolve("p", {"p": "middle"}, Resolver()) is None


@pytest.mark.parametrize(
    ("url", "kept"),
    [
        ("https://example.com/a?b=c#d", True),
        ("homeassistant://navigate/lovelace/0", True),
        ("tel:+46701234567", True),
        ("example.com", False),
        ("/lovelace/0", False),
        ("https://exa mple.com", False),
        ("https://exämple.com", False),
        ("https://example.com/" + "p" * 237, False),
        ("https://example.com/" + "p" * 236, True),
    ],
)
def test_a_tap_url_is_an_absolute_uri_or_nothing(url, kept) -> None:
    out = blocks.Url().resolve("tap_url", {"tap_url": url}, Resolver())
    assert out == (url if kept else None)
