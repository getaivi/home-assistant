"""State words and the 4 KiB cap: the words are measured as Aivi stores
them, and a full grid of them fits."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant

from custom_components.aivi import engine
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.switchboard import (
    MAX_CONTENT_BYTES,
    content_size,
)
from custom_components.aivi.templates import SWITCHBOARD
from helpers import (
    Resolver,
    account_entry,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def test_eight_covers_with_their_words_fit_the_cap() -> None:
    ids = [f"cover.garage_door_number_{i}" for i in range(8)]
    resolver = Resolver(
        states=dict.fromkeys(ids, "closing"),
        attrs={eid: {"friendly_name": "A garage door name past 24"} for eid in ids},
    )
    content = engine.resolve(
        SWITCHBOARD,
        {
            "actions": ids,
            "actions__options": {
                eid: {"subtitle": "Driveway, north side", "color": "#FF9F0A"}
                for eid in ids
            },
        },
        resolver,
    )
    assert content is not None
    assert all(a["state_text"]["off"] == "Closing" for a in content["actions"])
    size = content_size(content)
    assert size < MAX_CONTENT_BYTES
    # The words are counted as Aivi stores them: only the words that are
    # set, and no field at all on a tile without words.
    bare = [
        {k: v for k, v in a.items() if k != "state_text"} for a in content["actions"]
    ]
    assert size - content_size({**content, "actions": bare}) == 8 * len(
        ',"state_text":{"on":"Open","off":"Closing","turning_on":"Opening",'
        '"turning_off":"Closing"}'
    )


def _near_cap(hass: HomeAssistant, url_len: int) -> dict[str, Any]:
    ids = [f"cover.c{i}" for i in range(8)]
    for eid in ids:
        hass.states.async_set(eid, "closed", {"friendly_name": eid})
    return {
        "actions": ids,
        "actions__options": {
            eid: {"image": "https://img.example.com/" + "p" * url_len} for eid in ids
        },
    }


def _gap_url_len(hass: HomeAssistant) -> int:
    """An image URL length that puts eight cover tiles under the cap
    without their words, but over it with them."""
    from custom_components.aivi.sources import HassStateResolver

    for url_len in range(300, 500):
        content = engine.resolve(
            SWITCHBOARD, _near_cap(hass, url_len), HassStateResolver(hass)
        )
        assert content is not None
        if content_size(content) > MAX_CONTENT_BYTES:
            assert content_size(content, state_text=False) <= MAX_CONTENT_BYTES
            return url_len
    raise AssertionError("no gap found")


async def test_an_old_aivi_is_measured_as_it_stores(
    hass: HomeAssistant, fake_client
) -> None:
    """Until Aivi accepts the field, the cap is measured without it."""
    bindings = _near_cap(hass, _gap_url_len(hass))
    entry = account_entry(
        hass, widget_subentry("livingroom", "Living room", "switchboard", bindings)
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert len(fake_client.pushes) == 1
