"""Per-binding push runtime.

One ``PushManager`` per binding: it subscribes to the entities the binding
references, debounces bursts, resolves content from current state and sends
it, keeping the status (last push, last error, availability) the diagnostic
sensor reads.

Template slots are followed through Home Assistant's template result
tracking rather than the state subscription, so a template reading
``now()``, a dynamic group, or whole domains re-pushes when its output
changes.

Failure handling: transient errors (network, 5xx) retry on a backoff
schedule; a rejected token asks the config entry to start reauth; a deleted
widget, rejected payload, template mismatch or exhausted activity quota is
reported (``status``, ``last_error`` and a repair issue via
``on_issue``) and waits for the next state change rather than
retrying a request that cannot succeed. Unavailability and recovery are each logged
once.

Content that does not resolve (a required field reads ``unknown``) is not
sent: the cycle is logged as waiting, with the field and what its source
reads (``engine.blocker``), and a debug line says so once per reading and
once when it resolves again. A Live Activity turned off meanwhile is still
ended, with the content it last showed: the end needs content.

How a binding's content goes out is its ``Delivery``, which the runtime
builds per kind: the sender, the send context, a size check, which state
changes are urgent, and a throttle.

A Live Activity can be throttled (``min_interval``): while its lifecycle
state stays the same, content goes out at most once per interval, and a
change held back is sent when the interval is up, so the last state
always arrives. iOS allows an activity only so many high-priority
updates, and a busy sensor would otherwise spend them in minutes. The
first push, a lifecycle change (ONGOING / IDLE) and the answer to a press
(within ``CONFIRM_WINDOW_SECONDS`` of ``expect``) are never held.

Blocks that read recorded history (a trend's sparkline, an energy node's
"today") have it fetched before each resolve (``history.HistoryCache``),
and a push cycle runs again whenever a fetched answer expires.

A lapsed subscription is the account's state, not the binding's: the
manager pauses (it keeps following state but sends nothing) and tells the
runtime through ``on_subscription_inactive``, which pauses every binding
of the account. ``async_resume`` sends the current content once, even if
it is identical to the last delivered push.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final, cast

from homeassistant.core import (
    CoreState,
    Event,
    EventStateChangedData,
    HomeAssistant,
    callback,
)
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResult,
    TrackTemplateResultInfo,
    async_call_later,
    async_track_point_in_utc_time,
    async_track_state_change_event,
    async_track_template_result,
)
from homeassistant.helpers.template import Template
from homeassistant.util import dt as dt_util

from . import engine
from .api import (
    AiviAuthError,
    AiviError,
    AiviNotFoundError,
    AiviQuotaError,
    AiviSubscriptionError,
    AiviTemplateMismatchError,
    AiviValidationError,
    WireRequest,
)
from .const import DEFAULT_DEBOUNCE_SECONDS
from .history import HistoryCache
from .pushes import Hold, PushAttempt, PushOutcome
from .sources import DegradingResolver, HistoryQuery
from .templates import TemplateDef

if TYPE_CHECKING:
    from .wire import BindingStatusRow, WaitingRow

_LOGGER = logging.getLogger(__name__)

# Transient failures retry on this schedule (seconds); the last delay repeats.
RETRY_BACKOFF: tuple[float, ...] = (30, 60, 120, 300)

# Ceiling on the trailing debounce, measured from the first event of a burst:
# without it a source changing faster than the debounce never pushes.
MAX_DEBOUNCE_SECONDS: Final = 15.0

type PermanentErrorKind = str  # the repair issue: "widget_missing", ...


class PushStatus(StrEnum):
    """Where a binding's pushing stands; the diagnostic status sensor's
    state."""

    OK = "ok"
    RETRYING = "retrying"
    AUTH_FAILED = "auth_failed"
    NOT_FOUND = "not_found"
    REJECTED = "rejected"
    TOO_LARGE = "too_large"
    TEMPLATE_ERROR = "template_error"
    TEMPLATE_MISMATCH = "template_mismatch"
    # Paused with the account: nothing is sent until it is renewed.
    NO_SUBSCRIPTION = "no_subscription"
    QUOTA_EXCEEDED = "quota_exceeded"
    ERROR = "error"
    # Nothing sent: a required field has no value (``PushManager.waiting``).
    # Not a failure: it goes out once the field reads something.
    WAITING = "waiting"


# Told each request a send makes, just before it is made: what the push
# log shows as sent.
type Sent = Callable[[WireRequest], None]

type Sender = Callable[[dict[str, Any], Sent], Awaitable[None]]

# Anything outside the resolved content that changes what a send does, so
# equality suppression sees it. An activity's ONGOING/IDLE lifecycle is
# resolved inside the sender; without this the push that ends it would be
# suppressed as identical content.
type SendContext = Callable[[], object]

# Why content must not be sent (Aivi would reject its size), or ``None``.
type SizeCheck = Callable[[dict[str, Any]], str | None]

# Whether a state change must bypass the debounce: a switchboard toggle's
# new state is the answer the phone waits up to 15 s for.
type UrgentPredicate = Callable[[Event[EventStateChangedData]], bool]


@dataclass(frozen=True, slots=True, kw_only=True)
class Delivery:
    """How one binding's content goes out."""

    send: Sender
    #: The request a send of this content would make now: what the push
    #: log shows for a cycle that sends nothing (unchanged, held).
    request: Callable[[dict[str, Any]], WireRequest]
    #: The repair issue raised when Aivi no longer has the slug.
    missing_kind: PermanentErrorKind
    context: SendContext | None = None
    oversize: SizeCheck | None = None
    urgent: UrgentPredicate | None = None
    #: The least seconds between two pushes with the same send context.
    min_interval: float = 0
    #: Entities followed beyond the ones the bindings read.
    follows: frozenset[str] = frozenset()
    #: Whether a send now ends what the binding shows (an activity turned
    #: off). The end needs content, so while the current content does not
    #: resolve, the last delivered content goes out to end it.
    ends: Callable[[], bool] | None = None


