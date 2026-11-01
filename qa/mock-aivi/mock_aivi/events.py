"""``GET /events``, and ``POST /command``, which stands in for a press on
a device: a widget's tile or button, or a Live Activity's button."""

from __future__ import annotations

import json
import os
import queue
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from werkzeug.wrappers import Request, Response

from . import state
from .responses import detail, json_response
from .schema import event_errors

PING_S = float(os.environ.get("AIVI_MOCK_PING_S", "20"))
RETRY_MS = 1000
STREAM_LIFETIME_S = 15 * 60
MAX_STREAMS = 4
EVENT_TTL = timedelta(seconds=5)


def timestamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def command(body: dict[str, Any]) -> Response:
    """``{"widget": slug, ...}`` or ``{"activity": slug, ...}``, plus the
    action and a toggle's value. An activity is pressed on its current
    card, so it must be ongoing."""
    if "activity" in body:
        kind, slug = "activity", body.pop("activity")
        listed = {a["slug"] for a in state.activities()}
    else:
        kind, slug = "widget", body.pop("widget", None)
        listed = {w["slug"] for w in state.widgets()}
    if slug not in listed or "action" not in body:
        return detail(422, f"{kind} (a listed slug) and action required")
    if kind == "activity":
        with state.LOCK:
            instance = state.ONGOING.get(slug)
        if instance is None:
            return detail(409, "The activity is not ongoing")
        body.setdefault("instance_id", instance)
    body.setdefault("kind", "toggle" if "value" in body else "button")
    now = datetime.now(UTC)
    event = {
        "id": str(uuid.uuid4()),
        "request_id": f"act_{uuid.uuid4().hex[:12]}",
        "type": f"{kind}.action.v1",
        "subject": {"kind": kind, "slug": slug},
        "occurred_at": timestamp(now),
        "expires_at": timestamp(now + EVENT_TTL),
        "data": body,
    }
    if errors := event_errors(event):
        return detail(422, f"The event would break the schema: {errors}")
    with state.LOCK:
        state.CURSOR += 1
        state.LOG.append((state.CURSOR, event))
        del state.LOG[:-100]
        listeners = list(state.STREAMS)
        for q in listeners:
            q.put((state.CURSOR, event))
    print(
        f"[command] {kind}/{slug}: {json.dumps(body)} -> {len(listeners)} stream(s)",
        flush=True,
    )
    return json_response(202, {"id": event["id"], "delivered_to": len(listeners)})


def frame(cursor: int, event: dict[str, Any]) -> bytes:
    return f"id: u:{cursor}\ndata: {json.dumps(event)}\n\n".encode()


def stream_events(request: Request) -> Response:
    subjects = request.args.getlist("subject")
    for subject in subjects:
        kind, _, slug = subject.partition("/")
        if kind not in ("widget", "activity") or not slug:
            return detail(
                422, "subject must be <kind>/<slug>, for example widget/living-room"
            )
    types = request.args.getlist("types")
    resume = request.headers.get("Last-Event-ID")
    now = timestamp(datetime.now(UTC))

    def wanted(event: dict[str, Any]) -> bool:
        subject = f"{event['subject']['kind']}/{event['subject']['slug']}"
        return (not types or event["type"] in types) and (
            not subjects or subject in subjects
        )

    with state.LOCK:
        if state.STATE["refuse"]:
            state.STATE["refuse"] -= 1
            print("[events] refused a stream (retry only)", flush=True)
            return Response(f"retry: {RETRY_MS}\n\n", content_type="text/event-stream")
        if len(state.STREAMS) >= MAX_STREAMS:
            return detail(429, "Too many event streams")
        q: queue.Queue[tuple[int, dict[str, Any]] | None] = queue.Queue()
        state.STREAMS.append(q)
        position = state.CURSOR
        after = None
        if resume is not None and resume.startswith("u:") and resume[2:].isdigit():
            after = int(resume[2:])
        backlog = (
            [
                (cursor, event)
                for cursor, event in state.LOG
                if (after is None or cursor > after) and event["expires_at"] > now
            ]
            if resume is not None
            else []
        )
    print(
        f"[events] stream opened ({len(state.STREAMS)} open, resuming from"
        f" {resume or '-'}, {len(backlog)} replayed)",
        flush=True,
    )

    def body() -> Iterator[bytes]:
        deadline = time.monotonic() + STREAM_LIFETIME_S
        try:
            yield f"retry: {RETRY_MS}\n".encode()
            for cursor, event in backlog:
                if wanted(event):
                    yield frame(cursor, event)
            yield f"id: u:{position}\n\n".encode()
            while time.monotonic() < deadline:
                try:
                    item = q.get(timeout=PING_S)
                except queue.Empty:
                    yield b": ping\n\n"
                    continue
                if item is None:  # closed, as at the end of its lifetime
                    return
                if wanted(item[1]):
                    yield frame(*item)
        finally:
            with state.LOCK:
                state.STREAMS.remove(q)
            print(f"[events] stream closed ({len(state.STREAMS)} open)", flush=True)

    return Response(
        body(),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
        direct_passthrough=True,
    )
