"""Sourceable values: which parts of a binding can come from live state.

A ``ValueSlot`` is one addressable value inside a binding scope: a
top-level field, or a nested key like a value's text color. It declares
what kind of value it holds, whether its bare key means a literal or an
entity id, and which sources it accepts. From that declaration the
integration derives the entity subscription, the resolved payload, the
editor's per-field feedback, and the panel metadata.

Not to be confused with ``frontend/src/slots.ts``: a value slot is where a
value comes from; a preview slot is where a value is drawn.

The rule that decides what may be sourced: shape is static, values are
dynamic. A source may change what a payload key says, never which keys
exist, how many items a list has, or which template renders (so sourced
segment weights fall back rather than drop, and an unavailable sensor
cannot reshuffle a bar).

Storage uses flat markers:

    <slot>              the literal value, or the entity id for
                        entity-bare slots
    <slot>__entity      entity id
    <slot>__attribute   attribute name (with an entity)
    <slot>__template    Jinja source
    <slot>__watched     entity ids the template depends on, for the panel
    <slot>__bands       {"entity", "limits", "values"}: the value by band
                        of an entity's reading (``sources.Bands``)

Precedence is template > bands > attribute > entity > literal.

Failure is always a degrade, never a push failure. A source that is
unavailable, renders to nothing, raises, or produces a value the wire
would reject falls back to the stored literal; with no literal the slot
is unresolved and the engine's optional/required rules apply. This is
what makes sourcing a color safe: the wire palette is a closed enum, and
an unclamped value would get a 422 and a permanent repair issue.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, NamedTuple

from .sources import Bands, SourcedValue, StateResolver
from .values import SlotKind, coerce


class Bare(StrEnum):
    """What the slot's un-suffixed key means.

    ``ENTITY`` is the reading of ``Value``, ``Number``, ``Bool`` and
    ``Timestamp``: the bare key holds an entity id and there is no
    literal. ``LITERAL``: the bare key holds the value itself and doubles
    as the fallback.

    ``__entity`` is honored in both modes, so the panel can always write
    the explicit marker.
    """

    ENTITY = "entity"
    LITERAL = "literal"


# A literal-only slot narrows this to ().
DEFAULT_SOURCES: tuple[str, ...] = ("entity", "attribute", "template")
#: A palette color also takes bands: a color by value.
COLOR_SOURCES: tuple[str, ...] = (*DEFAULT_SOURCES, "bands")


@dataclass(frozen=True, slots=True)
class ValueSlot:
    """One sourceable value inside a binding scope."""

    #: Appended to the field key to address this slot; "" is the field
    #: itself. Sub-slots use the same marker convention one level down
    #: (``state__color``, then ``state__color__template``).
    suffix: str = ""
    kind: SlotKind = SlotKind.TEXT
    bare: Bare = Bare.LITERAL
    #: Allowed values, for the enum and color coercers.
    options: tuple[str, ...] = ()
    sources: tuple[str, ...] = field(default=DEFAULT_SOURCES)
    #: The longest text the wire takes here, for text and URL slots.
    max_length: int | None = None
    #: Number and money slots: a value that is not above 0 is unusable.
    positive: bool = False

    def address(self, key: str) -> str:
        return f"{key}{self.suffix}"

    def source(self, key: str, data: dict[str, Any]) -> SourcedValue | None:
        """The slot's declared source, or ``None`` when it has none."""
        return read_source(self.address(key), data, bare=self.bare)

    def literal(self, key: str, data: dict[str, Any]) -> Any:
        """The stored fallback. Entity-bare slots have none: their bare
        key is the entity id, not a value."""
        if self.bare is Bare.ENTITY:
            return None
        return data.get(self.address(key))

    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        """The slot's current value, coerced, falling back to the literal.

        The ladder, in order: a source that resolves and coerces cleanly
        wins; otherwise the stored literal, coerced the same way;
        otherwise the slot is unresolved. A source that raises is handled by
        the resolver (``DegradingResolver`` degrades it
        to ``None``), and arrives here as "unavailable".
        """
        source = self.source(key, data)
        if source is not None:
            # Text is shown as Home Assistant words it; every other kind
            # reads the raw state it parses.
            display = self.kind is SlotKind.TEXT
            value = self.coerce(source.resolve(resolver, display=display))
            if value is not None:
                return value
        return self.coerce(self.literal(key, data))

    def coerce(self, value: Any) -> Any:
        out = coerce(self.kind, value, self.options, self.max_length)
        if self.positive and out is not None and not float(out) > 0:
            return None
        return out


class SlotUse(NamedTuple):
    """A slot where one binding uses it: ``scope`` holds its markers under
    ``key``, and the editor's feedback is keyed by ``address``."""

    slot: ValueSlot
    scope: dict[str, Any]
    key: str
    address: str

    def source(self) -> SourcedValue | None:
        return self.slot.source(self.key, self.scope)


def read_source(
    address: str, data: dict[str, Any], *, bare: Bare = Bare.LITERAL
) -> SourcedValue | None:
    """Read a slot's source from stored data, template > bands >
    attribute > entity. ``None`` when the slot has no source (it is a
    literal). Bands that are not usable are no source."""
    if template := data.get(f"{address}__template"):
        watched = tuple(data.get(f"{address}__watched", ()) or ())
        return SourcedValue.tmpl(str(template), watched=watched)
    if (bands := Bands.parse(data.get(f"{address}__bands"))) is not None:
        return SourcedValue.banded(bands)
    entity_id = data.get(f"{address}__entity")
    if not entity_id and bare is Bare.ENTITY:
        entity_id = data.get(address)
    if not entity_id:
        return None
    if attribute := data.get(f"{address}__attribute"):
        return SourcedValue.attr(str(entity_id), str(attribute))
    return SourcedValue.entity(str(entity_id))


def describe(slot: ValueSlot) -> dict[str, Any]:
    """The slot as the panel sees it, for the template metadata."""
    described: dict[str, Any] = {
        "kind": slot.kind.value,
        "bare": slot.bare.value,
        "sources": list(slot.sources),
    }
    if slot.options:
        described["options"] = list(slot.options)
    return described
