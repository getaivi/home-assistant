"""Field blocks and value sources against a plain dict resolver."""

from __future__ import annotations

import json
import math
from datetime import date, datetime
from typing import Any

import pytest
from homeassistant.util import dt as dt_util

from custom_components.aivi import blocks, engine, templates, values
from custom_components.aivi.blocks import RootFragment
from custom_components.aivi.sources import SourcedValue
from custom_components.aivi.templates import GAUGE, PROGRESS
from custom_components.aivi.values import as_bool
from helpers import Resolver


def test_scalar_source_precedence_template_attribute_entity() -> None:
    resolver = Resolver(
        states={"sensor.a": "42"},
        attrs={"sensor.a": {"battery": 7}},
        renders={"{{ x }}": "rendered"},
    )
    block = blocks.Number()
    data = {
        "value": "sensor.a",
        "value__attribute": "battery",
        "value__template": "{{ x }}",
        "value__watched": ["sensor.a"],
    }
    # Template wins; template result tracking follows it, not the state
    # subscription.
    assert block.resolve("value", data, resolver) is None  # "rendered" isn't a number
    assert blocks.depends(block, "value", data) == set()
    del data["value__template"]
    assert block.resolve("value", data, resolver) == 7.0
    del data["value__attribute"]
    assert block.resolve("value", data, resolver) == 42.0


def test_number_scales_and_rejects_junk() -> None:
    resolver = Resolver(states={"sensor.pct": "62", "sensor.txt": "hello"})
    assert blocks.Number(scale=0.01).resolve("v", {"v": "sensor.pct"}, resolver) == 0.62
    assert blocks.Number().resolve("v", {"v": "sensor.txt"}, resolver) is None
    assert blocks.Number().resolve("v", {}, resolver) is None


def test_number_wire_values_carry_no_float_noise() -> None:
    """Scaling must not leak float noise onto the wire: 41 * 0.01 is
    0.41000000000000003 raw."""
    resolver = Resolver(
        states={"sensor.pct": "41"},
        renders={"{{ noisy }}": "32.400000000000006"},
    )
    scaled = blocks.Number(scale=0.01).resolve("v", {"v": "sensor.pct"}, resolver)
    assert scaled == 0.41
    assert json.dumps(scaled) == "0.41"
    # Noisy template output (e.g. Jinja arithmetic) is normalized too.
    gauge = blocks.Number().resolve("v", {"v__template": "{{ noisy }}"}, resolver)
    assert gauge == 32.4
    # A whole-number gauge value serializes as an integer, not "41.0".
    whole = blocks.Number().resolve("v", {"v": "sensor.pct"}, resolver)
    assert whole == 41 and isinstance(whole, int)


def test_wire_number_policy() -> None:
    """12 significant digits: strips arithmetic noise at any magnitude,
    keeps every real sensor resolution, collapses integral floats."""
    assert repr(values.wire_number(41 * 0.01)) == "0.41"
    assert repr(values.wire_number(0.1 + 0.2)) == "0.3"
    assert values.wire_number(21.5) == 21.5
    assert values.wire_number(68.0) == 68 and isinstance(values.wire_number(68.0), int)
    # SegmentList's 1024th quantization passes through untouched.
    assert values.wire_number(511 / 1024) == 511 / 1024
    # Non-finite and astronomically large values pass through unharmed.
    assert values.wire_number(math.inf) == math.inf
    assert math.isnan(values.wire_number(math.nan))
    assert isinstance(values.wire_number(1e300), float)


