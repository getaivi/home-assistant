"""Action ids and press routing: which entity a tile is, and what a press
on it calls."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Final

from homeassistant.const import SERVICE_TURN_OFF, SERVICE_TURN_ON
from homeassistant.core import DOMAIN as HOMEASSISTANT_DOMAIN
from homeassistant.core import Event, EventStateChangedData, callback

from .. import limits

SWITCHBOARD_TEMPLATE: Final = "switchboard"

#: Domains whose entities are on or off: their tiles are toggles.
#: For ``cover``, ``valve`` and ``lock``, ``on`` means open, open and
#: locked; for ``climate``, any mode but off (``toggle_on``).
TOGGLE_DOMAINS: Final[tuple[str, ...]] = (
    "light",
    "switch",
    "fan",
    "input_boolean",
    "automation",
    "humidifier",
    "siren",
    "cover",
    "valve",
    "lock",
    "climate",
)

#: Domains whose entities are pressed, not switched: their tiles are
#: buttons. A running script highlights its tile while it runs.
BUTTON_DOMAINS: Final[tuple[str, ...]] = ("scene", "script", "button", "input_button")

ACTION_DOMAINS: Final[tuple[str, ...]] = TOGGLE_DOMAINS + BUTTON_DOMAINS

#: The input event types a press is recorded as.
TOGGLE_ON: Final = "toggle_on"
TOGGLE_OFF: Final = "toggle_off"
PRESSED: Final = "pressed"

#: The services a button press calls, by domain; anything else is turned on.
_PRESS_SERVICES: Final[dict[str, tuple[str, str]]] = {
    "button": ("button", "press"),
    "input_button": ("input_button", "press"),
}

#: The (on, off) services of the toggles ``homeassistant.turn_on`` does
#: not cover: a lock has no turn_on, and each domain's own services are
#: the ones its integrations are sure to implement.
_TOGGLE_SERVICES: Final[dict[str, tuple[str, str]]] = {
    "cover": ("open_cover", "close_cover"),
    "valve": ("open_valve", "close_valve"),
    "lock": ("lock", "unlock"),
    "climate": ("turn_on", "turn_off"),
}

_ID_JUNK = re.compile(r"[^a-z0-9_-]+")


def action_id(entity_id: str) -> str:
    """The action id an entity is published under: the entity id with
    anything Aivi rejects folded into underscores, and one over 32
    characters shortened to a stable prefix-plus-hash."""
    folded = _ID_JUNK.sub("_", entity_id.lower()).strip("_-")
    if not folded or not folded[0].isalnum():
        folded = f"e_{folded}".rstrip("_")
    if len(folded) <= limits.ACTION_ID:
        return folded
    # Keeps a shortened id unique; not a security boundary.
    digest = hashlib.sha1(entity_id.encode()).hexdigest()[:7]  # noqa: S324
    return f"{folded[: limits.ACTION_ID - len(digest) - 1]}_{digest}"


def action_ids(entity_ids: list[str]) -> dict[str, str]:
    """Entity id -> action id for a bound list, unique in list order: a
    collision (two ids folding to the same string) gets a numeric suffix
    on the later one, so the same list always yields the same ids."""
    out: dict[str, str] = {}
    taken: set[str] = set()
    for entity_id in entity_ids:
        if entity_id in out:
            continue
        base = action_id(entity_id)
        candidate = base
        n = 2
        while candidate in taken:
            suffix = f"_{n}"
            candidate = f"{base[: limits.ACTION_ID - len(suffix)]}{suffix}"
            n += 1
        out[entity_id] = candidate
        taken.add(candidate)
    return out


def kind_of(entity_id: str) -> str:
    """``toggle`` for a two-state domain, ``button`` otherwise."""
    domain = entity_id.partition(".")[0]
    return "toggle" if domain in TOGGLE_DOMAINS else "button"


def bound_actions(
    bindings: dict[str, Any], *, limit: int = limits.ROWS
) -> dict[str, str]:
    """Action id -> entity id for a binding with actions (a switchboard's
    tiles, a remote's buttons), the map the command stream routes presses
    with (same derivation as the payload). Ids depend only on the list
    order, so the first ``limit`` entities get the same ids at any
    limit."""
    entity_ids = [
        entity_id
        for entity_id in (bindings.get("actions") or [])
        if isinstance(entity_id, str) and entity_id
    ][:limit]
    return {action: entity_id for entity_id, action in action_ids(entity_ids).items()}


def press_service(entity_id: str, value: Any) -> tuple[str, str] | None:
    """The (domain, service) a press calls. A toggle needs a boolean
    ``value`` (the requested state); a button ignores it. ``None`` when
    the press is malformed for the tile."""
    domain = entity_id.partition(".")[0]
    if kind_of(entity_id) == "toggle":
        if not isinstance(value, bool):
            return None
        if services := _TOGGLE_SERVICES.get(domain):
            return (domain, services[0] if value else services[1])
        return (HOMEASSISTANT_DOMAIN, SERVICE_TURN_ON if value else SERVICE_TURN_OFF)
    return _PRESS_SERVICES.get(domain, (HOMEASSISTANT_DOMAIN, SERVICE_TURN_ON))


def press_event_type(kind: Any, value: Any) -> str | None:
    """The input event type of a press on a tile of ``kind`` (``toggle``
    or ``button``); ``None`` when the press is malformed for it."""
    if kind == "toggle":
        if not isinstance(value, bool):
            return None
        return TOGGLE_ON if value else TOGGLE_OFF
    if kind == "button":
        return PRESSED
    return None


@callback
def toggle_flipped(event: Event[EventStateChangedData]) -> bool:
    """A toggle's entity turned on or off: the answer a press on the phone
    is waiting for, so it pushes without the debounce."""
    old, new = event.data["old_state"], event.data["new_state"]
    return (
        new is not None
        and kind_of(new.entity_id) == "toggle"
        and (old is None or old.state != new.state)
    )
