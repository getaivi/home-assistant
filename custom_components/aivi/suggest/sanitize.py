"""Sanitizing the model's answer.

The answer is held to the template's field map and the real entity
registry: unknown keys, nonexistent entities, colors outside the palette
and symbols outside the index are dropped and reported.
"""

from __future__ import annotations

import re
from typing import Any, TypedDict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template

from .. import limits
from ..blocks import COLORS, FORMATTERS, EntityRows, SegmentList, slots_of
from ..metadata import describe_template
from ..sources import Bands, template_entities
from ..sourcing import Bare, ValueSlot
from ..templates import TemplateDef
from ..values import SlotKind
from .keys import ICON_ENUMS, slot_group
from .merge import merge
from .symbols import known_symbol, symbols


class Rejected(TypedDict):
    """One part of the answer that was rejected, for the transcript: the
    model's reply is written before its answer is checked, so what the
    check drops has to be reported beside it."""

    #: The form field it was meant for.
    key: str
    #: What the model gave (an entity id, a color, an attribute, etc.).
    value: str
    #: Why not: already_there, list_full, no_entity, no_attribute,
    #: not_a_color, not_a_symbol, not_an_option,
    #: bad_template, bad_value, or no_value (styling for a field that has
    #: nothing to show yet).
    reason: str


class _Report:
    """What sanitizing dropped, and which fields' own values were given
    but unusable (those keep what the form has: an invented entity must
    not read as a field left out)."""

    def __init__(self) -> None:
        self.rejected: list[Rejected] = []
        self.invalid: set[str] = set()

    def reject(self, key: str, value: Any, reason: str) -> None:
        entry = Rejected(key=key, value=str(value)[:120], reason=reason)
        if entry not in self.rejected:
            self.rejected.append(entry)


def _validated_template(
    hass: HomeAssistant, value: Any
) -> tuple[str, list[str]] | None:
    """A model-proposed Jinja template is kept only if it renders against
    the live state machine and every entity it touches exists. Returns the
    template plus its watched entities, or ``None``."""
    if not isinstance(value, str):
        return None
    template = str(value).strip()
    if not template or len(value) > 1000:
        return None
    read = template_entities(hass, template)
    if read is None or not read.entities:
        return None
    if any(hass.states.get(entity_id) is None for entity_id in read.entities):
        return None
    return template, list(read.entities)


# A symbol name as a template spells it: dotted lowercase words.
_DOTTED = re.compile(r"[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+")


def _fake_symbols(hass: HomeAssistant, template: str, watched: list[str]) -> list[str]:
    """The names an icon template would print that are no SF Symbol: what
    it renders to right now, and every dotted name written in it (the
    branches not taken), apart from the entities it reads."""
    names = {
        token
        for token in _DOTTED.findall(template)
        if token not in watched and hass.states.get(token) is None
    }
    try:
        rendered = Template(template, hass).async_render(parse_result=False)
    except Exception:  # noqa: BLE001 (a model's template can raise anything)
        rendered = ""
    if isinstance(rendered, str) and rendered.strip():
        names.add(rendered.strip())
    return sorted(name for name in names if name not in symbols())


