"""A switchboard's content size: measured the way Aivi measures it, and never
sent over the 4 KiB cap."""

from __future__ import annotations

import json
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.aivi import engine
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import DOMAIN
from custom_components.aivi.sources import HassStateResolver
from custom_components.aivi.switchboard import (
    MAX_CONTENT_BYTES,
    content_size,
)
from custom_components.aivi.templates import SWITCHBOARD
from helpers import (
    account_entry,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def _stored_size(stored: dict[str, Any]) -> int:
    return len(json.dumps(stored, separators=(",", ":")))


def test_content_size_counts_what_aivi_stores() -> None:
    content = {"actions": [{"id": "a", "label": "A", "icon": "power"}]}
    stored = {
        "icon": None,
        "accent": None,
        "tap_url": None,
        "template": "switchboard",
        "actions": [
            {
                "id": "a",
                "label": "A",
                "subtitle": None,
                "icon": "power",
                "color": None,
                "gradient": None,
                "image": None,
                "kind": "button",
                "active": False,
            }
        ],
    }
    assert content_size(content) == _stored_size(stored)
    toggle = {
        "icon": {"name": "bolt", "primary_color": "red"},
        "tap_url": "https://example.com",
        "actions": [
            {
                "id": "t",
                "label": "Bürolicht",  # escaped as \\u00fc, like Aivi measures
                "icon": "power",
                "kind": "toggle",
                "on": True,
                "subtitle": {"value": "Hall"},
                "image": {"url": "https://e.com/x.png"},
                "state_text": {"on": "", "off": "Aus", "no_response": None},
            }
        ],
    }
    stored_toggle = {
        "icon": {
            "name": "bolt",
            "rendering_mode": None,
            "primary_color": "red",
            "secondary_color": None,
            "tertiary_color": None,
            "color_rendering": None,
        },
        "accent": None,
        # A URL with no path is stored with one.
        "tap_url": "https://example.com/",
        "template": "switchboard",
        "actions": [
            {
                "id": "t",
                "label": "Bürolicht",
                "subtitle": {"value": "Hall", "text_color": None, "formatter": None},
                "icon": "power",
                "color": None,
                "gradient": None,
                "image": {"url": "https://e.com/x.png", "alt": None},
                "kind": "toggle",
                "on": True,
                # Only the words that are set; "" hides one and is kept.
                "state_text": {"on": "", "off": "Aus"},
            }
        ],
    }
    assert content_size(toggle) == _stored_size(stored_toggle)
    del stored_toggle["actions"][0]["state_text"]
    assert content_size(toggle, state_text=False) == _stored_size(stored_toggle)


def _big_bindings(n: int = 8, url_len: int = 460) -> dict[str, Any]:
    ids = [f"scene.s{i}" for i in range(n)]
    return {
        "actions": ids,
        "actions__options": {
            eid: {"image": "https://img.example.com/" + "p" * url_len} for eid in ids
        },
    }


async def test_oversized_content_is_never_sent(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    for i in range(8):
        hass.states.async_set(f"scene.s{i}", "scening", {"friendly_name": f"S{i}"})
    content = engine.resolve(SWITCHBOARD, _big_bindings(), HassStateResolver(hass))
    assert content is not None and content_size(content) > MAX_CONTENT_BYTES
    entry = account_entry(
        hass,
        widget_subentry("livingroom", "Living room", "switchboard", _big_bindings()),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.pushes == []
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager.last_error is not None
    assert "over the Aivi limit of 4096; not sent" in manager.last_error
    assert "over the Aivi limit" in caplog.text
    subentry_id = next(iter(entry.subentries))
    issue = ir.async_get(hass).async_get_issue(
        DOMAIN, f"content_too_large_{subentry_id}"
    )
    assert issue is not None

    # Shorter URLs: it pushes, and the issue goes.
    hass.config_entries.async_update_subentry(
        entry,
        entry.subentries[subentry_id],
        data={
            **entry.subentries[subentry_id].data,
            "bindings": _big_bindings(url_len=40),
        },
    )
    await hass.async_block_till_done()
    assert len(fake_client.pushes) == 1
    assert (
        ir.async_get(hass).async_get_issue(DOMAIN, f"content_too_large_{subentry_id}")
        is None
    )
