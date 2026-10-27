"""State words: the word a tile shows for each state."""

from __future__ import annotations

import unicodedata
from typing import Any, Final

from homeassistant.const import STATE_OFF, STATE_ON

from .. import limits
from .ids import kind_of

#: The words a tile may carry in its ``state_text``, by tile kind. A
#: missing key (or null) keeps the app's own word ("On", "Off", "Turning
#: on", "Turning off", "No response"; for a button none, "Active",
#: "Sent"); ``""`` hides the word. Aivi rejects any other key, and a key
#: of the other kind.
STATE_TEXT_KEYS: Final[dict[str, tuple[str, ...]]] = {
    "toggle": ("on", "off", "turning_on", "turning_off", "no_response"),
    "button": ("idle", "active", "sent"),
}
#: The whitespace Aivi trims around a word (Unicode White_Space), and
#: the character categories it rejects inside one: control characters
#: (tabs and line breaks among them), line and paragraph separators, and
#: lone surrogates.
_WORD_SPACE: Final = (
    "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005"
    "\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
)
_WORD_FORBIDDEN: Final = frozenset({"Cc", "Zl", "Zp", "Cs"})
#: A tile's own words are row options named ``state_text_<key>``.
STATE_TEXT_OPTION: Final = "state_text_"

_OPEN_CLOSED: Final[dict[str, str]] = {
    "on": "Open",
    "off": "Closed",
    "turning_on": "Opening",
    "turning_off": "Closing",
}

#: Default words for the domains whose ``on`` is not "on". Every other
#: domain (and every button) sends no ``state_text``.
AUTO_STATE_TEXT: Final[dict[str, dict[str, str]]] = {
    "cover": _OPEN_CLOSED,
    "valve": _OPEN_CLOSED,
    "lock": {
        "on": "Locked",
        "off": "Unlocked",
        "turning_on": "Locking",
        "turning_off": "Unlocking",
    },
}

# Home Assistant's cover, valve and lock states, as strings so this module
# does not import those integrations.
_OPEN_CLOSE_STATES: Final[dict[str, tuple[bool, str | None]]] = {
    "open": (True, None),
    "opening": (True, "turning_on"),
    "closed": (False, None),
    "closing": (False, "turning_off"),
}

#: Home Assistant state -> (``on``, the word key shown in place of the
#: resting one). A moving tile is published as the state it is heading
#: for, so the press that started it is answered at once, while its word
#: says it is still moving ("Opening", not "Open").
_TOGGLE_STATES: Final[dict[str, dict[str, tuple[bool, str | None]]]] = {
    "cover": _OPEN_CLOSE_STATES,
    "valve": _OPEN_CLOSE_STATES,
    "lock": {
        "locked": (True, None),
        "locking": (True, "turning_on"),
        "unlocked": (False, None),
        "unlocking": (False, "turning_off"),
    },
}

#: States that are neither side, and the word an off tile shows for them
#: (a jammed lock must never read "Unlocked", let alone "Locked").
_STATUS_WORDS: Final[dict[str, dict[str, str]]] = {
    "cover": {},
    "valve": {},
    "lock": {"jammed": "Jammed", "open": "Open", "opening": "Opening"},
}
_UNKNOWN_WORDS: Final[dict[str, str]] = {
    "unknown": "Unknown",
    "unavailable": "Unavailable",
}


#: Domains whose state is a mode, ``off`` among them: any other known
#: mode is on (a thermostat heating, cooling or on auto).
_MODE_DOMAINS: Final = frozenset({"climate"})


def _mode_on(state: str | None) -> bool | None:
    """A mode entity's side: off, on for any other mode, ``None`` when Home
    Assistant does not know (unknown, unavailable)."""
    if state is None or state in _UNKNOWN_WORDS:
        return None
    return state != STATE_OFF


def toggle_on(entity_id: str, state: str | None) -> bool:
    """Whether a toggle tile is on for ``state``: open for a cover or a
    valve (and on its way open), locked for a lock (and locking), any
    mode but off for a thermostat, ``on`` for everything else. Anything
    else, unavailable included, is off."""
    domain = entity_id.partition(".")[0]
    if domain in _MODE_DOMAINS:
        return bool(_mode_on(state))
    if (states := _TOGGLE_STATES.get(domain)) is None:
        return state == STATE_ON
    return states.get(state or "", (False, None))[0]


