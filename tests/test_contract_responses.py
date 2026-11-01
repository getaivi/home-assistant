"""The wire contract's response side: every response shape Aivi's OpenAPI
document (``contract/aivi-openapi.json``) describes must parse."""

from __future__ import annotations

import json
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from openapi_core.testing import MockResponse

from custom_components.aivi.api import (
    ActivityInfo,
    AiohttpAiviClient,
    AiviAuthError,
    AiviNotFoundError,
    AiviSubscriptionError,
    AiviTemplateMismatchError,
    AiviValidationError,
    WidgetInfo,
)
from helpers import OPENAPI, api_request

BASE = "https://api.example.test"


def assert_documented(
    method: str, path: str, status: int, body: Any, **kw: Any
) -> None:
    """``body`` is what Aivi documents for ``status`` on that operation."""
    OPENAPI.validate_response(
        api_request(method, path, **kw),
        MockResponse(
            json.dumps(body).encode(),
            status_code=status,
            content_type="application/json",
        ),
    )


def _client(hass: HomeAssistant) -> AiohttpAiviClient:
    return AiohttpAiviClient(async_get_clientsession(hass), BASE, "t")


PAGES = [
    {
        "items": [{"slug": "laundry", "name": "Laundry", "template": "progress"}],
        "next_cursor": "o:1",
    },
    {
        "items": [{"slug": "porch", "name": "Porch", "template": "switchboard"}],
        "next_cursor": None,
    },
]


@pytest.mark.parametrize(
    ("path", "method", "info"),
    [
        ("/widgets", "list_widgets", WidgetInfo),
        ("/activities", "list_activities", ActivityInfo),
    ],
)
async def test_documented_pages_parse(hass, aioclient_mock, path, method, info) -> None:
    for page in PAGES:
        assert_documented("get", path, 200, page)
    aioclient_mock.get(f"{BASE}{path}?cursor=o:1", json=PAGES[1])
    aioclient_mock.get(f"{BASE}{path}", json=PAGES[0])
    assert await getattr(_client(hass), method)() == [
        info("laundry", "Laundry", "progress"),
        info("porch", "Porch", "switchboard"),
    ]


INACTIVE = {
    "detail": "No active subscription was found",
    "code": "subscription_inactive",
    "expired_at": "2026-09-01T00:00:00Z",
}


UNAUTHORIZED = {"detail": "Could not validate credentials"}


SCHEMA_REFUSAL = {
    "detail": [
        {
            "type": "extra_forbidden",
            "loc": ["body", "content", "switchboard", "actions", 0, "state_text"],
            "msg": "Extra inputs are not permitted",
        }
    ]
}


@pytest.mark.parametrize("path", ["/widgets", "/activities"])
async def test_documented_listing_errors_parse(hass, aioclient_mock, path) -> None:
    assert_documented("get", path, 401, UNAUTHORIZED)
    assert_documented("get", path, 402, INACTIVE)
    assert_documented("get", path, 402, {**INACTIVE, "expired_at": None})
    for status, body, error in (
        (401, UNAUTHORIZED, AiviAuthError),
        (402, INACTIVE, AiviSubscriptionError),
    ):
        aioclient_mock.clear_requests()
        aioclient_mock.get(f"{BASE}{path}", status=status, json=body)
        with pytest.raises(error):
            await _client(hass).list_widgets() if path == "/widgets" else (
                await _client(hass).list_activities()
            )


async def test_documented_push_errors_parse(hass, aioclient_mock) -> None:
    content = {"template": "status", "state": {"value": "x"}}
    assert_documented("patch", "/widgets/demo", 422, SCHEMA_REFUSAL)
    aioclient_mock.patch(f"{BASE}/widgets/demo", status=422, json=SCHEMA_REFUSAL)
    with pytest.raises(AiviValidationError) as err:
        await _client(hass).push_widget("demo", content)
    assert err.value.unknown_field("state_text")

    too_large = {"detail": "Content exceeds the 4 KiB limit"}
    assert_documented("patch", "/widgets/demo", 422, too_large)
    aioclient_mock.clear_requests()
    aioclient_mock.patch(f"{BASE}/widgets/demo", status=422, json=too_large)
    with pytest.raises(AiviValidationError, match="4 KiB"):
        await _client(hass).push_widget("demo", content)

    not_found = {"detail": "Widget not found"}
    assert_documented("patch", "/widgets/demo", 404, not_found)
    aioclient_mock.clear_requests()
    aioclient_mock.patch(f"{BASE}/widgets/demo", status=404, json=not_found)
    with pytest.raises(AiviNotFoundError):
        await _client(hass).push_widget("demo", content)

    for status, body in ((400, {"detail": "Template mismatch"}), (402, INACTIVE)):
        assert_documented("patch", "/widgets/demo", status, body)
        assert_documented("patch", "/activities/demo", status, body)
        aioclient_mock.clear_requests()
        aioclient_mock.patch(f"{BASE}/activities/demo", status=status, json=body)
        with pytest.raises(
            AiviSubscriptionError if status == 402 else AiviTemplateMismatchError
        ):
            await _client(hass).push_activity("demo", "ONGOING", content)


def test_the_documented_event_parses() -> None:
    """The stream's documented example frames carry events the command
    stream reads: their id, type, subject, expiry and press, and on a
    Live Activity's press the card it was made on."""
    response = OPENAPI.spec / "paths" / "/events" / "get" / "responses" / "200"
    stream = (response / "content" / "text/event-stream").read_value()
    widget, activity = (
        json.loads(line.removeprefix("data: "))
        for line in stream["example"].splitlines()
        if line.startswith("data: ")
    )
    assert widget["type"] == "widget.action.v1"
    assert widget["subject"] == {"kind": "widget", "slug": "living-room"}
    assert {"id", "expires_at", "request_id"} <= widget.keys()
    assert set(widget["data"]) == {"action", "kind", "value"}
    assert activity["type"] == "activity.action.v1"
    assert activity["subject"] == {"kind": "activity", "slug": "vacuum"}
    assert {"id", "expires_at", "request_id"} <= activity.keys()
    assert set(activity["data"]) == {"action", "kind", "instance_id"}
