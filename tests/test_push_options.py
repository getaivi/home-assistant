"""Per-binding push options: a widget's ``stale_after`` and a Live
Activity's throttle, through the panel API and the push path."""

from __future__ import annotations

from datetime import timedelta

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi.const import (
    CONF_STALE_AFTER,
    CONF_THROTTLE,
    DEFAULT_THROTTLE_SECONDS,
)
from helpers import (
    account_entry,
    activity_subentry,
    advance_past_debounce,
    setup_account,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _front_door(hass: HomeAssistant, **data: object):
    hass.states.async_set("input_boolean.front", "on")
    subentry = widget_subentry(
        "frontdoor", "Front door", "status", {"state": "input_boolean.front"}
    )
    subentry["data"] = {**subentry["data"], **data}
    entry = account_entry(hass, subentry)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_stale_after_goes_with_every_push(
    hass: HomeAssistant, fake_client
) -> None:
    await _front_door(hass, **{CONF_STALE_AFTER: 3600})
    hass.states.async_set("input_boolean.front", "off")
    await advance_past_debounce(hass)
    assert fake_client.stale_afters == [3600, 3600]


async def test_without_stale_after_the_widgets_setting_stands(
    hass: HomeAssistant, fake_client
) -> None:
    await _front_door(hass)
    assert fake_client.stale_afters == [None]


async def test_a_new_stale_after_is_sent_with_unchanged_content(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    entry = await setup_account(hass)
    hass.states.async_set("input_boolean.front", "on")
    client = await hass_ws_client(hass)
    save = {
        "type": "aivi/save",
        "entry_id": entry.entry_id,
        "slug": "frontdoor",
        "name": "Front door",
        "template": "status",
        "bindings": {"state": "input_boolean.front"},
    }
    await client.send_json_auto_id({**save, CONF_STALE_AFTER: 900})
    msg = await client.receive_json()
    assert msg["success"]
    subentry_id = msg["result"]["subentry_id"]
    await hass.async_block_till_done()
    assert fake_client.stale_afters == [900]
    assert entry.subentries[subentry_id].data[CONF_STALE_AFTER] == 900

    await client.send_json_auto_id({"type": "aivi/config"})
    (widget,) = (await client.receive_json())["result"]["accounts"][0]["widgets"]
    assert widget["stale_after"] == 900

    # 0 clears the widget's setting: the push carries it (sent as null).
    await client.send_json_auto_id(
        {**save, "subentry_id": subentry_id, CONF_STALE_AFTER: 0}
    )
    assert (await client.receive_json())["success"]
    await hass.async_block_till_done()
    assert fake_client.stale_afters == [900, 0]
    assert len({str(content) for _, content in fake_client.pushes}) == 1

    # Out of Aivi's range: refused.
    for bad in (30, 604801, "1h"):
        await client.send_json_auto_id({**save, CONF_STALE_AFTER: bad})
        assert not (await client.receive_json())["success"]


async def _washer(hass: HomeAssistant, throttle: int = DEFAULT_THROTTLE_SECONDS):
    hass.states.async_set("binary_sensor.washer_running", "on")
    hass.states.async_set("sensor.washer_progress", "10")
    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.washer_running",
            {"progress": "sensor.washer_progress"},
            throttle=throttle,
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _later(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, seconds: float
) -> None:
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=seconds))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


def _progress(fake_client) -> list[tuple[str, float]]:
    return [
        (state, c["progress"]["value"]) for _, state, c in fake_client.activity_pushes
    ]


async def test_a_busy_activity_is_throttled_and_its_last_state_arrives(
    hass: HomeAssistant, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    await _washer(hass)
    assert _progress(fake_client) == [("ONGOING", 0.1)]
    # A change a few seconds later is held back; so is the next one.
    for value in ("20", "30"):
        hass.states.async_set("sensor.washer_progress", value)
        await _later(hass, freezer, 5)
    assert _progress(fake_client) == [("ONGOING", 0.1)]
    # When the interval since the last push is up, the latest state goes.
    await _later(hass, freezer, DEFAULT_THROTTLE_SECONDS)
    assert _progress(fake_client) == [("ONGOING", 0.1), ("ONGOING", 0.3)]
    # Ending the activity is never held.
    hass.states.async_set("binary_sensor.washer_running", "off")
    await _later(hass, freezer, 3)
    assert _progress(fake_client)[-1] == ("IDLE", 0.3)


async def test_a_quiet_activity_is_not_held(
    hass: HomeAssistant, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    await _washer(hass)
    await _later(hass, freezer, DEFAULT_THROTTLE_SECONDS + 1)
    hass.states.async_set("sensor.washer_progress", "50")
    await _later(hass, freezer, 3)
    assert _progress(fake_client) == [("ONGOING", 0.1), ("ONGOING", 0.5)]


async def test_the_throttle_can_be_turned_off_and_is_saved(
    hass: HomeAssistant, hass_ws_client, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    await _washer(hass, throttle=0)
    hass.states.async_set("sensor.washer_progress", "20")
    await _later(hass, freezer, 3)
    assert _progress(fake_client) == [("ONGOING", 0.1), ("ONGOING", 0.2)]

    entry = await setup_account(hass)
    client = await hass_ws_client(hass)
    save = {
        "type": "aivi/save",
        "entry_id": entry.entry_id,
        "kind": "activity",
        "slug": "grill",
        "name": "Grill",
        "template": "monitor",
        "active": "binary_sensor.washer_running",
        "bindings": {"right_value": "sensor.washer_progress"},
    }
    await client.send_json_auto_id({**save, CONF_THROTTLE: 15})
    msg = await client.receive_json()
    assert msg["success"]
    subentry = entry.subentries[msg["result"]["subentry_id"]]
    assert subentry.data[CONF_THROTTLE] == 15
    await client.send_json_auto_id({"type": "aivi/config"})
    accounts = (await client.receive_json())["result"]["accounts"]
    activity = next(
        a for acc in accounts for a in acc["activities"] if a["slug"] == "grill"
    )
    assert activity["throttle"] == 15
    await client.send_json_auto_id({**save, CONF_THROTTLE: -1})
    assert not (await client.receive_json())["success"]
