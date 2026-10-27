"""The remote templates: a picture of the thing, one big reading and the
buttons that work it. A car's lock and climate, a garage door, a robot
vacuum.

The widget: when it last reported, up to three stats and one to five
buttons. Built from the parts it shares: the picture, the report time and
the stats are the showcase's; the buttons are the switchboard's tiles (the
same rows, ids, state words and press routing), held to five. There is
no state mark: the device words the state from the buttons.

The Live Activity: a state word, the reading with a unit and a label of
its own, a bar or up to two stats, and one to three buttons pressed from
the Lock Screen and the Dynamic Island. Its buttons draw only their label,
symbol and color, so their rows take no more; its picture's URL and its
readings are held to tighter caps, since every part rides in each push.
"""

from __future__ import annotations

import json
from functools import partial
from typing import Any, Final, override

from . import blocks, limits
from .showcase import StatRows, stored_image, stored_stat
from .sources import Source, StateResolver
from .sourcing import Bare, ValueSlot
from .switchboard import ActionRows, bound_actions
from .switchboard.size import ICON_KEYS, VALUE_KEYS, filled, stored_actions, stored_url
from .values import finite_number, wire_number

REMOTE_TEMPLATE: Final = "remote"

#: Units drawn against the number, without a space: 78%, 21°C.
_HUGGED: Final = ("%", "°")


def with_unit(number: str, unit: Any) -> str:
    """A reading with its unit, as the device draws it: ``78%``,
    ``21°C``, ``7.4 kW``."""
    if not isinstance(unit, str) or not (unit := unit.strip()):
        return number
    return f"{number}{unit}" if unit.startswith(_HUGGED) else f"{number} {unit}"


class Reading(blocks.Value):
    """The remote's one big reading: a ``Value`` that, read from a number
    entity, carries the entity's unit, since the content has no unit of
    its own (``78%``, ``312 km``). A template, an attribute or a value
    with a formatter is sent as it reads."""

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> dict[str, Any] | None:
        out = super().resolve(key, data, resolver)
        source = self.SLOT.source(key, data)
        if (
            out is None
            or "formatter" in out
            or source is None
            or source.source is not Source.ENTITY
            or source.entity_id is None
            or (number := finite_number(out["value"])) is None
        ):
            return out
        unit = resolver.attribute(source.entity_id, "unit_of_measurement")
        text = with_unit(str(wire_number(number)), unit)
        out["value"] = text[: limits.VALUE]
        return out


class RemoteActions(ActionRows):
    """A remote's buttons: the switchboard's tiles, one to five."""

    def __init__(self) -> None:
        super().__init__(max_rows=limits.REMOTE_ACTIONS)


class RemoteStats(StatRows):
    """A remote's stats: up to three, shown at the large size and up."""

    def __init__(self) -> None:
        super().__init__(max_rows=limits.REMOTE_STATS)


#: Action id -> entity id for a remote binding: the press-routing map,
#: over the buttons the content carries.
bound_remote_actions = partial(bound_actions, limit=limits.REMOTE_ACTIONS)


class ActivityReading(blocks.Value):
    """A Live Activity's reading: a ``Value`` held to Aivi's 64
    characters, since every push carries it. Its unit is a field of its
    own, so the reading is sent as it reads."""

    SLOT = ValueSlot(bare=Bare.ENTITY, max_length=limits.ACTIVITY_READING)


class ActivityActions(ActionRows):
    """A remote Live Activity's buttons: one to three, drawn with their
    label, symbol and color only."""

    def __init__(self) -> None:
        super().__init__(max_rows=limits.ACTIVITY_ACTIONS, tiles=False)


class ActivityStats(StatRows):
    """A remote Live Activity's stats: up to two, on the Lock Screen while
    there is no bar."""

    def __init__(self) -> None:
        super().__init__(max_rows=limits.ACTIVITY_STATS)


#: Action id -> entity id for a remote Live Activity binding.
bound_activity_actions = partial(bound_actions, limit=limits.ACTIVITY_ACTIONS)


def content_size(content: dict[str, Any], *, state_text: bool = True) -> int:
    """The size Aivi measures a remote's content at: compact,
    ASCII-escaped JSON of the content as Aivi stores it. The widget's
    icon, accent and tap URL are stored null when unset, the reading and
    each stat's value with their color and formatter, the buttons as a
    switchboard's tiles; the picture, the report time and the stats are
    stored only when set. ``state_text=False`` measures it as an Aivi
    server without state words stores it."""
    stored: dict[str, Any] = {
        "icon": None,
        "accent": None,
        "tap_url": None,
        **content,
        "template": REMOTE_TEMPLATE,
    }
    stored["icon"] = filled(stored["icon"], ICON_KEYS)
    stored["tap_url"] = stored_url(stored["tap_url"])
    if "image" in stored:
        stored["image"] = stored_image(stored["image"], fit=True)
    stored["value"] = filled(stored.get("value"), VALUE_KEYS)
    if stats := stored.get("stats"):
        stored["stats"] = [stored_stat(s) for s in stats]
    else:
        stored.pop("stats", None)
    stored["actions"] = stored_actions(stored.get("actions"), state_text=state_text)
    return len(json.dumps(stored, separators=(",", ":")))
