"""The account's event stream: reconnects, backoff on refusals, resume
from the last id, and the guards every event passes before it is played
back."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.aivi.api import STREAM_OPEN, AiviError
from custom_components.aivi.commands import (
    DATA_CURSORS,
    JITTER,
    CommandStream,
    CursorStore,
    async_remove_stream_cursor,
)
from helpers import account_entry, press_event, until, widget_subentry

pytestmark = pytest.mark.usefixtures("inject_fake_client")

WIDGETS = {
    ("widget", "porch"): {"light_porch": "light.porch", "scene_movie": "scene.movie"}
}


async def _porch(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("scene.movie", "scening", {"friendly_name": "Movie night"})
    entry = account_entry(
        hass,
        widget_subentry("porch", "Porch", "switchboard", {"actions": ["scene.movie"]}),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _recording_sleep(delays: list[float]) -> Callable[[float], Awaitable[None]]:
    async def sleep(delay: float) -> None:
        delays.append(delay)
        await asyncio.sleep(0)

    return sleep


async def test_junk_and_stale_events_are_ignored(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "stream open")

    press = press_event()
    fake_client.emit(press)
    fake_client.emit(press)  # a duplicate delivery: the same id
    fake_client.emit({**press_event(), "expires_at": "2000-01-01T00:00:00+00:00"})
    # A bare-slug subject, and a subject of another kind.
    fake_client.emit({**press_event(), "subject": "porch"})
    fake_client.emit(
        {**press_event(), "subject": {"kind": "activity", "slug": "porch"}}
    )
    # An unversioned type and a version this build does not know.
    fake_client.emit({**press_event(), "type": "widget.action"})
    fake_client.emit({**press_event(), "type": "widget.action.v2"})
    fake_client.emit({**press_event(), "data": "nope"})
    # A last good one, so the wait has something to land on.
    fake_client.emit(press_event("light_porch", kind="toggle", value=True))
    await until(hass, lambda: len(turn_on) == 2, "the trailing press")
    assert [call.data["entity_id"] for call in turn_on] == [
        "scene.movie",
        "light.porch",
    ]
    await stream.async_stop()


async def test_stream_reconnects_after_close_and_failure(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    stream.async_start()
    stream.async_start()  # idempotent
    await until(hass, lambda: stream.health.connected, "first open")
    assert fake_client.stream_opens == 1

    # The server's lifetime cap closes a stream that delivered: back again.
    fake_client.emit(press_event())
    await until(hass, lambda: len(turn_on) == 1, "a delivered event")
    fake_client.close_stream()
    await until(hass, lambda: fake_client.stream_opens == 2, "reopen")
    await until(hass, lambda: stream.health.connected, "reconnected")
    assert "Aivi command stream failed" not in caplog.text

    # A failed connection: one warning, backoff, then reconnect, and one
    # recovery line once the stream delivers again.
    fake_client.stream_error = AiviError("boom")
    fake_client.emit(press_event())
    await until(hass, lambda: len(turn_on) == 2, "a delivered event")
    fake_client.close_stream()
    await until(hass, lambda: fake_client.stream_opens == 3, "recovery")
    await until(hass, lambda: stream.health.connected, "reconnected again")
    assert stream.health.last_error == "boom"
    fake_client.emit(press_event())
    await until(hass, lambda: stream.health.last_error is None, "delivering again")
    assert caplog.text.count("Aivi command stream failed") == 1
    assert "connected again" in caplog.text

    # A second failure in a row logs at debug only (no warning flood).
    fake_client.stream_error = AiviError("boom again")
    fake_client.close_stream()
    await until(hass, lambda: fake_client.stream_opens == 4, "recovery 2")
    assert caplog.text.count("Aivi command stream failed") == 2

    await stream.async_stop()
    assert not stream.health.connected
    await stream.async_stop()  # idempotent


async def test_refused_streams_back_off_from_the_servers_retry(
    hass: HomeAssistant, fake_client
) -> None:
    """A stream that only sends ``retry:`` and ends (the server could not
    set it up) is a failure: each reconnect waits at least the retry, on a
    growing backoff with jitter, until a stream delivers."""
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    delays: list[float] = []
    fake_client.refusals = 3
    fake_client.refusal_retry = 1.5
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(0.5, 2, 5),
        sleep=_recording_sleep(delays),
    )
    stream.async_start()
    await until(hass, lambda: fake_client.stream_opens == 4, "the fourth open")
    # The retry is the floor of the first step, then the backoff grows;
    # jitter only ever adds.
    assert len(delays) == 3
    for delay, floor in zip(delays, (1.5, 2, 5), strict=True):
        assert floor <= delay <= floor * (1 + JITTER)
    assert (
        stream.health.last_error == "The event stream ended before delivering anything"
    )

    # A stream that delivers resets the backoff: its clean end waits only
    # the retry.
    fake_client.emit(press_event())
    await until(hass, lambda: len(turn_on) == 1, "a delivered event")
    assert stream.health.last_error is None
    fake_client.close_stream()
    await until(hass, lambda: fake_client.stream_opens == 5, "the fifth open")
    assert 1.5 <= delays[3] <= 1.5 * (1 + JITTER)
    await stream.async_stop()


async def test_a_long_quiet_stream_counts_as_healthy(
    hass: HomeAssistant, fake_client
) -> None:
    delays: list[float] = []
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(7,),
        healthy_after=0,
        sleep=_recording_sleep(delays),
    )
    stream.async_start()
    for opens in (2, 3):
        await until(hass, lambda: stream.health.connected, "open")
        fake_client.close_stream()
        await until(
            hass, lambda opens=opens: fake_client.stream_opens == opens, "reopen"
        )
    # No retry from the server and no backoff: straight back each time.
    assert delays == [0, 0]
    await stream.async_stop()


async def test_reconnect_resumes_from_the_last_id_and_dedupes_replays(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    # A fresh stream's starting position, then one event.
    fake_client.position("41")
    press = press_event()
    fake_client.emit(press, frame_id="42")
    await until(hass, lambda: len(turn_on) == 1, "the press")
    fake_client.close_stream()
    await until(hass, lambda: fake_client.stream_opens == 2, "reopen")
    assert fake_client.resumed_from == [None, "42"]

    # The server replays at least once: the press again, then a new one.
    fake_client.emit(press, frame_id="42")
    fake_client.emit(
        press_event("light_porch", kind="toggle", value=True), frame_id="43"
    )
    await until(hass, lambda: len(turn_on) == 2, "the new press")
    assert turn_on[1].data == {"entity_id": "light.porch"}
    assert stream.cursor.last_event_id == "43"
    await stream.async_stop()


async def test_the_cursor_survives_a_reload(hass: HomeAssistant, fake_client) -> None:
    entry = await _porch(hass)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.position("7")
    await until(hass, lambda: stream.cursor.last_event_id == "7", "the position")
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    reloaded = entry.runtime_data.commands
    assert reloaded is not None and reloaded is not stream
    assert reloaded.cursor is stream.cursor
    await until(hass, lambda: fake_client.resumed_from[-1] == "7", "resume")


async def test_stream_stops_on_a_rejected_token(
    hass: HomeAssistant, fake_client
) -> None:
    reauth: list[bool] = []
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(0,),
        on_auth_failed=lambda: reauth.append(True),
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.auth_ok = False
    fake_client.close_stream()
    await until(hass, lambda: bool(reauth), "reauth")
    assert stream.health.last_error is not None
    assert not stream.health.connected
    # Nothing reconnects on its own after that.
    fake_client.auth_ok = True
    await asyncio.sleep(0.05)
    assert fake_client.stream_opens == 1
    await stream.async_stop()


async def test_a_malformed_event_does_not_disturb_the_stream(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    # Non-string id and expiry, no data, no subject.
    fake_client.emit(
        {"type": "widget.action.v1", "id": 5, "expires_at": 12, "subject": None}
    )
    fake_client.emit(press_event())
    await until(hass, lambda: len(turn_on) == 1, "the good press")
    assert stream.health.connected
    await stream.async_stop()


def _raise_once(stream: CommandStream) -> None:
    """Make the stream's handling raise on the first event it sees."""
    handle = stream.playback.async_handle
    bugs = [RuntimeError("handler bug")]

    async def _handle(event: dict[str, Any]) -> None:
        if bugs:
            raise bugs.pop()
        await handle(event)

    stream.playback.async_handle = _handle  # type: ignore[method-assign]


