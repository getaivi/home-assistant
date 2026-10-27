"""One event from the stream: routed to the entity bound to it, played
back as a service call, and ended as a record of what became of it."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any, Final

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util

from ..const import EVENT_ACTION
from ..inputs import InputRecord, Outcome, StreamHealth
from ..switchboard import kind_of, press_event_type, press_service

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

_LOGGER = logging.getLogger(__name__)

#: The type carries the schema version of ``data``; anything else on the
#: stream (an unknown type, a later version) is ignored. A press on a
#: widget, and one on a Live Activity (whose ``data`` also names the
#: card it was pressed on, ``instance_id``).
ACTION_EVENT: Final = "widget.action.v1"
ACTIVITY_ACTION_EVENT: Final = "activity.action.v1"

#: The subject kind each consumed type must name (slugs are unique only
#: per kind), which is also the kind of the binding it routes to.
_SUBJECT_KINDS: Final[dict[str, str]] = {
    ACTION_EVENT: "widget",
    ACTIVITY_ACTION_EVENT: "activity",
}
ACTION_EVENTS: Final = tuple(_SUBJECT_KINDS)

#: (kind, slug) -> action id -> the entity that action stands for.
type Routes = Mapping[tuple[str, str], Mapping[str, str]]

_DEDUPE_WINDOW: Final = 256

#: How long stopping waits for presses already received to play out. The
#: cursor is past them, so a canceled one would never be replayed; a press
#: expires a few seconds after it was made, so this bounds them all.
PLAYBACK_DRAIN_SECONDS: Final = 10.0


#: Called after a press was played back: the kind and slug pressed, the
#: entity, and a toggle's requested state (``None`` for a button).
type PressCallback = Callable[[tuple[str, str], str, bool | None], None]


@dataclass(frozen=True, slots=True)
class _Press:
    """One press on its way to a record."""

    event: dict[str, Any]
    kind: str
    slug: str
    action: str
    data: dict[str, Any]
    context: Context
    received_at: datetime
    entity_id: str | None = None

    @property
    def resource(self) -> tuple[str, str]:
        return (self.kind, self.slug)

    @property
    def value(self) -> bool | None:
        value = self.data.get("value")
        return value if isinstance(value, bool) else None

    @property
    def event_type(self) -> str:
        kind = kind_of(self.entity_id) if self.entity_id else self.data.get("kind")
        typed = press_event_type(kind, self.data.get("value"))
        return typed or str(kind or "unknown")


class Playback:
    """Plays one account's presses back into services, one service call
    at a time per entity."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        routes: Routes,
        entry_id: str | None,
        health: StreamHealth,
        drain: float = PLAYBACK_DRAIN_SECONDS,
        on_played: PressCallback | None = None,
        on_record: Callable[[InputRecord], None] | None = None,
    ) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._health = health
        self._drain = drain
        self._on_played = on_played
        self._on_record = on_record
        self.set_routes(routes)
        # Playback runs beside the stream, one service call at a time per
        # entity, so a slow device never holds up presses on other tiles.
        self.playing: set[asyncio.Task[None]] = set()
        self._entity_locks: dict[str, asyncio.Lock] = {}
        self._seen: deque[str] = deque(maxlen=_DEDUPE_WINDOW)

    @callback
    def set_routes(self, routes: Routes) -> None:
        """Replace the routing ((kind, slug) -> action id -> the entity
        that action stands for)."""
        self._routes = {key: dict(actions) for key, actions in routes.items()}

    async def async_drain(self) -> None:
        """Wait for the presses already received to play out, canceling
        those that take longer than the drain."""
        playing, self.playing = self.playing, set()
        if not playing:
            return
        _, unfinished = await asyncio.wait(playing, timeout=self._drain)
        for pending in unfinished:
            pending.cancel()
        for pending in unfinished:
            with contextlib.suppress(asyncio.CancelledError):
                await pending

    async def async_handle(self, event: dict[str, Any]) -> None:
        kind = event.get("type")
        if not isinstance(kind, str) or kind not in _SUBJECT_KINDS:
            return
        event_id = event.get("id")
        if isinstance(event_id, str):
            if event_id in self._seen:
                return
            self._seen.append(event_id)
        data = event.get("data")
        subject_kind = _SUBJECT_KINDS[kind]
        subject = _subject_slug(event.get("subject"), subject_kind)
        if not isinstance(data, dict) or subject is None:
            _LOGGER.debug("Aivi event %s names no matching subject: %s", kind, event)
            return
        action = data.get("action")
        if not isinstance(action, str):
            return
        expired = _expired(event)
        press = _Press(
            event, subject_kind, subject, action, data, Context(), dt_util.utcnow()
        )
        if expired:
            _LOGGER.debug("Aivi event %s expired before delivery", event_id)
            self._record(press, Outcome.EXPIRED)
            return
        await self._handle_action(press)

    async def _handle_action(self, press: _Press) -> None:
        """A press: onto the event bus for everyone, and played back as a
        service call when the action stands for an entity here. The bus
        event and the call share the press's context."""
        event, subject, action, data = press.event, press.slug, press.action, press.data
        self._health.update(last_event=press.received_at)
        request_id = event.get("request_id")
        fired: dict[str, Any] = {
            "subject_kind": press.kind,
            "slug": subject,
            # Slugs are unique per account only.
            "entry_id": self._entry_id,
            "action": action,
            "action_kind": data.get("kind"),
            "value": data.get("value"),
            "event_id": event.get("id"),
            # An envelope without a request_id is identified by its event id.
            "request_id": request_id
            if isinstance(request_id, str)
            else event.get("id"),
        }
        if press.kind == _SUBJECT_KINDS[ACTIVITY_ACTION_EVENT]:
            # The Live Activity card that was pressed.
            instance_id = data.get("instance_id")
            fired["instance_id"] = instance_id if isinstance(instance_id, str) else None
        self._hass.bus.async_fire(EVENT_ACTION, fired, context=press.context)
        entity_id = self._routes.get(press.resource, {}).get(action)
        if entity_id is None:
            _LOGGER.debug("Aivi action %s on %s is not bound here", action, subject)
            self._record(press, Outcome.NOT_BOUND)
            return
        press = replace(press, entity_id=entity_id)
        service = press_service(entity_id, data.get("value"))
        if service is None:
            _LOGGER.debug(
                "Aivi action %s on %s carries no state; ignored", action, subject
            )
            self._record(press, Outcome.IGNORED, "The press carries no state")
            return
        task = self._hass.async_create_background_task(
            self._play(press, entity_id, service),
            name=f"aivi press {subject}/{action}",
        )
        self.playing.add(task)
        task.add_done_callback(self.playing.discard)

    async def _play(
        self, press: _Press, entity_id: str, service: tuple[str, str]
    ) -> None:
        """One press as a service call, after the presses before it on the
        same entity."""
        domain, name = service
        action, subject = press.action, press.slug
        lock = self._entity_locks.setdefault(entity_id, asyncio.Lock())
        async with lock:
            if _expired(press.event):
                _LOGGER.debug(
                    "Aivi action %s on %s expired; not played", action, subject
                )
                self._record(press, Outcome.EXPIRED)
                return
            _LOGGER.debug("Aivi action %s -> %s.%s %s", action, domain, name, entity_id)
            try:
                await self._hass.services.async_call(
                    domain,
                    name,
                    {ATTR_ENTITY_ID: entity_id},
                    blocking=True,
                    context=press.context,
                )
            except (HomeAssistantError, vol.Invalid) as err:
                _LOGGER.warning(
                    "Aivi action %s for %s could not be played back: %s",
                    action,
                    entity_id,
                    err,
                )
                self._record(press, Outcome.FAILED, str(err) or type(err).__name__)
                return
            except Exception as err:
                _LOGGER.exception(
                    "Aivi action %s for %s failed unexpectedly", action, entity_id
                )
                self._record(press, Outcome.FAILED, str(err) or type(err).__name__)
                return
        self._record(press, Outcome.PLAYED)
        if self._on_played is not None:
            self._on_played(press.resource, entity_id, press.value)

    @callback
    def _record(
        self, press: _Press, outcome: Outcome, error: str | None = None
    ) -> None:
        if self._on_record is None:
            return
        event_id = press.event.get("id")
        request_id = press.event.get("request_id")
        details: dict[str, Any] = {"action": press.action, "value": press.value}
        if isinstance(instance_id := press.data.get("instance_id"), str):
            details["instance_id"] = instance_id
        self._on_record(
            InputRecord(
                event_type=press.event_type,
                resource_kind=press.kind,
                slug=press.slug,
                outcome=outcome,
                received_at=press.received_at,
                finished_at=dt_util.utcnow(),
                details=details,
                entity_id=press.entity_id,
                error=error,
                event_id=event_id if isinstance(event_id, str) else None,
                request_id=request_id if isinstance(request_id, str) else None,
                context=press.context,
            )
        )


def _expired(event: dict[str, Any]) -> bool:
    """Whether the event is past its ``expires_at`` now. An event with no
    readable expiry is not expired: the server always sets one."""
    expires = event.get("expires_at")
    if not isinstance(expires, str):
        return False
    expires_at = dt_util.parse_datetime(expires)
    return expires_at is not None and expires_at < dt_util.utcnow()


def _subject_slug(subject: Any, kind: str) -> str | None:
    """The slug of an event's subject (``{"kind": ..., "slug": ...}``),
    or None when it is malformed or names a different kind."""
    if not isinstance(subject, dict) or subject.get("kind") != kind:
        return None
    slug = subject.get("slug")
    return slug if isinstance(slug, str) and slug else None
