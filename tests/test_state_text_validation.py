"""State words are validated on save: a save refuses what Aivi would."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import DOMAIN
from custom_components.aivi.switchboard import (
    state_text_errors,
)
from helpers import (
    OPEN_CLOSED,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def test_state_text_errors_say_what_is_wrong() -> None:
    assert state_text_errors({"actions": ["cover.garage"]}) == []
    assert (
        state_text_errors(
            {
                "actions__options": {
                    "cover.garage": {"state_text_on": "Up", "state_text_off": ""},
                    "scene.movie": {"state_text_sent": "x" * 24, "label": "x" * 99},
                }
            }
        )
        == []
    )
    errors = state_text_errors(
        {
            "actions__options": {
                "cover.garage": {
                    "state_text_on": "x" * 25,
                    "state_text_off": "Shut\nfor good",
                    "state_text_idle": "Tap",
                    "state_text_bogus": "?",
                },
                "scene.movie": {"state_text_on": "On", "state_text_sent": 3},
                "light.porch": "not a dict",
            },
        }
    )
    assert errors == [
        'cover.garage: the "on" word must be at most 24 characters',
        'cover.garage: the "off" word must be one line, with no tabs or'
        " control characters",
        'cover.garage: "idle" is not a state word of a toggle tile (it belongs'
        " to button tiles); use on, off, turning_on, turning_off, no_response",
        'cover.garage: "bogus" is not a state word of a toggle tile; use on,'
        " off, turning_on, turning_off, no_response",
        'scene.movie: "on" is not a state word of a button tile (it belongs'
        " to toggle tiles); use idle, active, sent",
        'scene.movie: the "sent" word must be text',
    ]
    # Any control character or line separator is refused, as Aivi does.
    for word in ("Open\tnow", "Open\x00", "Open\x85now", "Open\u2028now"):
        assert state_text_errors(
            {"actions__options": {"cover.garage": {"state_text_on": word}}}
        ), word
    # Format characters are allowed in words (a joined emoji, a bidi mark).
    assert not state_text_errors(
        {"actions__options": {"cover.garage": {"state_text_on": "Open \u200d🔒"}}}
    )
    # Trimmed first: surrounding spaces do not count.
    assert (
        state_text_errors(
            {"actions__options": {"cover.garage": {"state_text_on": f"  {'x' * 24}  "}}}
        )
        == []
    )


async def test_saving_refuses_bad_words(hass: HomeAssistant, hass_ws_client) -> None:
    await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, data={"token": "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    async def save(options: dict[str, str]) -> dict[str, Any]:
        await client.send_json_auto_id(
            {
                "type": "aivi/save",
                "entry_id": entry.entry_id,
                "slug": "livingroom",
                "name": "Living room",
                "template": "switchboard",
                "bindings": {
                    "actions": ["cover.garage"],
                    "actions__options": {"cover.garage": options},
                },
            }
        )
        return await client.receive_json()

    msg = await save({"state_text_on": "x" * 30})
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"
    assert msg["error"]["message"] == (
        'Invalid state words: cover.garage: the "on" word must be at most 24 characters'
    )
    assert not entry.subentries

    msg = await save({"state_text_on": "Up", "state_text_off": ""})
    assert msg["success"]
    await hass.async_block_till_done()
    (subentry,) = entry.subentries.values()
    # The hidden word is stored as "", so it keeps hiding.
    assert subentry.data["bindings"]["actions__options"]["cover.garage"] == {
        "state_text_on": "Up",
        "state_text_off": "",
    }


async def test_the_metadata_describes_the_words(
    hass: HomeAssistant, hass_ws_client
) -> None:
    await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, data={"token": "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "aivi/templates"})
    msg = await client.receive_json()
    (field,) = (
        f
        for f in msg["result"]["templates"]["switchboard"]["fields"]
        if f["key"] == "actions"
    )
    assert field["state_text"]["keys"]["button"] == ["idle", "active", "sent"]
    assert field["state_text"]["max"] == 24
    assert field["state_text"]["auto"]["cover"] == OPEN_CLOSED
    assert "lock" in field["state_text"]["toggle_domains"]
    assert "state_text_turning_on" in field["row_options"]
    assert {"cover", "lock", "valve"} <= set(field["filter"]["domain"])
