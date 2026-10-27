"""Presses on the phone, played back into Home Assistant.

A tile press on a switchboard widget comes back from Aivi as a
``widget.action.v1`` event on the account's SSE stream (``GET /events``),
whose ``subject`` names the resource's ``kind`` and ``slug``. Slugs are
unique only within one kind, so an event is routed only when its subject's
kind matches its type. One ``CommandStream`` per config entry routes each
event to the entity bound under that slug and action and calls the matching
service (``switchboard.press_service``). The resulting state change confirms
the press through the ordinary push path; nothing here pushes to Aivi. Every
action is also fired on the HA bus as ``aivi_action``, bound here or
not, under the same ``Context`` as the service call it leads to, so Home
Assistant credits the resulting state change to the press. Every event
handled ends as one ``InputRecord`` (``inputs.py``) with its outcome.

The stream resumes from the last ``id:`` via ``Last-Event-ID`` and the
server replays unexpired events in between; the cursor survives reloads
and, through a ``Store``, restarts. Replay is at least once, so events are
deduplicated on ``id``, which the server keeps stable across retries.
``request_id`` is the phone's id for the press, unique only per widget:
passed along for correlation, never deduplicated on. An event past its
``expires_at`` (checked again right before the service call) is dropped
rather than played back late.

A toggle press asks for a state and the phone waits up to 15 s for content
showing it. If the entity was already in that state nothing changes, so
``on_played`` asks the push manager to send its current content anyway,
only while the entity really is in that state. A button press is confirmed
by any content write within the event's lifetime, so ``on_played`` forces
one publish after a successful service call. A press that expired, was not
bound here, or whose service call failed is never acknowledged.

The server closes a healthy stream every 15 minutes, and refuses one by
sending only ``retry:`` and ending at once. Every reconnect waits at least
that ``retry:``. A stream that ends without delivering an event, unless it
stayed open ``HEALTHY_AFTER`` seconds, counts as a failure, as does every
network error; failures back off with jitter. A rejected token or a
lapsed subscription ends the stream without a reconnect. The stream's
health (``StreamHealth``) counts a routine close followed by a reconnect
as staying connected; only a failure, or stopping, disconnects it.

The package splits by concern: ``stream`` (the connection and its
reconnects), ``playback`` (one event, routed and played back) and
``cursor`` (where the stream resumes, kept on disk).
"""

from __future__ import annotations

from .cursor import (
    DATA_CURSORS,
    CursorStore,
    async_remove_stream_cursor,
    async_stream_cursor,
)
from .stream import JITTER, CommandStream

__all__ = [
    "DATA_CURSORS",
    "JITTER",
    "CommandStream",
    "CursorStore",
    "async_remove_stream_cursor",
    "async_stream_cursor",
]