def test_bool_and_timestamp_blocks() -> None:
    resolver = Resolver(states={"b.on": "on", "b.off": "off"})
    assert blocks.Bool().resolve("v", {"v": "b.on"}, resolver) is True
    assert blocks.Bool().resolve("v", {"v": "b.off"}, resolver) is False
    assert blocks.Bool().resolve("v", {}, resolver) is None
    assert as_bool("Playing") and not as_bool("idle")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-10-01T12:00:00+02:00", "2026-10-01T12:00:00+02:00"),
        ("2026-10-01T10:00:00Z", "2026-10-01T10:00:00+00:00"),
        # Naive and date-only values are read in Home Assistant's zone.
        ("2026-10-01 12:00:00", "2026-10-01T12:00:00+01:00"),
        ("2026-01-01", "2026-01-01T00:00:00+01:00"),
        (datetime(2026, 10, 1, 12, 0), "2026-10-01T12:00:00+01:00"),
        (date(2026, 1, 1), "2026-01-01T00:00:00+01:00"),
        # A Unix timestamp, as as_timestamp() renders it.
        ("1790000000.5", "2026-09-21T14:13:20.500000+00:00"),
        (1790000000, "2026-09-21T14:13:20+00:00"),
        ("soon", None),
        ("nan", None),
        ("1e30", None),
    ],
)
def test_timestamps_go_out_with_an_offset(raw, expected) -> None:
    """Aivi accepts only aware timestamps; a naive one would be rejected."""
    zone = dt_util.get_default_time_zone()
    dt_util.set_default_time_zone(dt_util.get_time_zone("Africa/Lagos"))
    try:
        resolver = Resolver(states={"t.x": raw})
        assert blocks.Timestamp().resolve("v", {"v": "t.x"}, resolver) == expected
    finally:
        dt_util.set_default_time_zone(zone)


def test_value_block_carries_color_and_formatter() -> None:
    resolver = Resolver(states={"s.x": "Open"})
    data = {"v": "s.x", "v__color": "red", "v__formatter": "time_since"}
    assert blocks.Value().resolve("v", data, resolver) == {
        "value": "Open",
        "text_color": "red",
        "formatter": "time_since",
    }
    assert blocks.Value().resolve("v", {"v": "s.x"}, resolver) == {"value": "Open"}


def test_icon_block_styles_only_when_asked() -> None:
    resolver = Resolver()
    bare = blocks.Icon().resolve("icon", {"icon": "washer.fill"}, resolver)
    assert bare == "washer.fill"
    styled = blocks.Icon().resolve(
        "icon",
        {
            "icon": "washer.fill",
            "icon__color": "teal",
            "icon__rendering_mode": "palette",
            "icon__secondary_color": "gray",
            "icon__color_rendering": "gradient",
        },
        resolver,
    )
    assert styled == {
        "name": "washer.fill",
        "primary_color": "teal",
        "rendering_mode": "palette",
        "secondary_color": "gray",
        "color_rendering": "gradient",
    }
    assert blocks.Icon().resolve("icon", {}, resolver) is None
    assert blocks.depends(blocks.Icon(), "icon", {}) == set()


def test_number_literal_block() -> None:
    resolver = Resolver()
    block = blocks.NumberLiteral()
    assert block.resolve("min", {"min": 5}, resolver) == 5.0
    assert block.resolve("min", {"min": "5.5"}, resolver) == 5.5
    assert block.resolve("min", {"min": ""}, resolver) is None
    assert block.resolve("min", {"min": "x"}, resolver) is None
    assert block.resolve("min", {}, resolver) is None
    assert blocks.depends(block, "min", {"min": 5}) == set()


def test_color_ramp_solid_gradient_and_junk() -> None:
    resolver = Resolver()
    ramp = blocks.ColorRamp(solid_key="color", gradient_key="gradient")
    assert ramp.resolve("ring", {}, resolver) is None
    solid = ramp.resolve("ring", {"ring": ["teal"]}, resolver)
    assert isinstance(solid, RootFragment) and solid == {"color": "teal"}
    grad = ramp.resolve("ring", {"ring": ["green", "hotpink", "red"]}, resolver)
    assert grad == {"gradient": ["green", "red"]}  # junk filtered
    capped = ramp.resolve(
        "ring", {"ring": ["red", "orange", "yellow", "green", "mint"]}, resolver
    )
    assert len(capped["gradient"]) == ramp.MAX
    assert blocks.depends(ramp, "ring", {"ring": ["red"]}) == set()


