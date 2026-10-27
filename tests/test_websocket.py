"""Panel WebSocket API tests: a real WS client against the fake Aivi client."""

from __future__ import annotations

import pytest

from helpers import setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_templates_and_widgets(hass, hass_ws_client) -> None:
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "aivi/templates"})
    msg = await client.receive_json()
    assert msg["success"]
    assert "progress" in msg["result"]["templates"]
    assert "red" in msg["result"]["colors"]
    rows_fields = {
        field["key"]: field
        for slug in ("list", "battery")
        for field in msg["result"]["templates"][slug]["fields"]
        if field["kind"] == "rows"
    }
    assert rows_fields["rows"]["row_options"] == ["label", "icon", "color"]
    assert rows_fields["devices"]["row_options"] == ["icon", "color", "charging"]

    await client.send_json_auto_id({"type": "aivi/widgets", "entry_id": entry.entry_id})
    msg = await client.receive_json()
    assert msg["success"]
    slugs = {w["slug"] for w in msg["result"]["widgets"]}
    assert {"laundry", "frontdoor", "batteries"} <= slugs
    assert all(w["supported"] for w in msg["result"]["widgets"])


async def test_activities_listing_mirrors_widgets(
    hass, hass_ws_client, fake_client
) -> None:
    """aivi/activities mirrors aivi/widgets, flagged by whether this build
    can drive the activity's template."""
    from custom_components.aivi.api import ActivityInfo

    fake_client.activities.append(ActivityInfo("mystery", "Mystery", "forecast"))
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {"type": "aivi/activities", "entry_id": entry.entry_id}
    )
    msg = await client.receive_json()
    assert msg["success"]
    activities = {a["slug"]: a for a in msg["result"]["activities"]}
    assert activities["washer"] == {
        "slug": "washer",
        "name": "Washer",
        "template": "progress",
        "supported": True,
    }
    assert activities["grill"]["template"] == "monitor"
    assert activities["grill"]["supported"] is True
    # An activity template this build doesn't know is listed, not hidden.
    assert activities["mystery"]["supported"] is False

    # Error paths mirror aivi/widgets too.
    await client.send_json_auto_id({"type": "aivi/activities", "entry_id": "nope"})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"

    fake_client.reachable = False
    await client.send_json_auto_id(
        {"type": "aivi/activities", "entry_id": entry.entry_id}
    )
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "cannot_connect"


async def test_listings_work_while_the_account_is_not_loaded(
    hass, hass_ws_client
) -> None:
    """The panel lists an account's widgets and activities from the entry
    alone, with no runtime to pause or resume."""
    entry = await setup_account(hass)
    assert await hass.config_entries.async_unload(entry.entry_id)
    client = await hass_ws_client(hass)

    for kind in ("widgets", "activities"):
        await client.send_json_auto_id(
            {"type": f"aivi/{kind}", "entry_id": entry.entry_id}
        )
        msg = await client.receive_json()
        assert msg["success"]
        assert msg["result"][kind]


async def test_ws_error_paths(hass, hass_ws_client, fake_client) -> None:
    """Unknown ids error cleanly; an unreachable API reports cannot_connect."""
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "aivi/widgets", "entry_id": "nope"})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"

    fake_client.reachable = False
    await client.send_json_auto_id({"type": "aivi/widgets", "entry_id": entry.entry_id})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "cannot_connect"
    fake_client.reachable = True

    await client.send_json_auto_id(
        {"type": "aivi/preview", "template": "nope", "bindings": {}}
    )
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"

    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": "nope",
            "slug": "s",
            "name": "n",
            "template": "progress",
            "bindings": {},
        }
    )
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"

    await client.send_json_auto_id(
        {"type": "aivi/delete", "entry_id": entry.entry_id, "subentry_id": "x"}
    )
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "nope",
            "name": "n",
            "description": "d",
        }
    )
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"


_SAVE = {
    "type": "aivi/save",
    "slug": "laundry",
    "name": "Laundry",
    "template": "progress",
    "bindings": {"progress": "sensor.washer_progress"},
}


@pytest.mark.parametrize(
    "command",
    [
        {"type": "aivi/config"},
        {"type": "aivi/templates"},
        {"type": "aivi/widgets", "entry_id": "x"},
        {"type": "aivi/activities", "entry_id": "x"},
        {"type": "aivi/preview", "template": "progress", "bindings": {}},
        {**_SAVE, "entry_id": "x"},
        {"type": "aivi/delete", "entry_id": "x", "subentry_id": "y"},
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "n",
            "description": "d",
        },
    ],
)
async def test_every_command_is_admin_only(
    hass, hass_ws_client, hass_read_only_access_token, command
) -> None:
    await setup_account(hass)
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json_auto_id(command)
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "unauthorized"
