"""The answer's keys, derived from the field map.

Everything the form can write is addressable: each slot of each block as
a literal, an entity, an attribute or a template (whichever the slot
takes), a list's per-row options, a segment's details, a trend's window.
The schema, the sanitizer and the merge all walk this one description, so
a new block or option never needs a second implementation here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..blocks import EntityRows, slots_of
from ..sourcing import Bare, ValueSlot
from ..templates import FieldDef
from ..values import SlotKind

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

_SOURCES = ("__entity", "__attribute", "__template", "__watched", "__bands")
#: An icon's rendering choices: literal look enums, not slots.
ICON_ENUMS = (
    ("rendering_mode", "rendering_modes"),
    ("color_rendering", "color_renderings"),
)


def _literal_type(slot: ValueSlot) -> Any:
    if slot.kind in (SlotKind.NUMBER, SlotKind.MONEY):
        return vol.Coerce(float)
    if slot.kind is SlotKind.BOOL:
        return bool
    return str


def _slot_keys(address: str, slot: ValueSlot) -> dict[str, Any]:
    """The answer keys one slot takes: itself (an entity id when its bare
    key is one, else the literal), and each source it accepts."""
    keys: dict[str, Any] = {}
    if slot.bare is Bare.ENTITY:
        keys[address] = str
    else:
        if slot.kind is not SlotKind.SERIES:
            keys[address] = _literal_type(slot)
        if "entity" in slot.sources:
            keys[f"{address}__entity"] = str
    if "attribute" in slot.sources:
        keys[f"{address}__attribute"] = str
    if "template" in slot.sources:
        keys[f"{address}__template"] = str
    return keys


def row_option_keys(block: EntityRows) -> dict[str, Any]:
    """One row's option keys: its slots (sourceable), then the plain ones."""
    slots = {slot.suffix: slot for slot in block.row_slots()}
    keys: dict[str, Any] = {}
    for option in block.row_options:
        if (slot := slots.get(option)) is not None:
            keys.update(_slot_keys(option, slot))
        else:
            keys[option] = str
    return keys


def answer_keys(field_def: FieldDef, field: dict[str, Any]) -> dict[str, Any]:
    """Every key of the answer that belongs to one field, with its type."""
    key, kind, block = field["key"], field["kind"], field_def.block
    keys: dict[str, Any] = {}
    if kind == "rows":
        keys[key] = [str]
        if isinstance(block, EntityRows) and block.row_options:
            # A list of row objects: strict providers reject an object with
            # open keys, which a dict by entity id would be.
            keys[f"{key}__options"] = [
                {
                    vol.Optional("entity_id"): str,
                    **{vol.Optional(k): v for k, v in row_option_keys(block).items()},
                }
            ]
    elif kind == "segments":
        keys[key] = [
            {
                vol.Optional("value"): vol.Coerce(float),
                vol.Optional("fill_color"): str,
                vol.Optional("label"): str,
                vol.Optional("track_color"): str,
                vol.Optional("track_fill"): str,
                vol.Optional("source"): str,
                vol.Optional("source__attribute"): str,
            }
        ]
        keys[f"{key}__display"] = str
    elif kind == "points":
        keys[f"{key}__hours"] = vol.Coerce(float)
        keys[f"{key}__entity"] = str
    elif kind == "enum":
        keys[key] = str
    elif kind == "number_literal" and not slots_of(block, key):
        keys[key] = vol.Coerce(float)
    elif kind == "colors":
        keys[key] = [str]
    else:
        slots = slots_of(block, key)
        for slot in slots:
            keys.update(_slot_keys(slot.address(key), slot))
        if not slots:
            keys[key] = str
        if field.get("formatter"):
            keys[f"{key}__formatter"] = str
        if field.get("invert"):
            keys[f"{key}__invert"] = bool
        if kind == "icon":
            for suffix, _ in ICON_ENUMS:
                keys[f"{key}__{suffix}"] = str
    return keys


def takes_entities(field_def: FieldDef, field: dict[str, Any]) -> bool:
    """Whether the field's own value is an entity (or a list of them), so
    its line carries the candidate list."""
    if field["kind"] == "rows":
        return True
    slots = slots_of(field_def.block, field["key"])
    return bool(slots) and slots[0].bare is Bare.ENTITY


def slot_group(address: str) -> tuple[str, ...]:
    return (address, *(address + marker for marker in _SOURCES))


def address_of(key: str) -> str:
    """The slot a key belongs to: the key without its source marker."""
    for marker in _SOURCES:
        if key.endswith(marker):
            return key.removesuffix(marker)
    return key


def bands_of(address: str) -> str:
    """Where a slot keeps its colors by value. The answer never writes
    them (the form does); it keeps them, or replaces them by setting or
    clearing the slot."""
    return f"{address}__bands"
