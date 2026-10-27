"""Setup never blocks on Aivi, leaks nothing it started, and survives a
stored binding it cannot run."""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.aivi.blocks import EntityRows
from custom_components.aivi.const import (
    DOMAIN,
)
from custom_components.aivi.push import (
    PushStatus,
)
from helpers import (
    account_entry,
    activity_subentry,
    advance_past_debounce,
    subentry_id_of,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_setup_failing_midway_stops_what_it_started(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("scene.movie", "scening")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
        widget_subentry("porch", "Porch", "switchboard", {"actions": ["scene.movie"]}),
    )

    async def _broken(*_args: object) -> None:
        raise RuntimeError("platform setup failed")

    monkeypatch.setattr(hass.config_entries, "async_forward_entry_setups", _broken)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    pushes = len(fake_client.pushes)

    hass.states.async_set("sensor.washer_progress", "90")
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes
    # The stream was stopped too: nothing reconnects.
    opens = fake_client.stream_opens
    await asyncio.sleep(0.05)
    assert fake_client.stream_opens == opens


async def test_setup_does_not_wait_for_aivi_to_answer_pushes(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    fake_client.gate = asyncio.Event()
    async with asyncio.timeout(1):
        assert await hass.config_entries.async_setup(entry.entry_id)
    assert fake_client.pushes == []

    fake_client.gate.set()
    await hass.async_block_till_done()
    assert [slug for slug, _ in fake_client.pushes] == ["laundry"]


async def test_activities_missing_from_the_listing_are_reported_at_setup(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.activities = []
    fake_client.gate = asyncio.Event()  # no push has answered yet
    hass.states.async_set("binary_sensor.washer_running", "on")
    hass.states.async_set("sensor.washer_progress", "40")

    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.washer_running",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    subentry_id = next(iter(entry.subentries))
    assert ir.async_get(hass).async_get_issue(DOMAIN, f"activity_missing_{subentry_id}")
    fake_client.gate.set()
    await hass.async_block_till_done()


async def test_a_malformed_stored_binding_does_not_break_the_account(
    hass: HomeAssistant, fake_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _choke(*_args: object) -> None:
        raise TypeError("malformed")

    # A binding the resolver raises on fails alone.
    monkeypatch.setattr(EntityRows, "resolve", _choke)
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry("batteries", "Batteries", "battery", {"devices": [{"bad": 1}]}),
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert [slug for slug, _ in fake_client.pushes] == ["laundry"]
    broken = entry.runtime_data.managers[subentry_id_of(entry, "batteries")]
    assert broken.status is PushStatus.ERROR
