"""Recorded history: the bucketing, the cache, and the push path reading
a real recorder."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    State,
    callback,
)
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi import history
from custom_components.aivi.history import HistoryCache, bucket_means, day_low
from custom_components.aivi.sources import HistoryKind, HistoryQuery
from helpers import account_entry, widget_subentry


class FakeRecorder:
    """Every state change, as the recorder would answer for it: the states
    from ``start`` to ``end`` and the one in effect at ``start``."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.states: list[State] = []
        self.fail = False
        hass.config.components.add("recorder")
        hass.bus.async_listen(EVENT_STATE_CHANGED, self._record)

    @callback
    def _record(self, event: Event[EventStateChangedData]) -> None:
        if (state := event.data["new_state"]) is not None:
            self.states.append(state)

    async def recorded(
        self,
        hass: HomeAssistant,
        start: datetime,
        end: datetime,
        entity_id: str,
        attribute: str | None,
    ) -> list[State]:
        if self.fail:
            raise RuntimeError("database is gone")
        own = [s for s in self.states if s.entity_id == entity_id]
        before = [s for s in own if s.last_updated < start][-1:]
        return before + [s for s in own if start <= s.last_updated <= end]


@pytest.fixture
def recorder(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> FakeRecorder:
    fake = FakeRecorder(hass)
    monkeypatch.setattr(history, "_async_recorded", fake.recorded)
    return fake


T0 = dt_util.parse_datetime("2026-01-15T10:00:00+00:00")
assert T0 is not None


def _state(value: str, at: datetime, **attrs: object) -> State:
    return State("sensor.t", value, attrs, last_changed=at, last_updated=at)


def test_bucket_means_are_time_weighted() -> None:
    start, end = T0, T0 + timedelta(hours=2)
    states = [
        _state("10", T0 - timedelta(hours=1)),  # in effect at the start
        _state("20", T0 + timedelta(minutes=30)),
        _state("unavailable", T0 + timedelta(minutes=60)),
        _state("40", T0 + timedelta(minutes=90)),
    ]
    assert bucket_means(states, None, start, end, 4) == [10, 20, None, 40]
    # Two buckets: the first half 10 then 20 (15 average), the second 40
    # over its covered half.
    assert bucket_means(states, None, start, end, 2) == [15, 40]
    assert bucket_means([], None, start, end, 2) == [None, None]
    attr = [_state("x", T0, temp=5), _state("x", T0 + timedelta(hours=1), temp=7)]
    assert bucket_means(attr, "temp", start, end, 2) == [5, 7]


def test_day_low_and_expiry() -> None:
    assert day_low([_state("5", T0), _state("2", T0), _state("x", T0)], None) == 2
    assert day_low([], None) is None
    buckets = HistoryQuery(HistoryKind.BUCKETS, "sensor.t", hours=24, buckets=24)
    assert history.expires(buckets, T0 + timedelta(minutes=10)) == T0 + timedelta(
        hours=1
    )
    low = HistoryQuery(HistoryKind.DAY_LOW, "sensor.t")
    assert history.expires(low, T0) == dt_util.start_of_local_day(
        dt_util.as_local(T0) + timedelta(days=1)
    )


async def test_without_a_recorder_nothing_is_answered(hass: HomeAssistant) -> None:
    query = HistoryQuery(HistoryKind.DAY_LOW, "sensor.t")
    hass.states.async_set("sensor.t", "5")
    cache = HistoryCache()
    await cache.async_refresh(hass, [query])
    # No history means no low: the current reading is not taken for one.
    assert cache.answer(query) is None
    assert cache.next_expiry() is not None


@pytest.fixture
def frozen(freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    freezer.move_to(T0)
    return freezer


async def test_a_trend_charts_the_recorded_history(
    hass: HomeAssistant, recorder, fake_client, frozen: FrozenDateTimeFactory
) -> None:
    for value in ("18", "19", "20", "21"):
        hass.states.async_set("sensor.temp", value, {"unit_of_measurement": "°C"})
        frozen.tick(timedelta(minutes=30))
    entry = account_entry(
        hass,
        widget_subentry(
            "trend",
            "Living room",
            "trend",
            {"value": "sensor.temp", "points__hours": 3},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    _, content = fake_client.pushes[-1]
    assert content["value"] == 21
    assert content["unit"] == "°C"
    # 3 hours in 7.5-minute buckets: the time before the first reading is
    # a gap, then each reading holds for four buckets; the live one last.
    assert content["points"] == [18] * 4 + [19] * 4 + [20] * 4 + [21] * 4 + [21]

    # The next bucket boundary refetches and pushes the shifted window.
    pushes = len(fake_client.pushes)
    frozen.tick(timedelta(minutes=10))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert len(fake_client.pushes) == pushes + 1
    assert fake_client.pushes[-1][1]["points"][-3:] == [21, 21, 21]

    # A failed fetch leaves the chart out (no push) and is fetched again.
    recorder.fail = True
    frozen.tick(timedelta(minutes=8))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert len(fake_client.pushes) == pushes + 1


async def test_energy_today_from_the_recorder(
    hass: HomeAssistant, recorder, fake_client, frozen: FrozenDateTimeFactory
) -> None:
    hass.states.async_set("sensor.home", "500")
    hass.states.async_set("sensor.meter", "1000", {"unit_of_measurement": "kWh"})
    frozen.tick(timedelta(minutes=5))
    hass.states.async_set("sensor.meter", "1004", {"unit_of_measurement": "kWh"})
    entry = account_entry(
        hass,
        widget_subentry(
            "energy",
            "Energy",
            "energy",
            {"home_power": "sensor.home", "home_today": "sensor.meter"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.pushes[-1][1]["home"] == {"power": 500, "today": 4}

    # A reset seen live is counted from.
    hass.states.async_set("sensor.meter", "0.5", {"unit_of_measurement": "kWh"})
    await hass.async_block_till_done()
    frozen.tick(timedelta(seconds=3))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.meter", "1.5", {"unit_of_measurement": "kWh"})
    await hass.async_block_till_done()
    frozen.tick(timedelta(seconds=3))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert fake_client.pushes[-1][1]["home"] == {"power": 500, "today": 1}
