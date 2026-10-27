"""Aivi public API client.

The rest of the integration depends on the ``AiviClient`` Protocol, never on
aiohttp. Production wires ``AiohttpAiviClient``; tests inject an in-memory
fake through the client-factory seam (see ``get_client``).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import quote

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .const import CONF_BASE_URL, CONF_TOKEN, DATA_CLIENT_FACTORY, DEFAULT_BASE_URL

if TYPE_CHECKING:
    from .runtime import AiviConfigEntry

_TIMEOUT = aiohttp.ClientTimeout(total=15)

#: The largest page the listing endpoints serve.
PAGE_LIMIT = 50
#: A listing longer than this many pages is a server bug, not an account.
MAX_PAGES = 100

# The event stream is held open indefinitely (the server closes it after
# 15 minutes and the caller reconnects); only a stalled socket ends it.
# The server pings every 20 s, so 45 s of silence (two missed pings plus
# margin) is a dead connection, not a quiet one.
STREAM_READ_TIMEOUT = 45
_STREAM_TIMEOUT = aiohttp.ClientTimeout(
    total=None, sock_connect=15, sock_read=STREAM_READ_TIMEOUT
)

#: The marker ``AiviClient.events`` yields once the stream is open, before
#: any event: lets the consumer know the connection is healthy (and reset
#: its backoff) without waiting for a press to arrive.
STREAM_OPEN: dict[str, Any] = {"type": "_open"}


@dataclass(slots=True)
class StreamCursor:
    """Where the account's event stream is, carried across reconnects.

    ``AiviClient.events`` updates it as frames arrive and sends it back
    when it connects: ``last_event_id`` is the server's last ``id:``
    (a fresh stream's starting position, then one per event), sent as
    ``Last-Event-ID`` so the server replays what was published while the
    client was away; ``retry`` is the server's ``retry:`` in seconds, the
    shortest wait it asks for before the next connection.
    """

    last_event_id: str | None = None
    retry: float | None = None


@dataclass(frozen=True, slots=True)
class WidgetInfo:
    """One widget as the public read endpoint reports it."""

    slug: str
    name: str
    template: str


@dataclass(frozen=True, slots=True)
class ActivityInfo:
    """One Live Activity as the public read endpoint reports it."""

    slug: str
    name: str
    template: str


class SubscriptionState(StrEnum):
    """The account's subscription, as ``GET /account`` names it."""

    ACTIVE = "active"
    EXPIRED = "expired"
    # The account never had one.
    NONE = "none"


@dataclass(frozen=True, slots=True)
class SubscriptionStatus:
    """The account's subscription. While active: ``expires_at``, when the
    paid period ends (``None``: it does not end), and whether it
    ``renews`` then. While expired: ``expired_at``, when it ended."""

    state: SubscriptionState
    expires_at: datetime | None = None
    renews: bool | None = None
    expired_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.state is SubscriptionState.ACTIVE

    @classmethod
    def refused(cls, err: AiviSubscriptionError) -> SubscriptionStatus:
        """What a 402 says of the subscription: expired, or never had one
        when it gives no end date."""
        if err.expired_at is None:
            return cls(SubscriptionState.NONE)
        return cls(SubscriptionState.EXPIRED, expired_at=err.expired_at)

    def refusal(self) -> AiviSubscriptionError | None:
        """The error every other route answers with for this status, or
        ``None`` while active."""
        if self.active:
            return None
        return AiviSubscriptionError(
            code="subscription_inactive", expired_at=self.expired_at
        )


class AiviError(Exception):
    """Base for all client errors."""


class AiviAuthError(AiviError):
    """The token was rejected (HTTP 401)."""


class AiviNotFoundError(AiviError):
    """The widget no longer exists (HTTP 404)."""


class AiviTemplateMismatchError(AiviError):
    """The content's template is not the one the widget or activity was
    created with (HTTP 400)."""


class AiviSubscriptionError(AiviError):
    """The token is valid but the account has no active subscription
    (HTTP 402). ``expired_at`` is when the last subscription ended, or
    ``None`` when the account never had one (or the server did not say)."""

    def __init__(
        self,
        message: str = "No active subscription was found",
        *,
        code: str | None = None,
        expired_at: datetime | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.expired_at = expired_at


class AiviQuotaError(AiviError):
    """Starting the Live Activity would exceed the account's quota of
    ongoing activities (HTTP 422 ``Too many ongoing activities``)."""


class AiviValidationError(AiviError):
    """The pushed content was rejected (HTTP 422). ``errors`` are a schema
    refusal's errors as (type, the names in its ``loc``), so a caller can
    tell a field Aivi does not recognize from a value it rejects."""

    def __init__(
        self,
        message: str = "",
        errors: Iterable[tuple[str, tuple[str, ...]]] = (),
    ) -> None:
        super().__init__(message)
        self.errors: tuple[tuple[str, tuple[str, ...]], ...] = tuple(errors)

    def unknown_field(self, name: str) -> bool:
        """Whether Aivi rejected a field called ``name`` as one it does not
        recognize (``extra_forbidden`` located at the field itself, not at a
        value inside it)."""
        return any(
            kind == "extra_forbidden" and loc[-1:] == (name,)
            for kind, loc in self.errors
        )


class AiviClient(Protocol):
    """What the integration needs from Aivi. The only seam to the network."""

    async def list_widgets(self) -> list[WidgetInfo]:
        """The token's widgets. A success also proves the token is valid."""
        ...

    async def list_activities(self) -> list[ActivityInfo]:
        """The token's Live Activities (defined in the Aivi app)."""
        ...

    async def get_subscription(self) -> SubscriptionStatus:
        """The account's subscription (``GET /account``, which answers
        whatever the subscription). A success also proves the token is
        valid."""
        ...

    async def check_access(self) -> None:
        """Raise unless the token works and the account is subscribed."""
        ...

    async def push_widget(
        self, slug: str, content: dict[str, Any], stale_after: int | None = None
    ) -> None:
        """Replace a widget's content; ``stale_after`` as in ``widget_body``."""
        ...

    async def push_activity(
        self, slug: str, state: str, content: dict[str, Any]
    ) -> None:
        """Update a Live Activity's content and lifecycle state
        ("ONGOING" starts/keeps it live, "IDLE" ends it)."""
        ...

    def events(
        self, types: list[str], cursor: StreamCursor | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """The account's event stream (``GET /events``): yields
        ``STREAM_OPEN`` once connected, then one dict per event, and
        returns when the server closes the stream. Resumes from
        ``cursor`` and keeps it current: an event's id is recorded only
        once the consumer asks for the next one, so an event whose
        handling was cut short is replayed. Errors raise the usual
        ``AiviError`` family; reconnecting is the caller's job."""
        ...


class AiohttpAiviClient:
    """The real client, over Home Assistant's shared aiohttp session."""

    def __init__(
        self, session: aiohttp.ClientSession, base_url: str, token: str
    ) -> None:
        self._session = session
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Token {token}"}

    async def list_widgets(self) -> list[WidgetInfo]:
        return [WidgetInfo(*item) for item in await self._list_all("/widgets")]

    async def list_activities(self) -> list[ActivityInfo]:
        return [ActivityInfo(*item) for item in await self._list_all("/activities")]

    async def _list_all(self, path: str) -> list[tuple[str, str, str]]:
        """Every item of a paginated listing as (slug, name, template),
        following ``next_cursor`` until it is null."""
        items: list[tuple[str, str, str]] = []
        seen: set[str] = set()
        params: dict[str, str | int] = {"limit": PAGE_LIMIT}
        while True:
            items_page, next_cursor = _page(await self._get(path, params))
            items.extend(items_page)
            if next_cursor is None:
                return items
            if next_cursor in seen or len(seen) >= MAX_PAGES:
                raise AiviError(f"Aivi kept paging {path}")
            seen.add(next_cursor)
            params = {"limit": PAGE_LIMIT, "cursor": next_cursor}

    async def _get(self, path: str, params: dict[str, str | int]) -> Any:
        try:
            async with self._session.get(
                f"{self._base}{path}",
                headers=self._headers,
                params=params,
                timeout=_TIMEOUT,
            ) as resp:
                await _check(resp)
                return await resp.json()
        except (TimeoutError, aiohttp.ClientError) as err:
            raise AiviError(f"Cannot reach Aivi: {err}") from err

    async def get_subscription(self) -> SubscriptionStatus:
        try:
            async with self._session.get(
                f"{self._base}/account", headers=self._headers, timeout=_TIMEOUT
            ) as resp:
                await _check(resp)
                body = await resp.json(content_type=None)
        except (TimeoutError, aiohttp.ClientError, ValueError) as err:
            raise AiviError(f"Cannot reach Aivi: {err}") from err
        return _subscription(body)

    async def check_access(self) -> None:
        if (err := (await self.get_subscription()).refusal()) is not None:
            raise err

    async def push_widget(
        self, slug: str, content: dict[str, Any], stale_after: int | None = None
    ) -> None:
        await self._patch(widget_request(slug, content, stale_after))

    async def push_activity(
        self, slug: str, state: str, content: dict[str, Any]
    ) -> None:
        await self._patch(activity_request(slug, state, content))

    async def _patch(self, request: WireRequest) -> None:
        try:
            async with self._session.patch(
                f"{self._base}{request.path}",
                headers=self._headers,
                json=request.body,
                timeout=_TIMEOUT,
            ) as resp:
                if resp.status == 422:
                    reason = await resp.text()
                    detail = _detail(reason)
                    if detail == _QUOTA_DETAIL:
                        raise AiviQuotaError(detail)
                    raise AiviValidationError(detail, _errors(reason))
                await _check(resp)
        except (TimeoutError, aiohttp.ClientError) as err:
            raise AiviError(f"Cannot reach Aivi: {err}") from err

    async def events(
        self, types: list[str], cursor: StreamCursor | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Server-sent events. ``: ping`` comments are the heartbeat; a
        blank line ends a frame, whose ``data:`` is one JSON event and
        whose ``id:`` moves the cursor. A ``retry:`` sets the shortest
        reconnect delay. A frame with no data (a fresh stream's starting
        position) only moves the cursor. The response is closed when the
        consumer stops iterating, however it stops."""
        cursor = StreamCursor() if cursor is None else cursor
        params = [("types", kind) for kind in types]
        headers = {**self._headers, "Accept": "text/event-stream"}
        if cursor.last_event_id is not None:
            headers["Last-Event-ID"] = cursor.last_event_id
        try:
            resp = await self._session.get(
                f"{self._base}/events",
                headers=headers,
                params=params,
                timeout=_STREAM_TIMEOUT,
            )
        except (TimeoutError, aiohttp.ClientError) as err:
            raise AiviError(f"Cannot reach Aivi: {err}") from err
        try:
            await _check(resp)
            yield STREAM_OPEN
            data: list[str] = []
            frame_id: str | None = None
            async for raw in resp.content:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if not line:
                    if data:
                        event = _decode(data)
                        data = []
                        if event is not None:
                            # The cursor moves only after the consumer
                            # handled the event, so a cut-short one replays.
                            yield event
                    if frame_id is not None:
                        cursor.last_event_id, frame_id = frame_id, None
                    continue
                if line.startswith(":"):
                    continue
                field, _, value = line.partition(":")
                value = value.removeprefix(" ")
                if field == "data":
                    data.append(value)
                elif field == "id" and "\0" not in value:
                    frame_id = value
                elif field == "retry" and value.isdigit():
                    cursor.retry = int(value) / 1000
        except (TimeoutError, aiohttp.ClientError) as err:
            raise AiviError(f"Event stream dropped: {err}") from err
        finally:
            resp.close()


@dataclass(frozen=True, slots=True)
class WireRequest:
    """A push as it goes over the wire: the method, the path under the
    base URL and the JSON body. The token travels in a header and is
    never part of it."""

    method: str
    path: str
    body: dict[str, Any]


def widget_request(
    slug: str, content: dict[str, Any], stale_after: int | None = None
) -> WireRequest:
    """The request that replaces a widget's content."""
    return WireRequest(
        "PATCH", f"/widgets/{quote(slug, safe='')}", widget_body(content, stale_after)
    )


def activity_request(slug: str, state: str, content: dict[str, Any]) -> WireRequest:
    """The request that updates a Live Activity."""
    return WireRequest(
        "PATCH", f"/activities/{quote(slug, safe='')}", activity_body(state, content)
    )


def widget_body(
    content: dict[str, Any], stale_after: int | None = None
) -> dict[str, Any]:
    """The ``PATCH /widgets/{slug}`` body. ``stale_after`` (seconds) marks
    the content stale on the phone once it is that old: ``None`` leaves
    the widget's own setting alone (the field is omitted), ``0`` clears
    it (sent as null)."""
    body: dict[str, Any] = {"content": content}
    if stale_after is not None:
        body["stale_after"] = stale_after or None
    return body


def activity_body(state: str, content: dict[str, Any]) -> dict[str, Any]:
    """The ``PATCH /activities/{slug}`` body."""
    return {"state": state, "content": content}


def _page(body: Any) -> tuple[list[tuple[str, str, str]], str | None]:
    """One listing page's items and its ``next_cursor``."""
    try:
        items = [
            (str(item["slug"]), str(item["name"]), str(item["template"]))
            for item in body["items"]
        ]
        next_cursor = body["next_cursor"]
    except (KeyError, TypeError) as err:
        raise AiviError("Malformed response from Aivi") from err
    if next_cursor is not None and not isinstance(next_cursor, str):
        raise AiviError("Malformed response from Aivi")
    return items, next_cursor


def _decode(data: list[str]) -> dict[str, Any] | None:
    """One frame's ``data:`` lines as an event, or None if they are not a
    JSON object."""
    try:
        event = json.loads("\n".join(data))
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


def _detail(body: str) -> str:
    """The reason in a 422 body (``{"detail": "..."}`` for a plain
    refusal such as the 4 KiB cap, a list of field errors for a schema
    one), bounded for a log line."""
    try:
        detail = json.loads(body).get("detail")
    except (ValueError, AttributeError):
        return ""
    if isinstance(detail, list):
        detail = "; ".join(_error_line(item) for item in detail)
    return str(detail or "")[:300]


def _error_line(item: Any) -> str:
    """One schema error: its message, after the field it names (the last
    name in its ``loc``) when there is one."""
    if not isinstance(item, dict):
        return str(item)
    message = str(item.get("msg", item))
    loc = item.get("loc")
    names = (
        [part for part in loc if isinstance(part, str)] if isinstance(loc, list) else []
    )
    return f"{names[-1]}: {message}" if names else message


def _errors(body: str) -> list[tuple[str, tuple[str, ...]]]:
    """A schema refusal's errors as (type, the field names in its
    ``loc``): ``["body", "content", "actions", 0, "toggle",
    "state_text"]`` names ``state_text`` last."""
    try:
        detail = json.loads(body).get("detail")
    except (ValueError, AttributeError):
        return []
    if not isinstance(detail, list):
        return []
    return [
        (
            str(item.get("type", "")),
            tuple(part for part in item["loc"] if isinstance(part, str)),
        )
        for item in detail
        if isinstance(item, dict) and isinstance(item.get("loc"), list)
    ]


_QUOTA_DETAIL = "Too many ongoing activities"


async def _check(resp: aiohttp.ClientResponse) -> None:
    """Raise the typed error for a failed response, reading the body of a
    402 for when the subscription ended."""
    if resp.status == 402:
        raise _subscription_error(await resp.text())
    _raise_for_status(resp.status)


def _subscription(body: Any) -> SubscriptionStatus:
    """The ``subscription`` of a ``GET /account`` body. A state this
    version does not know is not active, as every other route would
    answer 402 then."""
    subscription = body.get("subscription") if isinstance(body, dict) else None
    if not isinstance(subscription, dict):
        raise AiviError("Aivi answered GET /account without a subscription")
    state = subscription.get("state")
    if state == SubscriptionState.ACTIVE:
        return SubscriptionStatus(
            SubscriptionState.ACTIVE,
            expires_at=_parse_time(subscription.get("expires_at")),
            renews=subscription.get("renews") is True,
        )
    expired_at = _parse_time(subscription.get("expired_at"))
    if state == SubscriptionState.EXPIRED or expired_at is not None:
        return SubscriptionStatus(SubscriptionState.EXPIRED, expired_at=expired_at)
    return SubscriptionStatus(SubscriptionState.NONE)


def _subscription_error(body: str) -> AiviSubscriptionError:
    """A 402 body as an error: ``{"detail", "code", "expired_at"}``, or
    ``{"detail"}`` alone when the Aivi API answers without the newer keys."""
    try:
        parsed = json.loads(body)
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict):
        return AiviSubscriptionError()
    detail, code, expired = (
        parsed.get("detail"),
        parsed.get("code"),
        parsed.get("expired_at"),
    )
    return AiviSubscriptionError(
        *([detail] if isinstance(detail, str) and detail else []),
        code=code if isinstance(code, str) else None,
        expired_at=_parse_time(expired),
    )


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return dt_util.parse_datetime(value)
    except ValueError:
        return None


def _raise_for_status(status: int) -> None:
    if status < 400:
        return
    if status == 400:
        raise AiviTemplateMismatchError
    if status == 401:
        raise AiviAuthError
    if status == 404:
        raise AiviNotFoundError
    if status == 422:
        raise AiviValidationError
    raise AiviError(f"Aivi API returned {status}")


def get_client(hass: HomeAssistant, base_url: str, token: str) -> AiviClient:
    """Build a client, honoring a test-injected factory if one is present.

    Config flow and setup both go through here, so a test that registers a
    fake factory before either runs gets its fake everywhere, with no patch.
    """
    factory = hass.data.get(DATA_CLIENT_FACTORY)
    if factory is not None:
        return factory(hass, base_url, token)
    return AiohttpAiviClient(async_get_clientsession(hass), base_url, token)


def client_for(hass: HomeAssistant, entry: AiviConfigEntry) -> AiviClient:
    """The client for an account entry."""
    return get_client(
        hass, entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL), entry.data[CONF_TOKEN]
    )