async def test_stream_survives_a_handler_bug(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    """The event that hit the bug is logged and skipped (the cursor moves
    past it, so it is not replayed into the same bug); the stream stays
    open for the next one."""
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    _raise_once(stream)
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.emit(press_event(), frame_id="1")
    fake_client.emit(press_event(), frame_id="2")
    await until(hass, lambda: len(turn_on) == 1, "the next press")
    assert "error handling event" in caplog.text
    assert "handler bug" in caplog.text
    assert stream.health.connected
    assert fake_client.stream_opens == 1
    assert stream.cursor.last_event_id in ("1", "2")
    await stream.async_stop()


async def test_stream_survives_an_unexpected_stream_error(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    """A bug outside event handling ends that connection, not the stream:
    it is logged and the stream reconnects on the backoff."""
    fake_client.stream_error = RuntimeError("client bug")
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(0,),
        sleep=_recording_sleep([]),
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "reconnected")
    assert "Aivi command stream: unexpected error" in caplog.text
    assert "client bug" in caplog.text
    await stream.async_stop()


async def test_a_slow_service_call_does_not_hold_up_other_presses(
    hass: HomeAssistant, fake_client
) -> None:
    release = asyncio.Event()
    played: list[str] = []
    finished: list[str] = []

    async def _turn_on(call: ServiceCall) -> None:
        entity_id = call.data["entity_id"]
        played.append(entity_id)
        if entity_id == "light.slow":
            await release.wait()
        finished.append(entity_id)

    hass.services.async_register("homeassistant", "turn_on", _turn_on)
    confirmed: list[str] = []
    stream = CommandStream(
        hass,
        fake_client,
        routes={
            ("widget", "porch"): {
                "light_slow": "light.slow",
                "scene_movie": "scene.movie",
            }
        },
        backoff=(0,),
        on_played=lambda _resource, entity_id, _value: confirmed.append(entity_id),
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")

    fake_client.emit(press_event("light_slow", kind="toggle", value=True))
    fake_client.emit(press_event("light_slow", kind="toggle", value=True))
    fake_client.emit(press_event())
    await until(hass, lambda: finished == ["scene.movie"], "the other press")
    # Presses on the same entity wait for each other.
    assert played == ["light.slow", "scene.movie"]
    assert confirmed == ["scene.movie"]

    release.set()
    await until(hass, lambda: len(finished) == 3, "the slow presses")
    assert confirmed == ["scene.movie", "light.slow", "light.slow"]
    await stream.async_stop()


async def test_stopping_lets_received_presses_play_out(
    hass: HomeAssistant, fake_client
) -> None:
    """The cursor is already past a press queued behind a slow one, so
    stopping waits for it rather than dropping it for good."""
    release = asyncio.Event()
    finished: list[str] = []

    async def _turn_on(call: ServiceCall) -> None:
        if not finished:
            await release.wait()
        finished.append(call.data["entity_id"])

    hass.services.async_register("homeassistant", "turn_on", _turn_on)
    stream = CommandStream(hass, fake_client, routes=WIDGETS, backoff=(0,))
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.emit(press_event())
    fake_client.emit(press_event())
    playing = stream.playback.playing
    await until(hass, lambda: len(playing) == 2, "both presses received")

    stopping = hass.async_create_task(stream.async_stop())
    await asyncio.sleep(0.01)
    assert not stopping.done()
    release.set()
    async with asyncio.timeout(2):
        await stopping
    assert finished == ["scene.movie", "scene.movie"]


async def test_stopping_during_a_stuck_service_call(
    hass: HomeAssistant, fake_client
) -> None:
    started = asyncio.Event()

    async def _turn_on(_call: ServiceCall) -> None:
        started.set()
        await asyncio.Event().wait()

    hass.services.async_register("homeassistant", "turn_on", _turn_on)
    confirmed: list[str] = []
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(0,),
        playback_drain=0.05,
        on_played=lambda _resource, entity_id, _value: confirmed.append(entity_id),
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.emit(press_event())
    async with asyncio.timeout(2):
        await started.wait()
        await stream.async_stop()
    await asyncio.sleep(0.01)
    assert confirmed == []


@pytest.mark.parametrize(
    ("error", "logged"),
    [
        (vol.Invalid("bad entity"), "could not be played back: bad entity"),
        (HomeAssistantError("device offline"), "could not be played back"),
        (RuntimeError("service bug"), "failed unexpectedly"),
    ],
)
async def test_a_failing_service_keeps_the_stream(
    hass: HomeAssistant, fake_client, caplog, error: Exception, logged: str
) -> None:
    calls: list[str] = []

    async def _turn_on(call: ServiceCall) -> None:
        entity_id = call.data["entity_id"]
        calls.append(entity_id)
        if len(calls) == 1:
            raise error

    hass.services.async_register("homeassistant", "turn_on", _turn_on)
    confirmed: list[str] = []
    stream = CommandStream(
        hass,
        fake_client,
        routes=WIDGETS,
        backoff=(0,),
        on_played=lambda _resource, entity_id, _value: confirmed.append(entity_id),
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.emit(press_event())
    fake_client.emit(press_event("light_porch", kind="toggle", value=True))
    await until(hass, lambda: confirmed == ["light.porch"], "the next press")
    assert logged in caplog.text
    assert stream.health.connected
    assert fake_client.stream_opens == 1
    await stream.async_stop()


async def test_removing_the_entry_removes_through_the_store_that_writes(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """Unloading schedules a delayed write of the cursor. The store that
    scheduled it is the one that removes the file (``Store.async_remove``
    cancels its pending write), so the write cannot recreate the file."""
    entry = await _porch(hass)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.position("9")
    await until(hass, lambda: stream.cursor.last_event_id == "9", "the position")
    _, store = hass.data[DATA_CURSORS][entry.entry_id]
    removed_by: list[CursorStore] = []
    real_remove = CursorStore.async_remove

    async def _spy(self: CursorStore) -> None:
        removed_by.append(self)
        await real_remove(self)

    monkeypatch.setattr(CursorStore, "async_remove", _spy)
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert removed_by == [store]
    assert entry.entry_id not in hass.data[DATA_CURSORS]

    # With nothing cached (removed before ever loading), a fresh store
    # removes the file.
    await async_remove_stream_cursor(hass, "never-loaded")
    assert len(removed_by) == 2


async def test_open_marker_is_not_an_event() -> None:
    assert STREAM_OPEN["type"] == "_open"


async def test_setup_without_switchboards_opens_no_stream(
    hass: HomeAssistant,
) -> None:
    entry = account_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    assert entry.runtime_data.commands is None
