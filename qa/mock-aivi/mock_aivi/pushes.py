"""``PATCH /widgets/{slug}`` and ``PATCH /activities/{slug}``."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from werkzeug.wrappers import Response

from . import state
from .responses import detail, json_response, refusal
from .stored import stored_form, stored_size

MAX_CONTENT_BYTES = 4096


def record(label: str, content: Any, **extra: Any) -> None:
    entry = {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "slug": label,
        "content": content,
        **extra,
    }
    with state.LOCK:
        state.PUSHES.insert(0, entry)
        del state.PUSHES[50:]
    print(f"[push] {label}: {json.dumps(content)}", flush=True)


def patch_widget(slug: str, body: dict[str, Any]) -> Response:
    widget = next((w for w in state.widgets() if w["slug"] == slug), None)
    if widget is None:
        return detail(404, "Widget not found")
    content = body["content"]
    if content.get("template", widget["template"]) != widget["template"]:
        return detail(400, "Template mismatch")
    content = {**content, "template": widget["template"]}
    if errors := content_errors(content):
        return refusal(errors)
    if stored_size(content) > MAX_CONTENT_BYTES:
        return detail(422, "Content exceeds the 4 KiB limit")
    extra = {}
    with state.LOCK:
        if "stale_after" in body:
            state.STALE_AFTER[slug] = body["stale_after"]
            extra["stale_after"] = body["stale_after"]
        stale_after = state.STALE_AFTER.get(slug)
    record(slug, body["content"], **extra)
    stored = stored_form(content, {"$ref": "#/components/schemas/WidgetContent-Input"})
    return json_response(200, {"content": stored, "stale_after": stale_after})


def content_errors(content: dict[str, Any]) -> list[dict[str, Any]]:
    """What Aivi rejects beyond the schema (its model validators)."""
    template = content["template"]
    if template == "prices":
        starts = [
            datetime.fromisoformat(entry["start"]) for entry in content["entries"]
        ]
        if any(a >= b for a, b in zip(starts, starts[1:], strict=False)):
            message = "Entries must be in strictly increasing start order."
            return [_value_error(template, message)]
    if template == "energy" and not any(
        content.get(key) for key in ("sources", "grid", "battery", "home")
    ):
        message = "At least one of sources, grid, battery, home is required."
        return [_value_error(template, message)]
    return []


def _value_error(template: str, message: str) -> dict[str, Any]:
    return {
        "type": "value_error",
        "loc": ["body", "content", template],
        "msg": f"Value error, {message}",
    }


def patch_activity(slug: str, body: dict[str, Any]) -> Response:
    activity = next((a for a in state.activities() if a["slug"] == slug), None)
    if activity is None:
        return detail(404, "Activity not found")
    content, lifecycle = body["content"], body["state"]
    if content.get("template", activity["template"]) != activity["template"]:
        return detail(400, "Template mismatch")
    with state.LOCK:
        cap = state.STATE["max_ongoing"]
        if lifecycle == "ONGOING":
            if (
                slug not in state.ONGOING
                and cap is not None
                and len(state.ONGOING) >= cap
            ):
                return detail(422, "Too many ongoing activities")
            state.ONGOING.setdefault(slug, str(uuid.uuid4()))
        else:
            state.ONGOING.pop(slug, None)
    record(f"{slug} (activity) · {lifecycle}", content, activity=slug)
    stored = stored_form(
        {**content, "template": activity["template"]},
        {"$ref": "#/components/schemas/ActivityContent-Input"},
    )
    return json_response(200, {"state": lifecycle, "content": stored})