def toggle_answers(entity_id: str, state: str | None, value: bool) -> bool:
    """Whether ``state`` answers a press asking for ``value``: the entity
    is in (or, for a cover, valve or lock, on its way to) the requested
    side. A state that is neither (jammed, unknown, unavailable, a lock
    left open) never answers, so the phone says No response rather than
    taking the press as done."""
    domain = entity_id.partition(".")[0]
    if domain in _MODE_DOMAINS:
        return _mode_on(state) is value
    if (states := _TOGGLE_STATES.get(domain)) is None:
        return state in (STATE_ON, STATE_OFF) and (state == STATE_ON) == value
    reading = states.get(state or "")
    return reading is not None and reading[0] == value


def auto_state_text(entity_id: str) -> dict[str, str] | None:
    """The words a tile gets by its domain, or ``None`` for one that
    keeps the app's."""
    return AUTO_STATE_TEXT.get(entity_id.partition(".")[0])


def user_state_text(options: dict[str, Any], kind: str) -> dict[str, str]:
    """The words the user set on a tile (``state_text_<key>`` row
    options): only keys of its kind that pass ``state_text_problem``.
    ``""`` is kept: it hides the word."""
    words: dict[str, str] = {}
    for key in STATE_TEXT_KEYS[kind]:
        value = options.get(f"{STATE_TEXT_OPTION}{key}")
        if isinstance(value, str) and state_text_problem(value) is None:
            words[key] = value.strip(_WORD_SPACE)
    return words


def state_text_problem(value: Any) -> str | None:
    """Why Aivi would reject ``value`` as a state word, or ``None``."""
    if not isinstance(value, str):
        return "must be text"
    word = value.strip(_WORD_SPACE)
    if any(unicodedata.category(char) in _WORD_FORBIDDEN for char in word):
        return "must be one line, with no tabs or control characters"
    if len(word) > limits.STATE_TEXT:
        return f"must be at most {limits.STATE_TEXT} characters"
    return None


def state_text(
    entity_id: str, state: str | None, options: dict[str, Any]
) -> dict[str, str] | None:
    """A tile's ``state_text``: the domain's words overridden by the
    user's, with the in-between state's word (moving, jammed, unknown) in
    place of the resting one. ``None`` keeps the app's words."""
    kind = kind_of(entity_id)
    words = {**(auto_state_text(entity_id) or {}), **user_state_text(options, kind)}
    if not words or kind != "toggle":
        return words or None
    domain = entity_id.partition(".")[0]
    if domain not in _TOGGLE_STATES:
        return words
    if (reading := _TOGGLE_STATES[domain].get(state or "")) is not None:
        on, moving = reading
        if moving is not None and moving in words:
            words["on" if on else "off"] = words[moving]
        return words
    # Neither side: an unrecognized state is unknown, never "Unlocked" or
    # "Closed".
    words["off"] = (
        _STATUS_WORDS[domain].get(state or "")
        or _UNKNOWN_WORDS.get(state or "")
        or _UNKNOWN_WORDS["unknown"]
    )
    return words


def state_words_refusal(bindings: dict[str, Any]) -> str | None:
    """Why a save of a switchboard's bindings is refused: its state words
    are refused there, where the user can fix them, rather than stored
    and then dropped from every push."""
    if errors := state_text_errors(bindings):
        return "Invalid state words: " + "; ".join(errors)
    return None


def state_text_errors(bindings: dict[str, Any]) -> list[str]:
    """Problems with a switchboard's state words, one line each (empty
    when saving may go ahead)."""
    stored = bindings.get("actions__options")
    if not isinstance(stored, dict):
        return []
    errors: list[str] = []
    for entity_id, options in stored.items():
        if not isinstance(options, dict):
            continue
        kind = kind_of(str(entity_id))
        for option, value in options.items():
            if not str(option).startswith(STATE_TEXT_OPTION):
                continue
            word = str(option).removeprefix(STATE_TEXT_OPTION)
            if word not in STATE_TEXT_KEYS[kind]:
                other = "button" if kind == "toggle" else "toggle"
                errors.append(
                    f'{entity_id}: "{word}" is not a state word of a {kind} tile'
                    + (
                        f" (it belongs to {other} tiles)"
                        if word in STATE_TEXT_KEYS[other]
                        else ""
                    )
                    + f"; use {', '.join(STATE_TEXT_KEYS[kind])}"
                )
            elif problem := state_text_problem(value):
                errors.append(f'{entity_id}: the "{word}" word {problem}')
    return errors
