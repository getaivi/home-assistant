"""Reusable field blocks.

Each block resolves its stored values into a piece of the content payload
and declares the value slots they come from, which also give its entity
subscription and editor feedback. Templates are assembled from blocks as
data (``templates``).

Stored bindings are keyed per field. A scalar field ``state`` reads ``state``
(an entity) and, optionally, ``state__template`` (a Jinja override) and
``state__attribute``. Precedence: template, then attribute, then entity.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from typing import Any, Protocol, cast, override, runtime_checkable

from . import limits
from .sources import (
    HistoryKind,
    HistoryQuery,
    Source,
    SourcedValue,
    StateResolver,
    history_of,
)
from .sourcing import COLOR_SOURCES, Bare, SlotUse, ValueSlot, read_source
from .values import (
    TEXT_MAX,
    SlotKind,
    as_bool,
    finite_number,
    wire_number,
)

# Aivi's named color palette (a closed enum on the wire).
COLORS = [
    "red",
    "orange",
    "yellow",
    "green",
    "mint",
    "teal",
    "cyan",
    "blue",
    "indigo",
    "purple",
    "pink",
    "brown",
    "gray",
    "gray2",
    "gray3",
    "gray4",
    "gray5",
    "gray6",
]
FORMATTERS = ["time_since", "time_until"]
RENDERING_MODES = ["monochrome", "hierarchical", "palette", "multicolor"]
COLOR_RENDERINGS = ["flat", "gradient"]
TRACK_FILLS = ["solid", "hatched"]
SEGMENT_DISPLAYS = ["split", "layered"]


class RootFragment(dict[str, Any]):
    """A resolved fragment merged into the dict at the field's parent path
    instead of being set at the path itself, for blocks whose one input
    maps to several sibling payload keys (gauge's color-or-gradient at the
    root; a segment list flipping progress.style alongside its data)."""


def scalar_source(key: str, data: dict[str, Any]) -> SourcedValue | None:
    """A scalar field's source: template > attribute > entity, with the
    bare key holding the entity id."""
    return read_source(key, data, bare=Bare.ENTITY)


class Block(Protocol):
    """A field's payload contribution."""

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> Any: ...


@runtime_checkable
class Sourceable(Protocol):
    """A block with sourceable values: the slots one binding uses."""

    def slot_uses(self, key: str, data: dict[str, Any]) -> Iterable[SlotUse]: ...


class Slotted:
    """A block whose sourceable values are the slots it declares at the
    top level of the binding."""

    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        raise NotImplementedError

    def slot_uses(self, key: str, data: dict[str, Any]) -> Iterator[SlotUse]:
        for slot in self.value_slots(key):
            yield SlotUse(slot, data, key, slot.address(key))


def slots_of(block: object, key: str) -> tuple[ValueSlot, ...]:
    """The top-level slots a block declares, for the panel metadata."""
    return block.value_slots(key) if isinstance(block, Slotted) else ()


def slot_uses(block: object, key: str, data: dict[str, Any]) -> Iterable[SlotUse]:
    """The slots a field's binding uses: its own, its selected rows' and
    its segments'."""
    return block.slot_uses(key, data) if isinstance(block, Sourceable) else ()


def depends(block: object, key: str, data: dict[str, Any]) -> set[str]:
    """Every entity a field's binding reads, for the state subscription."""
    deps: set[str] = (
        block.entities(key, data) if isinstance(block, EntityRows) else set()
    )
    for use in slot_uses(block, key, data):
        if (source := use.source()) is not None:
            deps |= source.dependencies
    return deps


@runtime_checkable
class HistoryNeeds(Protocol):
    """A block that reads recorded history: the queries its stored values
    ask, fetched before each resolve (``history.HistoryCache``)."""

    def history_queries(self, key: str, data: dict[str, Any]) -> set[HistoryQuery]: ...


def history_queries_of(
    block: object, key: str, data: dict[str, Any]
) -> set[HistoryQuery]:
    return (
        block.history_queries(key, data) if isinstance(block, HistoryNeeds) else set()
    )


