"""One account's event stream: opened, kept open across the server's
routine closes, and reconnected with backoff after a failure."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
from collections.abc import Awaitable, Callable
from typing import Final

from homeassistant.core import HomeAssistant, callback
from homeassistant.util import dt as dt_util

from ..api import (
    STREAM_OPEN,
    AiviAuthError,
    AiviClient,
    AiviError,
    AiviSubscriptionError,
    StreamCursor,
)
from ..inputs import InputRecord, StreamHealth
from .cursor import CursorStore
from .playback import (
    ACTION_EVENTS,
    PLAYBACK_DRAIN_SECONDS,
    Playback,
    PressCallback,
    Routes,
)

_LOGGER = logging.getLogger(__name__)

#: Reconnect delays (seconds) after a failure; the last repeats. The
#: server's ``retry:`` is the floor of each.
RECONNECT_BACKOFF: tuple[float, ...] = (1, 2, 5, 15, 30, 60)

#: Seconds a stream must stay open to count as healthy without delivering
#: an event: three of the server's 20-second heartbeats.
HEALTHY_AFTER: Final = 60.0

#: Every reconnect delay is stretched by up to this fraction, so clients
#: dropped together (a server rollout) don't all come back at once.
JITTER: Final = 0.25


class CommandStream:
    """Owns one account's event stream and its playback into services."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: AiviClient,
        *,
        routes: Routes,
        entry_id: str | None = None,
        backoff: tuple[float, ...] | None = None,
        cursor: StreamCursor | None = None,
        healthy_after: float = HEALTHY_AFTER,
        playback_drain: float = PLAYBACK_DRAIN_SECONDS,
        sleep: Callable[[float], Awaitable[object]] = asyncio.sleep,
        store: CursorStore | None = None,
        on_played: PressCallback | None = None,
        on_auth_failed: Callable[[], None] | None = None,
        on_subscription_inactive: Callable[[AiviSubscriptionError], None] | None = None,
        on_record: Callable[[InputRecord], None] | None = None,
        health: StreamHealth | None = None,
    ) -> None:
        self._hass = hass
        self._client = client
        self._backoff = RECONNECT_BACKOFF if backoff is None else backoff
        self.cursor = StreamCursor() if cursor is None else cursor
        self._healthy_after = healthy_after
        self._sleep = sleep
        self._store = store
        self._on_auth_failed = on_auth_failed
        self._on_subscription_inactive = on_subscription_inactive
        self.health = StreamHealth() if health is None else health
        self.playback = Playback(
            hass,
            routes=routes,
            entry_id=entry_id,
            health=self.health,
            drain=playback_drain,
            on_played=on_played,
            on_record=on_record,
        )
        self._task: asyncio.Task[None] | None = None
        self._retries = 0
        self._logged_down = False

    @callback
    def async_start(self) -> None:
        if self._task is None:
            self._task = self._hass.async_create_background_task(
                self._run(), name="aivi command stream"
            )

    async def async_stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await self.playback.async_drain()
        self._disconnected()
        self._persist()

    @callback
    def set_routes(self, routes: Routes) -> None:
        """Replace the routing ((kind, slug) -> action id -> entity) in
        place, without reconnecting."""
        self.playback.set_routes(routes)

    @callback
    def _persist(self) -> None:
        if self._store is not None:
            self._store.save(self.cursor)

    async def _run(self) -> None:
        loop = self._hass.loop
        while True:
            opened_at: float | None = None
            delivered = False
            ended_cleanly = False
            try:
                async for event in self._client.events(
                    list(ACTION_EVENTS), self.cursor
                ):
                    # The cursor moved past the previous frame by now.
                    self._persist()
                    if event is STREAM_OPEN:
                        opened_at = loop.time()
                        self._opened()
                        continue
                    if not delivered:
                        delivered = True
                        self._healthy()
                    try:
                        await self.playback.async_handle(event)
                    except Exception:
                        # Skipped, not retried: the cursor moves past it, so
                        # a reconnect does not replay it into the same bug.
                        _LOGGER.exception(
                            "Aivi command stream: error handling event %s",
                            event.get("id"),
                        )
            except asyncio.CancelledError:
                raise
            except AiviAuthError:
                self._fail("The Aivi token was rejected; reauthentication required")
                self._disconnected()
                self.health.update(ended=True)
                if self._on_auth_failed:
                    self._on_auth_failed()
                return
            except AiviSubscriptionError as err:
                # The account's state, logged once by the runtime; the
                # stream is started again when the subscription is renewed.
                self._disconnected()
                self.health.update(last_error=str(err))
                if self._on_subscription_inactive:
                    self._on_subscription_inactive(err)
                return
            except AiviError as err:
                self._fail(str(err) or "Event stream failed")
            except Exception:
                # A bug in the stream itself must not end it for good.
                _LOGGER.exception("Aivi command stream: unexpected error")
                self._fail("Unexpected error")
            else:
                ended_cleanly = True
            self._persist()
            floor = self.cursor.retry or 0.0
            lasted = opened_at is not None and (
                loop.time() - opened_at >= self._healthy_after
            )
            if ended_cleanly and (delivered or lasted):
                # The server's lifetime cap: reconnect after its retry,
                # still counted as connected.
                self._healthy()
                delay = floor
            else:
                self._disconnected()
                if ended_cleanly:
                    # A refusal (only ``retry:``) or a stream that ended
                    # early: back off rather than reconnect at once.
                    self._fail("The event stream ended before delivering anything")
                step = self._backoff[min(self._retries, len(self._backoff) - 1)]
                self._retries += 1
                delay = max(step, floor)
            # Jitter for a reconnect delay, not a secret.
            await self._sleep(delay * (1 + random.uniform(0, JITTER)))  # noqa: S311

    @callback
    def _opened(self) -> None:
        health = self.health
        health.update(
            connected=True,
            connected_since=health.connected_since
            if health.connected
            else dt_util.utcnow(),
            opens=health.opens + 1,
        )

    @callback
    def _disconnected(self) -> None:
        self.health.update(connected=False, connected_since=None)

    @callback
    def _healthy(self) -> None:
        """The stream delivered, or stayed up: reset the backoff."""
        self.health.update(last_error=None)
        self._retries = 0
        if self._logged_down:
            _LOGGER.info("Aivi command stream is connected again")
            self._logged_down = False

    @callback
    def _fail(self, message: str) -> None:
        self.health.update(last_error=message)
        if not self._logged_down:
            _LOGGER.warning(
                "Aivi command stream failed: %s (presses on your devices will not"
                " reach Home Assistant until it reconnects)",
                message,
            )
            self._logged_down = True
        else:
            _LOGGER.debug("Aivi command stream failed again: %s", message)
