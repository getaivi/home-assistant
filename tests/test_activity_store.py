"""Keeping the activity log across restarts: an account option, off by
default, that writes both logs to a store in debounced batches."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi.const import CONF_KEEP_LOG, DOMAIN
from custom_components.aivi.inputs import DATA_ACCOUNT_INPUTS, SAVE_DELAY
from helpers import advance_past_debounce, two_widgets

pytestmark = pytest.mark.usefixtures("inject_fake_client")


def _key(entry_id: str) -> str:
    return f"{DOMAIN}.{entry_id}.activity"


async def _quiet_spell(hass: HomeAssistant, freezer) -> None:
    """Let the write's delay pass with nothing logged meanwhile."""
    freezer.tick(SAVE_DELAY + 1)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


async def _set_option(hass: HomeAssistant, entry_id: str, keep: bool) -> None:
    result = await hass.config_entries.options.async_init(entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_KEEP_LOG: keep}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()


async def test_the_log_is_in_memory_only_until_the_option_is_on(
    hass: HomeAssistant, hass_storage, hass_ws_client, freezer
) -> None:
    await async_setup_component(hass, "websocket_api", {})
    entry = await two_widgets(hass)
    key = _key(entry.entry_id)
    inputs = entry.runtime_data.inputs
    assert inputs.pushes.rows()
    await _quiet_spell(hass, freezer)
    assert key not in hass_storage
    assert not inputs.kept

    # The option, from the entry's options flow: applied to the running
    # entry without a reload.
    await _set_option(hass, entry.entry_id, True)
    assert entry.options == {CONF_KEEP_LOG: True}
    assert entry.runtime_data.inputs is inputs
    assert inputs.kept
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "aivi/config"})
    (account,) = (await client.receive_json())["result"]["accounts"]
    assert account["keep_log"] is True

    # Writes are debounced: a push does not write at once, a quiet spell
    # does, and what was logged before the option came on is kept too.
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert key not in hass_storage
    await _quiet_spell(hass, freezer)
    stored = hass_storage[key]["data"]
    assert [row["outcome"] for row in stored["pushes"]][-1] == "delivered"
    assert len(stored["pushes"]) == len(inputs.pushes.rows())
    assert stored["presses"] == []

    # A restart: the in-memory logs are gone, the store is not. The rows
    # come back once, and a reload after that does not double them.
    hass.data.pop(DATA_ACCOUNT_INPUTS)
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    restored = entry.runtime_data.inputs
    assert restored is not inputs
    kept = len(stored["pushes"])
    rows = restored.pushes.rows()
    # The restored rows, then setup's own first pushes.
    assert len(rows) == kept + 2
    assert [row["outcome"] for row in rows[-kept:]] == [
        row["outcome"] for row in reversed(stored["pushes"])
    ]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.inputs is restored
    assert len(restored.pushes.rows()) == kept + 4

    # Off again: what was written is removed, and nothing is written later.
    await _quiet_spell(hass, freezer)  # the reload's own pushes, written
    assert key in hass_storage
    await _set_option(hass, entry.entry_id, False)
    assert key not in hass_storage
    assert not restored.kept
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    await _quiet_spell(hass, freezer)
    assert key not in hass_storage


async def test_removing_the_account_removes_its_stored_log(
    hass: HomeAssistant, hass_storage, freezer
) -> None:
    entry = await two_widgets(hass)
    key = _key(entry.entry_id)
    await _set_option(hass, entry.entry_id, True)
    await _quiet_spell(hass, freezer)
    assert key in hass_storage
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert key not in hass_storage
    assert entry.entry_id not in hass.data.get(DATA_ACCOUNT_INPUTS, {})


async def test_the_option_is_read_at_setup(hass: HomeAssistant, hass_storage) -> None:
    from pytest_homeassistant_custom_component.common import MockConfigEntry

    entry = MockConfigEntry(
        domain=DOMAIN, data={"token": "t"}, options={CONF_KEEP_LOG: True}
    )
    key = _key(entry.entry_id)
    hass_storage[key] = {
        "version": 1,
        "minor_version": 1,
        "key": key,
        "data": {
            "presses": [
                {
                    "event_type": "pressed",
                    "resource_kind": "widget",
                    "slug": "porch",
                    "outcome": "played",
                    "received_at": "2026-10-08T10:00:00+00:00",
                    "finished_at": "2026-10-08T10:00:01+00:00",
                    "details": {"action": "scene_movie", "label": "Movie night"},
                    "entity_id": "scene.movie",
                    "subentry_id": "gone",
                    "count": 1,
                },
                {"event_type": "pressed"},
                "junk",
            ],
            "pushes": [{"kind": "widget"}],
        },
    }
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    inputs = entry.runtime_data.inputs
    assert inputs.kept
    # The readable row came back; the broken ones were dropped, not fatal.
    (row,) = inputs.log.rows()
    assert row["label"] == "Movie night"
    assert row["outcome"] == "played"
    assert inputs.pushes.rows() == []
