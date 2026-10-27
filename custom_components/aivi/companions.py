"""A battery row's charging flag, read from the device's own charging
sensor: filled in on save for rows that set no charging option."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from . import blocks
from .templates import TemplateDef

#: A row option key starting with this decides the row's charging flag.
CHARGING = "charging"


def charging_companion(hass: HomeAssistant, entity_id: str) -> str | None:
    """The entity that reports whether ``entity_id``'s device is charging: its
    one ``battery_charging`` binary sensor, else its one ``*_battery_state``
    sensor (the mobile app's "Charging" / "Not Charging")."""
    registry = er.async_get(hass)
    entry = registry.async_get(entity_id)
    if entry is None or entry.device_id is None:
        return None
    siblings = [
        e
        for e in er.async_entries_for_device(registry, entry.device_id)
        if e.disabled_by is None and e.entity_id != entity_id
    ]
    for candidates in (
        [
            e
            for e in siblings
            if e.domain == "binary_sensor"
            and (e.device_class or e.original_device_class) == "battery_charging"
        ],
        [
            e
            for e in siblings
            if e.domain == "sensor" and e.entity_id.endswith("_battery_state")
        ],
    ):
        if len(candidates) == 1:
            return candidates[0].entity_id
    return None


def with_companions(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> dict[str, Any]:
    """``bindings`` with a charging source on every battery row that has
    no charging option yet and whose device has a charging sensor."""
    out = dict(bindings)
    for field in template.fields:
        block = field.block
        if (
            not isinstance(block, blocks.EntityRows)
            or CHARGING not in block.row_options
        ):
            continue
        stored = out.get(f"{field.key}__options")
        options = dict(stored) if isinstance(stored, Mapping) else {}
        for entity_id in block.entity_ids(field.key, out):
            row = options.get(entity_id)
            row = dict(row) if isinstance(row, Mapping) else {}
            if any(key.startswith(CHARGING) for key in row):
                continue
            if (companion := charging_companion(hass, entity_id)) is not None:
                row[f"{CHARGING}__entity"] = companion
                options[entity_id] = row
        if options:
            out[f"{field.key}__options"] = options
    return out
