"""How a binding's content goes out, by kind: an activity with its
lifecycle state, a widget with its settings, a switchboard with its state
words while Aivi takes them."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from functools import partial
from typing import Any, cast

from homeassistant.core import HomeAssistant

from ..api import (
    AiviClient,
    AiviValidationError,
    WireRequest,
    activity_request,
    widget_request,
)
from ..const import (
    CONF_ACTIVE,
    CONF_STALE_AFTER,
    CONF_THROTTLE,
    DEFAULT_THROTTLE_SECONDS,
    SUBENTRY_ACTIVITY,
)
from ..push import Delivery, Sent
from ..switchboard import (
    MAX_CONTENT_BYTES,
    StateTextSupport,
    has_state_text,
    toggle_flipped,
    without_state_text,
)
from ..values import as_bool
from .binding import Binding
from .issues import MISSING_KINDS

_LOGGER = logging.getLogger(__name__)


def switchboard_content(
    content: dict[str, Any], support: StateTextSupport
) -> dict[str, Any]:
    """The switchboard content a push sends first: without its state
    words once Aivi has refused them."""
    if has_state_text(content) and not support.offered:
        return without_state_text(content)
    return content


async def push_switchboard(
    push: Callable[[dict[str, Any]], Awaitable[None]],
    content: dict[str, Any],
    support: StateTextSupport,
) -> None:
    """Push a switchboard's content, with its state words while Aivi takes
    them. A refusal naming ``state_text`` is retried at once without them;
    any other refusal is raised."""
    first = switchboard_content(content, support)
    if first is not content or not has_state_text(content):
        await push(first)
        return
    try:
        await push(content)
    except AiviValidationError as err:
        if not err.unknown_field("state_text"):
            raise
        _LOGGER.info(
            "Aivi does not take custom state words yet; sending the"
            " switchboard without them (%s)",
            err,
        )
        support.refused()
        await push(without_state_text(content))
    else:
        support.accepted()


def delivery_for(
    hass: HomeAssistant,
    client: AiviClient,
    binding: Binding,
    words: StateTextSupport,
) -> Delivery:
    """How the binding's content goes out. ``words`` is the account's
    answer on state words, which a switchboard's pushes follow."""
    slug, data = binding.slug, binding.data
    missing_kind = MISSING_KINDS[binding.kind]
    if binding.kind == SUBENTRY_ACTIVITY:
        # Truthy active entity keeps the Live Activity ONGOING, falsy
        # ends it (IDLE).
        active_entity = cast("str", data[CONF_ACTIVE])

        def _ongoing() -> bool:
            state = hass.states.get(active_entity)
            return state is not None and as_bool(state.state)

        def _activity_request(content: dict[str, Any]) -> WireRequest:
            return activity_request(slug, "ONGOING" if _ongoing() else "IDLE", content)

        async def _send_activity(content: dict[str, Any], sent: Sent) -> None:
            request = _activity_request(content)
            sent(request)
            await client.push_activity(slug, request.body["state"], content)

        return Delivery(
            send=_send_activity,
            request=_activity_request,
            missing_kind=missing_kind,
            # The lifecycle state, so push suppression can see an
            # activity ending: the content is identical either way.
            context=_ongoing,
            ends=lambda: not _ongoing(),
            # A flipped toggle answers a press waiting on the card.
            urgent=toggle_flipped if binding.pressable else None,
            min_interval=data.get(CONF_THROTTLE, DEFAULT_THROTTLE_SECONDS),
            follows=frozenset({active_entity}),
        )
    stale_after = cast("int | None", data.get(CONF_STALE_AFTER))
    request = partial(widget_request, slug, stale_after=stale_after)

    def _pusher(sent: Sent) -> Callable[[dict[str, Any]], Awaitable[None]]:
        async def _push(content: dict[str, Any]) -> None:
            sent(request(content))
            await client.push_widget(slug, content, stale_after=stale_after)

        return _push

    measure = binding.template.measure if binding.template is not None else None
    if measure is None:
        return Delivery(
            send=lambda content, sent: _pusher(sent)(content),
            request=request,
            missing_kind=missing_kind,
            # A changed setting goes out even with unchanged content.
            context=None if stale_after is None else lambda: stale_after,
        )

    def _oversize(content: dict[str, Any]) -> str | None:
        # Measured as the Aivi API stores it: with the
        # words only once it has accepted them.
        size = measure(content, state_text=words.confirmed)
        if size <= MAX_CONTENT_BYTES:
            return None
        return (
            f"Content is {size} bytes, over the Aivi limit of"
            f" {MAX_CONTENT_BYTES}; not sent (shorten image URLs or"
            " subtitles, or remove tiles)"
        )

    return Delivery(
        send=lambda content, sent: push_switchboard(_pusher(sent), content, words),
        request=lambda content: request(switchboard_content(content, words)),
        missing_kind=missing_kind,
        context=lambda: (words.epoch, stale_after),
        oversize=_oversize,
        urgent=toggle_flipped,
    )