def test_blank_template_renders_are_unresolved() -> None:
    """Whatever the preview reports as "renders to nothing" (blank,
    unknown/unavailable, and the "None" that ``parse_result=False`` makes
    of a ``None`` expression) resolves as unresolved, not ``{"value": ""}``."""
    for nothing in (None, "", "   ", "None", "unknown", "unavailable"):
        resolver = Resolver(renders={"{{ x }}": nothing})
        assert SourcedValue.tmpl("{{ x }}").resolve(resolver) is None
        assert blocks.Value().resolve("v", {"v__template": "{{ x }}"}, resolver) is None
        assert blocks.Text().resolve("u", {"u__template": "{{ x }}"}, resolver) is None
    # Falsy-looking but real values still pass through.
    for real in ("0", "False", "off"):
        resolver = Resolver(renders={"{{ x }}": real})
        assert SourcedValue.tmpl("{{ x }}").resolve(resolver) == real


def test_text_block_renders_templates() -> None:
    resolver = Resolver(renders={"{{ 1 }}": "1"})
    block = blocks.Text()
    assert block.resolve("unit", {"unit": "°C"}, resolver) == "°C"
    assert block.resolve("unit", {"unit__template": "{{ 1 }}"}, resolver) == "1"
    assert (
        blocks.depends(
            block, "unit", {"unit__template": "{{ 1 }}", "unit__watched": ["sensor.a"]}
        )
        == set()
    )
    assert blocks.depends(block, "unit", {"unit": "°C"}) == set()


def test_enum_block() -> None:
    resolver = Resolver()
    block = blocks.Enum(["a", "b"])
    assert block.options == ["a", "b"]
    assert block.resolve("mode", {"mode": "a"}, resolver) == "a"
    assert blocks.depends(block, "mode", {}) == set()


def test_entity_rows_skips_dead_rows() -> None:
    resolver = Resolver(states={"sensor.ok": "5"})

    def row(entity_id: str, r: Any, options: dict) -> dict | None:
        state = r.state(entity_id)
        return {"value": state} if state is not None else None

    block = blocks.EntityRows(row_builder=row, device_class="battery")
    data = {"rows": ["sensor.ok", "sensor.missing"]}
    assert block.resolve("rows", data, resolver) == [{"value": "5"}]
    assert blocks.depends(block, "rows", data) == {"sensor.ok", "sensor.missing"}
    assert block.resolve("rows", {}, resolver) is None
    assert block.filter_meta == {"device_class": "battery"}
    narrowed = blocks.EntityRows(
        row_builder=row,
        domain=["sensor", "input_number"],
        numeric=True,
        device_class_first="monetary",
    )
    assert narrowed.filter_meta == {
        "domain": ["sensor", "input_number"],
        "numeric": True,
        "device_class_first": "monetary",
    }


def test_entity_rows_per_row_options() -> None:
    """``<key>__options`` reach the row builder filtered to supported keys
    and non-empty strings; malformed data degrades to no options."""
    resolver = Resolver(states={"sensor.a": "1", "sensor.b": "2"})
    seen: dict[str, dict] = {}

    def row(entity_id: str, r: Any, options: dict) -> dict:
        seen[entity_id] = options
        return {"value": r.state(entity_id)}

    block = blocks.EntityRows(row_builder=row, row_options=("icon", "color"))
    assert block.row_options == ("icon", "color")
    data = {
        "rows": ["sensor.a", "sensor.b"],
        "rows__options": {
            "sensor.a": {"icon": "bolt.fill", "label": "dropped", "color": ""},
            "sensor.b": "not-a-dict",
        },
    }
    assert block.resolve("rows", data, resolver) == [{"value": "1"}, {"value": "2"}]
    assert seen == {"sensor.a": {"icon": "bolt.fill"}, "sensor.b": {}}
    seen.clear()
    block.resolve("rows", {"rows": ["sensor.a"], "rows__options": []}, resolver)
    assert seen == {"sensor.a": {}}


