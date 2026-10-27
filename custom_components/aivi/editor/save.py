"""What a save refuses, and what it derives before a binding is stored."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, valid_entity_id

from .. import blocks, engine
from ..companions import with_companions
from ..const import CONF_SLUG, SUBENTRY_ACTIVITY
from ..sources import DegradingResolver, template_entities
from ..templates import TemplateDef


def _bindings_problem(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> str | None:
    """Why these bindings cannot run, or ``None``. Checked on save because
    the runtime does not validate stored bindings: every entity they subscribe to
    or show must be an entity id, and resolving them must not raise. A rows
    field must list entity ids only: the runtime skips anything else,
    which would silently drop a row the user picked."""
    for field in template.fields:
        rows = bindings.get(field.key)
        if isinstance(field.block, blocks.EntityRows) and rows is not None:
            if not isinstance(rows, list):
                return f"{field.key} is not a list of entity ids"
            if bad := [str(row) for row in rows if not isinstance(row, str)]:
                return "not entity ids: " + ", ".join(bad)
    try:
        watched = engine.dependencies(template, bindings)
        # The panel shows a template's stored entities as chips.
        for use in engine.slot_uses(template, bindings):
            if (source := use.source()) is not None:
                watched.update(source.watched)
        engine.resolve(template, bindings, DegradingResolver(hass))
    except (TypeError, ValueError, AttributeError, KeyError) as err:
        return f"malformed value ({err})"
    if bad := sorted(
        str(entity)
        for entity in watched
        if not isinstance(entity, str) or not valid_entity_id(entity)
    ):
        return "not entity ids: " + ", ".join(bad)
    return None


def slug_taken(
    entry: ConfigEntry, kind: str, slug: str, subentry_id: str | None
) -> bool:
    """Whether another binding of the account already pushes to the
    widget or Live Activity ``slug``: each one has one feeder."""
    return any(
        other.subentry_type == kind
        and other.data.get(CONF_SLUG) == slug
        and other_id != subentry_id
        for other_id, other in entry.subentries.items()
    )


def save_problem(
    hass: HomeAssistant,
    kind: str,
    template: TemplateDef,
    bindings: dict[str, Any],
    *,
    active: str | None = None,
) -> str | None:
    """Why a save of these bindings is refused, or ``None``. ``active`` is
    the entity an activity runs while."""
    if (problem := _bindings_problem(hass, template, bindings)) is not None:
        return f"Invalid bindings: {problem}"
    if template.save_problem is not None and (
        problem := template.save_problem(bindings)
    ):
        return problem
    if kind == SUBENTRY_ACTIVITY and not valid_entity_id(active or ""):
        return "Activities need an active entity"
    return None


#: A template depending on more entities than this (or on all states /
#: whole domains) is not watched, rather than subscribing to everything.
WATCH_LIMIT = 60


def derive_watched(hass: HomeAssistant, template: str) -> list[str] | None:
    """The entities a template actually depends on, or ``None`` when it
    depends on too many to watch.

    The panel's regex over literal entity ids misses `expand(...)`,
    `label_entities(...)` and filtered state loops, so templates using them
    would never re-push; Home Assistant's render info is authoritative.
    """
    read = template_entities(hass, template)
    if read is None:
        return []
    if read.everything or len(read.entities) > WATCH_LIMIT:
        return None
    return list(read.entities)


def resolve_watched(hass: HomeAssistant, bindings: dict[str, Any]) -> dict[str, Any]:
    """Bindings with every ``__watched`` list re-derived server-side.

    Walks nested scopes (segment weights) too. A template that is not watched
    keeps whatever the panel sent: it still renders, but won't re-push on
    its own.
    """
    out = dict(bindings)
    for key, value in bindings.items():
        if isinstance(value, list):
            # Only lists of scopes (segments) are walked. A `__watched`
            # list is itself a list of strings, and walking it here would
            # overwrite the value just derived for it.
            if any(isinstance(item, dict) for item in value):
                out[key] = [
                    resolve_watched(hass, item) if isinstance(item, dict) else item
                    for item in value
                ]
            continue
        if isinstance(value, dict):
            out[key] = {
                inner: resolve_watched(hass, raw) if isinstance(raw, dict) else raw
                for inner, raw in value.items()
            }
            continue
        if not key.endswith("__template") or not isinstance(value, str) or not value:
            continue
        watched = derive_watched(hass, value)
        if watched is not None:
            out[f"{key.removesuffix('__template')}__watched"] = watched
    return out


def stored_bindings(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> dict[str, Any]:
    """The bindings a save stores: ``__watched`` re-derived rather than
    trusted from the panel, and battery rows' charging sensors filled in."""
    return with_companions(hass, template, resolve_watched(hass, bindings))
