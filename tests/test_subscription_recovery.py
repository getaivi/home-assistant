"""A paused account resumes once Aivi answers again: on the hourly check, or
from the repair flow."""

from __future__ import annotations

import pytest
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from custom_components.aivi.const import CONF_TOKEN, DOMAIN
from custom_components.aivi.push import PushStatus
from custom_components.aivi.runtime import subscription_issue_id
from helpers import (
    LAPSED,
    advance_past_debounce,
    hour_later,
    subscription_issue,
    two_widgets,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_the_hourly_check_resumes_every_binding(
    hass: HomeAssistant, fake_client, freezer, caplog
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    pushed = len(fake_client.pushes)
    fake_client.subscription = LAPSED
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert runtime.inactive is not None

    # Still inactive an hour later: nothing changes.
    checks = fake_client.access_checks
    await hour_later(hass, freezer)
    assert fake_client.access_checks == checks + 1
    assert runtime.inactive is not None
    assert subscription_issue(hass, entry) is not None

    # A failed check is tried again the next hour.
    fake_client.reachable = False
    await hour_later(hass, freezer)
    assert runtime.inactive is not None

    fake_client.reachable = True
    fake_client.subscription = None
    await hour_later(hass, freezer)
    assert runtime.inactive is None
    assert subscription_issue(hass, entry) is None
    assert caplog.text.count("is active again") == 1
    # Every binding pushes once, even the one whose content the phone
    # already had.
    assert sorted(slug for slug, _ in fake_client.pushes[pushed:]) == [
        "frontdoor",
        "laundry",
    ]
    for manager in runtime.managers.values():
        assert manager.status is PushStatus.OK

    # No more hourly checks once active.
    checks = fake_client.access_checks
    await hour_later(hass, freezer)
    assert fake_client.access_checks == checks


async def test_a_rejected_token_during_the_check_starts_reauth(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    fake_client.auth_ok = False
    await hour_later(hass, freezer)
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert [flow["context"]["source"] for flow in flows] == ["reauth"]
    assert entry.runtime_data.inactive is not None


async def test_the_repair_flow_checks_again(hass: HomeAssistant, fake_client) -> None:
    assert await async_setup_component(hass, "repairs", {})
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    manager = repairs_flow_manager(hass)
    assert manager is not None
    issue_id = subscription_issue_id(entry.entry_id)

    result = await manager.async_init(DOMAIN, data={"issue_id": issue_id})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "confirm"
    assert result["description_placeholders"] == {
        "account": "aivi",
        "expired": "2026-09-01",
    }
    # Not renewed: a step that says so, ready to ask again.
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "still_inactive"
    assert result["description_placeholders"] == {
        "account": "aivi",
        "expired": "2026-09-01",
    }
    assert subscription_issue(hass, entry) is not None

    fake_client.reachable = False
    result = await manager.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "cannot_connect"

    # Renewed: the same dialog's next check resolves the issue.
    fake_client.reachable = True
    fake_client.subscription = None
    result = await manager.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert subscription_issue(hass, entry) is None
    assert entry.runtime_data.inactive is None
    assert {slug for slug, _ in fake_client.pushes} == {"laundry", "frontdoor"}


async def test_the_repair_flow_needs_a_running_account(
    hass: HomeAssistant, fake_client
) -> None:
    assert await async_setup_component(hass, "repairs", {})
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    manager = repairs_flow_manager(hass)
    assert manager is not None
    issue_id = subscription_issue_id(entry.entry_id)

    result = await manager.async_init(DOMAIN, data={"issue_id": issue_id})
    fake_client.auth_ok = False
    result = await manager.async_configure(result["flow_id"], {})
    assert result["reason"] == "auth_failed"

    result = await manager.async_init(DOMAIN, data={"issue_id": issue_id})
    hass.config_entries.async_update_entry(entry, data={CONF_TOKEN: "other"})
    entry.mock_state(hass, ConfigEntryState.NOT_LOADED)
    result = await manager.async_configure(result["flow_id"], {})
    assert result["reason"] == "not_loaded"
