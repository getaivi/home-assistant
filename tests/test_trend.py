"""The trend template, resolved against a plain dict resolver with recorded
history."""

from __future__ import annotations

from custom_components.aivi import engine
from custom_components.aivi.sources import HistoryKind, HistoryQuery
from custom_components.aivi.templates import TREND
from custom_components.aivi.values import (
    SlotKind,
    coerce,
    parse_list,
    series,
)
from helpers import RecordedResolver


def _buckets(
    entity_id: str, attribute: str | None = None, hours: int = 24
) -> HistoryQuery:
    return HistoryQuery(
        HistoryKind.BUCKETS, entity_id, attribute, hours=hours, buckets=24
    )


def test_trend_charts_the_value_entitys_history() -> None:
    resolver = RecordedResolver(
        states={"sensor.temp": "21.44"},
        attrs={"sensor.temp": {"unit_of_measurement": "°C"}},
        history={_buckets("sensor.temp"): [19.123456, None, 20.0, 20.5]},
    )
    bindings = {"value": "sensor.temp"}
    assert engine.history_queries(TREND, bindings) == {_buckets("sensor.temp")}
    content = engine.resolve(TREND, bindings, resolver)
    assert content == {
        "template": "trend",
        "value": 21.44,
        # Bucket means to four significant digits, gaps skipped, the live
        # reading last; the sensor's own unit.
        "points": [19.12, 20, 20.5, 21.44],
        "unit": "°C",
    }


def test_trend_window_another_entity_and_attribute_history() -> None:
    climate = _buckets("climate.living", "current_temperature", hours=6)
    resolver = RecordedResolver(
        attrs={"climate.living": {"current_temperature": 21}},
        history={climate: [20, 20.5], _buckets("sensor.other", hours=48): [1, 2]},
        states={"sensor.other": "3"},
    )
    bindings = {
        "value": "climate.living",
        "value__attribute": "current_temperature",
        "points__hours": 6,
        "unit": "°",
    }
    content = engine.resolve(TREND, bindings, resolver)
    assert content["points"] == [20, 20.5, 21]
    assert content["unit"] == "°"
    # A window Aivi does not offer falls back to a day.
    bindings["points__hours"] = 5
    assert engine.history_queries(TREND, bindings) == {
        _buckets("climate.living", "current_temperature")
    }
    # Another entity's history.
    other = {"value": "climate.living", "value__attribute": "current_temperature"}
    other |= {"points__entity": "sensor.other", "points__hours": "48"}
    assert engine.resolve(TREND, other, resolver)["points"] == [1, 2, 3]


def test_trend_points_from_a_list() -> None:
    resolver = RecordedResolver(
        states={"sensor.temp": "5"},
        attrs={"weather.home": {"forecast": [1, "2", "x", 3.5, None]}},
        renders={"{{ x }}": "[4, 5.25, 6]", "{{ y }}": "(7, 8)", "{{ z }}": "nope"},
    )
    base = {"value": "sensor.temp"}
    attr = base | {"points__entity": "weather.home", "points__attribute": "forecast"}
    assert engine.history_queries(TREND, attr) == set()
    assert engine.resolve(TREND, attr, resolver)["points"] == [1, 2, 3.5]
    tmpl = base | {"points__template": "{{ x }}"}
    assert engine.resolve(TREND, tmpl, resolver)["points"] == [4, 5.25, 6]
    assert engine.resolve(TREND, base | {"points__template": "{{ y }}"}, resolver)[
        "points"
    ] == [7, 8]
    # Not a list, or fewer than two points: nothing to chart, no push.
    assert (
        engine.resolve(TREND, base | {"points__template": "{{ z }}"}, resolver) is None
    )
    long = RecordedResolver(
        states={"sensor.temp": "5"}, renders={"{{ x }}": list(range(60))}
    )
    points = engine.resolve(TREND, base | {"points__template": "{{ x }}"}, long)[
        "points"
    ]
    assert points == list(range(12, 60))


def test_trend_without_history_does_not_push() -> None:
    resolver = RecordedResolver(states={"sensor.temp": "5"})
    assert engine.resolve(TREND, {"value": "sensor.temp"}, resolver) is None
    # A template value has no history to chart.
    templated = {"value__template": "{{ 5 }}"}
    assert engine.history_queries(TREND, templated) == set()


def test_series_parsing() -> None:
    assert parse_list("[1, 2]") == [1, 2]
    assert parse_list("{'a': 1}") is None
    assert parse_list("") is None
    assert parse_list(5) is None
    assert parse_list("[1, ") is None
    assert series([None, "x"]) is None
    assert coerce(SlotKind.SERIES, "[1, 2]") == [1, 2]
    assert coerce(SlotKind.BOOL, "Charging") is True
    assert coerce(SlotKind.CURRENCY, " eur ") == "EUR"
