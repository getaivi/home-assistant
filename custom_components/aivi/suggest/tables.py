"""The tables Suggest reads from disk: the SF Symbols index and the panel's words.

Both are read on first use and cached. ``async_load_tables`` reads them in
the executor, so a request handler on the event loop finds them in memory.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

_COMPONENT_DIR = Path(__file__).parent.parent


@cache
def symbol_index() -> dict[str, Any]:
    """Every SF Symbol the icon picker offers, with its categories."""
    path = _COMPONENT_DIR / "frontend" / "sf-symbols.json"
    index: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return index


@cache
def panel_words() -> dict[str, Any]:
    """What the panel calls each template and field, and what it says about
    them: the model reads the same words the user does."""
    path = _COMPONENT_DIR / "translations" / "en.json"
    words: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))["config_panel"]
    return words


def _load() -> None:
    symbol_index()
    panel_words()


async def async_load_tables(hass: HomeAssistant) -> None:
    """Read both tables off the event loop; a no-op once they are cached."""
    await hass.async_add_executor_job(_load)
