"""What went out to Aivi, and how it went.

Every push cycle that reaches a decision ends as one ``PushRecord``: the
content was delivered, it was the same as the last delivery (nothing
sent), the send failed and will be retried, it failed for good until the
next change, a required field has no value so there is nothing to send
(waiting), or the throttle holds the change back until its interval is
up (held). An account keeps its latest records in a bounded log,
beside its press log (``inputs.py``), so the panel can show why a widget
shows what it shows.

A record carries the request as it went over the wire (method, path and
JSON body; the token is a header and never part of it), so a user can
see exactly what Aivi was sent; a body over ``CONTENT_CAP`` characters
is cut there and marked.
"""

from __future__ import annotations

import json
import secrets
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final, cast

from homeassistant.util import dt as dt_util

if TYPE_CHECKING:
    from .api import WireRequest
    from .wire import HoldRow, PushRow, RequestRow, WaitingRow

#: Records an account keeps.
RECENT_PUSHES: Final = 100
#: The longest request body a record keeps, in characters of compact JSON.
CONTENT_CAP: Final = 8192


class PushOutcome(StrEnum):
    """How one push cycle ended."""

    DELIVERED = "delivered"
    #: Nothing sent: the device already has this content.
    UNCHANGED = "unchanged"
    RETRYING = "retrying"
    FAILED = "failed"
    #: Nothing sent: a required field has no value (``PushRecord.waiting``).
    WAITING = "waiting"
    #: Not sent yet: the throttle sends it when its interval is up
    #: (``PushRecord.held``).
    HELD = "held"

    @property
    def coalesces(self) -> bool:
        """Whether a repeat of this outcome folds into the record before
        it. A delivery never does: each one sent something."""
        return self is not PushOutcome.DELIVERED


@dataclass(frozen=True, slots=True)
class PushAttempt:
    """What a push manager reports about one cycle; the runtime adds
    which binding it was for."""

    outcome: PushOutcome
    #: The binding's ``PushStatus`` after the cycle, by value.
    status: str
    error: str | None = None
    duration_ms: int | None = None
    #: The request the cycle made, or would make when it sent nothing.
    request: WireRequest | None = None
    #: WAITING: why nothing resolved (``engine.Blocker.as_dict``).
    waiting: Mapping[str, Any] | None = None
    #: HELD: when it goes out.
    held: Hold | None = None


@dataclass(frozen=True, slots=True)
class Hold:
    """A change the throttle holds back: when it goes out, and the
    binding's interval that holds it."""

    until: datetime
    #: The least seconds between two pushes.
    interval: float

    def as_row(self) -> HoldRow:
        return {"until": self.until.isoformat(), "interval": self.interval}

    @classmethod
    def from_stored(cls, data: Any) -> Hold | None:
        if not isinstance(data, Mapping):
            return None
        until = dt_util.parse_datetime(str(data.get("until")))
        interval = data.get("interval")
        if until is None or not isinstance(interval, int | float):
            return None
        return cls(until, float(interval))


def capped_request(request: WireRequest | None) -> tuple[RequestRow | None, bool]:
    """The request as a record keeps it: its body the mapping itself while
    its compact JSON fits ``CONTENT_CAP``, else that JSON cut there and a
    flag saying so."""
    if request is None:
        return None, False
    text = json.dumps(request.body, separators=(",", ":"), default=str)
    body: Any = dict(request.body)
    truncated = len(text) > CONTENT_CAP
    if truncated:
        body = text[:CONTENT_CAP]
    return {"method": request.method, "path": request.path, "body": body}, truncated


def _stored_request(data: Any) -> RequestRow | None:
    if not isinstance(data, Mapping):
        return None
    method, path = data.get("method"), data.get("path")
    if not isinstance(method, str) or not isinstance(path, str):
        return None
    return {"method": method, "path": path, "body": data.get("body")}


