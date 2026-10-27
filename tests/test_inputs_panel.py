"""What the panel is told about input: the stream's status, and the input a
template declares."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.diagnostics import async_get_config_entry_diagnostics
from custom_components.aivi.switchboard import PRESSED, TOGGLE_OFF, TOGGLE_ON
from helpers import (
    porch_subentry,
    setup_porch,
    tile_press,
    until,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("hall", "Hall", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
    ]


async def test_config_and_the_subscription_carry_the_stream(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    async_mock_service(hass, "homeassistant", "turn_on")
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    await until(hass, lambda: runtime.commands.health.connected, "open")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "aivi/config"})
    (account,) = (await client.receive_json())["result"]["accounts"]
    assert account["stream"]["state"] == "connected"
    assert account["stream"]["connected"] is True

    await client.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["success"]
    first = (await client.receive_json())["event"]
    assert first["stream"]["state"] == "connected"
    assert first["presses"] == []

    fake_client.emit(tile_press("scene_movie", slug="porch", kind="button"))
    while True:
        update = (await client.receive_json())["event"]
        if update["presses"]:
            break
    (row,) = update["presses"]
    assert row["label"] == "Movie night"
    assert row["outcome"] == "played"
    assert row["event_type"] == PRESSED

    await client.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": "nope"}
    )
    assert (await client.receive_json())["error"]["code"] == "not_found"

    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["stream"]["state"] == "connected"
    assert diagnostics["recent_inputs"][0]["outcome"] == "played"


async def test_templates_declare_their_input(hass: HomeAssistant, hass_ws_client):
    await setup_porch(hass, porch_subentry())
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "aivi/templates"})
    templates = (await client.receive_json())["result"]["templates"]
    assert templates["switchboard"]["inputs"] == [
        {"type": TOGGLE_ON, "recorded": True},
        {"type": TOGGLE_OFF, "recorded": True},
        {"type": PRESSED, "recorded": True},
    ]
    assert "inputs" not in templates["progress"]
