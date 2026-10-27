"""Recorded history, for the blocks that chart or total the past.

Resolving a binding is synchronous, the recorder is not, so the answers
are fetched ahead of a resolve into a ``HistoryCache`` the resolver reads
(``sources.HistoryResolver``). Each answer is kept until it can change:

- ``BUCKETS`` (a trend's sparkline): time-weighted means of the recorded
  states over equal buckets, the last bucket left open for the live
  value. The completed buckets only change when a bucket boundary passes,
  so they are fetched once per bucket width, not on every state change.
- ``DAY_LOW`` (an energy node's "today"): the lowest recorded state since
  local midnight, which is what a meter read "today" counts from (a
  lifetime meter's midnight reading, a daily meter's reset to zero).
  Fetched once a day; every refresh lowers it to the current reading, so
  a reset seen live is counted from.

Without the recorder, or when a fetch fails, the answer is ``None`` and
asked again after ``RETRY``; the blocks treat that as unresolved.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, State
from homeassistant.util import dt as dt_util

from .sources import HistoryKind, HistoryQuery

_LOGGER = logging.getLogger(__name__)

#: How soon a failed or impossible fetch is asked again.
RETRY = timedelta(minutes=5)


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _reading(state: State, attribute: str | None) -> float | None:
    raw = state.attributes.get(attribute) if attribute else state.state
    return _number(raw)


def bucket_width(query: HistoryQuery) -> float:
    """One bucket's span, in seconds."""
    return query.hours * 3600 / query.buckets


def bucket_window(query: HistoryQuery, now: datetime) -> tuple[datetime, datetime]:
    """The span of the completed buckets: it ends where the open bucket
    (the one ``now`` is in) starts."""
    width = bucket_width(query)
    end = math.floor(now.timestamp() / width) * width
    start = end - (query.buckets - 1) * width
    return dt_util.utc_from_timestamp(start), dt_util.utc_from_timestamp(end)


def bucket_means(
    states: Iterable[State],
    attribute: str | None,
    start: datetime,
    end: datetime,
    count: int,
) -> list[float | None]:
    """Time-weighted means of a step function over ``count`` equal buckets
    from ``start`` to ``end``. A state holds until the next one; a
    reading that is not a number (unavailable) is a gap, and a bucket with
    no numeric coverage is ``None``."""
    begin, finish = start.timestamp(), end.timestamp()
    width = (finish - begin) / count
    totals = [0.0] * count
    covered = [0.0] * count
    steps = sorted(states, key=lambda s: s.last_updated)
    for index, state in enumerate(steps):
        value = _reading(state, attribute)
        if value is None:
            continue
        lo = max(state.last_updated.timestamp(), begin)
        hi = (
            steps[index + 1].last_updated.timestamp()
            if index + 1 < len(steps)
            else finish
        )
        hi = min(hi, finish)
        if hi <= lo:
            continue
        first = int((lo - begin) // width)
        last = min(int((hi - begin) // width), count - 1)
        for bucket in range(first, last + 1):
            b_lo = begin + bucket * width
            span = min(hi, b_lo + width) - max(lo, b_lo)
            if span > 0:
                totals[bucket] += value * span
                covered[bucket] += span
    return [totals[i] / covered[i] if covered[i] > 0 else None for i in range(count)]


def day_low(states: Iterable[State], attribute: str | None) -> float | None:
    readings = [r for s in states if (r := _reading(s, attribute)) is not None]
    return min(readings) if readings else None


def _recorded(
    hass: HomeAssistant,
    start: datetime,
    end: datetime,
    entity_id: str,
    attribute: str | None,
) -> list[State]:
    """Every recorded state of the entity from ``start`` to ``end``, the
    one in effect at ``start`` included. Runs in the recorder's pool."""
    # Imported here: the recorder is an optional component.
    from homeassistant.components.recorder import history  # noqa: PLC0415

    found = history.get_significant_states(
        hass,
        start,
        end,
        [entity_id],
        include_start_time_state=True,
        significant_changes_only=False,
        no_attributes=attribute is None,
    )
    return [s for s in found.get(entity_id, []) if isinstance(s, State)]


async def _async_recorded(
    hass: HomeAssistant,
    start: datetime,
    end: datetime,
    entity_id: str,
    attribute: str | None,
) -> list[State]:
    # Imported here: the recorder is an optional component.
    from homeassistant.components.recorder import get_instance  # noqa: PLC0415

    return await get_instance(hass).async_add_executor_job(
        _recorded, hass, start, end, entity_id, attribute
    )


def expires(query: HistoryQuery, now: datetime) -> datetime:
    """When an answer fetched at ``now`` stops being current."""
    if query.kind is HistoryKind.BUCKETS:
        width = bucket_width(query)
        boundary = (math.floor(now.timestamp() / width) + 1) * width
        return dt_util.utc_from_timestamp(boundary)
    return dt_util.start_of_local_day(dt_util.as_local(now) + timedelta(days=1))


async def async_fetch(hass: HomeAssistant, query: HistoryQuery, now: datetime) -> Any:
    """The recorder's answer to ``query`` at ``now``, or ``None``."""
    if "recorder" not in hass.config.components:
        return None
    if query.kind is HistoryKind.BUCKETS:
        start, end = bucket_window(query, now)
    else:
        start, end = dt_util.start_of_local_day(dt_util.as_local(now)), now
    try:
        states = await _async_recorded(
            hass, start, end, query.entity_id, query.attribute
        )
    except Exception as err:  # noqa: BLE001 (any recorder failure degrades)
        _LOGGER.debug("History of %s unavailable: %s", query.entity_id, err)
        return None
    if query.kind is HistoryKind.BUCKETS:
        return bucket_means(states, query.attribute, start, end, query.buckets - 1)
    return day_low(states, query.attribute)


class HistoryCache:
    """Answers kept until they can change (see the module docstring)."""

    def __init__(self) -> None:
        self._answers: dict[HistoryQuery, tuple[Any, datetime]] = {}

    def answer(self, query: HistoryQuery) -> Any:
        found = self._answers.get(query)
        return found[0] if found else None

    def next_expiry(self) -> datetime | None:
        return min((until for _, until in self._answers.values()), default=None)

    async def async_refresh(
        self, hass: HomeAssistant, queries: Iterable[HistoryQuery]
    ) -> None:
        """Fetch what is missing or expired, and lower each day low to the
        entity's current reading."""
        now = dt_util.utcnow()
        wanted = set(queries)
        for stale in [q for q in self._answers if q not in wanted]:
            del self._answers[stale]
        due = [
            q for q in wanted if q not in self._answers or self._answers[q][1] <= now
        ]
        if due:
            answers = await asyncio.gather(
                *(async_fetch(hass, query, now) for query in due)
            )
            for query, value in zip(due, answers, strict=True):
                until = expires(query, now) if value is not None else now + RETRY
                self._answers[query] = (value, until)
        for query, (value, until) in list(self._answers.items()):
            if query.kind is not HistoryKind.DAY_LOW:
                continue
            state = hass.states.get(query.entity_id)
            current = _reading(state, query.attribute) if state else None
            if current is not None and value is not None and current < value:
                self._answers[query] = (current, until)
