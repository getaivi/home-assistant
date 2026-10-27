"""Template metadata for the custom panel.

Describes each template's fields as plain JSON so the frontend can render a
tailored form (which control, entity filters, whether a field takes a Jinja
template, color/formatter options) without hard-coding any template.
"""

from __future__ import annotations

from typing import Any

from . import blocks, limits, series, showcase, sourcing
from .blocks import COLORS, FORMATTERS
from .switchboard import (
    AUTO_STATE_TEXT,
    STATE_TEXT_KEYS,
    TOGGLE_DOMAINS,
    ActionRows,
)
from .templates import FieldDef, TemplateDef, TemplateRegistry
from .values import ON_STATES


def _describe_slots(block: object, key: str) -> dict[str, Any]:
    """The block's sourceable values, keyed by the suffix that addresses
    them ("" is the field itself). The panel builds its source controls
    from this instead of hardcoding which fields are sourceable."""
    return {
        slot.suffix: sourcing.describe(slot) for slot in blocks.slots_of(block, key)
    }


def _describe_block(block: object) -> dict[str, Any]:
    match block:
        case blocks.Value():
            return {
                "kind": "value",
                "source": True,
                "color": True,
                "formatter": block.FORMATTER,
                "filter": block.filter_meta,
            }
        case blocks.Number():
            described = {"kind": "number", "source": True, "filter": block.filter_meta}
            if isinstance(block, blocks.Measure) and block.invertible:
                described["invert"] = True
            return described
        case blocks.Amount():
            if block.SLOT.bare is sourcing.Bare.LITERAL:
                return {"kind": "number_literal"}
            return {"kind": "money", "source": True, "filter": block.filter_meta}
        case series.HistoryPoints():
            return {
                "kind": "points",
                "follows": block.follows,
                "hours": list(block.HOURS),
                "default_hours": block.DEFAULT_HOURS,
            }
        case series.PriceEntries():
            return {
                "kind": "prices",
                "source": True,
                "filter": block.filter_meta,
            }
        case blocks.Bool():
            return {"kind": "bool", "source": True, "filter": block.filter_meta}
        case showcase.LastReported():
            # Any entity: when it last reported, not a timestamp it holds.
            return {"kind": "reported", "source": True, "filter": block.filter_meta}
        case blocks.Timestamp():
            return {
                "kind": "timestamp",
                "source": True,
                "filter": block.filter_meta,
            }
        case blocks.Icon():
            return {
                "kind": "icon",
                "color": True,
                "rendering_modes": blocks.RENDERING_MODES,
                "color_renderings": blocks.COLOR_RENDERINGS,
            }
        case blocks.Color():
            return {"kind": "color", "options": COLORS}
        case blocks.NumberLiteral():
            return {"kind": "number_literal"}
        case blocks.ColorRamp():
            return {"kind": "colors", "options": COLORS, "max": block.MAX}
        case blocks.SegmentList():
            return {
                "kind": "segments",
                # Addressed inside one segment dict.
                "segment_slots": {
                    slot.suffix: sourcing.describe(slot)
                    for slot in blocks.SegmentList.SEGMENT_SLOTS
                },
                "colors": COLORS,
                "max": block.MAX,
                "displays": blocks.SEGMENT_DISPLAYS,
                "track_fills": blocks.TRACK_FILLS,
                # Segment weights are sourceable per segment.
                "sourced_values": True,
            }
        case blocks.EntityUnit():
            return {"kind": "text", "template": True, "follows": block.follows}
        case showcase.PictureUrl():
            # Checked as a picture URL (https, a host, no spaces) rather
            # than as a tap URL.
            return {"kind": "text", "template": True, "picture": True}
        case blocks.Text():
            return {"kind": "text", "template": True}
        case blocks.Setting():
            # Steers another field; nothing of its own is sent.
            return {"kind": "enum", "options": block.options, "setting": True}
        case showcase.PictureFit():
            # Always one of the two: the cut-out when nothing is stored.
            return {
                "kind": "enum",
                "options": block.options,
                "default": showcase.PICTURE_FITS[0],
            }
        case blocks.Enum():
            return {"kind": "enum", "options": block.options}
        case blocks.EntityRows():
            described: dict[str, Any] = {
                "kind": "rows",
                "filter": block.filter_meta,
                "max": block.MAX,
            }
            if block.row_options:
                # Stored under <key>__options as entity_id -> {option: value}.
                described["row_options"] = list(block.row_options)
                described["row_slots"] = {
                    slot.suffix: sourcing.describe(slot) for slot in block.row_slots()
                }
            if isinstance(block, ActionRows) and block.tiles:
                # "auto" feeds the editor's placeholders.
                described["state_text"] = {
                    "keys": {
                        kind: list(keys) for kind, keys in STATE_TEXT_KEYS.items()
                    },
                    "max": limits.STATE_TEXT,
                    "toggle_domains": list(TOGGLE_DOMAINS),
                    "auto": AUTO_STATE_TEXT,
                }
            return described
    return {"kind": "unknown"}


def _describe_field(field: FieldDef) -> dict[str, Any]:
    described = {
        "key": field.key,
        "required": field.required,
        "advanced": field.advanced,
        **_describe_block(field.block),
    }
    if slots := _describe_slots(field.block, field.key):
        described["slots"] = slots
    return described


def describe_template(template: TemplateDef) -> dict[str, Any]:
    described: dict[str, Any] = {
        "slug": template.slug,
        "fields": [_describe_field(field) for field in template.fields],
    }
    if template.inputs:
        # The panel lists recent presses for templates that take input.
        described["inputs"] = [
            {"type": event.type, "recorded": event.recorded}
            for event in template.inputs
        ]
    if template.requires_any:
        # The fields that can each make the content valid on their own:
        # one of them must be bound.
        described["requires_any"] = [
            field.key
            for field in template.fields
            if field.path[0] in template.requires_any
            and field.path[1:] in ((), (template.requires.get(field.path[0]),))
        ]
    return described


def describe_registry(
    widgets: TemplateRegistry, activities: TemplateRegistry
) -> dict[str, Any]:
    """Everything the panel needs to build any supported template's form:
    widget templates at the top level, activity templates beside them."""

    def describe(registry: TemplateRegistry) -> dict[str, Any]:
        return {slug: describe_template(t) for slug, t in registry.items()}

    return {
        "templates": describe(widgets),
        "colors": COLORS,
        "formatters": FORMATTERS,
        "on_states": sorted(ON_STATES),
        "activity_templates": describe(activities),
    }
