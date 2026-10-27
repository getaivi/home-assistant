"""The account the mock serves, and what it remembers between requests."""

from __future__ import annotations

import os
import queue
import threading
from typing import Any

EMPTY_ACCOUNT = os.environ.get("AIVI_MOCK_EMPTY", "") not in ("", "0")

# Slugs/templates line up with the helpers in the QA Home Assistant config.
WIDGETS = [
    {"slug": "laundry", "name": "Laundry", "template": "progress"},
    {"slug": "frontdoor", "name": "Front door", "template": "status"},
    {"slug": "batteries", "name": "Home batteries", "template": "battery"},
    {"slug": "livingroom", "name": "Living room", "template": "gauge"},
    {"slug": "garbage", "name": "Garbage day", "template": "countdown"},
    {"slug": "home", "name": "Home", "template": "list"},
    {"slug": "porch", "name": "Porch", "template": "switchboard"},
    {"slug": "spending", "name": "Spending", "template": "budget"},
    {"slug": "indoor", "name": "Indoor", "template": "trend"},
    {"slug": "electricity", "name": "Electricity", "template": "prices"},
    {"slug": "energy", "name": "Energy", "template": "energy"},
    {"slug": "car", "name": "Car", "template": "showcase"},
    {"slug": "fountain", "name": "Fountain", "template": "remote"},
]
ACTIVITIES = [
    {"slug": "washer", "name": "Washer", "template": "progress"},
    {"slug": "grill", "name": "Grill", "template": "monitor"},
    {"slug": "vacuum", "name": "Robot vacuum", "template": "remote"},
]

LOCK = threading.Lock()
PUSHES: list[dict[str, Any]] = []
# API requests answered 400 or 422, newest first.
REFUSALS: list[dict[str, Any]] = []
# Open streams: each a queue fed (cursor, event) by POST /command.
STREAMS: list[queue.Queue[tuple[int, dict[str, Any]] | None]] = []
# Delivered events, for Last-Event-ID replay.
LOG: list[tuple[int, dict[str, Any]]] = []
STATE: dict[str, Any] = {}
# Ongoing activity slug -> the instance id of its current card.
ONGOING: dict[str, str] = {}
# Widget slug -> its stale_after, as last sent.
STALE_AFTER: dict[str, int | None] = {}


def reset() -> None:
    global CURSOR
    with LOCK:
        PUSHES.clear()
        REFUSALS.clear()
        ONGOING.clear()
        STALE_AFTER.clear()
        STATE.update(
            active=True,
            expired_at=None,
            expires_at=None,
            renews=True,
            answered_402=0,
            account_checks=0,
            refuse=0,
            max_ongoing=None,
        )
        CURSOR = 0


CURSOR = 0
reset()


def widgets() -> list[dict[str, str]]:
    return [] if EMPTY_ACCOUNT else WIDGETS


def activities() -> list[dict[str, str]]:
    return [] if EMPTY_ACCOUNT else ACTIVITIES
