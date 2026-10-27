"""Helpers the test modules share: the fake client, entries and waits."""

from __future__ import annotations

import asyncio
import itertools
import json
import uuid
from collections.abc import AsyncIterator, Callable, Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from openapi_core.testing import MockRequest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from contract.openapi import load
from custom_components.aivi.api import (
    STREAM_OPEN,
    ActivityInfo,
    AiviAuthError,
    AiviError,
    AiviNotFoundError,
    AiviSubscriptionError,
    AiviValidationError,
    StreamCursor,
    SubscriptionState,
    SubscriptionStatus,
    WidgetInfo,
)
from custom_components.aivi.const import (
    CONF_ACTIVE,
    CONF_BINDINGS,
    CONF_NAME,
    CONF_SLUG,
    CONF_TEMPLATE,
    CONF_THROTTLE,
    DEFAULT_DEBOUNCE_SECONDS,
    DOMAIN,
    SUBENTRY_ACTIVITY,
    SUBENTRY_WIDGET,
)
from custom_components.aivi.runtime import PROBE_INTERVAL, subscription_issue_id
from custom_components.aivi.sources import HistoryQuery


class FakeAiviClient:
    """An in-memory stand-in for the Aivi API."""

    def __init__(
        self,
        widgets: Iterable[WidgetInfo],
        activities: Iterable[ActivityInfo] = (),
    ) -> None:
        self._widgets = list(widgets)
        self.activities = list(activities)
        self.pushes: list[tuple[str, dict]] = []
        # The stale_after each widget push carried, in push order.
        self.stale_afters: list[int | None] = []
        self.activity_pushes: list[tuple[str, str, dict]] = []
        self.auth_ok = True
        self.reachable = True
        self.missing_slugs: set[str] = set()
        self.reject_content = False
        # Simulates an Aivi API version without these tile fields: a push
        # carrying one is rejected with a 422 locating it, as its schema would.
        self.unknown_action_fields: set[str] = set()
        self.refused_pushes = 0
        # Raised by every push while set (any exception, AiviError or not).
        self.push_error: BaseException | None = None
        # Raised by every call while set: the account is not subscribed
        # (and GET /account says how, from its expired_at).
        self.subscription: AiviSubscriptionError | None = None
        # What GET /account answers while subscribed.
        self.active = SubscriptionStatus(SubscriptionState.ACTIVE, renews=True)
        self.push_attempts = 0
        self.access_checks = 0
        self.listings = 0
        # While set, pushes wait for it: a slow Aivi API.
        self.gate: asyncio.Event | None = None
        # Event stream: `emit` queues events, `close_stream` ends the stream
        # (the server's lifetime cap), `stream_error` fails the next open,
        # `refusals` opens that many streams that only send `retry:`.
        self._events: asyncio.Queue[tuple[dict[str, Any] | None, str | None] | None]
        self._events = asyncio.Queue()
        self.stream_opens = 0
        self.stream_error: Exception | None = None
        self.refusals = 0
        self.refusal_retry = 1.0
        # The Last-Event-ID each open resumed from (None: a fresh stream).
        self.resumed_from: list[str | None] = []

    async def list_widgets(self) -> list[WidgetInfo]:
        self.listings += 1
        self._check_account()
        return list(self._widgets)

    async def list_activities(self) -> list[ActivityInfo]:
        self.listings += 1
        self._check_account()
        return list(self.activities)

    async def get_subscription(self) -> SubscriptionStatus:
        """Like ``GET /account``: answered whatever the subscription."""
        self.access_checks += 1
        # A real request yields to the loop; callers that ask at the same
        # time overlap here.
        await asyncio.sleep(0)
        if self.subscription is None:
            self._check_account()
            return self.active
        refused, self.subscription = self.subscription, None
        try:
            self._check_account()
        finally:
            self.subscription = refused
        return SubscriptionStatus.refused(refused)

    async def check_access(self) -> None:
        if (err := (await self.get_subscription()).refusal()) is not None:
            raise err

    def _check_account(self) -> None:
        if not self.reachable:
            # Shaped like the real client's: a prefixed message over the
            # transport error as the cause.
            raise AiviError("Cannot reach Aivi: unreachable") from OSError(
                "unreachable"
            )
        if not self.auth_ok:
            raise AiviAuthError
        if self.subscription is not None:
            raise self.subscription

    async def push_widget(
        self, slug: str, content: dict, stale_after: int | None = None
    ) -> None:
        await self._wait_gate()
        self._check(slug)
        for action in content.get("actions") or []:
            for name in self.unknown_action_fields & set(action):
                self.refused_pushes += 1
                raise AiviValidationError(
                    f"{name}: Extra inputs are not permitted",
                    [
                        (
                            "extra_forbidden",
                            ("body", "content", "actions", "toggle", name),
                        )
                    ],
                )
        self.pushes.append((slug, content))
        self.stale_afters.append(stale_after)

    async def push_activity(self, slug: str, state: str, content: dict) -> None:
        await self._wait_gate()
        self._check(slug)
        self.activity_pushes.append((slug, state, content))

    async def events(
        self, types: list[str], cursor: StreamCursor | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        self._check_account()
        if self.stream_error is not None:
            error, self.stream_error = self.stream_error, None
            raise error
        cursor = StreamCursor() if cursor is None else cursor
        self.stream_opens += 1
        self.resumed_from.append(cursor.last_event_id)
        yield STREAM_OPEN
        if self.refusals:
            self.refusals -= 1
            cursor.retry = self.refusal_retry
            return
        while True:
            item = await self._events.get()
            if item is None:
                return
            event, frame_id = item
            if event is not None:
                yield event
            # Like the real client: the id moves once the event is handled.
            if frame_id is not None:
                cursor.last_event_id = frame_id

    def emit(self, event: dict[str, Any], *, frame_id: str | None = None) -> None:
        """Deliver one event on the open stream, under an ``id:``."""
        self._events.put_nowait((event, frame_id))

    def position(self, frame_id: str) -> None:
        """A frame with only an ``id:`` (a fresh stream's position)."""
        self._events.put_nowait((None, frame_id))

    def close_stream(self) -> None:
        """End the open stream cleanly (the server's 15-minute cap)."""
        self._events.put_nowait(None)

    async def _wait_gate(self) -> None:
        if self.gate is not None:
            await self.gate.wait()

    def _check(self, slug: str) -> None:
        self.push_attempts += 1
        if self.push_error is not None:
            raise self.push_error
        self._check_account()
        if slug in self.missing_slugs:
            raise AiviNotFoundError
        if self.reject_content:
            raise AiviValidationError

    @property
    def last_push(self) -> tuple[str, dict] | None:
        return self.pushes[-1] if self.pushes else None


class Resolver:
    def __init__(
        self,
        states: dict[str, str] | None = None,
        attrs: dict[str, dict[str, Any]] | None = None,
        renders: dict[str, Any] | None = None,
    ) -> None:
        self._states = states or {}
        self._attrs = attrs or {}
        self._renders = renders or {}

    def state(self, entity_id: str) -> str | None:
        return self._states.get(entity_id)

    def attribute(self, entity_id: str, name: str) -> Any:
        return (self._attrs.get(entity_id) or {}).get(name)

    def attributes(self, entity_id: str) -> dict[str, Any]:
        return dict(self._attrs.get(entity_id) or {})

    def render(self, template: str) -> Any:
        return self._renders.get(template)


class RecordedResolver(Resolver):
    """A ``Resolver`` that also answers for recorded history."""

    def __init__(
        self,
        states: dict[str, str] | None = None,
        attrs: dict[str, dict[str, Any]] | None = None,
        renders: dict[str, Any] | None = None,
        history: dict[HistoryQuery, Any] | None = None,
    ) -> None:
        super().__init__(states, attrs, renders)
        self._history = history or {}

    def history(self, query: HistoryQuery) -> Any:
        return self._history.get(query)


def account_entry(
    hass: HomeAssistant, *subentries: ConfigSubentryData
) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"token": "t"},
        title="aivi",
        subentries_data=list(subentries),
    )
    entry.add_to_hass(hass)
    return entry


