"""Removing an activity binding, or its account, ends the Live Activity on
the phone; a paused account sends nothing."""

from __future__ import annotations

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from custom_components.aivi.api import AiviError
from helpers import (
    LAPSED,
    account_entry,
    activity_subentry,
    subentry_id_of,
    two_widgets,
    washer_activity,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_removing_an_activity_binding_ends_the_activity(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    subentry_id = next(iter(entry.subentries))
    assert fake_client.activity_pushes[-1][:2] == ("washer", "ONGOING")
    hass.config_entries.async_remove_subentry(entry, subentry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    slug, state, content = fake_client.activity_pushes[-1]
    assert (slug, state) == ("washer", "IDLE")
    assert content["progress"]["value"] == 0.4


async def test_ending_an_activity_ignores_failures(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    pushed = len(fake_client.activity_pushes)
    fake_client.push_error = AiviError("down")
    hass.config_entries.async_remove_subentry(entry, next(iter(entry.subentries)))
    await hass.async_block_till_done(wait_background_tasks=True)
    assert len(fake_client.activity_pushes) == pushed
    assert entry.state is ConfigEntryState.LOADED


async def test_removing_a_widget_binding_sends_nothing(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    pushed = fake_client.push_attempts
    hass.config_entries.async_remove_subentry(entry, subentry_id_of(entry, "laundry"))
    await hass.async_block_till_done(wait_background_tasks=True)
    assert fake_client.push_attempts == pushed


async def test_removing_bindings_of_a_paused_account_sends_nothing(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.subscription = LAPSED
    entry = await washer_activity(hass)
    hass.config_entries.async_remove_subentry(entry, next(iter(entry.subentries)))
    await hass.async_block_till_done(wait_background_tasks=True)
    assert fake_client.push_attempts == 0


async def test_removing_the_account_ends_its_activities(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("binary_sensor.grill_on", "off")
    hass.states.async_set("sensor.washer_progress", "40")
    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.grill_on",
            {"progress": "sensor.washer_progress"},
        ),
        activity_subentry("grill", "Grill", "progress", "binary_sensor.grill_on", {}),
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    pushes = len(fake_client.pushes)
    fake_client.activity_pushes.clear()

    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    # The grill resolves no content (its progress is required), so it has
    # nothing to end with; widgets keep their last content.
    assert [(slug, state) for slug, state, _ in fake_client.activity_pushes] == [
        ("washer", "IDLE")
    ]
    assert len(fake_client.pushes) == pushes


async def test_removing_a_paused_account_sends_nothing(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.subscription = LAPSED
    entry = await washer_activity(hass)
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.push_attempts == 0
