"""Value sources: the "Entity / Attribute / Template / By value" model, once.

A ``SourcedValue`` is how any field gets its value. It knows which entities
it depends on (for the state subscription) and how to resolve itself against
a ``StateResolver``, an interface so resolution is testable against a plain
dict; the production ``HassStateResolver`` wraps ``hass``.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from itertools import pairwise
from typing import TYPE_CHECKING, Any, ClassVar, Protocol, override, runtime_checkable

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, State
from homeassistant.exceptions import TemplateError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.template import Template
from homeassistant.helpers.translation import async_translate_state

from .values import finite_number, wire_number

if TYPE_CHECKING:
    from homeassistant.helpers.template import RenderInfo

    from .history import HistoryCache

_UNRESOLVED = (STATE_UNAVAILABLE, STATE_UNKNOWN, None)
_NOTHING = ("", STATE_UNKNOWN, STATE_UNAVAILABLE, "None")

#: ``SourcedValue.reading`` for an entity Home Assistant does not have.
READING_MISSING = "missing"
#: ``SourcedValue.reading`` for a template or attribute that gives nothing.
READING_EMPTY = "empty"


def renders_to_nothing(value: Any) -> bool:
    """True when a template render carries no usable value.

    ``Template.async_render(parse_result=False)`` always returns a string,
    so Python ``None`` renders as ``"None"``, and ``unknown``/``unavailable``
    leak through ``states(...)``. These, and blank output, degrade to
    "unresolved": an empty render must not be pushed as ``{"value": ""}``.
    The editor preview uses this same predicate, so its "renders to
    nothing" matches what the runtime treats as unresolved.
    """
    return value is None or str(value).strip() in _NOTHING


class Source(StrEnum):
    ENTITY = "entity"
    ATTRIBUTE = "attribute"
    TEMPLATE = "template"
    #: An entity's reading, mapped to one of a few values by the band of
    #: numbers it falls in (``Bands``).
    BANDS = "bands"


@dataclass(frozen=True, slots=True)
class Bands:
    """Values by band of an entity's reading: ``values[i]`` while the
    reading is at least ``limits[i - 1]`` and below ``limits[i]``, so
    ``values`` is one longer than ``limits``, which ascend. A reading that
    is not a number has no band."""

    entity_id: str
    limits: tuple[float, ...]
    values: tuple[str, ...]

    MAX: ClassVar[int] = 5

    @classmethod
    def parse(cls, raw: Any) -> Bands | None:
        """Stored bands (``{"entity", "limits", "values"}``), or ``None``
        when they are not usable: no entity, a limit that is not a finite
        number, limits that do not ascend, or values that do not match
        them in number."""
        if not isinstance(raw, dict):
            return None
        entity_id, limits, values = (
            raw.get("entity"),
            raw.get("limits"),
            raw.get("values"),
        )
        if not isinstance(entity_id, str) or not entity_id:
            return None
        if not isinstance(limits, list) or not isinstance(values, list):
            return None
        numbers = [finite_number(limit) for limit in limits]
        if any(n is None for n in numbers) or not 2 <= len(values) <= cls.MAX:
            return None
        ascending = [float(n) for n in numbers if n is not None]
        if len(values) != len(ascending) + 1 or any(
            b <= a for a, b in pairwise(ascending)
        ):
            return None
        if not all(isinstance(value, str) for value in values):
            return None
        return cls(entity_id, tuple(ascending), tuple(values))

    def pick(self, reading: Any) -> str | None:
        """The value of the band ``reading`` falls in, or ``None`` when it
        is not a number."""
        number = finite_number(reading)
        if number is None:
            return None
        return self.values[bisect_right(self.limits, number)]

    def stored(self) -> dict[str, Any]:
        return {
            "entity": self.entity_id,
            "limits": [wire_number(limit) for limit in self.limits],
            "values": list(self.values),
        }


class StateResolver(Protocol):
    """Reads current state. The only coupling between binding resolution and
    the running Home Assistant."""

    def state(self, entity_id: str) -> str | None: ...
    def attribute(self, entity_id: str, name: str) -> Any: ...
    def attributes(self, entity_id: str) -> dict[str, Any]: ...
    def render(self, template: str) -> Any: ...


@runtime_checkable
class AreaResolver(Protocol):
    """A resolver that also reads an entity's area. Separate from
    ``StateResolver`` because only a few blocks need it (a switchboard
    tile's default subtitle is its room), and a resolver over a plain dict
    has no registries to read."""

    def area_name(self, entity_id: str) -> str | None: ...


@runtime_checkable
class DisplayResolver(Protocol):
    """A resolver that also knows how Home Assistant words a state: "Away"
    for ``not_home``, "Off" for ``off``, in the instance's language.
    Separate for the same reason as ``AreaResolver``: a resolver over a
    plain dict has no translations to read."""

    def display_state(self, entity_id: str) -> str | None: ...


@runtime_checkable
class ReportedResolver(Protocol):
    """A resolver that knows when an entity last reported: a showcase's
    "last reported" line. Separate for the same reason as the others: a
    resolver over a plain dict has no state objects to read."""

    def last_reported(self, entity_id: str) -> datetime | None: ...


def display_state_of(resolver: StateResolver, entity_id: str) -> str | None:
    """The entity's state as Home Assistant displays it, or the raw state
    where the resolver cannot say."""
    if isinstance(resolver, DisplayResolver):
        return resolver.display_state(entity_id)
    return resolver.state(entity_id)


class HistoryKind(StrEnum):
    #: Time-weighted means of the recorded states over equal buckets.
    BUCKETS = "buckets"
    #: The lowest recorded state since local midnight.
    DAY_LOW = "day_low"


@dataclass(frozen=True, slots=True)
class HistoryQuery:
    """A question about an entity's recorded past. The answer is fetched
    from the recorder ahead of a resolve (``history.HistoryCache``), since
    resolving itself is synchronous."""

    kind: HistoryKind
    entity_id: str
    attribute: str | None = None
    #: BUCKETS only: the window, in hours, and how many buckets split it.
    hours: int = 24
    buckets: int = 24


@runtime_checkable
class HistoryResolver(Protocol):
    """A resolver that also answers ``HistoryQuery``s. Separate from
    ``StateResolver`` for the same reason as ``AreaResolver``: only a few
    blocks need it, and only the push path and the preview can answer."""

    def history(self, query: HistoryQuery) -> Any: ...


def history_of(resolver: StateResolver, query: HistoryQuery) -> Any:
    """The resolver's answer to ``query``, or ``None`` when it has none."""
    return resolver.history(query) if isinstance(resolver, HistoryResolver) else None


@dataclass(frozen=True, slots=True)
class SourcedValue:
    """Where a field's value comes from."""

    source: Source
    entity_id: str | None = None
    attribute: str | None = None
    template: str | None = None
    watched: tuple[str, ...] = field(default_factory=tuple)
    bands: Bands | None = None

    @property
    def dependencies(self) -> set[str]:
        """The entity to follow. A template is followed by template result
        tracking instead, which sees what it really reads."""
        if self.source is not Source.TEMPLATE and self.entity_id:
            return {self.entity_id}
        return set()

    def resolve(self, resolver: StateResolver, *, display: bool = False) -> Any:
        """The current value, or ``None`` when it can't resolve yet.

        ``display`` reads an entity's state the way Home Assistant words it
        ("Away", not ``not_home``): for a value shown as text. Numbers,
        switches and moments read the raw state.

        Entity states filter only the ``unknown``/``unavailable`` sentinels
        (integrations don't produce blank states); template renders go
        through the stricter ``renders_to_nothing``, since user Jinja
        routinely produces blank/``None`` output that must not be pushed as
        a real value.
        """
        match self.source:
            case Source.ENTITY if self.entity_id is not None:
                value = resolver.state(self.entity_id)
                if value in _UNRESOLVED:
                    return None
                return display_state_of(resolver, self.entity_id) if display else value
            case Source.ATTRIBUTE if (
                self.entity_id is not None and self.attribute is not None
            ):
                return resolver.attribute(self.entity_id, self.attribute)
            case Source.TEMPLATE if self.template is not None:
                value = resolver.render(self.template)
                return None if renders_to_nothing(value) else value
            case Source.BANDS if self.bands is not None:
                return self.bands.pick(resolver.state(self.bands.entity_id))
        return None

    def reading(self, resolver: StateResolver) -> str | None:
        """What the source reads now, raw, to say why it does not resolve:
        an entity's state as it is (``unknown``, ``unavailable``, ``abc``),
        ``READING_MISSING`` for an entity Home Assistant does not have, or
        ``READING_EMPTY`` for a template or an attribute that gives
        nothing. ``None`` for a source with nothing to read."""
        match self.source:
            case Source.TEMPLATE if self.template is not None:
                value = resolver.render(self.template)
                return READING_EMPTY if renders_to_nothing(value) else str(value)
            case Source.ATTRIBUTE if (
                self.entity_id is not None and self.attribute is not None
            ):
                if resolver.state(self.entity_id) is None:
                    return READING_MISSING
                value = resolver.attribute(self.entity_id, self.attribute)
                return READING_EMPTY if value is None or value == "" else str(value)
        if self.entity_id is None:
            return None
        state = resolver.state(self.entity_id)
        return READING_MISSING if state is None else state

    @classmethod
    def entity(cls, entity_id: str) -> SourcedValue:
        return cls(Source.ENTITY, entity_id=entity_id)

    @classmethod
    def attr(cls, entity_id: str, name: str) -> SourcedValue:
        return cls(Source.ATTRIBUTE, entity_id=entity_id, attribute=name)

    @classmethod
    def tmpl(cls, template: str, watched: tuple[str, ...] = ()) -> SourcedValue:
        return cls(Source.TEMPLATE, template=template, watched=watched)

    @classmethod
    def banded(cls, bands: Bands) -> SourcedValue:
        return cls(Source.BANDS, entity_id=bands.entity_id, bands=bands)


@dataclass(frozen=True, slots=True)
class TemplateListeners:
    """What a template re-renders on, read from Home Assistant's render
    info the way its template tracking (``async_track_template_result``,
    which the push uses) reads it."""

    entities: tuple[str, ...]
    #: Domains it reads whole (``states.sensor``): any change in them.
    domains: tuple[str, ...] = ()
    #: It reads every state (``states`` itself): any state change.
    all_states: bool = False
    #: It reads the clock (``now()``, ``today_at()``, ``relative_time()``),
    #: so it also re-renders at the start of every minute.
    time: bool = False
    #: The fewest seconds between re-renders Home Assistant allows it: a
    #: second for a domain listener, a minute for every state, or what the
    #: template sets itself. ``None`` when it re-renders on every change.
    rate_limit: float | None = None

    @property
    def everything(self) -> bool:
        """It reads every state, or whole domains: no entity list covers
        it."""
        return self.all_states or bool(self.domains)


def listeners_of(info: RenderInfo) -> TemplateListeners:
    """The listeners Home Assistant's template tracking sets up for a
    render: its entities, its domains (read whole or only for entities
    coming and going) and, for reading ``states`` at all, every state."""
    rate_limit: Any = info.rate_limit
    if isinstance(rate_limit, timedelta):
        rate_limit = rate_limit.total_seconds()
    return TemplateListeners(
        entities=tuple(sorted(info.entities)),
        domains=tuple(sorted({*info.domains, *info.domains_lifecycle})),
        all_states=info.all_states or info.all_states_lifecycle,
        time=info.has_time,
        rate_limit=float(rate_limit) if rate_limit else None,
    )


def template_entities(hass: HomeAssistant, template: str) -> TemplateListeners | None:
    """What ``template`` depends on, or ``None`` when it does not render.
    Render info sees through ``expand(...)``, label and area helpers and
    filtered state loops, which a scan for entity ids does not.
    """
    try:
        info = Template(template, hass).async_render_to_info()
        # Rendering is lazy: the entity set is complete only once the
        # result is forced (``expand(...)`` otherwise reports the group).
        info.result()
    except TemplateError:
        return None
    return listeners_of(info)


class HassStateResolver:
    """Production resolver over a live Home Assistant.

    Compiled templates are cached by source text, since constructing a
    ``Template`` compiles it and a push renders every template slot. No
    invalidation is needed: an edited template is different text, and a
    resolver lives no longer than the entry that made it.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._templates: dict[str, Template] = {}

    def _template(self, template: str) -> Template:
        cached = self._templates.get(template)
        if cached is None:
            cached = Template(template, self._hass)
            self._templates[template] = cached
        return cached

    def state(self, entity_id: str) -> str | None:
        state = self._hass.states.get(entity_id)
        return state.state if state else None

    def display_state(self, entity_id: str) -> str | None:
        """The state in Home Assistant's own words, as its dashboards and
        ``state_translated()`` give it: the entity's translation, else its
        device class's, else its domain's, else the state as it is (a
        number, free text). Translations come from the cache Home
        Assistant fills for the instance's language."""
        state = self._hass.states.get(entity_id)
        if state is None:
            return None
        return self._translate(state, state.state)

    def _translate(self, state: State, value: str) -> str:
        """``value`` as Home Assistant words it for the entity ``state``
        belongs to."""
        entry = er.async_get(self._hass).async_get(state.entity_id)
        return async_translate_state(
            self._hass,
            value,
            state.domain,
            entry.platform if entry else None,
            entry.translation_key if entry else None,
            state.attributes.get("device_class"),
        )

    def attribute(self, entity_id: str, name: str) -> Any:
        state = self._hass.states.get(entity_id)
        return state.attributes.get(name) if state else None

    def last_reported(self, entity_id: str) -> datetime | None:
        """When the entity last reported a state, even an unchanged one;
        the last change where Home Assistant has nothing newer."""
        state = self._hass.states.get(entity_id)
        if state is None:
            return None
        return state.last_reported or state.last_changed

    def render(self, template: str) -> Any:
        return self._template(template).async_render(parse_result=False)

    def attributes(self, entity_id: str) -> dict[str, Any]:
        state = self._hass.states.get(entity_id)
        return dict(state.attributes) if state else {}

    def area_name(self, entity_id: str) -> str | None:
        """The name of the entity's area: its own, else its device's (the
        same inheritance the Home Assistant UI shows)."""
        entry = er.async_get(self._hass).async_get(entity_id)
        if entry is None:
            return None
        area_id = entry.area_id
        if area_id is None and entry.device_id is not None:
            device = dr.async_get(self._hass).async_get(entry.device_id)
            area_id = device.area_id if device is not None else None
        if area_id is None:
            return None
        area = ar.async_get(self._hass).async_get_area(area_id)
        return area.name if area is not None else None


class DegradingResolver(HassStateResolver):
    """A resolver where a template that raises resolves to ``None``.

    A template valid at save can start raising later (an entity renamed,
    ``float`` on junk), so the field degrades like an unavailable entity.
    The error is appended to ``errors`` when a list is given, else
    dropped. Recorded history is answered from ``history``.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        history: HistoryCache | None = None,
        *,
        errors: list[str] | None = None,
    ) -> None:
        super().__init__(hass)
        self._history = history
        self._errors = errors

    def history(self, query: HistoryQuery) -> Any:
        return self._history.answer(query) if self._history else None

    @override
    def render(self, template: str) -> Any:
        try:
            return super().render(template)
        except TemplateError as err:
            if self._errors is not None:
                self._errors.append(str(err))
            return None
