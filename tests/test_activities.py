"""Live Activity bindings: lifecycle-driven pushes and the panel API."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.aivi.const import (
    DOMAIN,
)
from custom_components.aivi.runtime import registered_device
from helpers import advance_past_debounce, setup_account, washer_activity

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_activity_pushes_with_lifecycle_state(
    hass: HomeAssistant, fake_client
) -> None:
    await washer_activity(hass)
    slug, state, content = fake_client.activity_pushes[-1]
    assert (slug, state) == ("washer", "ONGOING")
    assert content["progress"]["value"] == 0.4

    # The active entity turning off ends the activity on the next push.
    hass.states.async_set("binary_sensor.washer_running", "off")
    await advance_past_debounce(hass)
    assert fake_client.activity_pushes[-1][1] == "IDLE"


async def test_unknown_activity_slug_raises_a_repair_issue(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.missing_slugs.add("washer")
    entry = await washer_activity(hass)
    subentry_id = next(iter(entry.subentries))
    issue = ir.async_get(hass).async_get_issue(
        DOMAIN, f"activity_missing_{subentry_id}"
    )
    assert issue is not None


async def test_activity_device_and_sensor_model(
    hass: HomeAssistant, device_registry
) -> None:
    entry = await washer_activity(hass)
    subentry_id = next(iter(entry.subentries))
    device = registered_device(device_registry, entry.entry_id, subentry_id)
    assert device.model == "progress activity"


async def test_bound_activity_missing_from_remote_list_keeps_working(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    """A subentry whose slug the remote list does not contain still loads,
    pushes, and shows in aivi/config; the panel renders it as
    bound-but-vanished, like a widget."""
    from homeassistant.setup import async_setup_component

    await async_setup_component(hass, "websocket_api", {})
    fake_client.activities = [a for a in fake_client.activities if a.slug != "washer"]
    await washer_activity(hass)
    assert fake_client.activity_pushes[-1][0] == "washer"

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    (activity,) = msg["result"]["accounts"][0]["activities"]
    assert activity["slug"] == "washer"

    # The panel's merge with the remote listing surfaces the vanished card.
    entry_id = msg["result"]["accounts"][0]["entry_id"]
    await client.send_json_auto_id({"type": "aivi/activities", "entry_id": entry_id})
    msg = await client.receive_json()
    assert "washer" not in {a["slug"] for a in msg["result"]["activities"]}


async def test_ws_save_and_preview_activities(hass, hass_ws_client) -> None:

    entry = await setup_account(hass)
    hass.states.async_set("sensor.grill_temp", "180")
    hass.states.async_set("binary_sensor.grill_on", "on")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "kind": "activity",
            "template": "monitor",
            "bindings": {"right_value": "sensor.grill_temp", "right_header": "Grill"},
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["content"]["right_column"] == {
        "value": {"value": "180"},
        "header": "Grill",
    }

    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": entry.entry_id,
            "kind": "activity",
            "slug": "grill",
            "name": "Grill",
            "template": "monitor",
            "active": "binary_sensor.grill_on",
            "bindings": {"right_value": "sensor.grill_temp"},
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    await hass.async_block_till_done()

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    (activity,) = msg["result"]["accounts"][0]["activities"]
    assert activity["slug"] == "grill"
    assert activity["active"] == "binary_sensor.grill_on"

    # Activities without a lifecycle entity are refused.
    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": entry.entry_id,
            "kind": "activity",
            "slug": "x",
            "name": "X",
            "template": "monitor",
            "bindings": {},
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"
