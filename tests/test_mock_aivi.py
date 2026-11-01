"""The QA mock (qa/mock-aivi) holds requests to the OpenAPI
document, and the real client works against it over HTTP."""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

import aiohttp
import pytest
from werkzeug.serving import make_server
from werkzeug.test import Client

from custom_components.aivi import engine
from custom_components.aivi.api import (
    STREAM_OPEN,
    AiohttpAiviClient,
    AiviAuthError,
    AiviNotFoundError,
    AiviSubscriptionError,
    AiviValidationError,
    StreamCursor,
    SubscriptionState,
    SubscriptionStatus,
)
from custom_components.aivi.templates import (
    ACTIVITY_PROGRESS,
    ACTIVITY_REMOTE,
    PROGRESS,
    REMOTE,
    SWITCHBOARD,
)

PACKAGE = Path(__file__).resolve().parent.parent / "qa" / "mock-aivi"
AUTH = {"Authorization": "Token dev"}


def _load() -> ModuleType:
    sys.path.insert(0, str(PACKAGE))
    try:
        return importlib.import_module("mock_aivi")
    finally:
        sys.path.remove(str(PACKAGE))


MOCK = _load()


@pytest.fixture
def mock() -> Iterator[ModuleType]:
    MOCK.reset()
    MOCK.LOG.clear()
    yield MOCK
    MOCK.reset()


@pytest.fixture
def client(mock) -> Client:
    return Client(mock.app)


def _json(response: Any) -> Any:
    return json.loads(response.get_data(as_text=True))


