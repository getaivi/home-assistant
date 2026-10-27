"""The real aiohttp client: status mapping, network-error wrapping, and
response parsing, against a mocked aiohttp layer (no fake client here)."""

from __future__ import annotations

from datetime import UTC, datetime

import aiohttp
import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMockResponse,
)

from custom_components.aivi.api import (
    STREAM_OPEN,
    ActivityInfo,
    AiohttpAiviClient,
    AiviAuthError,
    AiviError,
    AiviNotFoundError,
    AiviQuotaError,
    AiviSubscriptionError,
    AiviTemplateMismatchError,
    AiviValidationError,
    StreamCursor,
    SubscriptionState,
    SubscriptionStatus,
    WidgetInfo,
)

BASE = "https://api.example.test"


def _client(hass: HomeAssistant) -> AiohttpAiviClient:
    return AiohttpAiviClient(async_get_clientsession(hass), BASE, "tok")


def _page(next_cursor: str | None, *slugs: str) -> dict:
    return {
        "items": [
            {"slug": slug, "name": slug.title(), "template": "progress"}
            for slug in slugs
        ],
        "next_cursor": next_cursor,
    }


async def test_list_widgets_parses_the_body(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/widgets", json=_page(None, "laundry"))
    assert await _client(hass).list_widgets() == [
        WidgetInfo("laundry", "Laundry", "progress")
    ]
    _, url, _, headers = aioclient_mock.mock_calls[0]
    assert headers["Authorization"] == "Token tok"
    assert dict(url.query) == {"limit": "50"}


@pytest.mark.parametrize(
    ("path", "method", "info"),
    [
        ("/widgets", "list_widgets", WidgetInfo),
        ("/activities", "list_activities", ActivityInfo),
    ],
)
async def test_listings_load_every_page(
    hass, aioclient_mock, path, method, info
) -> None:
    """Pages are followed by their opaque ``next_cursor`` until it is null,
    50 at a time."""
    aioclient_mock.get(f"{BASE}{path}?cursor=c%2F2", json=_page(None, "c"))
    aioclient_mock.get(f"{BASE}{path}?cursor=c1", json=_page("c/2", "b"))
    aioclient_mock.get(f"{BASE}{path}", json=_page("c1", "a"))
    listed = await getattr(_client(hass), method)()
    assert listed == [info(s, s.title(), "progress") for s in ("a", "b", "c")]
    queries = [dict(call[1].query) for call in aioclient_mock.mock_calls]
    assert queries == [
        {"limit": "50"},
        {"limit": "50", "cursor": "c1"},
        {"limit": "50", "cursor": "c/2"},
    ]


async def test_a_cursor_loop_is_an_error(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/widgets?cursor=again", json=_page("again", "b"))
    aioclient_mock.get(f"{BASE}/widgets", json=_page("again", "a"))
    with pytest.raises(AiviError):
        await _client(hass).list_widgets()
    assert aioclient_mock.call_count == 2


async def test_endless_paging_is_an_error(hass, aioclient_mock, monkeypatch) -> None:
    monkeypatch.setattr("custom_components.aivi.api.MAX_PAGES", 3)
    counter = iter(range(100))

    async def next_page(method, url, data):
        return AiohttpClientMockResponse(
            method, url, json=_page(f"c{next(counter)}", "x")
        )

    aioclient_mock.get(f"{BASE}/widgets", side_effect=next_page)
    with pytest.raises(AiviError):
        await _client(hass).list_widgets()
    assert aioclient_mock.call_count == 4


@pytest.mark.parametrize(
    "body",
    [
        [{"slug": "a", "name": "A", "template": "progress"}],
        {"items": [{"slug": "a"}], "next_cursor": None},
        {"items": [], "next_cursor": 2},
        {"items": []},
    ],
)
async def test_a_malformed_page_is_an_error(hass, aioclient_mock, body) -> None:
    aioclient_mock.get(f"{BASE}/widgets", json=body)
    with pytest.raises(AiviError):
        await _client(hass).list_widgets()


async def test_list_activities_maps_errors_like_widgets(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/activities", status=401)
    with pytest.raises(AiviAuthError):
        await _client(hass).list_activities()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{BASE}/activities", exc=aiohttp.ClientError("boom"))
    with pytest.raises(AiviError):
        await _client(hass).list_activities()
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{BASE}/activities", json={"items": [{"nope": True}]})
    with pytest.raises(AiviError):
        await _client(hass).list_activities()


async def test_push_widget_patches_content(hass, aioclient_mock) -> None:
    aioclient_mock.patch(f"{BASE}/widgets/laundry", json={})
    await _client(hass).push_widget("laundry", {"template": "progress"})
    assert aioclient_mock.mock_calls[0][2] == {"content": {"template": "progress"}}


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (400, AiviTemplateMismatchError),
        (401, AiviAuthError),
        (402, AiviSubscriptionError),
        (404, AiviNotFoundError),
        (422, AiviValidationError),
        (500, AiviError),
    ],
)
async def test_status_codes_map_to_typed_errors(
    hass, aioclient_mock, status, expected
) -> None:
    aioclient_mock.get(f"{BASE}/widgets", status=status)
    with pytest.raises(expected):
        await _client(hass).list_widgets()


async def test_the_activity_quota_is_told_apart_from_a_rejection(
    hass, aioclient_mock
) -> None:
    aioclient_mock.patch(
        f"{BASE}/activities/washer",
        status=422,
        json={"detail": "Too many ongoing activities"},
    )
    with pytest.raises(AiviQuotaError):
        await _client(hass).push_activity("washer", "ONGOING", {})
    aioclient_mock.clear_requests()
    aioclient_mock.patch(
        f"{BASE}/activities/washer",
        status=422,
        json={"detail": "Invalid widget content"},
    )
    with pytest.raises(AiviValidationError):
        await _client(hass).push_activity("washer", "ONGOING", {})
    aioclient_mock.clear_requests()
    aioclient_mock.patch(f"{BASE}/activities/washer", status=400)
    with pytest.raises(AiviTemplateMismatchError):
        await _client(hass).push_activity("washer", "ONGOING", {})


async def test_network_errors_are_wrapped(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/widgets", exc=aiohttp.ClientError("boom"))
    with pytest.raises(AiviError):
        await _client(hass).list_widgets()
    aioclient_mock.clear_requests()
    aioclient_mock.patch(f"{BASE}/widgets/x", exc=TimeoutError)
    with pytest.raises(AiviError):
        await _client(hass).push_widget("x", {})


async def test_events_decodes_server_sent_events(hass, aioclient_mock) -> None:
    aioclient_mock.get(
        f"{BASE}/events",
        text=(
            ": ping\n\n"
            'data: {"id": "e1", "type": "widget.action"}\n\n'
            "data: not json\n\n"
            "data: [1, 2]\n\n"
            'data: {"id": "e2", "type": "widget.action"}\n\n'
        ),
    )
    received = [event async for event in _client(hass).events(["widget.action"])]
    assert received[0] is STREAM_OPEN
    assert received[1:] == [
        {"id": "e1", "type": "widget.action"},
        {"id": "e2", "type": "widget.action"},
    ]
    method, url, _, headers = aioclient_mock.mock_calls[0]
    assert url.query.get("types") == "widget.action"
    assert headers["Authorization"] == "Token tok"
    assert headers["Accept"] == "text/event-stream"


async def test_events_follow_the_cursor_and_resume_from_it(
    hass, aioclient_mock
) -> None:
    """``id:`` frames move the cursor (only once the event before them is
    handled), ``retry:`` sets the floor, and a reconnect sends the last id
    as ``Last-Event-ID``."""
    aioclient_mock.get(
        f"{BASE}/events",
        text=(
            "retry: 1500\n"
            "id: 41\n\n"
            ": ping\n\n"
            "id: 42\n"
            'data: {"id": "e1", "type": "widget.action.v1"}\n\n'
            "retry: soon\n"
            "id: bad\0id\n\n"
        ),
    )
    cursor = StreamCursor()
    seen: list[tuple[str, str | None]] = []
    async for event in _client(hass).events(["widget.action.v1"], cursor):
        seen.append((event["type"], cursor.last_event_id))
    # The event is handed over while the cursor still points before it.
    assert seen == [("_open", None), ("widget.action.v1", "41")]
    assert cursor.last_event_id == "42"
    assert cursor.retry == 1.5
    assert "Last-Event-ID" not in aioclient_mock.mock_calls[0][3]

    async for _ in _client(hass).events(["widget.action.v1"], cursor):
        pass
    assert aioclient_mock.mock_calls[1][3]["Last-Event-ID"] == "42"


async def test_a_refused_stream_only_sets_the_retry(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/events", text="retry: 1000\n\n")
    cursor = StreamCursor(last_event_id="9")
    received = [e async for e in _client(hass).events(["widget.action.v1"], cursor)]
    assert received == [STREAM_OPEN]
    assert cursor == StreamCursor(last_event_id="9", retry=1.0)


async def test_events_maps_errors(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/events", status=401)
    with pytest.raises(AiviAuthError):
        async for _ in _client(hass).events(["widget.action"]):
            pass
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{BASE}/events", exc=aiohttp.ClientError("boom"))
    with pytest.raises(AiviError):
        async for _ in _client(hass).events(["widget.action"]):
            pass


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({"detail": "Content exceeds the 4 KiB limit"}, "Content exceeds the 4 KiB"),
        ({"detail": [{"msg": "String should match pattern"}, "x"]}, "match pattern; x"),
        ([], ""),
    ],
)
async def test_a_rejected_push_says_why(hass, aioclient_mock, body, reason) -> None:
    """A 422 carries Aivi's reason (the 4 KiB cap, a field error), so the
    binding's last error can say more than "rejected"."""
    aioclient_mock.patch(f"{BASE}/widgets/porch", status=422, json=body)
    with pytest.raises(AiviValidationError) as err:
        await _client(hass).push_widget("porch", {"actions": []})
    assert reason in str(err.value)
    aioclient_mock.clear_requests()
    aioclient_mock.patch(f"{BASE}/widgets/porch", status=422, text="not json")
    with pytest.raises(AiviValidationError) as err:
        await _client(hass).push_widget("porch", {"actions": []})
    assert str(err.value) == ""


async def test_a_schema_refusal_names_its_fields(hass, aioclient_mock) -> None:
    """Aivi's 422 for an unknown field (Aivi forbids extras) locates
    it, so a push can tell a field Aivi does not accept from a bad
    value, and the log line says which field."""
    body = {
        "detail": [
            {
                "type": "extra_forbidden",
                "loc": [
                    "body",
                    "content",
                    "switchboard",
                    "actions",
                    0,
                    "toggle",
                    "state_text",
                ],
                "msg": "Extra inputs are not permitted",
                "input": {"on": "Open"},
            }
        ]
    }
    aioclient_mock.patch(f"{BASE}/widgets/porch", status=422, json=body)
    with pytest.raises(AiviValidationError) as err:
        await _client(hass).push_widget("porch", {"actions": []})
    assert err.value.unknown_field("state_text")
    assert not err.value.unknown_field("toggle")
    assert str(err.value) == "state_text: Extra inputs are not permitted"
    aioclient_mock.clear_requests()
    aioclient_mock.patch(
        f"{BASE}/widgets/porch", status=422, json={"detail": "Invalid widget content"}
    )
    with pytest.raises(AiviValidationError) as err:
        await _client(hass).push_widget("porch", {"actions": []})
    assert err.value.errors == ()


@pytest.mark.parametrize(
    ("body", "code", "expired_at"),
    [
        (
            {
                "detail": "No active subscription was found",
                "code": "subscription_inactive",
                "expired_at": "2026-09-01T12:00:00Z",
            },
            "subscription_inactive",
            "2026-09-01T12:00:00+00:00",
        ),
        (
            {
                "detail": "No active subscription was found",
                "code": "subscription_inactive",
                "expired_at": None,
            },
            "subscription_inactive",
            None,
        ),
        # A body with ``detail`` alone, and junk.
        ({"detail": "No active subscription was found"}, None, None),
        ({"expired_at": "not a date", "code": 7}, None, None),
        ({"expired_at": "2026-13-45T00:00:00Z"}, None, None),
        ([], None, None),
    ],
)
async def test_a_402_says_when_the_subscription_ended(
    hass, aioclient_mock, body, code, expired_at
) -> None:
    aioclient_mock.patch(f"{BASE}/widgets/laundry", status=402, json=body)
    with pytest.raises(AiviSubscriptionError) as caught:
        await _client(hass).push_widget("laundry", {})
    assert caught.value.code == code
    assert (
        caught.value.expired_at.isoformat() if caught.value.expired_at else None
    ) == expired_at
    assert str(caught.value) == "No active subscription was found"


async def test_a_402_body_that_is_not_json_is_still_a_402(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/widgets", status=402, text="Payment Required")
    with pytest.raises(AiviSubscriptionError):
        await _client(hass).list_widgets()


def _account(state: str, expired_at: str | None = None) -> dict:
    if state == "active":
        return {"subscription": {"state": state, "expires_at": None, "renews": True}}
    if state == "expired":
        return {"subscription": {"state": state, "expired_at": expired_at}}
    return {"subscription": {"state": state}}


async def test_check_access_asks_the_account(hass, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/account", json=_account("active"))
    await _client(hass).check_access()
    method, url, _data, headers = aioclient_mock.mock_calls[0][:4]
    assert (method, str(url)) == ("GET", f"{BASE}/account")
    assert headers["Authorization"] == "Token tok"


@pytest.mark.parametrize(
    ("account", "expired_at"),
    [
        (_account("expired", "2026-09-01T12:30:15Z"), "2026-09-01T12:30:15+00:00"),
        (_account("none"), None),
    ],
    ids=["expired", "never"],
)
async def test_check_access_refuses_an_inactive_account(
    hass, aioclient_mock, account: dict, expired_at: str | None
) -> None:
    aioclient_mock.get(f"{BASE}/account", json=account)
    with pytest.raises(AiviSubscriptionError) as caught:
        await _client(hass).check_access()
    assert caught.value.code == "subscription_inactive"
    when = caught.value.expired_at
    assert (when.isoformat() if when else None) == expired_at


_WHEN = datetime(2026, 9, 1, 12, 30, 15, tzinfo=UTC)


@pytest.mark.parametrize(
    ("subscription", "status"),
    [
        (
            {"state": "active", "expires_at": "2026-09-01T12:30:15Z", "renews": True},
            SubscriptionStatus(SubscriptionState.ACTIVE, expires_at=_WHEN, renews=True),
        ),
        (
            {"state": "active", "expires_at": None, "renews": False},
            SubscriptionStatus(SubscriptionState.ACTIVE, renews=False),
        ),
        (
            {"state": "expired", "expired_at": "2026-09-01T12:30:15Z"},
            SubscriptionStatus(SubscriptionState.EXPIRED, expired_at=_WHEN),
        ),
        ({"state": "none"}, SubscriptionStatus(SubscriptionState.NONE)),
        # A state this version does not know is not active.
        ({"state": "paused"}, SubscriptionStatus(SubscriptionState.NONE)),
        (
            {"state": "paused", "expired_at": "2026-09-01T12:30:15Z"},
            SubscriptionStatus(SubscriptionState.EXPIRED, expired_at=_WHEN),
        ),
    ],
    ids=[
        "active-ending",
        "active-open-ended",
        "expired",
        "none",
        "unknown",
        "unknown-ended",
    ],
)
async def test_get_subscription_reads_each_state(
    hass, aioclient_mock, subscription: dict, status: SubscriptionStatus
) -> None:
    aioclient_mock.get(f"{BASE}/account", json={"subscription": subscription})
    assert await _client(hass).get_subscription() == status
    assert status.active is (status.state is SubscriptionState.ACTIVE)
    assert (status.refusal() is None) is status.active


@pytest.mark.parametrize(
    ("answer", "error"),
    [
        ({"status": 401}, AiviAuthError),
        ({"status": 500}, AiviError),
        ({"exc": aiohttp.ClientError("boom")}, AiviError),
        ({"exc": TimeoutError()}, AiviError),
        ({"text": "not json"}, AiviError),
        ({"json": {"unexpected": True}}, AiviError),
        ({"json": ["not", "an", "object"]}, AiviError),
    ],
    ids=[
        "unknown-token",
        "5xx",
        "unreachable",
        "timeout",
        "not-json",
        "no-key",
        "list",
    ],
)
async def test_get_subscription_errors(
    hass, aioclient_mock, answer: dict, error: type[Exception]
) -> None:
    aioclient_mock.get(f"{BASE}/account", **answer)
    with pytest.raises(error):
        await _client(hass).get_subscription()


def test_a_refusal_and_its_status_agree() -> None:
    """A 402 reads as the status GET /account would give, and back."""
    ended = AiviSubscriptionError(expired_at=_WHEN)
    status = SubscriptionStatus.refused(ended)
    assert status == SubscriptionStatus(SubscriptionState.EXPIRED, expired_at=_WHEN)
    refusal = status.refusal()
    assert refusal is not None
    assert (refusal.code, refusal.expired_at) == ("subscription_inactive", _WHEN)
    assert SubscriptionStatus.refused(AiviSubscriptionError()) == SubscriptionStatus(
        SubscriptionState.NONE
    )


@pytest.mark.parametrize(
    ("answer", "error"),
    [
        ({"status": 401}, AiviAuthError),
        (
            {
                "status": 402,
                "json": {
                    "detail": "x",
                    "code": "subscription_inactive",
                    "expired_at": None,
                },
            },
            AiviSubscriptionError,
        ),
        ({"exc": aiohttp.ClientError("boom")}, AiviError),
        ({"text": "not json"}, AiviError),
        ({"json": {"unexpected": True}}, AiviError),
    ],
    ids=["unknown-token", "402", "unreachable", "not-json", "no-subscription-key"],
)
async def test_check_access_errors(
    hass, aioclient_mock, answer: dict, error: type[Exception]
) -> None:
    aioclient_mock.get(f"{BASE}/account", **answer)
    with pytest.raises(error):
        await _client(hass).check_access()


async def test_the_event_stream_reads_a_402(hass, aioclient_mock) -> None:
    aioclient_mock.get(
        f"{BASE}/events",
        status=402,
        json={
            "detail": "x",
            "code": "subscription_inactive",
            "expired_at": "2026-09-01T00:00:00+00:00",
        },
    )
    with pytest.raises(AiviSubscriptionError) as caught:
        async for _ in _client(hass).events(["widget.action.v1"]):
            pass
    assert caught.value.expired_at is not None
