"""The shapes the panel's WebSocket commands answer with, outside the
editor's (preview, save, defaults and starters are replayed from the
integration itself).

The panel declares the same shapes in ``frontend/src/types/accounts.ts``
and its harness fakes them in ``frontend/harness/mock-hass.js``;
``tests/test_wire.py`` records these, as sent, into
``frontend/tests/fixtures/wire.json``, and the panel's
``tests/wire.test.ts`` holds the harness to it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, TypedDict

if TYPE_CHECKING:
    from .suggest import SuggestModel, SuggestState

StreamState = Literal["connected", "reconnecting", "paused", "stopped"]


class StreamStatus(TypedDict):
    """How an account's event stream stands."""

    state: StreamState
    connected: bool
    reason: str | None
    last_error: str | None
    connected_since: str | None
    last_event: str | None
    reconnects: int


class PressRow(TypedDict):
    """One event from the phone and what became of it."""

    id: str | None
    time: str
    received_at: str
    kind: str
    slug: str
    subentry_id: str | None
    event_type: str
    entity_id: str | None
    label: str | None
    value: Any
    outcome: str
    error: str | None
    recorded: bool
    count: int


class WaitingRow(TypedDict):
    """Why a push waits: the required field with no value
    (``engine.Blocker``)."""

    field: str | None
    fields: list[str]
    entity_id: str | None
    #: The entity's raw state, "missing", "empty", or null.
    reading: str | None


class HoldRow(TypedDict):
    """When a change the throttle holds back goes out."""

    until: str
    #: The binding's least seconds between two pushes.
    interval: float


class RequestRow(TypedDict):
    """A push as it went over the wire."""

    method: str
    #: Under the API's base URL, e.g. ``/activities/washer``.
    path: str
    #: The JSON body, or its JSON cut short (a string) when the row is
    #: ``truncated``.
    body: Any


class PushRow(TypedDict):
    """One push cycle for a binding and how it ended."""

    id: str
    time: str
    kind: str
    slug: str
    subentry_id: str
    outcome: str
    status: str
    error: str | None
    duration_ms: int | None
    #: The request as sent (or, unchanged or held, as it would be sent);
    #: null when nothing resolved.
    request: RequestRow | None
    truncated: bool
    #: Outcome "waiting": why nothing was sent; else null.
    waiting: WaitingRow | None
    #: Outcome "held": when it goes out; else null.
    held: HoldRow | None
    count: int


class BindingStatusRow(TypedDict):
    """How a binding's pushing stands now."""

    #: ``PushStatus``, by value.
    status: str
    #: Status "waiting": the field with no value; else null.
    waiting: WaitingRow | None
    #: While the throttle holds a change back: when it goes out; else null.
    held: HoldRow | None


class InputsUpdate(TypedDict):
    """What ``aivi/inputs/subscribe`` sends, at once and on every change."""

    stream: StreamStatus | None
    presses: list[PressRow]
    pushes: list[PushRow]
    #: Each running binding's status, by subentry id.
    status: dict[str, BindingStatusRow]


class BindingView(TypedDict):
    subentry_id: str
    slug: str
    name: str
    template: str
    bindings: dict[str, Any]


class WidgetView(BindingView):
    stale_after: int | None


class ActivityView(BindingView):
    active: str | None
    throttle: int


class AccountView(TypedDict):
    entry_id: str
    title: str
    subscription: Literal["active", "inactive"]
    #: While paused: when the subscription ended (ISO 8601), or None.
    subscription_ended: str | None
    stream: StreamStatus | None
    #: Whether the account keeps its activity log across restarts.
    keep_log: bool
    widgets: list[WidgetView]
    activities: list[ActivityView]


class FeederView(TypedDict):
    """An automation that feeds a widget or Live Activity by its slug."""

    kind: str
    slug: str
    entity_id: str
    name: str
    enabled: bool
    config_id: str | None
    blueprint: bool
    keep: Literal["shared", "initial_state"] | None


class ConfigResult(TypedDict):
    """``aivi/config``."""

    accounts: list[AccountView]
    suggest_state: SuggestState
    suggest_models: list[SuggestModel]
    version: str | None
    automations: list[FeederView]


class RemoteItem(TypedDict):
    """One widget or Live Activity in an ``aivi/widgets`` or
    ``aivi/activities`` listing."""

    slug: str
    name: str
    template: str
    supported: bool
