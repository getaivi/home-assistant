"""The 4 KiB content limit, measured the way Aivi measures it."""

from __future__ import annotations

import json
from typing import Any, Final
from urllib.parse import urlsplit, urlunsplit

from .ids import SWITCHBOARD_TEMPLATE

#: Aivi's cap on widget content, measured as compact JSON of the content
#: it stores (every field present, unset ones as null).
MAX_CONTENT_BYTES: Final = 4096

VALUE_KEYS: Final = ("value", "text_color", "formatter")
IMAGE_KEYS: Final = ("url", "alt")
_ACTION_KEYS: Final = (
    "id",
    "label",
    "subtitle",
    "icon",
    "color",
    "gradient",
    "image",
)
ICON_KEYS: Final = (
    "name",
    "rendering_mode",
    "primary_color",
    "secondary_color",
    "tertiary_color",
    "color_rendering",
)


#: Schemes whose URLs Aivi stores with a ``/`` path when they have none.
_SPECIAL_SCHEMES: Final = frozenset({"http", "https", "ws", "wss", "ftp", "file"})


def stored_url(url: Any) -> Any:
    """A URL as Aivi stores it (a special scheme's empty path becomes
    ``/``), so the measure counts the stored bytes."""
    if not isinstance(url, str):
        return url
    parts = urlsplit(url)
    if parts.scheme.lower() in _SPECIAL_SCHEMES and parts.netloc and not parts.path:
        return urlunsplit(parts._replace(path="/"))
    return url


def filled(obj: Any, keys: tuple[str, ...]) -> Any:
    """``obj`` with every one of ``keys`` present, null when unset."""
    if not isinstance(obj, dict):
        return obj
    return {**{key: None for key in keys}, **obj}


def stored_actions(actions: Any, *, state_text: bool) -> list[Any]:
    """Actions as Aivi stores them (``_stored_action``);
    ``state_text=False`` as a server without state words stores them."""
    stored = [_stored_action(a) for a in actions or []]
    if not state_text:
        for action in stored:
            if isinstance(action, dict):
                action.pop("state_text", None)
    return stored


def _stored_action(action: Any) -> Any:
    """A tile as Aivi stores it: every field present, null when unset,
    except ``state_text``, which is stored only when set and then only
    with the words that are set."""
    if not isinstance(action, dict):
        return action
    stored = filled(action, _ACTION_KEYS)
    stored["subtitle"] = filled(stored["subtitle"], VALUE_KEYS)
    stored["image"] = filled(stored["image"], IMAGE_KEYS)
    words = stored.pop("state_text", None)
    if isinstance(words, dict):
        stored["state_text"] = {k: v for k, v in words.items() if v is not None}
    if stored.get("kind") == "toggle":
        stored.setdefault("on", False)
    else:
        stored.setdefault("kind", "button")
        stored.setdefault("active", False)
    return stored


def content_size(content: dict[str, Any], *, state_text: bool = True) -> int:
    """The size Aivi measures a switchboard's content at: compact,
    ASCII-escaped JSON of the content as Aivi stores it, optional fields
    present as ``null`` and defaults filled in (the sparse payload would
    undercount and let a 422 through). ``state_text=False`` measures
    it as an Aivi server without state words stores it."""
    stored: dict[str, Any] = {
        "icon": None,
        "accent": None,
        "tap_url": None,
        **content,
        "template": SWITCHBOARD_TEMPLATE,
    }
    stored["icon"] = filled(stored["icon"], ICON_KEYS)
    stored["tap_url"] = stored_url(stored["tap_url"])
    stored["actions"] = stored_actions(stored.get("actions"), state_text=state_text)
    return len(json.dumps(stored, separators=(",", ":")))