def test_listings_page_with_opaque_cursors(client) -> None:
    slugs, cursor = [], None
    for _ in range(5):
        query = "limit=50" + (f"&cursor={cursor}" if cursor else "")
        page = _json(client.get(f"/widgets?{query}", headers=AUTH))
        slugs += [item["slug"] for item in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert slugs == [w["slug"] for w in MOCK.WIDGETS]
    bad = client.get("/activities?cursor=dzoz", headers=AUTH)  # a widget cursor
    assert bad.status_code == 422
    assert _json(bad)["detail"][0]["loc"] == ["query", "cursor"]
    assert client.get("/widgets?limit=51", headers=AUTH).status_code == 422


def test_auth_and_subscription(client) -> None:
    assert client.get("/widgets").status_code == 401
    assert (
        client.get("/widgets", headers={"Authorization": "Token invalid"}).status_code
        == 401
    )
    client.post("/admin/subscription", json={"active": False})
    for response in (
        client.get("/widgets", headers=AUTH),
        client.get("/events", headers=AUTH),
        client.patch("/widgets/laundry", headers=AUTH, json={}),
    ):
        assert response.status_code == 402
        assert _json(response) == {
            "detail": "No active subscription was found",
            "code": "subscription_inactive",
            "expired_at": None,
        }
    assert _json(client.get("/state.json"))["answered_402"] == 3
    client.post("/admin/subscription", json={"active": True})
    assert _json(client.get("/state.json"))["answered_402"] == 0


def test_account_answers_whatever_the_subscription(client) -> None:
    def subscription() -> dict:
        response = client.get("/account", headers=AUTH)
        assert response.status_code == 200
        return _json(response)["subscription"]

    assert subscription() == {"state": "active", "expires_at": None, "renews": True}
    client.post(
        "/admin/subscription",
        json={"active": False, "expired_at": "2026-09-01T00:00:00Z"},
    )
    assert subscription() == {"state": "expired", "expired_at": "2026-09-01T00:00:00Z"}
    client.post("/admin/subscription", json={"active": False})
    assert subscription() == {"state": "none"}
    state = _json(client.get("/state.json"))
    assert (state["account_checks"], state["answered_402"]) == (1, 0)
    ending = {"active": True, "expires_at": "2026-11-01T00:00:00Z", "renews": False}
    client.post("/admin/subscription", json=ending)
    assert subscription() == {
        "state": "active",
        "expires_at": "2026-11-01T00:00:00Z",
        "renews": False,
    }
    assert client.get("/account").status_code == 401


@pytest.mark.parametrize(
    ("body", "status", "detail"),
    [
        (
            {"content": {"progress": {"style": "simple", "value": 0.5}}},
            422,
            [["body", "content"]],
        ),
        (
            {
                "content": {
                    "template": "progress",
                    "progress": {"style": "simple", "value": 0.5},
                    "x": 1,
                }
            },
            422,
            [["body", "content", "x"]],
        ),
        ({"content": {"template": "status"}}, 400, "Template mismatch"),
    ],
)
def test_pushes_are_held_to_the_schema(client, body, status, detail) -> None:
    response = client.patch("/widgets/laundry", headers=AUTH, json=body)
    assert response.status_code == status
    got = _json(response)["detail"]
    if isinstance(detail, str):
        assert got == detail
    else:
        assert [error["loc"] for error in got] == detail
    assert _json(client.get("/pushes.json")) == []
    refusals = _json(client.get("/refusals.json"))
    assert refusals[0]["request"] == "PATCH /widgets/laundry"
    assert refusals[0]["status"] == status


def test_strict_json_and_unknown_slugs(client) -> None:
    nan = client.patch(
        "/widgets/livingroom",
        headers=AUTH,
        data='{"content": {"template": "gauge", "value": NaN}}',
        content_type="application/json",
    )
    assert nan.status_code == 422
    assert _json(nan)["detail"][0]["type"] == "json_invalid"
    body = {"content": {"template": "gauge", "value": 1}}
    assert client.patch("/widgets/nope", headers=AUTH, json=body).status_code == 404
    assert (
        client.patch(
            "/activities/nope",
            headers=AUTH,
            json={
                "state": "IDLE",
                "content": {
                    "template": "progress",
                    "progress": {"style": "simple", "value": 0},
                },
            },
        ).status_code
        == 404
    )


def test_widget_content_is_measured_as_stored(client) -> None:
    def actions(alt: str) -> list[dict[str, Any]]:
        return [
            {
                "id": f"a{i}",
                "label": "A",
                "icon": "power",
                "image": {"url": "https://e.com/" + "p" * 380, "alt": alt},
            }
            for i in range(8)
        ]

    body = {"content": {"template": "switchboard", "actions": actions("x")}}
    # Under 4 KiB as sent, over it as stored (every unset field as null).
    assert len(json.dumps(body["content"], separators=(",", ":"))) < 4096
    refused = client.patch("/widgets/porch", headers=AUTH, json=body)
    assert refused.status_code == 422
    assert _json(refused) == {"detail": "Content exceeds the 4 KiB limit"}


def test_what_aivi_checks_beyond_the_schema(client) -> None:
    def push(slug: str, content: dict[str, Any]) -> Any:
        return client.patch(f"/widgets/{slug}", headers=AUTH, json={"content": content})

    hour = "2026-10-01T{:02d}:00:00+02:00"
    entries = [{"start": hour.format(h), "price": 1} for h in (1, 0)]
    refused = push("electricity", {"template": "prices", "entries": entries})
    assert refused.status_code == 422
    assert _json(refused)["detail"][0]["loc"] == ["body", "content", "prices"]
    entries.reverse()
    assert (
        push("electricity", {"template": "prices", "entries": entries}).status_code
        == 200
    )
    refused = push("energy", {"template": "energy", "sources": []})
    assert _json(refused)["detail"][0]["type"] == "value_error"
    assert (
        push("energy", {"template": "energy", "home": {"power": 1}}).status_code == 200
    )


def test_a_widget_keeps_its_stale_after(client) -> None:
    content = {"template": "status", "state": {"value": "x"}}

    def push(**body: Any) -> Any:
        response = client.patch(
            "/widgets/frontdoor", headers=AUTH, json={"content": content, **body}
        )
        assert response.status_code == 200
        return _json(response)["stale_after"]

    assert push() is None
    assert push(stale_after=600) == 600
    assert push() == 600
    assert push(stale_after=None) is None
    assert _json(client.get("/pushes.json"))[2]["stale_after"] == 600


def test_the_ongoing_quota(client) -> None:
    client.post("/admin/activities", json={"max_ongoing": 1})
    content = {"template": "progress", "progress": {"style": "simple", "value": 0}}
    washer = {"state": "ONGOING", "content": content}
    assert (
        client.patch("/activities/washer", headers=AUTH, json=washer).status_code == 200
    )
    grill = {
        "state": "ONGOING",
        "content": {"template": "monitor", "right_column": {"value": {"value": "1"}}},
    }
    quota = client.patch("/activities/grill", headers=AUTH, json=grill)
    assert (quota.status_code, _json(quota)) == (
        422,
        {"detail": "Too many ongoing activities"},
    )


def test_streams_are_capped_and_refusable(client) -> None:
    streams = [client.get("/events", headers=AUTH, buffered=False) for _ in range(4)]
    assert all(stream.status_code == 200 for stream in streams)
    fifth = client.get("/events", headers=AUTH)
    assert (fifth.status_code, _json(fifth)) == (
        429,
        {"detail": "Too many event streams"},
    )
    for stream in streams:
        stream.close()
    client.post("/admin/events", json={"refuse": 1})
    refused = client.get("/events", headers=AUTH)
    assert refused.get_data() == b"retry: 1000\n\n"
    assert client.get("/events?subject=nope", headers=AUTH).status_code == 422


def test_commands_replay_on_resume(client) -> None:
    assert (
        client.post(
            "/command", json={"widget": "porch", "action": "a", "value": True}
        ).status_code
        == 202
    )
    assert (
        client.post("/command", json={"widget": "porch", "action": "b"}).status_code
        == 202
    )
    assert (
        client.post("/command", json={"widget": "nope", "action": "b"}).status_code
        == 422
    )

    def opening(headers: dict[str, str]) -> list[bytes]:
        stream = client.get("/events", headers={**AUTH, **headers}, buffered=False)
        chunks = iter(stream.response)
        frames = []
        for chunk in chunks:
            frames.append(chunk)
            if chunk.startswith(b"id:") and b"data:" not in chunk:
                break
        stream.close()
        return frames

    # An unknown cursor replays every unexpired event; a known one, those
    # after it; none, nothing.
    assert len(opening({"Last-Event-ID": "who-knows"})) == 4
    assert len(opening({"Last-Event-ID": "u:1"})) == 3
    fresh = opening({})
    assert fresh == [b"retry: 1000\n", b"id: u:2\n\n"]
    replayed = opening({"Last-Event-ID": "u:1"})[1].decode()
    event = json.loads(replayed.split("data: ", 1)[1])
    assert event["data"] == {"action": "b", "kind": "button"}
    assert event["expires_at"].endswith("Z")


@pytest.fixture
def base_url(mock, socket_enabled) -> Iterator[str]:
    server = make_server("127.0.0.1", 0, mock.app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    Client(mock.app).post("/admin/events", json={"close": True})
    server.shutdown()
    server.server_close()
    for request_thread in threading.enumerate():
        if "process_request_thread" in request_thread.name:
            request_thread.join(timeout=5)


class _Resolver:
    def __init__(self, states: dict[str, str]) -> None:
        self._states = states

    def state(self, entity_id: str) -> str | None:
        return self._states.get(entity_id)

    def attribute(self, entity_id: str, name: str) -> Any:
        return None

    def attributes(self, entity_id: str) -> dict[str, Any]:
        return {}

    def render(self, template: str) -> Any:
        return None


async def test_the_client_speaks_the_mocks_contract(base_url, mock) -> None:
    async with aiohttp.ClientSession() as session:
        client = AiohttpAiviClient(session, base_url, "dev")
        widgets = await client.list_widgets()
        assert [w.slug for w in widgets] == [w["slug"] for w in mock.WIDGETS]
        assert [a.slug for a in await client.list_activities()] == [
            "washer",
            "grill",
            "vacuum",
        ]

        resolver = _Resolver(
            {"sensor.p": "40", "light.porch": "on", "scene.movie": "scening"}
        )
        laundry = engine.resolve(PROGRESS, {"progress": "sensor.p"}, resolver)
        porch = engine.resolve(
            SWITCHBOARD, {"actions": ["light.porch", "scene.movie"]}, resolver
        )
        washer = engine.resolve(ACTIVITY_PROGRESS, {"progress": "sensor.p"}, resolver)
        assert laundry and porch and washer
        await client.push_widget("laundry", laundry)
        await client.push_widget("porch", porch)
        await client.push_activity("washer", "ONGOING", washer)
        pushed = [push["slug"] for push in mock.PUSHES]
        assert pushed == ["washer (activity) · ONGOING", "porch", "laundry"]

        with pytest.raises(AiviNotFoundError):
            await client.push_widget("nope", laundry)
        with pytest.raises(AiviValidationError):
            await client.push_widget("laundry", {"progress": {"value": 0.4}})

        cursor = StreamCursor()
        stream = client.events(["widget.action.v1"], cursor)
        assert await anext(stream) is STREAM_OPEN
        await asyncio.to_thread(
            Client(mock.app).post,
            "/command",
            json={"widget": "porch", "action": "light_porch", "value": True},
        )
        event = await asyncio.wait_for(anext(stream), 5)
        assert event["data"] == {
            "action": "light_porch",
            "value": True,
            "kind": "toggle",
        }
        await stream.aclose()
        assert cursor.retry == 1.0

        bad = AiohttpAiviClient(session, base_url, "invalid")
        with pytest.raises(AiviAuthError):
            await bad.list_widgets()
        # The mock's 402 reads as the lapse the runtime pauses on.
        lapse = {"active": False, "expired_at": "2026-09-01T00:00:00Z"}
        await asyncio.to_thread(
            Client(mock.app).post, "/admin/subscription", json=lapse
        )
        refusals = (
            client.list_activities(),
            client.check_access(),
            client.push_widget("laundry", laundry),
            anext(client.events(["widget.action.v1"])),
        )
        for call in refusals:
            with pytest.raises(AiviSubscriptionError) as err:
                await call
            assert err.value.code == "subscription_inactive"
            assert err.value.expired_at == datetime(2026, 9, 1, tzinfo=UTC)
        renew = {"active": True}
        await asyncio.to_thread(
            Client(mock.app).post, "/admin/subscription", json=renew
        )
        await client.check_access()
        ending = {"active": True, "expires_at": "2026-11-01T00:00:00Z", "renews": False}
        await asyncio.to_thread(
            Client(mock.app).post, "/admin/subscription", json=ending
        )
        assert await client.get_subscription() == SubscriptionStatus(
            SubscriptionState.ACTIVE,
            expires_at=datetime(2026, 11, 1, tzinfo=UTC),
            renews=False,
        )


def test_a_remote_is_pressed_on_the_widget_and_on_the_live_activity_card(
    client, mock
) -> None:
    """Both remotes' content passes the contract, and a press on the Live
    Activity names the card it was made on, which must be ongoing."""
    resolver = _Resolver({"sensor.charge": "78", "lock.car": "locked"})
    bindings = {"value": "sensor.charge", "actions": ["lock.car"]}
    widget = engine.resolve(REMOTE, bindings, resolver)
    activity = engine.resolve(ACTIVITY_REMOTE, bindings, resolver)
    assert widget and activity
    response = client.patch("/widgets/fountain", json={"content": widget}, headers=AUTH)
    assert response.status_code == 200, response.get_data(as_text=True)

    press = {"activity": "vacuum", "action": "lock_car", "value": True}
    assert client.post("/command", json=dict(press)).status_code == 409
    body = {"state": "ONGOING", "content": activity}
    response = client.patch("/activities/vacuum", json=body, headers=AUTH)
    assert response.status_code == 200, response.get_data(as_text=True)
    assert client.post("/command", json=dict(press)).status_code == 202
    _, event = mock.LOG[-1]
    assert event["type"] == "activity.action.v1"
    assert event["subject"] == {"kind": "activity", "slug": "vacuum"}
    assert event["data"] == {
        "action": "lock_car",
        "value": True,
        "kind": "toggle",
        "instance_id": mock.ONGOING["vacuum"],
    }


def test_an_activity_press_is_held_to_the_documented_activity_event(
    client, mock
) -> None:
    """A Live Activity press is checked against `ActivityActionEvent`
    itself: the card it names must be a UUID, and nothing undocumented
    rides along."""
    resolver = _Resolver({"sensor.charge": "78", "lock.car": "locked"})
    bindings = {"value": "sensor.charge", "actions": ["lock.car"]}
    content = engine.resolve(ACTIVITY_REMOTE, bindings, resolver)
    body = {"state": "ONGOING", "content": content}
    response = client.patch("/activities/vacuum", json=body, headers=AUTH)
    assert response.status_code == 200, response.get_data(as_text=True)

    press = {"activity": "vacuum", "action": "lock_car"}
    assert client.post("/command", json=dict(press)).status_code == 202
    _, event = mock.LOG[-1]
    assert event["data"] == {
        "action": "lock_car",
        "kind": "button",
        "instance_id": mock.ONGOING["vacuum"],
    }

    for broken in ({"instance_id": "card-1"}, {"extra": 1}):
        response = client.post("/command", json={**press, **broken})
        assert response.status_code == 422, response.get_data(as_text=True)
        assert "would break the schema" in response.get_json()["detail"]
