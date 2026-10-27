"""Routing: the mock-only routes, then the Aivi API's, validated against
the schema both ways."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from openapi_core.contrib.werkzeug import WerkzeugOpenAPIRequest
from openapi_core.templating.paths.exceptions import (
    OperationNotFound,
    PathNotFound,
)
from werkzeug.wrappers import Request, Response

from . import state
from .admin import admin, status_page
from .events import command, stream_events
from .listings import listing
from .pushes import patch_activity, patch_widget
from .responses import account, inactive, json_response, unauthorized
from .schema import OPENAPI, check_response, strict_json, validation_failure


def api(request: Request) -> Response:
    """An Aivi API route, validated against the schema both ways. As in
    Aivi, the token and the subscription are checked before the body."""
    result = OPENAPI.unmarshal_request(WerkzeugOpenAPIRequest(request))
    unrouted = [
        e for e in result.errors if isinstance(e, PathNotFound | OperationNotFound)
    ]
    if unrouted:
        return validation_failure(unrouted[0])
    auth = request.headers.get("Authorization", "")
    scheme, _, token = auth.partition(" ")
    # "invalid" is the token the mock refuses, not a credential.
    if scheme != "Token" or not token or token == "invalid":  # noqa: S105
        return unauthorized()
    if request.path == "/account":
        # The one route that answers whatever the subscription.
        with state.LOCK:
            state.STATE["account_checks"] += 1
        return account()
    if not state.STATE["active"]:
        with state.LOCK:
            state.STATE["answered_402"] += 1
        return inactive()
    raw = request.get_data()
    if raw and (refused := strict_json(raw)) is not None:
        return refused
    if result.errors:
        return validation_failure(result.errors[0])
    path = request.path
    if path == "/widgets":
        return listing(request, "w", state.widgets())
    if path == "/activities":
        return listing(request, "a", state.activities())
    if path == "/events":
        return stream_events(request)
    body = json.loads(raw)
    if path.startswith("/widgets/"):
        return patch_widget(path.removeprefix("/widgets/"), body)
    return patch_activity(path.removeprefix("/activities/"), body)


@Request.application
def app(request: Request) -> Response:
    path = request.path
    if request.method == "GET" and path == "/":
        return status_page(request)
    if request.method == "GET" and path == "/pushes.json":
        with state.LOCK:
            return json_response(200, list(state.PUSHES))
    if request.method == "GET" and path == "/refusals.json":
        with state.LOCK:
            return json_response(200, list(state.REFUSALS))
    if request.method == "GET" and path == "/state.json":
        with state.LOCK:
            return json_response(200, {k: state.STATE[k] for k in sorted(state.STATE)})
    if request.method == "POST" and path == "/command":
        return command(json.loads(request.get_data() or b"{}"))
    if request.method == "POST" and path.startswith("/admin/"):
        return admin(path, json.loads(request.get_data() or b"{}"))
    response = api(request)
    if response.mimetype == "text/event-stream":
        return response
    response = check_response(request, response)
    if response.status_code in (400, 422):
        refused = {
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
            "request": f"{request.method} {request.full_path.rstrip('?')}",
            "status": response.status_code,
            "detail": json.loads(response.get_data())["detail"],
        }
        print(f"[refused] {json.dumps(refused)}", flush=True)
        with state.LOCK:
            state.REFUSALS.insert(0, refused)
            del state.REFUSALS[50:]
    return response
