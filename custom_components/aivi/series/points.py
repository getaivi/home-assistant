"""A trend's points: an entity's recorded history, or a list it holds."""

from __future__ import annotations

from typing import Any, override

from .. import limits
from ..blocks import Slotted, scalar_source
from ..sources import (
    HistoryKind,
    HistoryQuery,
    Source,
    StateResolver,
    history_of,
)
from ..sourcing import Bare, ValueSlot
from ..values import (
    SlotKind,
    finite_number,
    series,
    wire_number,
)


def _significant(value: float) -> int | float:
    """Four significant digits: a sparkline never needs more, and history
    means would otherwise carry a dozen."""
    return wire_number(float(f"{value:.4g}"))


class HistoryPoints(Slotted):
    """A trend's points, oldest first.

    By default, the recorded history of the entity another field reads
    (``follows``): the window (``<key>__hours``) split into equal buckets,
    each the time-weighted mean of the states in it, ending with the live
    reading. ``<key>__entity`` charts another entity's history instead;
    with ``__attribute`` or ``__template`` the points are a list that
    attribute or template holds (the last ``limits.POINTS``)."""

    HOURS = (1, 3, 6, 12, 24, 48, 168)
    DEFAULT_HOURS = 24
    #: Points drawn from history: the completed buckets plus the live one.
    BUCKETS = 24

    def __init__(self, *, follows: str) -> None:
        self.follows = follows

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (ValueSlot(kind=SlotKind.SERIES, bare=Bare.LITERAL),)

    def hours(self, key: str, data: dict[str, Any]) -> int:
        raw = finite_number(data.get(f"{key}__hours"))
        return int(raw) if raw is not None and raw in self.HOURS else self.DEFAULT_HOURS

    def _charted(self, key: str, data: dict[str, Any]) -> tuple[str, str | None] | None:
        """The entity (and attribute) whose history is charted, or ``None``
        when the points come from a list or nothing is charted."""
        own = scalar_source(key, data)
        if own is not None:
            if own.source is Source.ENTITY and own.entity_id:
                return own.entity_id, None
            return None
        source = scalar_source(self.follows, data)
        if source is None or source.entity_id is None:
            return None
        return source.entity_id, source.attribute

    def query(self, key: str, data: dict[str, Any]) -> HistoryQuery | None:
        charted = self._charted(key, data)
        if charted is None:
            return None
        entity_id, attribute = charted
        return HistoryQuery(
            HistoryKind.BUCKETS,
            entity_id,
            attribute,
            hours=self.hours(key, data),
            buckets=self.BUCKETS,
        )

    def history_queries(self, key: str, data: dict[str, Any]) -> set[HistoryQuery]:
        query = self.query(key, data)
        return set() if query is None else {query}

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> list[int | float] | None:
        query = self.query(key, data)
        if query is not None:
            points = self._from_history(query, resolver)
        else:
            source = scalar_source(key, data)
            values = series(source.resolve(resolver)) if source else None
            points = values[-limits.POINTS :] if values else []
        return [_significant(p) for p in points] if len(points) >= 2 else None

    def _from_history(
        self, query: HistoryQuery, resolver: StateResolver
    ) -> list[float]:
        buckets = history_of(resolver, query)
        if not isinstance(buckets, list):
            return []
        points = [p for b in buckets if (p := finite_number(b)) is not None]
        live = (
            resolver.attribute(query.entity_id, query.attribute)
            if query.attribute
            else resolver.state(query.entity_id)
        )
        if (current := finite_number(live)) is not None:
            points.append(current)
        return points
