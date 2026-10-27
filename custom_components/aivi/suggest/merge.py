"""Merging a refinement into the current form state."""

from __future__ import annotations

from typing import Any

from ..blocks import EntityRows, SegmentList, slots_of
from ..metadata import describe_template
from ..sources import Source
from ..sourcing import read_source
from ..templates import FieldDef, TemplateDef
from .keys import ICON_ENUMS, slot_group


def _identity(data: dict[str, Any], key: str, field_def: FieldDef, kind: str) -> Any:
    """What a field's own value is, as far as an answer says it: a
    template, else the entity (bare or ``__entity``), else the stored
    value. The attribute beside an entity is a detail of the same value."""
    if (source := read_source(key, data)) is not None:
        return source.template if source.source is Source.TEMPLATE else source.entity_id
    value = data.get(key)
    if kind == "segments":
        return [(s["value"], s["fill_color"]) for s in SegmentList().clean(value)]
    return value


def _sub_groups(field_def: FieldDef, field: dict[str, Any]) -> list[tuple[str, ...]]:
    """The keys beside a field's own value, in groups that change together
    (a slot with its source markers; a plain key alone)."""
    key, kind = field["key"], field["kind"]
    groups: list[tuple[str, ...]] = []
    if kind == "segments":
        groups.append((f"{key}__display",))
    elif kind == "points":
        groups += [(f"{key}__hours",), (f"{key}__entity",)]
    elif kind not in ("rows", "enum", "colors"):
        groups += [
            slot_group(slot.address(key)) for slot in slots_of(field_def.block, key)[1:]
        ]
        if field.get("formatter"):
            groups.append((f"{key}__formatter",))
        if field.get("invert"):
            groups.append((f"{key}__invert",))
        if kind == "icon":
            groups += [(f"{key}__{suffix}",) for suffix, _ in ICON_ENUMS]
    return groups


def _apply_group(
    group: tuple[str, ...],
    out: dict[str, Any],
    proposed: dict[str, Any],
    cleared: set[str],
) -> None:
    """A group the answer sets replaces the stored one; one it asks to
    remove goes; one it says nothing about stays."""
    if any(marker in proposed for marker in group):
        repeated = group[0] in proposed and not any(m in proposed for m in group[1:])
        if repeated and out.get(group[0]) == proposed[group[0]]:
            return  # the same value: a source stored behind it stays
        for marker in group:
            out.pop(marker, None)
            if marker in proposed:
                out[marker] = proposed[marker]
    elif group[0] in cleared:
        for marker in group:
            out.pop(marker, None)


def _merge_segments(
    current: list[dict[str, Any]], proposed: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """The same phases (sizes and colors, in order) keep what the answer
    did not repeat (a track, a label, a live source); anything else is the
    answer's list."""
    same = len(current) == len(proposed) and all(
        (a.get("value"), a.get("fill_color")) == (b.get("value"), b.get("fill_color"))
        for a, b in zip(current, proposed, strict=True)
    )
    if not same:
        return proposed
    return [{**a, **b} for a, b in zip(current, proposed, strict=True)]


def _merge_row_options(
    block: EntityRows,
    ids: list[str],
    current: dict[str, Any],
    proposed: dict[str, Any],
) -> dict[str, Any]:
    """Each remaining row keeps its options unless the answer sets them."""
    slots = {slot.suffix for slot in block.row_slots()}
    merged: dict[str, Any] = {}
    for entity_id in ids:
        row = dict(current.get(entity_id) or {})
        answer = proposed.get(entity_id) or {}
        for option in block.row_options:
            group = slot_group(option) if option in slots else (option,)
            _apply_group(group, row, answer, set())
        if row:
            merged[entity_id] = row
    return merged


def merge(
    template: TemplateDef,
    current: dict[str, Any],
    proposed: dict[str, Any],
    cleared: set[str] | None = None,
    invalid: set[str] | None = None,
) -> dict[str, Any]:
    """The current bindings with the model's answer applied.

    A field's own value follows the answer: one it repeats keeps its stored
    form (its attribute, a source behind a literal), one it changes
    replaces that value and its sources, and a field it leaves out is
    cleared with everything of its own. The keys beside a value (a color,
    a format, an icon's styling, a row's options, a trend's window) stay
    unless the answer sets them, or removes them with an empty string: a
    model asked for a new accent does not have to repeat the rest to keep
    it."""
    cleared = cleared or set()
    out = dict(current)
    fields = describe_template(template)["fields"]
    for field_def, field in zip(template.fields, fields, strict=True):
        key, kind, block = field["key"], field["kind"], field_def.block
        if kind == "points":
            for group in _sub_groups(field_def, field):
                _apply_group(group, out, proposed, cleared)
            continue
        had = _identity(current, key, field_def, kind)
        has = _identity(proposed, key, field_def, kind)
        if invalid and key in invalid:
            # The answer gave this field something unusable (an entity
            # that does not exist): the form keeps what it has.
            for group in _sub_groups(field_def, field):
                _apply_group(group, out, proposed, cleared)
            continue
        if had not in (None, [], "") and has in (None, [], ""):
            for stored in list(out):
                if stored == key or stored.startswith(f"{key}__"):
                    del out[stored]
            continue
        if kind == "segments" and key in proposed:
            stored = current.get(key)
            out[key] = _merge_segments(
                stored if isinstance(stored, list) else [], proposed[key]
            )
        elif had != has:
            for marker in slot_group(key):
                out.pop(marker, None)
                if marker in proposed:
                    out[marker] = proposed[marker]
        elif f"{key}__attribute" in proposed:
            out[f"{key}__attribute"] = proposed[f"{key}__attribute"]
        if kind == "rows" and isinstance(block, EntityRows) and block.row_options:
            options = _merge_row_options(
                block,
                out.get(key) or [],
                current.get(f"{key}__options") or {},
                proposed.get(f"{key}__options") or {},
            )
            out.pop(f"{key}__options", None)
            if options:
                out[f"{key}__options"] = options
        for group in _sub_groups(field_def, field):
            _apply_group(group, out, proposed, cleared)
    return out
