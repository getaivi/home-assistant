"""A press on a tile with state words, end to end: answered as soon as the
entity starts moving, never by a failure state."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from helpers import (
    account_entry,
    advance_past_debounce,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


async def test_a_cover_press_is_answered_when_it_starts_moving(
    hass: HomeAssistant, fake_client
) -> None:
    open_cover = async_mock_service(hass, "cover", "open_cover")
    hass.states.async_set("cover.garage", "closed", {"friendly_name": "Garage"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom", "Living room", "switchboard", {"actions": ["cover.garage"]}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    stream = entry.runtime_data.commands
    await until(hass, lambda: stream.health.connected, "stream open")
    now = dt_util.utcnow()
    fake_client.emit(
        {
            "id": str(uuid.uuid4()),
            "request_id": "act_1",
            "type": "widget.action.v1",
            "subject": {"kind": "widget", "slug": "livingroom"},
            "occurred_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=5)).isoformat(),
            "data": {"action": "cover_garage", "kind": "toggle", "value": True},
        }
    )
    await until(hass, lambda: len(open_cover) == 1, "the press")
    assert open_cover[0].data == {"entity_id": "cover.garage"}
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager._expected is not None
    answered, _ = manager._expected
    assert not answered()
    hass.states.async_set("cover.garage", "opening", {"friendly_name": "Garage"})
    assert answered()
    await advance_past_debounce(hass)
    tile = fake_client.last_push[1]["actions"][0]
    assert tile["on"] is True
    assert tile["state_text"]["on"] == "Opening"


@pytest.mark.parametrize("state", ["jammed", "unknown", "unavailable", "open"])
async def test_a_failure_state_never_answers_a_press(
    hass: HomeAssistant, fake_client, state: str
) -> None:
    """A press on a jammed or unreporting lock is not answered with the
    current content, or the phone would never show No response."""
    unlock = async_mock_service(hass, "lock", "unlock")
    hass.states.async_set("lock.front_door", state, {"friendly_name": "Front door"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom", "Living room", "switchboard", {"actions": ["lock.front_door"]}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    stream = entry.runtime_data.commands
    await until(hass, lambda: stream.health.connected, "stream open")
    fake_client.emit(tile_press("lock_front_door", kind="toggle", value=False))
    await until(hass, lambda: len(unlock) == 1, "the press")
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager._expected is not None
    answered, _ = manager._expected
    assert not answered()
    hass.states.async_set(
        "lock.front_door", "unlocked", {"friendly_name": "Front door"}
    )
    assert answered()