def entity_source(key: str, data: dict[str, Any]) -> str | None:
    """The entity a scalar field reads its state from, or ``None`` when it
    is template- or attribute-sourced."""
    source = scalar_source(key, data)
    if source is None or source.source is not Source.ENTITY:
        return None
    return source.entity_id


class EntityFilter:
    """A block bound to entities the panel's picker narrows by domain and
    device class; ``numeric`` keeps only entities whose state reads as a
    number, and ``device_class_first`` lists one device class ahead of
    the rest (a budget's categories: numeric sensors, money first)."""

    def __init__(
        self,
        *,
        domain: str | list[str] | None = None,
        device_class: str | None = None,
        numeric: bool = False,
        device_class_first: str | None = None,
    ) -> None:
        self._domain = domain
        self._device_class = device_class
        self._numeric = numeric
        self._device_class_first = device_class_first

    @property
    def filter_meta(self) -> dict[str, Any]:
        """Entity-picker constraints, for the custom panel's picker."""
        meta: dict[str, Any] = {}
        if self._domain is not None:
            meta["domain"] = self._domain
        if self._device_class is not None:
            meta["device_class"] = self._device_class
        if self._numeric:
            meta["numeric"] = True
        if self._device_class_first is not None:
            meta["device_class_first"] = self._device_class_first
        return meta


class _ScalarBlock(Slotted, EntityFilter):
    """An entity-or-template field whose value is its one slot's."""

    SLOT = ValueSlot(bare=Bare.ENTITY)

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (self.SLOT,)

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        return cast("float | None", self.SLOT.resolve(key, data, resolver))


