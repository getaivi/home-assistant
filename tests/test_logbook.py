"""The logbook lines a press leaves."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import Event, HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import (
    DOMAIN,
    EVENT_ACTION,
)
from custom_components.aivi.logbook import async_describe_events, describe_press
from helpers import (
    account_entry,
    porch_subentry,
    setup_porch,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("hall", "Hall", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
    ]


async def test_logbook_lines_read_as_presses(hass: HomeAssistant) -> None:
    hass.states.async_set("cover.garage", "closed", {"friendly_name": "Garage"})
    await setup_porch(
        hass,
        porch_subentry(
            ["light.porch", "scene.movie", "cover.garage"],
            **{"scene.movie": {"label": "Film"}},
        ),
    )
    described: list[tuple[str, str, Any]] = []
    async_describe_events(
        hass, lambda domain, event_type, fn: described.append((domain, event_type, fn))
    )
    ((domain, event_type, describe),) = described
    assert (domain, event_type) == (DOMAIN, EVENT_ACTION)

    def line(data: dict[str, Any]) -> dict[str, str]:
        return describe(Event(EVENT_ACTION, {"slug": "porch", **data}))

    assert line({"action": "light_porch", "action_kind": "toggle", "value": True}) == {
        "name": "Porch",
        "message": "Porch light turned on from the widget",
        "entity_id": "light.porch",
    }
    assert line({"action": "scene_movie", "action_kind": "button"})["message"] == (
        "Film tile pressed"
    )
    assert line({"action": "cover_garage", "action_kind": "toggle", "value": False})[
        "message"
    ] == ("Garage closed from the widget")
    # A widget this install does not bind still reads.
    assert describe_press(
        hass,
        {"slug": "elsewhere", "action": "fan", "action_kind": "toggle", "value": True},
    ) == {"name": "elsewhere", "message": "fan turned on from the widget"}


async def test_a_sourced_tile_label_reads_as_the_tile_shows_it(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("sensor.porch_name", "Front porch")
    await setup_porch(
        hass,
        porch_subentry(
            ["light.porch"], **{"light.porch": {"label__entity": "sensor.porch_name"}}
        ),
    )
    assert fake_client.last_push[1]["actions"][0]["label"] == "Front porch"
    line = describe_press(
        hass,
        {
            "slug": "porch",
            "action": "light_porch",
            "action_kind": "toggle",
            "value": True,
        },
    )
    assert line["message"] == "Front porch turned on from the widget"


async def test_logbook_lines_name_the_account_that_received_the_press(
    hass: HomeAssistant,
) -> None:
    """Slugs are unique per account only: two accounts may each have a
    `porch` switchboard, bound to different entities."""
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    hass.states.async_set("light.shed", "off", {"friendly_name": "Shed light"})
    first = account_entry(hass, porch_subentry(["light.porch"]))
    second = MockConfigEntry(
        domain=DOMAIN,
        data={"token": "other"},
        title="aivi 2",
        subentries_data=[
            widget_subentry("porch", "Shed", "switchboard", {"actions": ["light.shed"]})
        ],
    )
    second.add_to_hass(hass)
    assert await hass.config_entries.async_setup(first.entry_id)
    await hass.async_block_till_done()

    def line(entry_id: str, action: str) -> dict[str, str]:
        return describe_press(
            hass,
            {
                "slug": "porch",
                "entry_id": entry_id,
                "action": action,
                "action_kind": "toggle",
                "value": True,
            },
        )

    assert line(first.entry_id, "light_porch")["entity_id"] == "light.porch"
    assert line(second.entry_id, "light_shed") == {
        "name": "Shed",
        "message": "Shed light turned on from the widget",
        "entity_id": "light.shed",
    }
