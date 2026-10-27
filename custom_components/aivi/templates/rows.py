"""Row builders for the repeating templates.

A row's options arrive coerced by the field's row slots (``EntityRows``):
a color from the palette, an icon and a label within their caps.
"""

from __future__ import annotations

from typing import Any

from .. import blocks, limits
from ..sources import StateResolver, display_state_of
from ..values import finite_number, wire_money, wire_number


def _friendly_name(entity_id: str, resolver: StateResolver) -> str:
    name = str(resolver.attribute(entity_id, "friendly_name") or "").strip()
    return (name or entity_id)[: limits.LABEL]


def _row_chrome(options: dict[str, Any]) -> dict[str, Any]:
    """A row's icon and color, those that are set."""
    return {key: options[key] for key in ("icon", "color") if key in options}


def list_row(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, Any] | None:
    state = resolver.state(entity_id)
    if state in (None, "unavailable", "unknown"):
        return None
    # A list shows states as text: in Home Assistant's own words.
    state = display_state_of(resolver, entity_id)
    chrome = _row_chrome(options)
    value: dict[str, Any] = {"value": str(state)[: limits.VALUE]}
    # A list row's color is its value's.
    if color := chrome.pop("color", None):
        value["text_color"] = color
    return {
        "label": options.get("label") or _friendly_name(entity_id, resolver),
        "value": value,
        **chrome,
    }


def battery_row(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, Any] | None:
    level = finite_number(resolver.state(entity_id))
    if level is None:
        return None
    row: dict[str, Any] = {
        "name": _friendly_name(entity_id, resolver),
        "level": min(max(level, 0), 100),
        **_row_chrome(options),
    }
    if "charging" in options:
        row["charging"] = options["charging"]
    return row


def budget_row(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, Any] | None:
    spent = wire_money(_available(resolver.state(entity_id)))
    if spent is None:
        return None
    row: dict[str, Any] = {
        "spent": spent,
        "label": options.get("label") or _friendly_name(entity_id, resolver),
        **_row_chrome(options),
    }
    if budget := options.get("budget"):
        row["budget"] = budget
    return row


def energy_source_row(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, Any] | None:
    power = finite_number(resolver.state(entity_id))
    if power is None:
        return None
    factor = blocks.unit_factor(blocks.POWER_UNITS, entity_id, resolver)
    row: dict[str, Any] = {
        "power": wire_number(power * factor),
        **_row_chrome(options),
    }
    if label := options.get("label"):
        row["name"] = label
    today = options.get("today")
    energy = blocks.energy_today(today, resolver) if isinstance(today, str) else None
    if energy is not None:
        row["today"] = energy
    return row


def _available(state: str | None) -> str | None:
    return None if state in (None, "unavailable", "unknown") else state
