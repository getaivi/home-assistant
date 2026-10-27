"""The answers every route shares."""

from __future__ import annotations

import json
from typing import Any

from werkzeug.wrappers import Response

from .state import STATE


def json_response(status: int, body: Any) -> Response:
    return Response(json.dumps(body), status=status, content_type="application/json")


def detail(status: int, text: str) -> Response:
    return json_response(status, {"detail": text})


def unauthorized() -> Response:
    return detail(401, "Could not validate credentials")


def account() -> Response:
    """``GET /account``: active (with when the paid period ends and
    whether it renews), or since when it is not (``none`` when the mock's
    lapse has no end date)."""
    ended = STATE["expired_at"]
    if STATE["active"]:
        subscription = {
            "state": "active",
            "expires_at": STATE["expires_at"],
            "renews": STATE["renews"],
        }
    elif ended:
        subscription = {"state": "expired", "expired_at": ended}
    else:
        subscription = {"state": "none"}
    return json_response(200, {"subscription": subscription})


def inactive() -> Response:
    return json_response(
        402,
        {
            "detail": "No active subscription was found",
            "code": "subscription_inactive",
            "expired_at": STATE["expired_at"],
        },
    )


def refusal(errors: list[dict[str, Any]]) -> Response:
    return json_response(422, {"detail": errors})