class Number(_ScalarBlock):
    """A numeric field (progress fraction, gauge value, power)."""

    SLOT = ValueSlot(kind=SlotKind.NUMBER, bare=Bare.ENTITY)

    def __init__(
        self,
        *,
        scale: float = 1.0,
        minimum: float | None = None,
        maximum: float | None = None,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        self._scale = scale
        self._minimum = minimum
        self._maximum = maximum

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> int | float | None:
        number = self.SLOT.resolve(key, data, resolver)
        if number is None:
            return None
        number *= self._scale
        if self._minimum is not None:
            number = max(number, self._minimum)
        if self._maximum is not None:
            number = min(number, self._maximum)
        return wire_number(number)


#: unit_of_measurement -> factor to watts / kilowatt-hours.
POWER_UNITS: dict[str, float] = {
    "mW": 0.001,
    "W": 1,
    "kW": 1000,
    "MW": 1_000_000,
    "GW": 1_000_000_000,
    "BTU/h": 0.29307107,
}
ENERGY_UNITS: dict[str, float] = {
    "mWh": 0.000001,
    "Wh": 0.001,
    "kWh": 1,
    "MWh": 1000,
    "GWh": 1_000_000,
    "MJ": 1 / 3.6,
    "GJ": 1000 / 3.6,
}


def unit_factor(
    units: dict[str, float], entity_id: str | None, resolver: StateResolver
) -> float:
    """The factor that brings an entity's state to the unit ``units`` is
    keyed against; 1 for an unknown or missing unit."""
    if entity_id is None:
        return 1
    unit = resolver.attribute(entity_id, "unit_of_measurement")
    return units.get(str(unit).strip(), 1) if unit else 1


class Measure(Number):
    """A number in a fixed unit (watts, kilowatt-hours). An entity's state
    is converted from its ``unit_of_measurement``; a template or an
    attribute is taken as already in that unit. With ``invertible``, a
    stored ``<key>__invert`` flips the sign, for meters whose direction
    convention is the opposite of Aivi's."""

    def __init__(
        self, *, units: dict[str, float], invertible: bool = False, **kw: Any
    ) -> None:
        super().__init__(**kw)
        self.units = units
        self.invertible = invertible

    def _reading(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> float | None:
        return cast("float | None", self.SLOT.resolve(key, data, resolver))

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> int | float | None:
        number = self._reading(key, data, resolver)
        if number is None:
            return None
        number *= unit_factor(self.units, entity_source(key, data), resolver)
        if self.invertible and as_bool(data.get(f"{key}__invert", False)):
            number = -number
        return wire_number(number)


class EnergyToday(Measure):
    """Today's energy in kWh. From an entity: its reading now minus the
    lowest it read since midnight (``HistoryKind.DAY_LOW``), which counts
    a lifetime meter from its midnight reading and a daily meter from its
    reset, so either kind works. A template or an attribute is taken as
    today's figure already."""

    def __init__(self, **kw: Any) -> None:
        super().__init__(units=ENERGY_UNITS, **kw)

    def history_queries(self, key: str, data: dict[str, Any]) -> set[HistoryQuery]:
        entity_id = entity_source(key, data)
        if entity_id is None:
            return set()
        return {HistoryQuery(HistoryKind.DAY_LOW, entity_id)}

    @override
    def _reading(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> float | None:
        number = super()._reading(key, data, resolver)
        entity_id = entity_source(key, data)
        if number is None or entity_id is None:
            return number
        low = finite_number(
            history_of(resolver, HistoryQuery(HistoryKind.DAY_LOW, entity_id))
        )
        return None if low is None else max(number - low, 0)


class Amount(_ScalarBlock):
    """An amount of money (``SlotKind.MONEY``). ``bare`` decides whether
    the field is an entity (what was spent) or a typed amount that may be
    sourced (a budget); ``positive`` drops an amount that is not above 0."""

    def __init__(
        self, *, bare: Bare = Bare.ENTITY, positive: bool = False, **kw: Any
    ) -> None:
        super().__init__(**kw)
        self.SLOT = ValueSlot(kind=SlotKind.MONEY, bare=bare, positive=positive)


class Bool(_ScalarBlock):
    SLOT = ValueSlot(kind=SlotKind.BOOL, bare=Bare.ENTITY)


class Timestamp(_ScalarBlock):
    """An entity/template whose value is (or renders to) a timestamp."""

    SLOT = ValueSlot(kind=SlotKind.TIMESTAMP, bare=Bare.ENTITY)


class Value(_ScalarBlock):
    """Aivi's ``{value, text_color?, formatter?}`` object.

    The value and the text color are independently sourceable; the
    formatter stays a literal. ``FORMATTER`` says whether the wire takes
    one here (a state mark's word takes none).
    """

    FORMATTER = True
    SLOT = ValueSlot(bare=Bare.ENTITY, max_length=limits.VALUE)
    _COLOR = ValueSlot(
        suffix="__color",
        kind=SlotKind.COLOR,
        options=tuple(COLORS),
        sources=COLOR_SOURCES,
    )

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (self.SLOT, self._COLOR)

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> dict[str, Any] | None:
        value = self.SLOT.resolve(key, data, resolver)
        if value is None:
            return None
        out: dict[str, Any] = {"value": value}
        if color := self._COLOR.resolve(key, data, resolver):
            out["text_color"] = color
        if (formatter := data.get(f"{key}__formatter")) in FORMATTERS:
            out["formatter"] = formatter
        return out


class Icon(Slotted):
    """An SF Symbol name, with the full icon styling of the wire format:
    primary/secondary/tertiary colors, rendering mode, and flat/gradient
    color rendering. A bare name stays a bare string."""

    _STYLE = {
        "color": "primary_color",
        "rendering_mode": "rendering_mode",
        "secondary_color": "secondary_color",
        "tertiary_color": "tertiary_color",
        "color_rendering": "color_rendering",
    }

    _NAME = ValueSlot(kind=SlotKind.ICON)
    # The color style keys, sourceable and clamped to the palette.
    _COLORS = {
        suffix: ValueSlot(
            suffix=f"__{suffix}",
            kind=SlotKind.COLOR,
            options=tuple(COLORS),
            sources=COLOR_SOURCES,
        )
        for suffix in ("color", "secondary_color", "tertiary_color")
    }
    _ENUMS = {
        "rendering_mode": RENDERING_MODES,
        "color_rendering": COLOR_RENDERINGS,
    }

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        """The name and the three colors are sourceable; the two
        rendering enums stay literal look choices."""
        return (self._NAME, *self._COLORS.values())

    def _style_value(
        self, key: str, suffix: str, data: dict[str, Any], resolver: StateResolver
    ) -> Any:
        if (slot := self._COLORS.get(suffix)) is not None:
            return slot.resolve(key, data, resolver)
        value = data.get(f"{key}__{suffix}")
        if (options := self._ENUMS.get(suffix)) is not None:
            return value if value in options else None
        return value

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        name = self._NAME.resolve(key, data, resolver)
        if not name:
            return None
        styled = {
            payload_key: value
            for suffix, payload_key in self._STYLE.items()
            if (value := self._style_value(key, suffix, data, resolver))
        }
        if styled:
            return {"name": name, **styled}
        return name


class Color(Slotted):
    """A palette color name, sourceable.

    The stored color is the fallback, so a template that renders something
    outside the palette degrades to the picked swatch instead of a 422.
    """

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (
            ValueSlot(
                kind=SlotKind.COLOR, options=tuple(COLORS), sources=COLOR_SOURCES
            ),
        )

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        return self.value_slots(key)[0].resolve(key, data, resolver)


class NumberLiteral:
    """A literal number typed into the editor (gauge bounds), not sourced
    from an entity."""

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> int | float | None:
        value = data.get(key)
        return None if value == "" else finite_number(value)


class ColorRamp(Slotted):
    """An ordered pick of 1–4 palette colors that lands as one of two
    mutually exclusive payload keys: one color becomes ``solid_key``, two
    or more become ``gradient_key``. Aivi rejects payloads carrying
    both, so a single input keeps that state unrepresentable.

    The one color may follow a reading by value (``<key>__bands``). Then
    it is one color whatever happens: the band's, else the first picked
    one; a sourced solid never turns into a gradient. The ramp itself
    stays a literal."""

    MAX = limits.RAMP_STOPS
    #: The one color by value.
    SOLID = ValueSlot(kind=SlotKind.COLOR, options=tuple(COLORS), sources=("bands",))

    def __init__(self, *, solid_key: str, gradient_key: str) -> None:
        self.solid_key = solid_key
        self.gradient_key = gradient_key

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (self.SOLID,)

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> RootFragment | None:
        colors = [c for c in (data.get(key) or []) if c in COLORS][: self.MAX]
        if (source := self.SOLID.source(key, data)) is not None:
            color = self.SOLID.coerce(source.resolve(resolver))
            solid = color or (colors[0] if colors else None)
            return RootFragment({self.solid_key: solid}) if solid else None
        if not colors:
            return None
        if len(colors) == 1:
            return RootFragment({self.solid_key: colors[0]})
        return RootFragment({self.gradient_key: colors})


class SegmentList:
    """Segments for a segmented progress bar: an ordered list of up to four
    ``{value, fill_color, track_color?, track_fill?, label?}`` dicts, plus
    a sibling ``<key>__display`` (split | layered). Resolves to a fragment
    merged into the parent progress object, flipping its style to
    "segmented".

    A segment's weight may be sourced (``WEIGHT``: ``source`` /
    ``source__attribute`` / ``source__template`` inside the segment). The
    literal ``value`` is required either way and is the fallback weight
    whenever the source yields nothing usable: falling back instead of
    dropping the segment keeps the bar's segment count and order stable.

    Aivi requires segment values to sum to exactly 1.0 under float
    equality, so weights are normalized and quantized to 1024ths: dyadic
    fractions add without rounding. Source keys never reach the wire.
    """

    MAX = limits.SEGMENTS
    _UNITS = 1024

    WEIGHT = ValueSlot(
        suffix="source", kind=SlotKind.NUMBER, bare=Bare.ENTITY, positive=True
    )
    #: Per-segment sourceable values, addressed inside the segment dict.
    #: They override the stored literal when they resolve; the literal
    #: stays required so a segment can never disappear.
    SEGMENT_SLOTS: tuple[ValueSlot, ...] = (
        ValueSlot(suffix="fill_color", kind=SlotKind.COLOR, options=tuple(COLORS)),
        ValueSlot(suffix="track_color", kind=SlotKind.COLOR, options=tuple(COLORS)),
        ValueSlot(suffix="label", kind=SlotKind.TEXT, max_length=limits.LABEL),
    )

    def slot_uses(self, key: str, data: dict[str, Any]) -> Iterator[SlotUse]:
        """Each valid segment's weight, colors and label, addressed
        ``<key>.<index>.<slot>`` (the weight's slot is ``source``)."""
        for index, _, item in self._parse(data.get(key)):
            for slot in (self.WEIGHT, *self.SEGMENT_SLOTS):
                yield SlotUse(slot, item, "", f"{key}.{index}.{slot.suffix}")

    def _parse(self, raw: Any) -> list[tuple[int, dict[str, Any], dict[str, Any]]]:
        """The valid segments as (stored index, wire payload, stored item);
        the stored item is kept for resolving per-segment slots."""
        if not isinstance(raw, list):
            return []
        segments: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
        for index, item in enumerate(raw[: self.MAX]):
            if not isinstance(item, dict):
                continue
            value = finite_number(item.get("value", 0))
            fill = item.get("fill_color")
            if value is None or value <= 0 or fill not in COLORS:
                continue
            segment: dict[str, Any] = {"value": value, "fill_color": fill}
            if (track := item.get("track_color")) in COLORS:
                segment["track_color"] = track
            if (track_fill := item.get("track_fill")) in TRACK_FILLS:
                segment["track_fill"] = track_fill
            label = item.get("label")
            if isinstance(label, str) and label.strip():
                segment["label"] = label.strip()[: limits.LABEL]
            segments.append((index, segment, item))
        return segments

    def clean(self, raw: Any) -> list[dict[str, Any]]:
        """The valid segments' wire payloads (weight sources stripped)."""
        return [segment for _, segment, _ in self._parse(raw)]

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> RootFragment | None:
        parsed = self._parse(data.get(key))
        if not parsed:
            return None
        segments = [segment for _, segment, _ in parsed]
        # A sourced weight that is not a finite positive number falls back
        # to the stored one.
        weights = [
            self.WEIGHT.resolve("", item, resolver) or segment["value"]
            for _, segment, item in parsed
        ]
        for _, segment, item in parsed:
            for slot in self.SEGMENT_SLOTS:
                if (value := slot.resolve("", item, resolver)) is not None:
                    segment[slot.suffix] = value
        total = sum(weights)
        units = [max(1, round(weight / total * self._UNITS)) for weight in weights[:-1]]
        # Keep at least one unit for the last segment.
        while sum(units) > self._UNITS - 1:
            units[units.index(max(units))] -= 1
        units.append(self._UNITS - sum(units))
        for segment, quantum in zip(segments, units, strict=True):
            segment["value"] = wire_number(quantum / self._UNITS)
        out: dict[str, Any] = {"style": "segmented", "segments": segments}
        if (display := data.get(f"{key}__display")) in SEGMENT_DISPLAYS:
            out["display"] = display
        return RootFragment(out)


class Text(Slotted):
    """A string (unit, label), sourceable; the stored string is the
    fallback. Clamped to ``max_length``, the field's cap on the wire."""

    KIND: SlotKind = SlotKind.TEXT

    def __init__(self, *, max_length: int = TEXT_MAX) -> None:
        self._max_length = max_length

    @override
    def value_slots(self, key: str) -> tuple[ValueSlot, ...]:
        return (ValueSlot(kind=self.KIND, max_length=self._max_length),)

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        return self.value_slots(key)[0].resolve(key, data, resolver)


class Currency(Text):
    """An ISO 4217 code, uppercased; anything else is left out."""

    KIND = SlotKind.CURRENCY


class EntityUnit(Text):
    """A unit that defaults to the ``unit_of_measurement`` of the entity
    another field (``follows``) reads, so a sensor's own unit is used
    unless one is typed."""

    def __init__(self, *, follows: str, max_length: int = limits.UNIT) -> None:
        super().__init__(max_length=max_length)
        self.follows = follows

    @override
    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        own = super().resolve(key, data, resolver)
        if own is not None:
            return own
        entity_id = entity_source(self.follows, data)
        if entity_id is None:
            return None
        return self.value_slots(key)[0].coerce(
            resolver.attribute(entity_id, "unit_of_measurement")
        )


class Url(Text):
    """A link (``tap_url``), sourceable: an absolute URI or nothing, so a
    malformed one is left out rather than refused."""

    KIND = SlotKind.URL

    def __init__(self) -> None:
        super().__init__(max_length=limits.TAP_URL)


class Enum:
    def __init__(self, options: list[str]) -> None:
        self._options = options

    @property
    def options(self) -> list[str]:
        return self._options

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        value = data.get(key)
        return value if value in self._options else None


class Setting(Enum):
    """A choice that steers another field and is not sent itself (a price
    timeline's scale)."""

    @override
    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        return None


#: The slots of the row options most rows take; a row's label cap is
#: its own.
ROW_COLOR = ValueSlot("color", SlotKind.COLOR, options=tuple(COLORS))
ROW_ICON = ValueSlot("icon", SlotKind.ICON)


def row_label(max_length: int) -> ValueSlot:
    return ValueSlot("label", SlotKind.TEXT, max_length=max_length)


#: Maps an entity, a resolver and the row's options to the row's payload.
type RowBuilder = Callable[[str, StateResolver, dict[str, Any]], dict[str, Any] | None]


class EntityRows(EntityFilter):
    """A multi-select of entities, each becoming one row of a repeating
    template. The stored value is the ordered list of entity ids (list
    order is row order). Per-row detail lives in a sibling
    ``<key>__options`` dict of ``entity_id -> {option: value}``;
    ``row_options`` names the supported keys and ``row_builder`` maps an
    entity plus its options to its row dict (a subclass that builds its
    rows itself passes none)."""

    def __init__(
        self,
        *,
        domain: str | list[str] | None = None,
        device_class: str | None = None,
        numeric: bool = False,
        device_class_first: str | None = None,
        row_builder: RowBuilder | None = None,
        row_options: tuple[str, ...] = (),
        max_rows: int | None = None,
    ) -> None:
        super().__init__(
            domain=domain,
            device_class=device_class,
            numeric=numeric,
            device_class_first=device_class_first,
        )
        self._row_builder = row_builder
        self._row_options = row_options
        if max_rows is not None:
            self.MAX = max_rows

    #: How each supported row option coerces, capped at what this row's
    #: wire field takes, so per-row values are sourceable on the same terms
    #: as top-level ones.
    ROW_SLOTS: tuple[ValueSlot, ...] = (
        ROW_COLOR,
        ROW_ICON,
        row_label(limits.LABEL),
        ValueSlot("budget", SlotKind.MONEY, positive=True),
        ValueSlot("charging", SlotKind.BOOL),
    )

    @property
    def row_options(self) -> tuple[str, ...]:
        """The per-row option keys this field supports."""
        return self._row_options

    #: What a plain (non-slot) row option takes, in words, for whoever
    #: has to describe the options (the suggester's prompt).
    OPTION_NOTES: dict[str, str] = {
        "today": "the entity id of the energy sensor counting today's total"
    }

    def clean_option(self, option: str, value: Any) -> Any | None:
        """A plain (non-slot) row option as it is stored, or ``None`` when
        it cannot use the value."""
        if isinstance(value, str) and value.strip():
            return value.strip()[:TEXT_MAX]
        return None

    def row_slots(self) -> tuple[ValueSlot, ...]:
        """The sourceable slots inside one row's options dict."""
        return tuple(
            slot
            for option in self._row_options
            for slot in self.ROW_SLOTS
            if slot.suffix == option
        )

    def entity_ids(self, key: str, data: dict[str, Any]) -> list[str]:
        """The bound entities that become rows: the first ``MAX``
        entity ids, in list order."""
        ids: list[str] = [
            entity_id
            for entity_id in (data.get(key) or [])
            if isinstance(entity_id, str) and entity_id
        ]
        return ids[: self.MAX]

    #: The most rows the template takes.
    MAX = limits.ROWS

    def entities(self, key: str, data: dict[str, Any]) -> set[str]:
        """The entities the selected rows read besides their options' slots."""
        return set(self.entity_ids(key, data))

    def slot_uses(self, key: str, data: dict[str, Any]) -> Iterator[SlotUse]:
        """The selected rows' option slots, addressed
        ``<key>.<entity id>.<option>``."""
        for entity_id in self.entity_ids(key, data):
            options = self._stored_options(key, data, entity_id)
            for slot in self.row_slots():
                yield SlotUse(slot, options, "", f"{key}.{entity_id}.{slot.suffix}")

    def _stored_options(
        self, key: str, data: dict[str, Any], entity_id: str
    ) -> dict[str, Any]:
        stored = data.get(f"{key}__options")
        raw = stored.get(entity_id) if isinstance(stored, dict) else None
        return raw if isinstance(raw, dict) else {}

    def _options_for(
        self,
        key: str,
        data: dict[str, Any],
        entity_id: str,
        resolver: StateResolver,
    ) -> dict[str, Any]:
        """The per-row options for one entity: only supported keys with
        non-empty string values, each sourceable option resolved and
        falling back to its stored literal."""
        raw = self._stored_options(key, data, entity_id)
        if not raw:
            return {}
        options = {
            option: value
            for option, value in raw.items()
            if option in self._row_options and isinstance(value, str) and value
        }
        for slot in self.row_slots():
            if (value := slot.resolve("", raw, resolver)) is not None:
                options[slot.suffix] = value
            else:
                options.pop(slot.suffix, None)
        return options

    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> list[dict[str, Any]] | None:
        if self._row_builder is None:
            return None
        rows = [
            self._row_builder(
                eid, resolver, self._options_for(key, data, eid, resolver)
            )
            for eid in self.entity_ids(key, data)
        ]
        rows = [r for r in rows if r is not None]
        return rows or None


class EnergySources(EntityRows):
    """The energy template's generation sources: power sensors, each with
    an optional "today" energy entity (row option ``today``, read like
    ``EnergyToday``)."""

    ROW_SLOTS = (ROW_COLOR, ROW_ICON, row_label(limits.ENERGY_NAME))

    def __init__(
        self,
        *,
        row_builder: RowBuilder,
        max_rows: int,
    ) -> None:
        super().__init__(
            domain="sensor",
            device_class="power",
            row_builder=row_builder,
            row_options=("label", "icon", "color", "today"),
            max_rows=max_rows,
        )

    def _today_entities(self, key: str, data: dict[str, Any]) -> set[str]:
        found: set[str] = set()
        for entity_id in self.entity_ids(key, data):
            today = self._stored_options(key, data, entity_id).get("today")
            if isinstance(today, str) and today:
                found.add(today)
        return found

    @override
    def entities(self, key: str, data: dict[str, Any]) -> set[str]:
        return super().entities(key, data) | self._today_entities(key, data)

    def history_queries(self, key: str, data: dict[str, Any]) -> set[HistoryQuery]:
        return {
            HistoryQuery(HistoryKind.DAY_LOW, entity_id)
            for entity_id in self._today_entities(key, data)
        }


def energy_today(entity_id: str, resolver: StateResolver) -> int | float | None:
    """``EnergyToday`` for an entity id outside a field (a source row)."""
    return EnergyToday().resolve("today", {"today": entity_id}, resolver)