def test_list_and_battery_row_options_reach_the_wire() -> None:
    """List/battery rows carry icon, color (and a list label) into the
    payload; off-palette colors are dropped."""
    resolver = Resolver(
        states={"sensor.temp": "21.5", "sensor.vac": "68"},
        attrs={
            "sensor.temp": {"friendly_name": "Temperature"},
            "sensor.vac": {"friendly_name": "Vacuum"},
        },
    )
    list_rows = next(f for f in templates.LIST.fields if f.key == "rows")
    resolved = list_rows.block.resolve(
        "rows",
        {
            "rows": ["sensor.temp"],
            "rows__options": {
                "sensor.temp": {
                    "label": "  Inside  ",
                    "icon": "thermometer.medium",
                    "color": "orange",
                }
            },
        },
        resolver,
    )
    assert resolved == [
        {
            "label": "Inside",
            "value": {"value": "21.5", "text_color": "orange"},
            "icon": "thermometer.medium",
        }
    ]
    battery = next(f for f in templates.BATTERY.fields if f.key == "devices")
    resolved = battery.block.resolve(
        "devices",
        {
            "devices": ["sensor.vac"],
            "devices__options": {
                "sensor.vac": {"icon": "fan.fill", "color": "not-a-color"}
            },
        },
        resolver,
    )
    assert resolved == [{"name": "Vacuum", "level": 68, "icon": "fan.fill"}]
    # Without options the rows stay in their bare shape (defaults apply).
    assert battery.block.resolve("devices", {"devices": ["sensor.vac"]}, resolver) == [
        {"name": "Vacuum", "level": 68}
    ]


def test_sourced_value_dependencies() -> None:
    tmpl = SourcedValue.tmpl("{{ x }}", watched=("sensor.a",))
    assert tmpl.dependencies == set()
    attr = SourcedValue.attr("sensor.a", "battery")
    assert attr.dependencies == {"sensor.a"}
    assert attr.resolve(Resolver(attrs={"sensor.a": {"battery": 9}})) == 9
    unavailable = SourcedValue.entity("sensor.x")
    assert unavailable.resolve(Resolver(states={"sensor.x": "unavailable"})) is None


def test_segment_list_normalizes_to_an_exact_sum() -> None:
    resolver = Resolver()
    block = blocks.SegmentList()
    # 0.15 + 0.35 + 0.5 fails the backend's float-equality sum check raw;
    # quantized to 1024ths the sum is exactly 1.0 by construction.
    fragment = block.resolve(
        "segments",
        {
            "segments": [
                {"value": 0.15, "fill_color": "cyan", "label": "Build"},
                {"value": 0.35, "fill_color": "blue"},
                {"value": 0.5, "fill_color": "gray", "track_fill": "hatched"},
            ],
            "segments__display": "layered",
        },
        resolver,
    )
    assert isinstance(fragment, RootFragment)
    assert fragment["style"] == "segmented"
    assert fragment["display"] == "layered"
    assert sum(s["value"] for s in fragment["segments"]) == 1.0
    assert fragment["segments"][0]["label"] == "Build"
    assert fragment["segments"][2]["track_fill"] == "hatched"


def test_segment_list_drops_junk() -> None:
    resolver = Resolver()
    block = blocks.SegmentList()
    assert block.resolve("segments", {"segments": "nope"}, resolver) is None
    assert (
        block.resolve(
            "segments",
            {
                "segments": [
                    {"value": 0, "fill_color": "red"},  # zero width
                    {"value": 0.5, "fill_color": "hotpink"},  # bad color
                    "garbage",
                ],
            },
            resolver,
        )
        is None
    )
    only = block.resolve(
        "segments",
        {
            "segments": [{"value": 3, "fill_color": "teal"}],
        },
        resolver,
    )
    assert only["segments"] == [{"value": 1.0, "fill_color": "teal"}]


def test_segment_list_sourced_weights_resolve_and_normalize() -> None:
    """Sourced segment weights resolve per push, normalize and quantize to
    1024ths like literals; source keys are stripped from the wire."""
    resolver = Resolver(
        states={"sensor.wash": "3"},
        attrs={"sensor.plan": {"spin": 1}},
        renders={"{{ r }}": "2"},
    )
    block = blocks.SegmentList()
    data = {
        "segments": [
            {"value": 0.5, "fill_color": "cyan", "source": "sensor.wash"},
            {
                "value": 0.3,
                "fill_color": "blue",
                "source": "sensor.plan",
                "source__attribute": "spin",
            },
            {
                "value": 0.2,
                "fill_color": "gray",
                "source__template": "{{ r }}",
                "source__watched": ["sensor.a"],
            },
        ]
    }
    assert blocks.depends(block, "segments", data) == {"sensor.wash", "sensor.plan"}
    fragment = block.resolve("segments", data, resolver)
    assert isinstance(fragment, RootFragment)
    values = [s["value"] for s in fragment["segments"]]
    # Resolved 3:1:2, quantized to 1024ths: the sum is exactly 1.0.
    assert values[0] == 512 / 1024
    assert sum(values) == 1.0
    assert all(not any(k.startswith("source") for k in s) for s in fragment["segments"])
    assert json.dumps(fragment["segments"][0])  # serializable, no leftovers


