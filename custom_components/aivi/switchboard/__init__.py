"""The switchboard template: a grid of Home Screen tiles, one per entity.

Up to eight tiles, each one Home Assistant entity: a two-state entity
becomes a *toggle* whose fill follows its state, a momentary one (scene,
script, button) a *button*. A press comes back as a ``widget.action.v1``
event and is played back as a service call (``commands.CommandStream``);
the resulting state change re-pushes the widget, which is what confirms
the press on the phone.

Action ids are derived from entity ids (``action_ids``), so the bindings
list is the press-routing map; nothing else is stored.

The package splits by concern: ``ids`` (action ids and press routing),
``words`` (the state words a tile shows), ``support`` (a server that does
not take those words), ``marks`` (subtitle, gradient, picture), ``rows``
(the tiles) and ``size`` (the 4 KiB limit).
"""

from __future__ import annotations

from .ids import (
    PRESSED,
    SWITCHBOARD_TEMPLATE,
    TOGGLE_DOMAINS,
    TOGGLE_OFF,
    TOGGLE_ON,
    action_id,
    action_ids,
    bound_actions,
    kind_of,
    press_event_type,
    press_service,
    toggle_flipped,
)
from .marks import (
    light_gradient,
    user_gradient,
    valid_image_url,
    white_gradient,
)
from .rows import (
    ActionRows,
    tile_label,
)
from .size import (
    MAX_CONTENT_BYTES,
    content_size,
)
from .support import (
    STATE_TEXT_RETRY_SECONDS,
    StateTextSupport,
    has_state_text,
    without_state_text,
)
from .words import (
    AUTO_STATE_TEXT,
    STATE_TEXT_KEYS,
    state_text,
    state_text_errors,
    state_text_problem,
    state_words_refusal,
    toggle_answers,
    toggle_on,
)

__all__ = [
    "AUTO_STATE_TEXT",
    "ActionRows",
    "MAX_CONTENT_BYTES",
    "PRESSED",
    "STATE_TEXT_KEYS",
    "STATE_TEXT_RETRY_SECONDS",
    "SWITCHBOARD_TEMPLATE",
    "StateTextSupport",
    "TOGGLE_DOMAINS",
    "TOGGLE_OFF",
    "TOGGLE_ON",
    "action_id",
    "action_ids",
    "bound_actions",
    "content_size",
    "has_state_text",
    "kind_of",
    "light_gradient",
    "press_event_type",
    "press_service",
    "state_text",
    "state_text_errors",
    "state_text_problem",
    "state_words_refusal",
    "tile_label",
    "toggle_answers",
    "toggle_flipped",
    "toggle_on",
    "user_gradient",
    "valid_image_url",
    "white_gradient",
    "without_state_text",
]