def widget_subentry(
    slug: str, name: str, template: str, bindings: dict
) -> ConfigSubentryData:
    return ConfigSubentryData(
        data={
            CONF_SLUG: slug,
            CONF_NAME: name,
            CONF_TEMPLATE: template,
            CONF_BINDINGS: bindings,
        },
        subentry_type=SUBENTRY_WIDGET,
        title=name,
        unique_id=None,
    )


async def advance(hass: HomeAssistant, seconds: float) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


async def advance_past_debounce(hass: HomeAssistant) -> None:
    # Let the state-change event be processed (which schedules the debounce),
    # then advance time past it so the debounced push fires.
    await hass.async_block_till_done()
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=DEFAULT_DEBOUNCE_SECONDS + 1)
    )
    await hass.async_block_till_done()


def activity_subentry(
    slug: str,
    name: str,
    template: str,
    active: str,
    bindings: dict,
    throttle: int = 0,
):
    """An activity subentry; unthrottled unless a test is about that."""
    return ConfigSubentryData(
        data={
            CONF_SLUG: slug,
            CONF_NAME: name,
            CONF_TEMPLATE: template,
            CONF_ACTIVE: active,
            CONF_BINDINGS: bindings,
            CONF_THROTTLE: throttle,
        },
        subentry_type=SUBENTRY_ACTIVITY,
        title=name,
        unique_id=None,
    )