def test_segment_list_unresolvable_sources_fall_back_to_stored_weight() -> None:
    """An unusable sourced weight falls back to the stored literal; the
    segment is never dropped, which would reshuffle the bar."""
    resolver = Resolver(
        states={
            "sensor.gone": "unavailable",
            "sensor.txt": "hello",
            "sensor.neg": "-4",
            "sensor.inf": "inf",
        },
        renders={"{{ r }}": ""},
    )
    block = blocks.SegmentList()
    data = {
        "segments": [
            {"value": 0.25, "fill_color": "cyan", "source": "sensor.gone"},
            {"value": 0.25, "fill_color": "blue", "source": "sensor.txt"},
            {"value": 0.25, "fill_color": "green", "source__template": "{{ r }}"},
            {"value": 0.25, "fill_color": "gray", "source": "sensor.neg"},
        ]
    }
    fragment = block.resolve("segments", data, resolver)
    assert [s["value"] for s in fragment["segments"]] == [0.25, 0.25, 0.25, 0.25]
    # "inf" parses as a float but is non-finite.
    data["segments"][0]["source"] = "sensor.inf"
    fragment = block.resolve("segments", data, resolver)
    assert [s["value"] for s in fragment["segments"]] == [0.25, 0.25, 0.25, 0.25]
    # Empty source markers (UI leftovers) mean "literal": no dependencies.
    assert (
        blocks.depends(
            block,
            "segments",
            {"segments": [{"value": 1, "fill_color": "teal", "source": ""}]},
        )
        == set()
    )
    assert blocks.depends(block, "segments", {"segments": "nope"}) == set()


def test_progress_template_resolves_sourced_segment_weights() -> None:
    """Sourced segment weights resolve through the engine, and the
    template's dependencies include the segment sources."""
    resolver = Resolver(states={"sensor.p": "75", "sensor.wash": "0.6"})
    bindings = {
        "progress": "sensor.p",
        "segments": [
            {"value": 0.5, "fill_color": "cyan", "source": "sensor.wash"},
            {"value": 0.4, "fill_color": "blue"},
        ],
    }
    assert engine.dependencies(PROGRESS, bindings) == {"sensor.p", "sensor.wash"}
    content = engine.resolve(PROGRESS, bindings, resolver)
    segments = content["progress"]["segments"]
    # 0.6 vs 0.4 after resolution (the literal keeps its stored weight).
    assert segments[0]["value"] == 614 / 1024
    assert sum(s["value"] for s in segments) == 1.0


def test_progress_template_flips_to_segmented() -> None:
    resolver = Resolver(states={"sensor.p": "75"})
    content = engine.resolve(
        PROGRESS,
        {
            "progress": "sensor.p",
            "segments": [
                {"value": 0.25, "fill_color": "cyan"},
                {"value": 0.75, "fill_color": "blue"},
            ],
        },
        resolver,
    )
    assert content["progress"]["style"] == "segmented"
    assert content["progress"]["value"] == 0.75
    assert len(content["progress"]["segments"]) == 2
    # Without segments the constants keep the simple style.
    simple = engine.resolve(PROGRESS, {"progress": "sensor.p"}, resolver)
    assert simple["progress"]["style"] == "simple"


