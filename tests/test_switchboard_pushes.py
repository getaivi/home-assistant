"""A switchboard's pushes: identical content is suppressed, a toggle is
answered promptly, and a button press the integration acted on publishes
exactly once (Aivi confirms a button press on any content write after it)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.push import URGENT_DELAY_SECONDS
from helpers import (
    account_entry,
    advance_past_debounce,
    porch_light_tile,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


async def test_identical_content_is_not_pushed_again(
    hass: HomeAssistant, fake_client
) -> None:
    await porch_light_tile(hass)
    assert len(fake_client.pushes) == 1
    # An attribute the tile does not show: same content, no PATCH.
    hass.states.async_set(
        "light.porch", "off", {"friendly_name": "Porch light", "effect_list": ["x"]}
    )
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == 1
    hass.states.async_set(
        "light.porch",
        "on",
        {
            "friendly_name": "Porch light",
            "color_mode": "color_temp",
            "color_temp_kelvin": 2700,
        },
    )
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == 2
    tile = fake_client.last_push[1]["actions"][0]
    assert tile["on"] is True
    assert tile["gradient"] == ["#FFE4AD", "#FFAE5E"]
    # A color change while on changes the gradient.
    hass.states.async_set(
        "light.porch",
        "on",
        {"friendly_name": "Porch light", "color_mode": "hs", "rgb_color": [255, 0, 0]},
    )
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == 3
    assert fake_client.last_push[1]["actions"][0]["gradient"] == ["#FF8080", "#FF0000"]


async def test_a_failed_push_is_not_remembered_as_sent(
    hass: HomeAssistant, fake_client
) -> None:
    await porch_light_tile(hass)
    fake_client.reachable = False
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch light"})
    await advance_past_debounce(hass)
    fake_client.reachable = True
    # Back to the content that failed, then forward again: the retry of
    # the unsent content is not suppressed as "already sent".
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    await advance_past_debounce(hass)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch light"})
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["actions"][0]["on"] is True


async def test_a_toggle_flip_is_pushed_without_the_debounce(
    hass: HomeAssistant, fake_client
) -> None:
    await porch_light_tile(hass)
    pushes = len(fake_client.pushes)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch light"})
    await hass.async_block_till_done()
    # Well inside the 2 s debounce: the flip is the answer the phone is
    # waiting for, so it goes out after the short urgent delay.
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=URGENT_DELAY_SECONDS + 0.1)
    )
    await hass.async_block_till_done()
    assert len(fake_client.pushes) == pushes + 1
    assert fake_client.last_push[1]["actions"][0]["on"] is True


async def test_toggle_press_answers(hass: HomeAssistant, fake_client) -> None:
    """A press is answered by the entity's change, or with the current
    content if the entity is already in the asked state; a press the
    device ignores is never answered."""
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    turn_off = async_mock_service(hass, "homeassistant", "turn_off")
    entry = await porch_light_tile(hass)
    stream = entry.runtime_data.commands
    await until(hass, lambda: stream.health.connected, "stream open")
    base = len(fake_client.pushes)

    async def settle() -> None:
        await hass.async_block_till_done()
        async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3))
        await hass.async_block_till_done()

    # The device is offline: turn_on runs, nothing changes, nothing sent.
    fake_client.emit(tile_press("light_porch", kind="toggle", value=True))
    await until(hass, lambda: len(turn_on) == 1, "the press")
    await settle()
    assert len(fake_client.pushes) == base

    # Already off, and the phone asks for off (a second phone pressed
    # first): the identical content goes out as the answer.
    fake_client.emit(tile_press("light_porch", kind="toggle", value=False))
    await until(hass, lambda: len(turn_off) == 1, "the off press")
    await settle()
    assert len(fake_client.pushes) == base + 1
    assert fake_client.last_push[1]["actions"][0]["on"] is False

    # The answer window is 15 s: a stale expectation does not force one.
    fake_client.emit(tile_press("light_porch", kind="toggle", value=False))
    await until(hass, lambda: len(turn_off) == 2, "the second off press")
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager._expected is not None
    answered, _ = manager._expected
    manager._expected = (answered, hass.loop.time() - 1)
    await settle()
    assert len(fake_client.pushes) == base + 1


async def test_button_presses_are_acknowledged_with_one_publish(
    hass: HomeAssistant, fake_client
) -> None:
    calls: list[str] = []

    async def _turn_on(call: ServiceCall) -> None:
        for entity_id in call.data["entity_id"]:
            calls.append(entity_id)
            if entity_id == "script.bedtime":
                hass.states.async_set(entity_id, "on", {"friendly_name": "Bedtime"})
            elif entity_id == "scene.movie":
                # A scene's state is when it last ran: a change the tile
                # does not show.
                hass.states.async_set(
                    entity_id,
                    dt_util.utcnow().isoformat(),
                    {"friendly_name": "Movie night"},
                )
            elif entity_id == "scene.broken":
                raise HomeAssistantError("offline")

    hass.services.async_register(
        "homeassistant", "turn_on", _turn_on, schema=cv.make_entity_service_schema({})
    )
    hass.states.async_set(
        "scene.movie", "2026-09-27T10:00:00+00:00", {"friendly_name": "Movie night"}
    )
    hass.states.async_set("scene.broken", "2026-09-27T10:00:00+00:00")
    hass.states.async_set("script.bedtime", "off", {"friendly_name": "Bedtime"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom",
            "Living room",
            "switchboard",
            {"actions": ["scene.movie", "script.bedtime", "scene.broken"]},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    stream = entry.runtime_data.commands
    await until(hass, lambda: stream.health.connected, "stream open")

    async def settle() -> None:
        # Past the acknowledgement delay and the ordinary debounce, so a
        # second publish would have gone out by now.
        for seconds in (1, 4):
            await hass.async_block_till_done()
            async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
            await hass.async_block_till_done()

    await settle()
    base = len(fake_client.pushes)
    before = fake_client.last_push[1]

    # A momentary press, content unchanged: exactly one publish, and its
    # own (invisible) state change folds into it.
    fake_client.emit(tile_press("scene_movie", kind="button"))
    await until(hass, lambda: calls == ["scene.movie"], "the scene")
    await settle()
    assert len(fake_client.pushes) == base + 1
    assert fake_client.last_push[1] == before

    # A press that changes the tile: one publish, with the script active.
    fake_client.emit(tile_press("script_bedtime", kind="button"))
    await until(hass, lambda: len(calls) == 2, "the script")
    await settle()
    assert len(fake_client.pushes) == base + 2
    assert fake_client.last_push[1]["actions"][1]["active"] is True

    # Not acted on: expired, not bound here, or the service failed.
    stale = tile_press("scene_movie", kind="button")
    stale["expires_at"] = (dt_util.utcnow() - timedelta(seconds=1)).isoformat()
    fake_client.emit(stale)
    fake_client.emit(tile_press("garage", kind="button"))
    fake_client.emit(tile_press("scene_broken", kind="button"))
    await until(hass, lambda: calls[-1] == "scene.broken", "the failed press")
    await settle()
    assert calls == ["scene.movie", "script.bedtime", "scene.broken"]
    assert len(fake_client.pushes) == base + 2