#: How soon an urgent change is pushed. Short, but long enough to fold the
#: burst a scene or a light group sends into one push.
URGENT_DELAY_SECONDS: Final = 0.5

#: How long a pending confirmation (``expect``) stays armed: the phone
#: waits 15 s for a toggle's answer.
CONFIRM_WINDOW_SECONDS: Final = 15.0


#: No push delivered yet (``PushManager._delivered_context``).
_UNSENT = object()


def content_digest(content: dict[str, Any], context: object) -> str:
    """A digest of exactly what a send would deliver: canonical JSON of
    the content, plus the send context outside it."""
    canonical = json.dumps(
        [content, repr(context)], sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def resolve_content(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> dict[str, Any] | None:
    """The content a binding resolves to now, as the push path resolves it,
    or ``None`` when it does not resolve."""
    try:
        return engine.resolve(template, bindings, DegradingResolver(hass))
    except Exception:  # noqa: BLE001 (a user's template can raise anything)
        return None


class PushManager:
    """Owns one binding's subscription and push loop (widget or activity)."""

    def __init__(
        self,
        hass: HomeAssistant,
        delivery: Delivery,
        *,
        slug: str,
        template: TemplateDef,
        bindings: dict[str, Any],
        on_status: Callable[[], None],
        on_issue: Callable[[PermanentErrorKind], None],
        on_auth_failed: Callable[[], None],
        on_subscription_inactive: Callable[[AiviSubscriptionError], None],
        on_record: Callable[[PushAttempt], None] | None = None,
        previous: PushManager | None = None,
        paused: bool = False,
    ) -> None:
        """``previous`` ran the same widget or activity: its last delivery
        carries over. ``on_record`` gets every cycle that reached a
        decision (delivered, unchanged, retrying, failed) for the log."""
        self._hass = hass
        self._delivery = delivery
        self._slug = slug
        self._template = template
        self._bindings = bindings
        self._on_record = on_record
        # The cycle in progress: the request it made or would make (what
        # a record shows) and when its send started (for the duration).
        self._cycle_request: WireRequest | None = None
        self._cycle_started: float | None = None
        # Loop-time deadline of a pending urgent change; later non-urgent
        # events in the burst never push it back.
        self._urgent_by: float | None = None
        # See ``expect``: (answered, loop-time deadline).
        self._expected: tuple[Callable[[], bool], float] | None = None
        # Loop-time end of the window a press waits for its answer in:
        # the throttle holds nothing back until then.
        self._pressed_until: float | None = None
        self._on_status = on_status
        self._on_issue = on_issue
        self._on_auth_failed = on_auth_failed
        self._on_subscription_inactive = on_subscription_inactive
        self._paused = paused
        self._unsub_state: Callable[[], None] | None = None
        self._template_tracker: TrackTemplateResultInfo | None = None
        self._cancel_debounce: Callable[[], None] | None = None
        self._burst_started: float | None = None
        # Digest of the last delivered (content, send context), to suppress
        # identical pushes: every PATCH costs a push to every subscribed
        # device. Only a delivered push sets it, so a failure never masks
        # the retry; in memory only, so the first push after a restart
        # always goes out. A replacement manager for the same widget starts
        # from its predecessor's.
        self.last_sent = previous.last_sent if previous is not None else None
        # The last delivered content and its send context, to end an
        # activity whose content no longer resolves. In memory only: after
        # a restart there is none, and such an activity stays until its
        # content resolves again.
        self.last_delivered: tuple[dict[str, Any], object] | None = (
            previous.last_delivered if previous is not None else None
        )
        self._cancel_retry: Callable[[], None] | None = None
        self._push_task: asyncio.Task[None] | None = None
        # A cycle was asked for while one was in flight: run once more after
        # it, rather than canceling a send that may be nearly done.
        self._rerun = False
        self._history = HistoryCache()
        self._history_queries: set[HistoryQuery] = set()
        self._cancel_history: Callable[[], None] | None = None
        self._template_errors: list[str] = []
        self._resolver = DegradingResolver(
            hass, self._history, errors=self._template_errors
        )
        self._cancel_throttle: Callable[[], None] | None = None
        # The send context of the last delivered push; a different one (an
        # activity starting or ending) is never held by the throttle.
        self._delivered_context: object = _UNSENT
        self._retries = 0
        self._logged_unavailable = False
        self._logged_degraded = False
        # What the content last waited on, so the debug line is written
        # once per reading.
        self._waiting_on: engine.Blocker | None = None
        #: While the throttle holds a change back: when it goes out.
        self.held: Hold | None = None

        self.last_pushed = previous.last_pushed if previous is not None else None
        self.last_error: str | None = None
        self.status: PushStatus = (
            PushStatus.NO_SUBSCRIPTION if paused else PushStatus.OK
        )

    @property
    def last_content(self) -> dict[str, Any] | None:
        """The content last delivered, while this run of Home Assistant
        has delivered any."""
        return self.last_delivered[0] if self.last_delivered is not None else None

    @property
    def waiting(self) -> engine.Blocker | None:
        """What the content waits on while its status is ``WAITING``: the
        required field with no value."""
        return self._waiting_on if self.status is PushStatus.WAITING else None

    def status_row(self) -> BindingStatusRow:
        """The binding's status as the panel shows it."""
        waiting = self.waiting
        return {
            "status": self.status.value,
            "waiting": (
                cast("WaitingRow", waiting.as_dict()) if waiting is not None else None
            ),
            "held": self.held.as_row() if self.held is not None else None,
        }

    @property
    def available(self) -> bool:
        """Whether the binding is healthy (its last cycle did not fail;
        waiting for a value is not a failure)."""
        return self.status in (PushStatus.OK, PushStatus.WAITING)

    @property
    def failing(self) -> bool:
        """Whether the binding needs attention: its pushes fail, other than
        while the account is paused, or a retry failed again (one failed
        attempt alone is often a blip that its first retry clears)."""
        if self.status is PushStatus.RETRYING:
            return self._retries > 1
        return self.status not in (
            PushStatus.OK,
            PushStatus.NO_SUBSCRIPTION,
            PushStatus.WAITING,
        )

    @callback
    def async_start(self) -> None:
        """Subscribe, and push the current content in the background."""
        try:
            entity_ids = (
                engine.dependencies(self._template, self._bindings)
                | self._delivery.follows
            )
            self._history_queries = engine.history_queries(
                self._template, self._bindings
            )
            sources = engine.template_sources(self._template, self._bindings)
        except Exception:
            # A stored binding that save-time validation did not check must
            # not stop the whole account from starting.
            _LOGGER.exception("Aivi binding for %s is malformed", self._slug)
            self._fail(PushStatus.ERROR, "The binding is malformed; save it again")
            return
        if entity_ids:
            self._unsub_state = async_track_state_change_event(
                self._hass, list(entity_ids), self._handle_state_event
            )
        if sources:
            self._template_tracker = async_track_template_result(
                self._hass,
                [
                    TrackTemplate(Template(source, self._hass), None)
                    for source in sources
                ],
                self._handle_template_result,
                # The push cycle reports template errors itself.
                log_fn=lambda _level, message: _LOGGER.debug(
                    "Aivi template for %s: %s", self._slug, message
                ),
            )
        self._start_push()

    @callback
    def async_stop(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        if self._template_tracker:
            self._template_tracker.async_remove()
            self._template_tracker = None
        self._cancel_pending()
        if self._push_task and not self._push_task.done():
            self._push_task.cancel()
        self._push_task = None

    @callback
    def _cancel_pending(self) -> None:
        """Cancel every scheduled call: debounce, retry, throttle and the
        history refresh."""
        if self._cancel_debounce:
            self._cancel_debounce()
            self._cancel_debounce = None
        if self._cancel_retry:
            self._cancel_retry()
            self._cancel_retry = None
        if self._cancel_throttle:
            self._cancel_throttle()
            self._cancel_throttle = None
        if self._cancel_history:
            self._cancel_history()
            self._cancel_history = None

    @property
    def paused(self) -> bool:
        return self._paused

    @callback
    def async_pause(self) -> None:
        """Stop sending (the account's subscription lapsed). State is still
        followed; nothing scheduled goes out."""
        if self._paused:
            return
        self._paused = True
        self._expected = None
        self._pressed_until = None
        self._cancel_pending()
        self._burst_started = None
        self._urgent_by = None
        self._retries = 0
        self.last_error = None
        self.status = PushStatus.NO_SUBSCRIPTION
        self._on_status()

    @callback
    def async_resume(self) -> None:
        """Send again, starting with the current content even if the phone
        was last sent the same: it may have missed changes meanwhile."""
        if not self._paused:
            return
        self._paused = False
        self.last_sent = None
        self.status = PushStatus.OK
        self._on_status()
        self._start_push()

    @callback
    def _handle_state_event(self, event: Event[EventStateChangedData]) -> None:
        urgent = self._delivery.urgent
        self._schedule(urgent=urgent is not None and urgent(event))

    @callback
    def _handle_template_result(
        self,
        _event: Event[EventStateChangedData] | None,
        _updates: list[TrackTemplateResult],
    ) -> None:
        self._schedule(urgent=False)

    @callback
    def _schedule(self, *, urgent: bool) -> None:
        """Trailing debounce, capped at MAX_DEBOUNCE_SECONDS from the burst's
        first event so a chatty source (a power meter, ``sensor.time``)
        still pushes every ~15 s; urgent changes shorten the delay."""
        now = self._hass.loop.time()
        if self._burst_started is None:
            self._burst_started = now
        elapsed = now - self._burst_started
        if self._cancel_debounce:
            self._cancel_debounce()
            self._cancel_debounce = None
        if elapsed >= MAX_DEBOUNCE_SECONDS:
            self._debounced_push(None)
            return
        if urgent:
            self._pull_in(now + URGENT_DELAY_SECONDS)
        delay = min(DEFAULT_DEBOUNCE_SECONDS, MAX_DEBOUNCE_SECONDS - elapsed)
        if self._urgent_by is not None:
            delay = max(min(delay, self._urgent_by - now), 0.0)
        self._cancel_debounce = async_call_later(
            self._hass, delay, self._debounced_push
        )

    @callback
    def _pull_in(self, by: float) -> float:
        """Push no later than loop time ``by``; a later, ordinary change in
        the same burst never pushes it back. Returns the deadline now in
        effect."""
        if self._urgent_by is not None:
            by = min(self._urgent_by, by)
        self._urgent_by = by
        return by

    @callback
    def _debounced_push(self, _now: datetime | None) -> None:
        self._cancel_debounce = None
        self._burst_started = None
        self._urgent_by = None
        self._start_push()

    @callback
    def expect(self, answered: Callable[[], bool]) -> None:
        """A press is waiting for its answer; ``answered`` says it arrived.

        Covers the press whose entity was already in the requested state:
        nothing changes, so suppression would drop the answer. The next
        push cycle sends even identical content, but only while ``answered``
        holds (a button press passes one that always holds). The cycle runs
        after the urgent delay; an already-queued push is pulled in rather
        than joined by a second one."""
        now = self._hass.loop.time()
        self._expected = (answered, now + CONFIRM_WINDOW_SECONDS)
        self._pressed_until = now + CONFIRM_WINDOW_SECONDS
        by = self._pull_in(now + URGENT_DELAY_SECONDS)
        if self._cancel_debounce is not None:
            self._cancel_debounce()
        self._cancel_debounce = async_call_later(
            self._hass, max(by - now, 0.0), self._debounced_push
        )

    def _answer_due(self) -> bool:
        """Whether a pending ``expect`` requires this cycle to send regardless;
        consumes it either way (a later state change pushes on its own)."""
        expected, self._expected = self._expected, None
        if expected is None:
            return False
        answered, deadline = expected
        return self._hass.loop.time() <= deadline and answered()

    @callback
    def async_refresh(self) -> None:
        """Evaluate the content now; it is sent only if it (or its send
        context) changed since the last delivered push."""
        self._start_push()

    @callback
    def _start_push(self) -> None:
        if self._paused:
            return
        # Fresh content supersedes any scheduled retry.
        if self._cancel_retry:
            self._cancel_retry()
            self._cancel_retry = None
        if self._push_task and not self._push_task.done():
            self._rerun = True
            return
        self._push_task = self._hass.async_create_task(
            self._async_push_cycles(), f"aivi push {self._slug}"
        )

    async def _async_push_cycles(self) -> None:
        while True:
            self._rerun = False
            await self._async_push()
            if not self._rerun:
                return
            if self._cancel_retry:
                self._cancel_retry()
                self._cancel_retry = None

    @callback
    def _schedule_retry(self) -> None:
        delay = RETRY_BACKOFF[min(self._retries, len(RETRY_BACKOFF) - 1)]
        self._retries += 1
        if self._cancel_retry:
            self._cancel_retry()
        self._cancel_retry = async_call_later(self._hass, delay, self._retry)

    @callback
    def _retry(self, _now: datetime) -> None:
        self._cancel_retry = None
        self._start_push()

    async def _async_push(self) -> None:
        try:
            await self._async_push_once()
        except Exception:
            _LOGGER.exception("Aivi push for %s: unexpected error", self._slug)
            self._fail(PushStatus.ERROR, "Unexpected error; see the log")

    async def _async_push_once(self) -> None:
        """Resolve the current content and deliver it.

        Template errors degrade per field: an unresolved optional field is
        omitted and the push proceeds (one warning, binding not marked
        failed); an unresolved required field skips the push until the next
        state change (logged as waiting), and a template error there is
        reported via ``_fail``. An activity that has just turned off is
        ended with its last delivered content when the current content does
        not resolve.
        """
        self._cycle_request = None
        self._cycle_started = None
        self.held = None
        if self._history_queries:
            await self._history.async_refresh(self._hass, self._history_queries)
            self._follow_history()
        errors = self._template_errors
        errors.clear()
        content = engine.resolve(self._template, self._bindings, self._resolver)
        delivery = self._delivery
        context = delivery.context() if delivery.context else None
        if content is None:
            content = self._ending(context)
            if content is None:
                if errors:
                    self._fail(
                        PushStatus.TEMPLATE_ERROR, f"Template error: {errors[0]}"
                    )
                else:
                    self._waiting()
                return
        else:
            self._resolved(errors)
        self._cycle_request = delivery.request(content)
        # Templates re-render identical output on every tick of their
        # inputs; skip sending what the device already has.
        sent = content_digest(content, context)
        answer_due = self._answer_due()
        if self._paused:
            return
        if self.last_sent == sent and not answer_due:
            self._suppressed()
            return
        if delivery.oversize is not None and (reason := delivery.oversize(content)):
            # Aivi would answer 422; report why here and keep what the phone
            # shows until the content fits again.
            self._fail(PushStatus.TOO_LARGE, reason)
            self._on_issue("content_too_large")
            return
        if self._held(context):
            return
        self._cycle_started = self._hass.loop.time()
        try:
            await delivery.send(content, self._sent)
        except AiviNotFoundError:
            self._fail(PushStatus.NOT_FOUND, "No longer exists in Aivi")
            self._on_issue(delivery.missing_kind)
        except AiviAuthError:
            self._fail(
                PushStatus.AUTH_FAILED,
                "The Aivi token was rejected; reauthentication required",
            )
            self._on_auth_failed()
        except AiviValidationError as err:
            self._fail(
                PushStatus.REJECTED,
                f"Aivi rejected the content: {err}"
                if str(err)
                else "Aivi rejected the content",
            )
            self._on_issue("content_rejected")
        except AiviTemplateMismatchError:
            self._fail(
                PushStatus.TEMPLATE_MISMATCH,
                "Aivi has this slug with a different template than the binding",
            )
            self._on_issue("template_mismatch")
        except AiviQuotaError:
            self._fail(
                PushStatus.QUOTA_EXCEEDED,
                "Too many ongoing Live Activities on the Aivi account",
            )
            self._on_issue("activity_quota")
        except AiviSubscriptionError as err:
            self.async_pause()
            self._record(PushOutcome.FAILED, str(err) or "No active subscription")
            self._on_subscription_inactive(err)
        except AiviError as err:
            # Scheduled first, so the status listeners see the retry count.
            self._schedule_retry()
            self._fail(PushStatus.RETRYING, str(err) or "Push failed")
        else:
            self.last_sent = sent
            self.last_delivered = (content, context)
            self._delivered_context = context
            self._succeed()

    def _sent(self, request: WireRequest) -> None:
        self._cycle_request = request

    def _ending(self, context: object) -> dict[str, Any] | None:
        """The content to end the binding's activity with while its own
        does not resolve: the last delivered, once it has just turned off
        (the last delivery went out with another send context). ``None``
        when there is nothing to end, or nothing to end it with."""
        ends = self._delivery.ends
        if self.last_delivered is None or ends is None or not ends():
            return None
        content, delivered = self.last_delivered
        return content if context != delivered else None

    @callback
    def _waiting(self) -> None:
        """Nothing resolved and no template raised: say which field the
        content waits on, in the status (unless paused) and the push log.
        No row goes in the push log before Home Assistant is running:
        while it starts, entities are still coming up, and every restart
        would leave a burst of them."""
        blocker = engine.blocker(self._template, self._bindings, self._resolver)
        if blocker is None:
            return
        changed = blocker != self._waiting_on
        if changed:
            self._waiting_on = blocker
            field = blocker.field or ", ".join(blocker.fields)
            if blocker.entity_id is not None:
                _LOGGER.debug(
                    "Aivi push for %s not sent: %s is unresolved (%s reads %r)",
                    self._slug,
                    field,
                    blocker.entity_id,
                    blocker.reading,
                )
            else:
                _LOGGER.debug(
                    "Aivi push for %s not sent: %s is unresolved", self._slug, field
                )
        notify = not self._paused and (changed or self.status is not PushStatus.WAITING)
        if notify:
            self._retries = 0
            self.last_error = None
            self.status = PushStatus.WAITING
        if self._hass.state is CoreState.running:
            self._record(PushOutcome.WAITING, waiting=blocker)
        if notify:
            self._on_status()

    @callback
    def _resolved(self, errors: list[str]) -> None:
        """The content resolved: say once that an optional field's
        template fails (or renders again), and that a field waited on
        resolves again."""
        if errors:
            if not self._logged_degraded:
                _LOGGER.warning(
                    "Aivi push for %s: an optional field's template failed and"
                    " the field was omitted: %s",
                    self._slug,
                    errors[0],
                )
                self._logged_degraded = True
        elif self._logged_degraded:
            _LOGGER.info(
                "Aivi push for %s: all field templates render again", self._slug
            )
            self._logged_degraded = False
        if self._waiting_on is not None:
            _LOGGER.debug(
                "Aivi push for %s: %s resolves again",
                self._slug,
                self._waiting_on.field or ", ".join(self._waiting_on.fields),
            )
            self._waiting_on = None

    @callback
    def _held(self, context: object) -> bool:
        """Whether the throttle holds this push back; if so, a push is
        scheduled for when the interval since the last delivery is up."""
        min_interval = self._delivery.min_interval
        pressed = (
            self._pressed_until is not None
            and self._hass.loop.time() <= self._pressed_until
        )
        if (
            not min_interval
            or pressed
            or self.last_sent is None
            or self.last_pushed is None
            or context != self._delivered_context
        ):
            return False
        wait = (
            self.last_pushed + timedelta(seconds=min_interval) - dt_util.utcnow()
        ).total_seconds()
        if wait <= 0:
            return False
        if self._cancel_throttle is None:
            self._cancel_throttle = async_call_later(
                self._hass, wait, self._throttle_elapsed
            )
        self.held = Hold(
            until=self.last_pushed + timedelta(seconds=min_interval),
            interval=min_interval,
        )
        self._record(PushOutcome.HELD, held=self.held)
        # What waited resolves, but is not sent yet: the status says so
        # here, where no send outcome does.
        if self.status is PushStatus.WAITING:
            self.status = PushStatus.OK
            self._on_status()
        return True

    @callback
    def _throttle_elapsed(self, _now: datetime) -> None:
        self._cancel_throttle = None
        self._start_push()

    @callback
    def _follow_history(self) -> None:
        """Run a push cycle when the first fetched history answer expires
        (a trend's next bucket, an energy day's end)."""
        if self._cancel_history:
            self._cancel_history()
            self._cancel_history = None
        if (expiry := self._history.next_expiry()) is not None:
            self._cancel_history = async_track_point_in_utc_time(
                self._hass, self._history_expired, expiry
            )

    @callback
    def _history_expired(self, _now: datetime) -> None:
        self._cancel_history = None
        self._start_push()

    @callback
    def _suppressed(self) -> None:
        """Nothing new to send: the binding is healthy, but ``last_pushed``
        stays since nothing was sent."""
        if self.last_error is not None or self.status is not PushStatus.OK:
            self.last_error = None
            self.status = PushStatus.OK
            self._on_status()
        self._retries = 0
        self._record(PushOutcome.UNCHANGED)

    @callback
    def _succeed(self) -> None:
        self.last_pushed = dt_util.utcnow()
        self.last_error = None
        self.status = PushStatus.OK
        self._retries = 0
        if self._logged_unavailable:
            _LOGGER.info("Aivi push for %s is working again", self._slug)
            self._logged_unavailable = False
        self._record(PushOutcome.DELIVERED)
        self._on_status()

    @callback
    def _fail(self, status: PushStatus, message: str) -> None:
        if not self._logged_unavailable:
            _LOGGER.warning("Aivi push for %s failed: %s", self._slug, message)
            self._logged_unavailable = True
        else:
            _LOGGER.debug("Aivi push for %s failed again: %s", self._slug, message)
        self.last_error = message
        self.status = status
        self._record(
            PushOutcome.RETRYING
            if status is PushStatus.RETRYING
            else PushOutcome.FAILED,
            message,
        )
        self._on_status()

    @callback
    def _record(
        self,
        outcome: PushOutcome,
        error: str | None = None,
        *,
        waiting: engine.Blocker | None = None,
        held: Hold | None = None,
    ) -> None:
        """Hand the cycle's outcome to the log, with the request it made
        (or would make) and how long the send took (when one was made)."""
        if self._on_record is None:
            return
        started, self._cycle_started = self._cycle_started, None
        self._on_record(
            PushAttempt(
                outcome=outcome,
                status=self.status.value,
                error=error,
                duration_ms=(
                    round((self._hass.loop.time() - started) * 1000)
                    if started is not None
                    else None
                ),
                request=self._cycle_request,
                waiting=waiting.as_dict() if waiting is not None else None,
                held=held,
            )
        )