async def washer_activity(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("binary_sensor.washer_running", "on")
    hass.states.async_set("sensor.washer_progress", "40")
    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.washer_running",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def setup_account(hass: HomeAssistant) -> MockConfigEntry:
    await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, data={"token": "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def two_widgets(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("binary_sensor.door", "off")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
        widget_subentry(
            "frontdoor", "Front door", "status", {"state": "binary_sensor.door"}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def subentry_id_of(entry: MockConfigEntry, slug: str) -> str:
    return next(
        subentry_id
        for subentry_id, subentry in entry.subentries.items()
        if subentry.data[CONF_SLUG] == slug
    )


async def until(hass: HomeAssistant, cond: Callable[[], bool], what: str) -> None:
    """Poll for a condition the background command task produces (it is
    a background task, so async_block_till_done does not wait for it)."""
    deadline = hass.loop.time() + 3
    while not cond():
        if hass.loop.time() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        await asyncio.sleep(0.01)


_IDS = itertools.count()


def press_event(action: str = "scene_movie", **data: Any) -> dict[str, Any]:
    now = dt_util.utcnow()
    return {
        "id": f"evt_{action}_{next(_IDS)}",
        "type": "widget.action.v1",
        "subject": {"kind": "widget", "slug": "porch"},
        "occurred_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=5)).isoformat(),
        "data": {"action": action, "kind": "button", **data},
    }


def tile_press(
    action: str,
    *,
    slug: str = "livingroom",
    expires_in: float = 5,
    surface: str = "widget",
    **data: Any,
) -> dict[str, Any]:
    """A press envelope: the server's UUIDv5 delivery ``id`` and the
    phone's own ``request_id``; on a Live Activity with ``surface``
    ``activity``."""
    now = dt_util.utcnow()
    n = next(_IDS)
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"press/{n}")),
        "request_id": f"act_{action}_{n}",
        "type": f"{surface}.action.v1",
        "subject": {"kind": surface, "slug": slug},
        "occurred_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=expires_in)).isoformat(),
        "data": {"action": action, **data},
    }


async def porch_light_tile(
    hass: HomeAssistant, options: dict[str, Any] | None = None
) -> MockConfigEntry:
    """An account whose one switchboard holds the porch light."""
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    bindings: dict[str, Any] = {"actions": ["light.porch"]}
    if options:
        bindings["actions__options"] = {"light.porch": options}
    entry = account_entry(
        hass, widget_subentry("livingroom", "Living room", "switchboard", bindings)
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def porch_subentry(
    actions: list[str] | None = None, **options: Any
) -> ConfigSubentryData:
    """The porch switchboard: the porch light and the movie scene, unless
    ``actions`` names other entities."""
    bindings: dict[str, Any] = {"actions": actions or ["light.porch", "scene.movie"]}
    if options:
        bindings["actions__options"] = options
    return widget_subentry("porch", "Porch", "switchboard", bindings)


async def setup_porch(
    hass: HomeAssistant, *subentries: ConfigSubentryData
) -> MockConfigEntry:
    """Set up an account with ``subentries``, the porch light and the movie
    scene in place."""
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    hass.states.async_set("scene.movie", "scening", {"friendly_name": "Movie night"})
    entry = account_entry(hass, *subentries)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def entity_id_of(
    entity_registry: er.EntityRegistry, platform: str, unique_id: str
) -> str | None:
    return entity_registry.async_get_entity_id(platform, DOMAIN, unique_id)


def stream_sensor_of(
    entity_registry: er.EntityRegistry, entry: MockConfigEntry
) -> str | None:
    return entity_id_of(
        entity_registry, "binary_sensor", f"{entry.entry_id}_event_stream"
    )


#: The words a cover's tile shows on its own.
OPEN_CLOSED = {
    "on": "Open",
    "off": "Closed",
    "turning_on": "Opening",
    "turning_off": "Closing",
}


EXPIRED = datetime(2026, 9, 1, 12, tzinfo=UTC)


LAPSED = AiviSubscriptionError(code="subscription_inactive", expired_at=EXPIRED)


def subscription_issue(
    hass: HomeAssistant, entry: MockConfigEntry
) -> ir.IssueEntry | None:
    return ir.async_get(hass).async_get_issue(
        DOMAIN, subscription_issue_id(entry.entry_id)
    )


def issue_ids(hass: HomeAssistant) -> set[str]:
    return {
        issue_id for domain, issue_id in ir.async_get(hass).issues if domain == DOMAIN
    }


async def hour_later(hass: HomeAssistant, freezer) -> None:
    """Move past the hourly subscription check."""
    freezer.tick(PROBE_INTERVAL)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


#: The vendored OpenAPI document the contract tests validate against.
OPENAPI = load()


def api_request(method: str, path: str, body: Any = None, **kw: Any) -> MockRequest:
    data = None
    if body is not None:
        # Strict JSON, as Aivi parses it: NaN and infinity are not numbers.
        data = json.dumps(body, allow_nan=False).encode()
    return MockRequest(
        OPENAPI.spec["servers"][0]["url"],
        method,
        path,
        data=data,
        headers={"Authorization": "Token t"},
        content_type="application/json",
        **kw,
    )
