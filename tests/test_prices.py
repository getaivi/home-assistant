"""The prices template, resolved against a plain dict resolver."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from custom_components.aivi import engine
from custom_components.aivi.series import cents_unit
from custom_components.aivi.templates import PRICES
from helpers import RecordedResolver

CET = timezone(timedelta(hours=1))


DAY = datetime(2026, 1, 15, tzinfo=CET)


def _hourly(start: datetime, prices: list[float], key: str = "value") -> list[dict]:
    return [
        {
            "start": start + timedelta(hours=i),
            "end": start + timedelta(hours=i + 1),
            key: p,
        }
        for i, p in enumerate(prices)
    ]


@pytest.fixture
def at_noon(freezer) -> None:
    freezer.move_to(DAY + timedelta(hours=12, minutes=30))


@pytest.mark.usefixtures("at_noon")
def test_prices_combine_a_nord_pool_sensor() -> None:
    resolver = RecordedResolver(
        attrs={
            "sensor.nordpool": {
                "unit_of_measurement": "EUR/kWh",
                "today": [0.1] * 24,
                "raw_today": _hourly(DAY, [0.1 + i / 100 for i in range(24)]),
                "raw_tomorrow": _hourly(DAY + timedelta(days=1), [0.2] * 24),
            }
        }
    )
    content = engine.resolve(PRICES, {"entries": "sensor.nordpool"}, resolver)
    assert content["unit"] == "EUR/kWh"
    entries = content["entries"]
    assert len(entries) == 48
    assert entries[0] == {"start": "2026-01-15T00:00:00+01:00", "price": 0.1}
    assert entries[-1]["start"] == "2026-01-16T23:00:00+01:00"
    # Cents: prices times 100, the unit in the currency's minor unit.
    cents = engine.resolve(
        PRICES, {"entries": "sensor.nordpool", "scale": "cents"}, resolver
    )
    assert cents["entries"][1]["price"] == 11
    assert cents["unit"] == "ct/kWh"
    # A typed unit wins.
    typed = engine.resolve(
        PRICES, {"entries": "sensor.nordpool", "unit": "öre"}, resolver
    )
    assert typed["unit"] == "öre"


@pytest.mark.usefixtures("at_noon")
def test_prices_quarter_hours_become_hours_and_keep_now() -> None:
    quarters = [
        {
            "start_time": (DAY + timedelta(minutes=15 * i)).isoformat(),
            "per_kwh": i % 4,
            "descriptor": "veryLow" if i < 8 else "spike",
        }
        for i in range(4 * 72)
    ]
    resolver = RecordedResolver(attrs={"sensor.amber": {"forecasts": quarters}})
    entries = engine.resolve(PRICES, {"entries": "sensor.amber"}, resolver)["entries"]
    # 72 hours of quarters: averaged into hours, then the 48 starting at
    # the current one (12:00 today).
    assert len(entries) == 48
    assert entries[0] == {
        "start": "2026-01-15T12:00:00+01:00",
        "price": 1.5,
        "level": "high",
    }
    starts = [datetime.fromisoformat(e["start"]) for e in entries]
    assert starts == sorted(set(starts))


@pytest.mark.usefixtures("at_noon")
def test_prices_from_an_attribute_a_template_and_known_names() -> None:
    pairs = [[(DAY + timedelta(hours=i)).isoformat(), i] for i in range(3)]
    tibber = [
        {"startsAt": (DAY + timedelta(hours=i)).isoformat(), "total": 1, "level": lvl}
        for i, lvl in enumerate(["VERY_CHEAP", "NORMAL", "VERY_EXPENSIVE", "odd"])
    ]
    resolver = RecordedResolver(
        attrs={"sensor.p": {"mine": pairs, "other": tibber}},
        renders={"{{ p }}": str(pairs).replace("'", '"')},
    )
    pinned = {"entries": "sensor.p", "entries__attribute": "mine"}
    assert [
        e["price"] for e in engine.resolve(PRICES, pinned, resolver)["entries"]
    ] == [
        0,
        1,
        2,
    ]
    levels = engine.resolve(
        PRICES, {"entries": "sensor.p", "entries__attribute": "other"}, resolver
    )["entries"]
    assert [e.get("level") for e in levels] == ["low", "medium", "high", None]
    templated = engine.resolve(PRICES, {"entries__template": "{{ p }}"}, resolver)
    assert len(templated["entries"]) == 3
    assert "unit" not in templated
    # Nothing that reads as a timeline: no push.
    junk = RecordedResolver(attrs={"sensor.x": {"a": [{"hour": 5, "price": 1}, "x"]}})
    assert engine.resolve(PRICES, {"entries": "sensor.x"}, junk) is None


def test_cents_units() -> None:
    assert cents_unit("SEK/kWh") == "öre/kWh"
    assert cents_unit("ZAR/kWh") == "c/kWh"
    assert cents_unit("kWh") is None
    assert cents_unit("€/kWh") is None
    assert cents_unit(None) is None