@dataclass(frozen=True, slots=True)
class PushRecord:
    """One push cycle's outcome for one binding."""

    kind: str
    slug: str
    subentry_id: str
    outcome: PushOutcome
    status: str
    time: datetime
    error: str | None = None
    duration_ms: int | None = None
    #: The request as sent; its body a mapping, or its JSON cut at
    #: ``CONTENT_CAP`` (a string) when ``truncated``. ``None`` when no
    #: content resolved.
    request: RequestRow | None = None
    truncated: bool = False
    #: WAITING: the field that has no value and what its source reads.
    waiting: Mapping[str, Any] | None = None
    #: HELD: when the change goes out (the latest, once repeats fold).
    held: Hold | None = None
    #: Coalesced repeats: how many cycles this one stands for.
    count: int = 1
    id: str = ""

    @classmethod
    def of(
        cls, attempt: PushAttempt, *, kind: str, slug: str, subentry_id: str
    ) -> PushRecord:
        request, truncated = capped_request(attempt.request)
        return cls(
            kind=kind,
            slug=slug,
            subentry_id=subentry_id,
            outcome=attempt.outcome,
            status=attempt.status,
            time=dt_util.utcnow(),
            error=attempt.error,
            duration_ms=attempt.duration_ms,
            request=request,
            truncated=truncated,
            waiting=attempt.waiting,
            held=attempt.held,
            id=secrets.token_hex(6),
        )

    @property
    def coalesce_key(self) -> tuple[Any, ...] | None:
        """Repeats with the same key fold into one record; ``None`` for a
        record that never folds. A field that waits on another reading
        starts a record of its own."""
        if not self.outcome.coalesces:
            return None
        return (self.subentry_id, self.outcome, self.error, self.waiting)

    def as_row(self) -> PushRow:
        """The record as the panel lists it."""
        return {
            "id": self.id,
            "time": self.time.isoformat(),
            "kind": self.kind,
            "slug": self.slug,
            "subentry_id": self.subentry_id,
            "outcome": self.outcome.value,
            "status": self.status,
            "error": self.error,
            "duration_ms": self.duration_ms,
            "request": self.request,
            "truncated": self.truncated,
            "waiting": (
                cast("WaitingRow", dict(self.waiting))
                if self.waiting is not None
                else None
            ),
            "held": self.held.as_row() if self.held is not None else None,
            "count": self.count,
        }

    def as_stored(self) -> dict[str, Any]:
        """The record as the activity store keeps it."""
        return dict(self.as_row())

    @classmethod
    def from_stored(cls, data: Any) -> PushRecord | None:
        """A record back from the store; ``None`` for one that does not
        read, which is dropped rather than failing the load."""
        if not isinstance(data, Mapping):
            return None
        try:
            time = dt_util.parse_datetime(str(data["time"]))
            if time is None:
                return None
            return cls(
                kind=str(data["kind"]),
                slug=str(data["slug"]),
                subentry_id=str(data["subentry_id"]),
                outcome=PushOutcome(data["outcome"]),
                status=str(data["status"]),
                time=time,
                error=_opt_str(data.get("error")),
                duration_ms=(
                    int(data["duration_ms"])
                    if isinstance(data.get("duration_ms"), int | float)
                    else None
                ),
                request=_stored_request(data.get("request")),
                truncated=bool(data.get("truncated", False)),
                waiting=(
                    dict(data["waiting"])
                    if isinstance(data.get("waiting"), Mapping)
                    else None
                ),
                held=Hold.from_stored(data.get("held")),
                count=max(int(data.get("count", 1)), 1),
                id=str(data.get("id") or secrets.token_hex(6)),
            )
        except (KeyError, ValueError, TypeError):
            return None


def _opt_str(value: Any) -> str | None:
    return str(value) if value is not None else None


class PushLog:
    """An account's latest push records, newest last. A repeat of the
    newest record (same binding, same outcome, same error) folds into it."""

    def __init__(self, limit: int = RECENT_PUSHES) -> None:
        self._records: deque[PushRecord] = deque(maxlen=limit)

    def __len__(self) -> int:
        return len(self._records)

    def append(self, record: PushRecord) -> None:
        key = record.coalesce_key
        if (
            key is not None
            and self._records
            and (last := self._records[-1]).coalesce_key == key
        ):
            self._records[-1] = replace(record, count=last.count + 1, id=last.id)
            return
        self._records.append(record)

    def records(self) -> list[PushRecord]:
        """Oldest first."""
        return list(self._records)

    def rows(self, subentry_id: str | None = None) -> list[PushRow]:
        """Newest first, optionally only one binding's."""
        return [
            record.as_row()
            for record in reversed(self._records)
            if subentry_id is None or record.subentry_id == subentry_id
        ]

    def restore(self, records: list[PushRecord]) -> None:
        """Fill an empty log from stored records (oldest first)."""
        if self._records:
            return
        self._records.extend(
            records[-self._records.maxlen :] if self._records.maxlen else records
        )