def test_registry_and_metadata_describe() -> None:
    from custom_components.aivi.metadata import describe_registry
    from custom_components.aivi.templates import (
        default_activity_registry,
        default_registry,
    )

    registry = default_registry()
    assert registry.is_supported("gauge")
    assert not registry.is_supported("forecast")
    described = describe_registry(registry, default_activity_registry())
    assert set(described["templates"]) == {
        "status",
        "progress",
        "gauge",
        "countdown",
        "list",
        "battery",
        "budget",
        "trend",
        "prices",
        "energy",
        "switchboard",
        "showcase",
        "remote",
    }
    assert set(described["activity_templates"]) == {"progress", "monitor", "remote"}
    gauge = described["templates"]["gauge"]
    kinds = {f["key"]: f["kind"] for f in gauge["fields"]}
    assert kinds["min_value"] == "number_literal"
    assert kinds["ring"] == "colors"
    icon = next(f for f in gauge["fields"] if f["key"] == "icon")
    assert "palette" in icon["rendering_modes"]

    progress = described["templates"]["progress"]
    # Lets the panel offer per-segment source switching.
    segments = next(f for f in progress["fields"] if f["key"] == "segments")
    assert segments["sourced_values"] is True


class _SuggestFakeHass:
    """Just enough hass for AiTaskSuggester.state() and .models()."""

    def __init__(
        self,
        components: set[str],
        data: dict[Any, Any] | None = None,
        known: dict[str, str] | None = None,
    ) -> None:
        from types import SimpleNamespace

        existing = {
            entity_id: SimpleNamespace(entity_id=entity_id, name=name)
            for entity_id, name in (known or {}).items()
        }
        self.config = type("Config", (), {"components": components})()
        self.data = data or {}
        self.states = SimpleNamespace(
            get=lambda e: existing.get(e),
            async_all=lambda domain: [
                st for e, st in existing.items() if e.startswith(f"{domain}.")
            ],
        )


def test_ai_task_suggester_state_not_loaded() -> None:
    """Without ai_task loaded, state() reports it without importing it."""
    from custom_components.aivi.suggest import AiTaskSuggester

    assert AiTaskSuggester().state(_SuggestFakeHass(set())) == "not_loaded"
    assert AiTaskSuggester().models(_SuggestFakeHass(set())) == []


def test_ai_task_suggester_state_when_loaded(monkeypatch) -> None:
    """ "no_entity" until a model provides data generation, then "ready";
    the models list the preferred one first. ai_task isn't importable in
    the test env, so the lazy import is served a stub."""
    import sys
    from types import SimpleNamespace

    monkeypatch.setitem(
        sys.modules,
        "homeassistant.components.ai_task",
        SimpleNamespace(DATA_PREFERENCES="ai_task_preferences"),
    )
    from custom_components.aivi.suggest import AiTaskSuggester

    suggester = AiTaskSuggester()
    loaded = {"ai_task"}
    assert suggester.state(_SuggestFakeHass(loaded)) == "no_entity"

    prefs = SimpleNamespace(gen_data_entity_id=None)
    data: dict[Any, Any] = {"ai_task_preferences": prefs}
    # No model at all, with or without a preference pointing at one.
    assert suggester.state(_SuggestFakeHass(loaded, data)) == "no_entity"
    prefs.gen_data_entity_id = "ai_task.llm"
    assert suggester.state(_SuggestFakeHass(loaded, data)) == "no_entity"
    # A model without a preference set is enough: the request names the model.
    prefs.gen_data_entity_id = None
    known = {"ai_task.zeta": "Zeta", "ai_task.llm": "Local"}
    assert suggester.state(_SuggestFakeHass(loaded, data, known=known)) == "ready"
    assert [
        m["entity_id"] for m in suggester.models(_SuggestFakeHass(loaded, data, known))
    ] == [
        "ai_task.llm",
        "ai_task.zeta",
    ]
    # The preferred one comes first.
    prefs.gen_data_entity_id = "ai_task.zeta"
    assert suggester.models(_SuggestFakeHass(loaded, data, known)) == [
        {"entity_id": "ai_task.zeta", "name": "Zeta", "preferred": True},
        {"entity_id": "ai_task.llm", "name": "Local", "preferred": False},
    ]


def test_engine_root_fragments_and_required_fields() -> None:
    resolver = Resolver(states={"sensor.v": "42"})
    content = engine.resolve(
        GAUGE, {"value": "sensor.v", "ring": ["green", "red"]}, resolver
    )
    assert content == {"template": "gauge", "value": 42, "gradient": ["green", "red"]}
    # Required field unresolvable -> the whole payload is withheld.
    assert engine.resolve(GAUGE, {"value": "sensor.missing"}, resolver) is None
