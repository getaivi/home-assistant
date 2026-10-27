"""The envelope a press arrives in: deduplicated on the delivery id, with its
``request_id`` passed along, its expiry and its type, and the cursor the
stream resumes from after a restart."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi.api import STREAM_READ_TIMEOUT, WidgetInfo
from custom_components.aivi.commands import DATA_CURSORS, CommandStream
from custom_components.aivi.const import DOMAIN, EVENT_ACTION
from helpers import (
    porch_light_tile,
    tile_press,
    until,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


async def test_the_envelope_dedupes_on_id_and_carries_request_id(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    bus: list[Event] = []
    hass.bus.async_listen(EVENT_ACTION, callback(lambda e: bus.append(e)))
    stream = CommandStream(
        hass, fake_client, routes={("widget", "livingroom"): {"scene_a": "scene.a"}}
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    press = tile_press("scene_a", kind="button")
    fake_client.emit(press)
    # A retry of the same press: the same delivery id, whatever else.
    fake_client.emit({**press, "occurred_at": dt_util.utcnow().isoformat()})
    # A later version of the type, and an unknown type: never consumed.
    fake_client.emit(
        {**tile_press("scene_a", kind="button"), "type": "widget.action.v2"}
    )
    fake_client.emit({**tile_press("scene_a", kind="button"), "type": "widget.pressed"})
    # Two presses may share a request_id across widgets; the id tells
    # them apart, so both play.
    other = tile_press("scene_a", kind="button")
    other["request_id"] = press["request_id"]
    fake_client.emit(other)
    await until(hass, lambda: len(turn_on) == 2, "two presses")
    await hass.async_block_till_done()
    assert len(turn_on) == 2
    assert [(e.data["event_id"], e.data["request_id"]) for e in bus] == [
        (press["id"], press["request_id"]),
        (other["id"], press["request_id"]),
    ]
    # An envelope without request_id: the delivery id stands in for it.
    legacy = tile_press("scene_a", kind="button")
    del legacy["request_id"]
    fake_client.emit(legacy)
    await until(hass, lambda: len(turn_on) == 3, "the legacy press")
    assert bus[-1].data["request_id"] == legacy["id"]
    await stream.async_stop()


async def test_expired_presses_are_dropped(hass: HomeAssistant, fake_client) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    bus: list[Event] = []
    hass.bus.async_listen(EVENT_ACTION, callback(lambda e: bus.append(e)))
    stream = CommandStream(
        hass, fake_client, routes={("widget", "livingroom"): {"scene_a": "scene.a"}}
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    stale = tile_press("scene_a", kind="button")
    stale["expires_at"] = (dt_util.utcnow() - timedelta(seconds=1)).isoformat()
    fake_client.emit(stale)
    fresh = tile_press("scene_a", kind="button")
    fake_client.emit(fresh)
    await until(hass, lambda: len(turn_on) == 1, "the fresh press")
    assert [e.data["event_id"] for e in bus] == [fresh["id"]]
    await stream.async_stop()


async def test_expiry_is_checked_again_right_before_acting(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """A press that expires while bus listeners run is not played back."""

    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    stream = CommandStream(
        hass, fake_client, routes={("widget", "livingroom"): {"scene_a": "scene.a"}}
    )
    stream.async_start()
    await until(hass, lambda: stream.health.connected, "open")
    press = tile_press("scene_a", kind="button")
    real_utcnow = dt_util.utcnow
    calls = {"n": 0}

    def later() -> Any:
        # The check on receipt sees now; everything after, 10 s on.
        calls["n"] += 1
        return real_utcnow() + timedelta(seconds=0 if calls["n"] == 1 else 10)

    monkeypatch.setattr(
        "custom_components.aivi.commands.playback.dt_util.utcnow", later, raising=True
    )
    fake_client.emit(press)
    await until(hass, lambda: calls["n"] >= 3, "the second check")
    await hass.async_block_till_done()
    assert turn_on == []
    monkeypatch.undo()
    await stream.async_stop()


async def test_the_cursor_survives_a_restart(
    hass: HomeAssistant, fake_client, hass_storage
) -> None:
    entry = await porch_light_tile(hass)
    stream = entry.runtime_data.commands
    await until(hass, lambda: stream.health.connected, "open")
    fake_client.position("41")
    fake_client.emit(
        tile_press("light_porch", kind="toggle", value=True), frame_id="42"
    )
    fake_client.emit(tile_press("light_porch", kind="toggle", value=False))
    await until(hass, lambda: stream.cursor.last_event_id == "42", "the position")
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    # The write is delayed and coalesced; Home Assistant flushes it on
    # the way down.
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()
    key = f"{DOMAIN}.{entry.entry_id}.events"
    assert hass_storage[key]["data"] == {"last_event_id": "42"}

    # A restart: the in-memory cursors are gone, the store is not.
    hass.data.pop(DATA_CURSORS)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    restarted = entry.runtime_data.commands
    await until(hass, lambda: restarted.health.connected, "reopen")
    assert fake_client.resumed_from[-1] == "42"

    # Removing the account removes its stored cursor.
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert key not in hass_storage


def test_the_stream_read_timeout_is_two_pings_plus_margin() -> None:
    # The server pings every 20 s; two missed pings plus margin.
    assert STREAM_READ_TIMEOUT == 45