def sanitize(
    hass: HomeAssistant,
    template: TemplateDef,
    raw: Any,
    current: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The answer clamped to things that are true (see
    ``sanitize_report``, which also says what was dropped)."""
    return sanitize_report(hass, template, raw, current)[0]


def sanitize_report(
    hass: HomeAssistant,
    template: TemplateDef,
    raw: Any,
    current: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[Rejected]]:
    """Clamp a model answer to things that are true: known keys,
    existing entities, palette colors, each value through its slot's own
    coercer. Anything else is dropped and reported. On a refinement the
    answer is merged into ``current`` (``merge``); a field whose value
    was given but unusable keeps what it has."""
    out, cleared, report = _proposed(hass, template, raw)
    if current and (out or report.invalid):
        out = merge(template, current, out, cleared, report.invalid)
    return out, report.rejected


def _entity_ok(hass: HomeAssistant, value: Any) -> bool:
    return isinstance(value, str) and hass.states.get(value) is not None


def _literal(slot: ValueSlot, value: Any) -> Any:
    """The value as the form would store it, or None when the slot's own
    coercer rejects it."""
    if isinstance(value, str):
        value = value.strip()
        if slot.kind is SlotKind.ICON:
            # Not cut to the limit: a cut name would be another symbol's.
            symbol = known_symbol(value) if len(value) <= limits.ICON else None
            if symbol is None:
                return None
            value = symbol
        value = value[: slot.max_length or 256]
    if value is None or value == "" or slot.coerce(value) is None:
        return None
    return value


def _given(value: Any) -> bool:
    return value is not None and value not in ("", [])


def _store_slot(
    hass: HomeAssistant,
    address: str,
    slot: ValueSlot,
    raw: dict[str, Any],
    out: dict[str, Any],
    report: _Report,
    field: str,
) -> None:
    """One slot of the answer into stored form: a template wins over an
    entity (with its attribute), which sits beside the literal fallback.
    What was given but is unusable goes to the report."""
    template = raw.get(f"{address}__template")
    if "template" in slot.sources and _given(template):
        tmpl = _validated_template(hass, template)
        if tmpl and slot.kind is SlotKind.ICON and (fake := _fake_symbols(hass, *tmpl)):
            # An icon template is held to the symbol index too.
            report.reject(field, ", ".join(fake), "not_a_symbol")
        elif tmpl:
            out[f"{address}__template"], out[f"{address}__watched"] = tmpl
            return
        else:
            report.reject(field, template, "bad_template")
    # Colors by value come from the form and are kept as they are; the
    # answer replaces them by setting or clearing the slot.
    bands = Bands.parse(raw.get(f"{address}__bands"))
    if "bands" in slot.sources and bands is not None:
        out[f"{address}__bands"] = bands.stored()
    entity_key = address if slot.bare is Bare.ENTITY else f"{address}__entity"
    entity = raw.get(entity_key)
    takes_entity = slot.bare is Bare.ENTITY or "entity" in slot.sources
    if takes_entity and _given(entity):
        if isinstance(entity, str) and _entity_ok(hass, entity):
            out[entity_key] = entity
            attribute = raw.get(f"{address}__attribute")
            state = hass.states.get(entity)
            if "attribute" in slot.sources and _given(attribute):
                if (
                    isinstance(attribute, str)
                    and state is not None
                    and attribute in state.attributes
                ):
                    out[f"{address}__attribute"] = attribute
                else:
                    report.reject(field, f"{entity}: {attribute}", "no_attribute")
        else:
            report.reject(field, entity, "no_entity")
    if slot.bare is Bare.LITERAL and slot.kind is not SlotKind.SERIES:
        value = raw.get(address)
        literal = _literal(slot, value)
        if literal is not None:
            out[address] = literal
        elif _given(value):
            reason = {
                SlotKind.COLOR: "not_a_color",
                SlotKind.ACTION_COLOR: "not_a_color",
                SlotKind.ICON: "not_a_symbol",
            }.get(slot.kind, "bad_value")
            report.reject(field, value, reason)


def _row_options(
    hass: HomeAssistant,
    block: EntityRows,
    raw: Any,
    ids: list[str],
    report: _Report,
    field: str,
) -> dict[str, dict[str, Any]]:
    """The answer's list of row objects as the stored dict by entity id."""
    if not isinstance(raw, list):
        return {}
    slots = {slot.suffix: slot for slot in block.row_slots()}
    options: dict[str, dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict) or item.get("entity_id") not in ids:
            continue
        row: dict[str, Any] = {}
        for option in block.row_options:
            given = item.get(option)
            if (slot := slots.get(option)) is not None:
                _store_slot(hass, option, slot, item, row, report, field)
            elif option == "today":
                if _entity_ok(hass, given):
                    row[option] = given
                elif _given(given):
                    report.reject(field, given, "no_entity")
            elif (value := block.clean_option(option, given)) is not None:
                row[option] = value
            elif _given(given):
                report.reject(field, f"{option}: {given}", "bad_value")
        if row:
            options[item["entity_id"]] = row
    return options


def _segments(
    hass: HomeAssistant, raw: Any, report: _Report, field: str
) -> list[dict[str, Any]]:
    """The same clamp the engine applies, plus each segment's live weight
    source; raw fractions are kept and normalized at resolve time."""
    if not isinstance(raw, list):
        return []
    segments: list[dict[str, Any]] = []
    for item in raw[: SegmentList.MAX]:
        cleaned = SegmentList().clean([item])
        if not cleaned:
            continue
        segment = cleaned[0]
        _store_slot(hass, "source", SegmentList.WEIGHT, item, segment, report, field)
        segments.append(segment)
    return segments


def _unspoken(raw: Any) -> Any:
    """The answer without the keys a model filled just to say nothing:
    some write null (or the word) into every key the structure offers."""
    if isinstance(raw, dict):
        return {
            key: _unspoken(value)
            for key, value in raw.items()
            if value is not None
            and not (isinstance(value, str) and value.strip().lower() == "null")
        }
    if isinstance(raw, list):
        return [_unspoken(item) for item in raw]
    return raw


def _proposed(
    hass: HomeAssistant, template: TemplateDef, raw: Any
) -> tuple[dict[str, Any], set[str], _Report]:
    """The answer in stored form, the keys it asks to remove (set to an
    empty string), and the report of what was rejected."""
    report = _Report()
    raw = _unspoken(raw)
    if not isinstance(raw, dict):
        return {}, set(), report
    out: dict[str, Any] = {}
    cleared = {key for key, value in raw.items() if value == ""}

    fields = describe_template(template)["fields"]
    for field_def, field in zip(template.fields, fields, strict=True):
        key, kind, block = field["key"], field["kind"], field_def.block
        value = raw.get(key)
        if kind == "rows":
            given = list(dict.fromkeys(value)) if isinstance(value, list) else []
            ids = [v for v in given if _entity_ok(hass, v)]
            for missing in (v for v in given if v not in ids):
                report.reject(key, missing, "no_entity")
            if given and not ids:
                report.invalid.add(key)
            if ids:
                out[key] = ids
                if isinstance(block, EntityRows) and (
                    options := _row_options(
                        hass, block, raw.get(f"{key}__options"), ids, report, key
                    )
                ):
                    out[f"{key}__options"] = options
        elif kind == "segments":
            if segments := _segments(hass, value, report, key):
                out[key] = segments
            elif _given(value):
                report.invalid.add(key)
                report.reject(key, "phases", "bad_value")
            display = raw.get(f"{key}__display")
            if display in (field.get("displays") or ()):
                out[f"{key}__display"] = display
            elif _given(display):
                report.reject(key, display, "not_an_option")
        elif kind == "points":
            hours = raw.get(f"{key}__hours")
            if isinstance(hours, (int, float)) and hours in (field.get("hours") or ()):
                out[f"{key}__hours"] = int(hours)
            elif _given(hours):
                report.reject(key, hours, "not_an_option")
            other = raw.get(f"{key}__entity")
            if _entity_ok(hass, other):
                out[f"{key}__entity"] = other
            elif _given(other):
                report.reject(key, other, "no_entity")
        elif kind == "enum":
            if value in (field.get("options") or []):
                out[key] = value
            elif _given(value):
                report.invalid.add(key)
                report.reject(key, value, "not_an_option")
        elif kind == "number_literal" and not slots_of(block, key):
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                out[key] = value
            elif _given(value):
                report.invalid.add(key)
                report.reject(key, value, "bad_value")
        elif kind == "colors":
            if isinstance(value, list):
                cap = field.get("max") or 4
                # Repeats are kept: the form allows the same color twice.
                colors = [c for c in value if c in COLORS]
                for bad in (c for c in value if c not in COLORS):
                    report.reject(key, bad, "not_a_color")
                if colors:
                    out[key] = colors[:cap]
                elif value:
                    report.invalid.add(key)
            # The one color by value is the form's, kept as it is.
            if (bands := Bands.parse(raw.get(f"{key}__bands"))) is not None:
                out[f"{key}__bands"] = bands.stored()
        else:
            slots = slots_of(block, key)
            if not slots:
                if isinstance(value, str) and value.strip():
                    out[key] = value.strip()[:256]
                continue
            main, *subs = slots
            _store_slot(hass, key, main, raw, out, report, key)
            if not any(marker in out for marker in slot_group(key)):
                # Nothing usable: its color and format have no value to
                # apply to. Given but unusable is not the same as left out.
                if any(_given(raw.get(marker)) for marker in slot_group(key)):
                    report.invalid.add(key)
                elif any(
                    _given(value) and name.startswith(f"{key}__")
                    for name, value in raw.items()
                ):
                    # A color or a format for a field that shows nothing.
                    report.reject(key, "", "no_value")
                continue
            for slot in subs:
                _store_slot(hass, slot.address(key), slot, raw, out, report, key)
            formatter = raw.get(f"{key}__formatter")
            if field.get("formatter") and formatter in FORMATTERS:
                out[f"{key}__formatter"] = formatter
            elif field.get("formatter") and _given(formatter):
                report.reject(key, formatter, "not_an_option")
            if field.get("invert") and isinstance(raw.get(f"{key}__invert"), bool):
                out[f"{key}__invert"] = raw[f"{key}__invert"]
            if kind == "icon":
                for suffix, options_key in ICON_ENUMS:
                    choice = raw.get(f"{key}__{suffix}")
                    if choice in (field.get(options_key) or ()):
                        out[f"{key}__{suffix}"] = choice
                    elif _given(choice):
                        report.reject(key, choice, "not_an_option")
    return out, cleared, report
