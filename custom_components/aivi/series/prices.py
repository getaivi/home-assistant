"""A price timeline, read from wherever a price integration keeps it."""

from __future__ import annotations

import math
from datetime import datetime
from statistics import median
from typing import Any, override

from homeassistant.util import dt as dt_util

from .. import limits
from ..blocks import RootFragment, Slotted, scalar_source
from ..sources import (
    Source,
    StateResolver,
)
from ..sourcing import Bare, ValueSlot
from ..values import (
    SlotKind,
    finite_number,
    parse_list,
    wire_number,
    wire_timestamp,
)

#: Where price integrations keep a period's start, price and level, in
#: the order they are tried (Nord Pool, ENTSO-e, Energi Data Service,
#: Octopus Energy, Amber, Tibber-style and template sensors).
TIME_KEYS = (
    "start",
    "start_time",
    "startsAt",
    "starts_at",
    "from",
    "valid_from",
    "time",
    "hour",
    "period_start",
    "datetime",
)
PRICE_KEYS = (
    "price",
    "value",
    "total",
    "per_kwh",
    "value_inc_vat",
    "price_per_kwh",
    "electricity_price",
    "marketprice",
    "energy",
)
LEVEL_KEYS = ("level", "descriptor", "price_level")

#: Level words price integrations use, folded to Aivi's three bands.
LEVELS = {
    "verycheap": "low",
    "cheap": "low",
    "extremelylow": "low",
    "verylow": "low",
    "low": "low",
    "normal": "medium",
    "neutral": "medium",
    "medium": "medium",
    "average": "medium",
    "expensive": "high",
    "veryexpensive": "high",
    "high": "high",
    "veryhigh": "high",
    "extremelyhigh": "high",
    "spike": "high",
}

#: The minor unit a "per kWh" price is shown in when scaled to cents.
CENT_UNITS = {
    "EUR": "ct",
    "SEK": "öre",
    "NOK": "øre",
    "DKK": "øre",
    "GBP": "p",
    "USD": "¢",
    "AUD": "c",
    "NZD": "c",
    "CHF": "Rp",
    "PLN": "gr",
    "CZK": "h",
}

SCALES = ["cents"]


def _moment(value: Any) -> datetime | None:
    """A period start: a datetime, or text that reads as one. Bare
    numbers are rejected (an "hour" of 13 is not a moment)."""
    if isinstance(value, datetime):
        return (
            value
            if value.tzinfo
            else value.replace(tzinfo=dt_util.get_default_time_zone())
        )
    if not isinstance(value, str) or finite_number(value) is not None:
        return None
    stamp = wire_timestamp(value)
    return datetime.fromisoformat(stamp) if stamp else None


