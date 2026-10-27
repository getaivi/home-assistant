"""The wire contract's request side, checked against Aivi's OpenAPI document.

Every request body the client would send, for every template over a
matrix of entity states, must validate against the operation's request
schema in ``contract/aivi-openapi.json``. Refresh the document with
``make openapi``."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from jsonschema.exceptions import best_match
from openapi_core.exceptions import OpenAPIError
from werkzeug.datastructures import ImmutableMultiDict

from contract.openapi import document
from custom_components.aivi import blocks, engine, limits, series
from custom_components.aivi.api import (
    activity_body,
    widget_body,
)
from custom_components.aivi.commands.playback import ACTION_EVENTS
from custom_components.aivi.switchboard import (
    MAX_CONTENT_BYTES,
    ActionRows,
    content_size,
)
from custom_components.aivi.templates import (
    TemplateDef,
    default_activity_registry,
    default_registry,
)
from helpers import OPENAPI, api_request

WIDGET_TEMPLATES = [template for _, template in default_registry().items()]


ACTIVITY_TEMPLATES = [template for _, template in default_activity_registry().items()]


def _errors(error: Exception) -> list[str]:
    """The schema errors behind an openapi-core failure, one line each,
    at the deepest path that explains them."""
    cause = error.__cause__
    lines = []
    for item in getattr(cause, "schema_errors", ()):
        while item.context:
            item = best_match(item.context)
        path = "/".join(str(part) for part in item.absolute_path)
        lines.append(f"{path}: {item.message[:200]}")
    return lines or [str(error)[:500]]


def assert_valid_request(method: str, path: str, body: Any = None, **kw: Any) -> None:
    try:
        OPENAPI.validate_request(api_request(method, path, body, **kw))
    except OpenAPIError as err:
        raise AssertionError("\n".join(_errors(err))) from None


@dataclass(frozen=True)
class Scenario:
    """What every bound entity reads in one run: text sensors, template
    renders and friendly names read ``text``; numeric sensors ``number``;
    timestamp sensors ``time``."""

    name: str
    text: Any
    number: Any
    time: Any
    attrs: dict[str, Any] = field(default_factory=dict)


SCENARIOS = [
    Scenario("typical", "Running", "42.5", "2026-10-01T12:00:00+00:00"),
    Scenario("long", "Lorem ipsum dolor " * 20, "100.4", "2026-10-01 12:00:00"),
    Scenario(
        "unicode and control characters",
        "Tvätt 🧺\tklar\x00\x07\n \u0085퟿ end",
        "-5",
        "2026-10-01",
    ),
    Scenario("not a number", "nan", "nan", "1790000000"),
    Scenario("infinite", "inf", "inf", "-inf"),
    Scenario("negative infinity", "-inf", "-inf", "1e400"),
    Scenario("unavailable", "unavailable", "unavailable", "unavailable"),
    Scenario("unknown", "unknown", "unknown", "unknown"),
    Scenario("missing", None, None, None),
    Scenario("blank", "", "", ""),
    Scenario("words that look like values", "None", "1e400", "tomorrow"),
    Scenario("a palette color and a link", "red", "0", "2026-10-01T23:59:59-11:00"),
    Scenario(
        "links",
        "homeassistant://navigate/lovelace/0",
        "1e-9",
        "2026-02-29T00:00:00+00:00",
    ),
    Scenario("a link with spaces", "https://exa mple.com/ x", "99.999999", "0"),
    Scenario("a hex color", "#FF9F0A", "12", "2026-10-01T12:00:00.123456+02:00"),
]


TOGGLE_STATES = {
    "light.desk": "on",
    "switch.fountain": "off",
    "fan.attic": "unavailable",
    "input_boolean.porch": "on",
    "cover.garage": "opening",
    "valve.garden": "closed",
    "lock.front": "jammed",
    "humidifier.bedroom": "unknown",
}


BUTTON_STATES = {
    "scene.movie": "scening",
    "script.bedtime": "on",
    "button.doorbell": "2026-10-01T12:00:00+00:00",
    "input_button.reset": "unknown",
}


ROWS = [f"sensor.row_{i}" for i in range(10)]


class ScenarioResolver:
    """Every entity of the bindings below, reading ``scenario``."""

    def __init__(self, scenario: Scenario) -> None:
        self._s = scenario

    def state(self, entity_id: str) -> Any:
        if entity_id in TOGGLE_STATES:
            return TOGGLE_STATES[entity_id]
        if entity_id in BUTTON_STATES:
            return BUTTON_STATES[entity_id]
        if entity_id.startswith("sensor.row_"):
            odd = int(entity_id.rpartition("_")[2]) % 2
            return self._s.text if odd else self._s.number
        if entity_id.startswith("sensor.number"):
            return self._s.number
        if entity_id.startswith("sensor.time"):
            return self._s.time
        return self._s.text

    def attribute(self, entity_id: str, name: str) -> Any:
        if name in self._s.attrs:
            return self._s.attrs[name]
        return {
            "friendly_name": self._s.text,
            "entity_picture": self._s.text,
            "device_class": "garage",
            "color_mode": "color_temp",
            "color_temp_kelvin": self._s.number,
            "brightness": self._s.number,
            "percentage": self._s.number,
            "hs_color": [self._s.number, 50],
            "rgb_color": [self._s.number, 0, 0],
        }.get(name)

    def render(self, template: str) -> Any:
        return self._s.text

    def area_name(self, entity_id: str) -> str | None:
        return None if self._s.text is None else str(self._s.text)

    def attributes(self, entity_id: str) -> dict[str, Any]:
        """A price sensor's timeline: two days of quarter hours (past the
        cap, so they become hours), one period on the scenario's time, a
        duplicate, and periods that are not periods."""
        day = datetime(2026, 10, 1, tzinfo=timezone(timedelta(hours=2)))
        quarter = [
            {
                "start": (day + timedelta(minutes=15 * i)).isoformat(),
                "value": self._s.number if i % 7 else i / 10,
                "level": self._s.text if i % 5 else "VERY_CHEAP",
            }
            for i in range(192)
        ]
        return {
            "raw_today": quarter[:96],
            "raw_tomorrow": quarter[90:],
            "prices": [
                {"start_time": self._s.time, "per_kwh": self._s.number},
                [self._s.time, self._s.number],
                {"hour": 13, "price": 1},
                "13:00",
            ],
            "today": [0.1, 0.2],
            "unit_of_measurement": self._s.text,
        }

    def history(self, query: Any) -> Any:
        if query.kind == "day_low":
            return self._s.number
        return [self._s.number, None, "nan", 1.5, self._s.text]


def _sourced(key: str, literal: Any) -> dict[str, Any]:
    """A literal fallback plus a text sensor as its source."""
    return {key: literal, f"{key}__entity": "sensor.text"}


def full_bindings(template: TemplateDef, variant: str) -> dict[str, Any]:
    """Every field of the template bound, most of them to the scenario's
    entities. ``bogus`` stores literals the Aivi API rejects."""
    bogus = variant == "bogus"
    bindings: dict[str, Any] = {}
    for f in template.fields:
        key, block = f.key, f.block
        match block:
            case ActionRows():
                entities = [*TOGGLE_STATES, *BUTTON_STATES]
                bindings[key] = entities
                bindings[f"{key}__options"] = {
                    eid: {
                        "label__entity": "sensor.text",
                        "subtitle__entity": "sensor.text",
                        "icon__entity": "sensor.text",
                        "color": "#12AB34" if not bogus else "#12AB3",
                        "color__entity": "sensor.text",
                        "gradient": "red,#00FF00,blue" if not bogus else "red",
                        "image": "https://example.com/p.png" if not bogus else "x",
                        "image_alt": "An alt text that runs well past sixty-four"
                        " characters, to be cut",
                        "image_source": "entity_picture",
                        "subtitle_mode": "state",
                        "state_text_on": "Open\tnow" if bogus else "Wide open",
                        "state_text_off": "",
                        "state_text_turning_on": "x" * 30,
                        "state_text_no_response": "  Nope  ",
                        "state_text_idle": "Tap",
                        "state_text_sent": "Sent ",
                    }
                    for eid in entities
                }
            case blocks.EntityRows():
                bindings[key] = ROWS
                bindings[f"{key}__options"] = {
                    eid: {
                        "label__entity": "sensor.text",
                        "icon__entity": "sensor.text",
                        "color": "chartreuse" if bogus else "red",
                        "color__entity": "sensor.text",
                        "budget": "-3" if bogus else "12.50",
                        "budget__entity": "sensor.number",
                        "charging__entity": "sensor.text",
                        "today": "sensor.number_today",
                    }
                    for eid in ROWS
                }
            case blocks.Amount():
                if block.SLOT.bare == "literal":
                    bindings.update(_sourced(key, "0" if bogus else "1500"))
                    bindings[f"{key}__entity"] = "sensor.number"
                else:
                    bindings[key] = "sensor.number"
            case blocks.Currency():
                bindings.update(_sourced(key, "usd$" if bogus else "usd"))
            case series.HistoryPoints():
                bindings[f"{key}__hours"] = "25" if bogus else "24"
            case series.PriceEntries():
                bindings[key] = "sensor.prices"
            case blocks.Value():
                bindings[key] = "sensor.text"
                bindings[f"{key}__color"] = "chartreuse" if bogus else "red"
                bindings[f"{key}__color__entity"] = "sensor.text"
                bindings[f"{key}__formatter"] = "eventually" if bogus else "time_since"
            case blocks.Number():
                bindings[key] = "sensor.number"
                bindings[f"{key}__invert"] = True
            case blocks.Timestamp():
                bindings[key] = "sensor.time"
            case blocks.Icon():
                bindings.update(_sourced(key, "star.fill"))
                bindings[f"{key}__color"] = "red"
                bindings[f"{key}__secondary_color__entity"] = "sensor.text"
                bindings[f"{key}__rendering_mode"] = "loud" if bogus else "palette"
                bindings[f"{key}__color_rendering"] = "gradient"
            case blocks.Color():
                bindings.update(_sourced(key, "chartreuse" if bogus else "blue"))
            case blocks.Url():
                bindings.update(
                    _sourced(key, "not a url" if bogus else "https://example.com/")
                )
            case blocks.Text():
                bindings.update(_sourced(key, "x" * 300 if bogus else "Fallback"))
            case blocks.NumberLiteral():
                bindings[key] = "nan" if bogus else 0
            case blocks.ColorRamp():
                bindings[key] = ["red", "blue", "green", "pink", "teal"]
            case blocks.SegmentList():
                bindings[key] = [
                    {
                        "value": "inf" if bogus and i == 0 else 0.2,
                        "fill_color": "red",
                        "track_color": "gray",
                        "track_fill": "hatched",
                        "label": "L" * 70,
                        "label__entity": "sensor.text",
                        "fill_color__entity": "sensor.text",
                        "source": "sensor.number",
                    }
                    for i in range(5)
                ]
                bindings[f"{key}__display"] = "layered"
            case blocks.Enum():
                bindings[key] = "middle" if bogus else block.options[0]
            case _:
                raise AssertionError(f"no binding for {type(block).__name__}")
    return bindings


def minimal_bindings(template: TemplateDef) -> dict[str, Any]:
    """Only the required fields bound."""
    full = full_bindings(template, "full")
    required = {f.key for f in template.fields if f.required}
    return {k: v for k, v in full.items() if k.partition("__")[0] in required}


BINDINGS = ["full", "bogus", "minimal"]


def _bindings(template: TemplateDef, variant: str) -> dict[str, Any]:
    if variant == "minimal":
        return minimal_bindings(template)
    return full_bindings(template, variant)


def _ids(template: TemplateDef) -> str:
    return template.slug


@pytest.mark.parametrize("variant", BINDINGS)
@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
@pytest.mark.parametrize("template", WIDGET_TEMPLATES, ids=_ids)
def test_every_widget_push_matches_the_schema(
    template: TemplateDef, scenario: Scenario, variant: str
) -> None:
    content = engine.resolve(
        template, _bindings(template, variant), ScenarioResolver(scenario)
    )
    if content is None:
        # A required field did not resolve: nothing is pushed.
        return
    if template.slug == "switchboard" and content_size(content) > MAX_CONTENT_BYTES:
        # Never sent: the binding fails with content_too_large instead.
        return
    assert_valid_request("patch", "/widgets/demo", widget_body(content))


@pytest.mark.parametrize("stale_after", [None, 0, 60, 3600, 604800])
def test_stale_after_matches_the_schema(stale_after) -> None:
    content = {"template": "status", "state": {"value": "x"}}
    body = widget_body(content, stale_after)
    assert ("stale_after" in body) is (stale_after is not None)
    assert_valid_request("patch", "/widgets/demo", body)


@pytest.mark.parametrize("state", ["ONGOING", "IDLE"])
@pytest.mark.parametrize("variant", BINDINGS)
@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
@pytest.mark.parametrize("template", ACTIVITY_TEMPLATES, ids=_ids)
def test_every_activity_push_matches_the_schema(
    template: TemplateDef, scenario: Scenario, variant: str, state: str
) -> None:
    content = engine.resolve(
        template, _bindings(template, variant), ScenarioResolver(scenario)
    )
    if content is None:
        return
    assert_valid_request("patch", "/activities/demo", activity_body(state, content))


@pytest.mark.parametrize("template", [*WIDGET_TEMPLATES, *ACTIVITY_TEMPLATES], ids=_ids)
def test_the_typical_scenario_pushes_every_template(template: TemplateDef) -> None:
    """The matrix is not vacuous: with every field bound and ordinary
    states, every template produces content."""
    content = engine.resolve(
        template, full_bindings(template, "full"), ScenarioResolver(SCENARIOS[0])
    )
    assert content is not None
    assert content["template"] == template.slug


def test_the_validator_refuses_what_aivi_refuses() -> None:
    """The check is not vacuous: content Aivi rejects fails it."""
    refused = [
        {"content": {"state": {"value": "x"}}},  # no template
        {"content": {"template": "status", "state": {"value": "x" * 129}}},
        {"content": {"template": "countdown", "target": "2026-10-01 12:00:00"}},
        {"content": {"template": "gauge", "value": 1, "unit": "x" * 17}},
        {"content": {"template": "status", "tap_url": "not a url"}},
        {"content": {"template": "list", "rows": [{"label": "a"}] * 9}},
        {"content": {"template": "progress", "progress": {"value": 1.004}}},
    ]
    for body in refused:
        with pytest.raises(AssertionError):
            assert_valid_request("patch", "/widgets/demo", body)
    with pytest.raises(ValueError):
        assert_valid_request(
            "patch", "/widgets/demo", {"content": {"template": "gauge", "value": NAN}}
        )
    with pytest.raises(AssertionError):
        assert_valid_request(
            "patch",
            "/activities/demo",
            {
                "state": "ONGOING",
                "content": {"template": "monitor", "left_column": {"header": "x"}},
            },
        )


NAN = float("nan")


SCHEMAS = document()["components"]["schemas"]


def _keyword(schema: str, prop: str | None, keyword: str) -> Any:
    """``keyword`` of a schema, or of one of its properties, looking
    through the ``anyOf`` of a nullable one."""
    node = SCHEMAS[schema]
    if prop is not None:
        node = node["properties"][prop]
    for option in [node, *node.get("anyOf", [])]:
        if keyword in option:
            return option[keyword]
    raise KeyError(f"{schema}.{prop} has no {keyword}")


@pytest.mark.parametrize(
    ("limit", "schema", "prop", "keyword"),
    [
        (limits.ICON, "Icon", "name", "maxLength"),
        (limits.ICON, "IconField-Input", None, "maxLength"),
        (limits.ICON, "ToggleAction-Input", "icon", "maxLength"),
        (limits.ICON, "ButtonAction-Input", "icon", "maxLength"),
        (limits.VALUE, "Value", "value", "maxLength"),
        (limits.TAP_URL, "StatusWidgetContent-Input", "tap_url", "maxLength"),
        (limits.TAP_URL, "MonitorActivityContent-Input", "tap_url", "maxLength"),
        (limits.UNIT, "GaugeWidgetContent-Input", "unit", "maxLength"),
        (limits.UNIT, "TrendWidgetContent-Input", "unit", "maxLength"),
        (limits.UNIT, "PricesWidgetContent-Input", "unit", "maxLength"),
        (limits.LABEL, "GaugeWidgetContent-Input", "label", "maxLength"),
        (limits.LABEL, "CountdownWidgetContent-Input", "expired_text", "maxLength"),
        (limits.LABEL, "Column-Input", "header", "maxLength"),
        (limits.LABEL, "Column-Input", "footer", "maxLength"),
        (limits.LABEL, "ListRow-Input", "label", "maxLength"),
        (limits.LABEL, "BatteryDevice-Input", "name", "maxLength"),
        (limits.LABEL, "BudgetEntry-Input", "label", "maxLength"),
        (limits.LABEL, "Segment", "label", "maxLength"),
        (limits.LABEL, "Image", "alt", "maxLength"),
        (limits.ENERGY_NAME, "EnergyNode-Input", "name", "maxLength"),
        (limits.TILE_LABEL, "ToggleAction-Input", "label", "maxLength"),
        (limits.TILE_LABEL, "ButtonAction-Input", "label", "maxLength"),
        (limits.IMAGE_URL, "Image", "url", "maxLength"),
        (limits.IMAGE_URL, "HeroImage", "url", "maxLength"),
        (limits.LABEL, "HeroImage", "alt", "maxLength"),
        (limits.STAT_LABEL, "Stat-Input", "label", "maxLength"),
        (limits.STAT_UNIT, "Stat-Input", "unit", "maxLength"),
        (limits.ICON, "Stat-Input", "icon", "maxLength"),
        (limits.STATS, "ShowcaseWidgetContent-Input", "stats", "maxItems"),
        (limits.ROWS, "ListWidgetContent-Input", "rows", "maxItems"),
        (limits.ROWS, "BatteryWidgetContent-Input", "devices", "maxItems"),
        (limits.ROWS, "SwitchboardWidgetContent-Input", "actions", "maxItems"),
        (
            limits.BUDGET_CATEGORIES,
            "BudgetWidgetContent-Input",
            "categories",
            "maxItems",
        ),
        (limits.ENERGY_SOURCES, "EnergyWidgetContent-Input", "sources", "maxItems"),
        (limits.SEGMENTS, "SegmentedProgressBar-Input", "segments", "maxItems"),
        (limits.RAMP_STOPS, "GaugeWidgetContent-Input", "gradient", "maxItems"),
        (limits.TILE_GRADIENT, "ToggleAction-Input", "gradient", "maxItems"),
        (limits.TILE_GRADIENT, "ButtonAction-Input", "gradient", "maxItems"),
        (limits.POINTS, "TrendWidgetContent-Input", "points", "maxItems"),
        (limits.PRICE_ENTRIES, "PricesWidgetContent-Input", "entries", "maxItems"),
        (limits.REMOTE_STATS, "RemoteWidgetContent-Input", "stats", "maxItems"),
        (limits.REMOTE_ACTIONS, "RemoteWidgetContent-Input", "actions", "maxItems"),
        (limits.ACTIVITY_STATS, "RemoteActivityContent-Input", "stats", "maxItems"),
        (
            limits.ACTIVITY_ACTIONS,
            "RemoteActivityContent-Input",
            "actions",
            "maxItems",
        ),
        (limits.ACTIVITY_IMAGE_URL, "ActivityImage", "url", "maxLength"),
        (limits.LABEL, "ActivityImage", "alt", "maxLength"),
        (limits.ACTIVITY_READING, "ActivityReading", "value", "maxLength"),
        (limits.STAT_UNIT, "RemoteActivityContent-Input", "unit", "maxLength"),
        (
            limits.ACTIVITY_VALUE_LABEL,
            "RemoteActivityContent-Input",
            "value_label",
            "maxLength",
        ),
        (limits.TILE_LABEL, "ActivityButtonAction-Input", "label", "maxLength"),
        (limits.TILE_LABEL, "ActivityToggleAction-Input", "label", "maxLength"),
    ],
)
def test_a_wire_limit_matches_the_document(
    limit: int, schema: str, prop: str | None, keyword: str
) -> None:
    assert _keyword(schema, prop, keyword) == limit


@pytest.mark.parametrize(
    ("values", "schema"),
    [
        (blocks.COLORS, "Color"),
        (blocks.FORMATTERS, "Formatter"),
        (blocks.RENDERING_MODES, "RenderingMode"),
        (blocks.COLOR_RENDERINGS, "ColorRendering"),
        (blocks.TRACK_FILLS, "TrackFill"),
        (blocks.SEGMENT_DISPLAYS, "SegmentDisplay"),
    ],
)
def test_a_wire_enum_matches_the_document(values: list[str], schema: str) -> None:
    assert values == _keyword(schema, None, "enum")


@pytest.mark.parametrize(
    ("limit", "schema", "prop"),
    [
        (limits.ACTION_ID, "ActionId", None),
        (limits.STATE_TEXT, "ToggleStateText", "on"),
        (limits.STATE_TEXT, "ButtonStateText", "idle"),
        (limits.STATE_TEXT, "StateValue", "value"),
    ],
)
def test_a_patterned_limit_matches_the_document(
    limit: int, schema: str, prop: str | None
) -> None:
    pattern = _keyword(schema, prop, "pattern")
    assert re.search(pattern, "a" * limit)
    assert not re.search(pattern, "a" * (limit + 1))


@pytest.mark.parametrize("cursor", [None, "c1"])
async def test_listing_requests_match_the_schema(cursor) -> None:
    args = {"limit": "50"} if cursor is None else {"limit": "50", "cursor": cursor}
    for path in ("/widgets", "/activities"):
        assert_valid_request("get", path, args=args)


def test_the_event_stream_request_matches_the_schema() -> None:
    assert_valid_request(
        "get",
        "/events",
        args=ImmutableMultiDict([("types", kind) for kind in ACTION_EVENTS]),
    )