def _first(item: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if item.get(key) is not None:
            return item[key]
    return None


def _entry(item: Any) -> tuple[datetime, float, str | None] | None:
    if isinstance(item, dict):
        start = _moment(_first(item, TIME_KEYS))
        price = finite_number(_first(item, PRICE_KEYS))
        raw_level = _first(item, LEVEL_KEYS)
    elif isinstance(item, list | tuple) and len(item) >= 2:
        start, price, raw_level = _moment(item[0]), finite_number(item[1]), None
    else:
        return None
    if start is None or price is None:
        return None
    start = start.replace(microsecond=0)
    level = None
    if isinstance(raw_level, str):
        level = LEVELS.get("".join(c for c in raw_level.lower() if c.isalpha()))
    return start, price, level


def price_entries(value: Any) -> list[tuple[datetime, float, str | None]]:
    """The periods a list holds, unordered."""
    items = parse_list(value) or []
    return [entry for item in items if (entry := _entry(item)) is not None]


def _hourly(
    entries: list[tuple[datetime, float, str | None]],
) -> list[tuple[datetime, float, str | None]]:
    """Sub-hourly periods averaged into hours (a level survives only when
    every period of the hour agrees)."""
    hours: dict[int, list[tuple[datetime, float, str | None]]] = {}
    for entry in entries:
        hours.setdefault(math.floor(entry[0].timestamp() / 3600), []).append(entry)
    out = []
    for group in hours.values():
        levels = {level for _, _, level in group}
        out.append(
            (
                group[0][0],
                sum(price for _, price, _ in group) / len(group),
                levels.pop() if len(levels) == 1 else None,
            )
        )
    return out


def timeline(
    entries: list[tuple[datetime, float, str | None]], now: datetime
) -> list[tuple[datetime, float, str | None]]:
    """Ordered, de-duplicated periods, at most ``limits.PRICE_ENTRIES``: sub-hourly
    prices beyond the cap become hourly, and what still does not fit is
    cut from the past side, keeping the current period and what follows
    (the window the phone charts)."""
    unique: dict[float, tuple[datetime, float, str | None]] = {}
    for entry in sorted(entries, key=lambda e: e[0]):
        unique.setdefault(entry[0].timestamp(), entry)
    ordered = list(unique.values())
    if len(ordered) > limits.PRICE_ENTRIES:
        gaps = [
            (b[0] - a[0]).total_seconds()
            for a, b in zip(ordered, ordered[1:], strict=False)
        ]
        if median(gaps) < 3600:
            ordered = _hourly(ordered)
    current = 0
    for index, (start, _, _) in enumerate(ordered):
        if start <= now:
            current = index
    first = max(0, min(current, len(ordered) - limits.PRICE_ENTRIES))
    return ordered[first : first + limits.PRICE_ENTRIES]


def _price(value: float) -> int | float:
    """Six significant digits: whole seconds and this keep two days of
    hourly periods inside Aivi's 4 KiB content limit."""
    return wire_number(float(f"{value:.6g}"))


def cents_unit(unit: Any) -> str | None:
    """ "EUR/kWh" as its cents unit ("ct/kWh"); ``None`` when it is not a
    currency per something."""
    if not isinstance(unit, str) or "/" not in unit:
        return None
    currency, _, per = unit.partition("/")
    code = currency.strip().upper()
    if len(code) != 3 or not code.isalpha():
        return None
    return f"{CENT_UNITS.get(code, 'c')}/{per.strip()}"


class PriceEntries(Slotted):
    """A price timeline from a price sensor, as Aivi's ``entries`` plus a
    default ``unit`` (merged at the root; the unit field overrides it).

    An entity is searched for its timeline: every list attribute whose
    items carry a start and a price (Nord Pool's ``raw_today`` and
    ``raw_tomorrow``, ENTSO-e's ``prices``, Octopus Energy's ``rates``,
    Amber's ``forecasts``...), combined. ``__attribute`` pins one, and a
    template may render the list. With ``scale_key`` set to ``cents`` in
    the binding, prices are multiplied by 100."""

    def __init__(self, *, scale_key: str) -> None:
        self.scale_key = scale_key

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (ValueSlot(kind=SlotKind.TEXT, bare=Bare.ENTITY),)

    @property
    def filter_meta(self) -> dict[str, Any]:
        return {"domain": ["sensor", "event"]}

    def _found(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> list[tuple[datetime, float, str | None]]:
        source = scalar_source(key, data)
        if source is None:
            return []
        if source.source is not Source.ENTITY or source.entity_id is None:
            return price_entries(source.resolve(resolver))
        found = []
        for value in resolver.attributes(source.entity_id).values():
            if isinstance(value, list | tuple):
                found.extend(price_entries(value))
        return found

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> RootFragment | None:
        periods = timeline(self._found(key, data, resolver), dt_util.utcnow())
        if not periods:
            return None
        cents = data.get(self.scale_key) == "cents"
        entries = []
        for start, price, level in periods:
            entry: dict[str, Any] = {
                "start": start.isoformat(),
                "price": _price(price * 100 if cents else price),
            }
            if level is not None:
                entry["level"] = level
            entries.append(entry)
        out = RootFragment({"entries": entries})
        # The sensor's own unit, also when one of its attributes is pinned.
        source = scalar_source(key, data)
        entity_id = source.entity_id if source else None
        unit = (
            resolver.attribute(entity_id, "unit_of_measurement") if entity_id else None
        )
        if cents:
            unit = cents_unit(unit)
        if isinstance(unit, str) and unit.strip():
            out["unit"] = unit.strip()[: limits.UNIT]
        return out
