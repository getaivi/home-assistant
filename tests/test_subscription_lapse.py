"""An account whose subscription lapses: the first 402 from any call pauses
every binding and the stream behind one repair issue, and the other
accounts carry on."""

from __future__ import annotations

from datetime import timedelta

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.aivi.api import AiviSubscriptionError
from custom_components.aivi.const import CONF_TOKEN, DATA_CLIENT_FACTORY, DOMAIN
from custom_components.aivi.push import RETRY_BACKOFF, PushStatus
from custom_components.aivi.runtime import subscription_issue_id
from helpers import (
    LAPSED,
    FakeAiviClient,
    account_entry,
    advance_past_debounce,
    hour_later,
    issue_ids,
    press_event,
    subentry_id_of,
    subscription_issue,
    two_widgets,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _porch(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("scene.movie", "scening")
    entry = account_entry(
        hass,
        widget_subentry("porch", "Porch", "switchboard", {"actions": ["scene.movie"]}),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_a_push_402_pauses_the_whole_account(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    fake_client.subscription = LAPSED
    hass.states.async_set("sensor.washer_progress", "70")
    hass.states.async_set("binary_sensor.door", "on")
    await advance_past_debounce(hass)

    assert runtime.inactive is LAPSED
    for manager in runtime.managers.values():
        assert manager.paused
        assert manager.status is PushStatus.NO_SUBSCRIPTION
        assert manager.last_error is None
    # One issue for the account, none per binding.
    assert issue_ids(hass) == {subscription_issue_id(entry.entry_id)}
    issue = subscription_issue(hass, entry)
    assert issue is not None
    assert issue.is_fixable
    assert issue.translation_key == "subscription_expired"
    assert issue.translation_placeholders == {
        "account": "aivi",
        "expired": "2026-09-01",
    }
    assert (
        issue.learn_more_url == "https://docs.getaivi.app/home-assistant/integration/"
    )
    assert caplog.text.count("has no active subscription") == 1
    assert "Aivi push for" not in caplog.text

    # Paused: state is still followed, nothing is sent.
    attempts = fake_client.push_attempts
    hass.states.async_set("sensor.washer_progress", "71")
    await advance_past_debounce(hass)
    assert fake_client.push_attempts == attempts


async def test_pausing_drops_a_scheduled_retry(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    laundry = entry.runtime_data.managers[subentry_id_of(entry, "laundry")]
    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert laundry.status is PushStatus.RETRYING

    fake_client.reachable = True
    entry.runtime_data.async_subscription_inactive(LAPSED)
    attempts = fake_client.push_attempts
    async_fire_time_changed(
        hass, dt_util.utcnow() + timedelta(seconds=RETRY_BACKOFF[-1] + 1)
    )
    await hass.async_block_till_done()
    assert fake_client.push_attempts == attempts
    assert laundry.status is PushStatus.NO_SUBSCRIPTION


async def test_a_stream_402_pauses_the_account_without_reconnecting(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await _porch(hass)
    runtime = entry.runtime_data
    stream = runtime.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")
    # A delivered event makes the reconnect immediate.
    fake_client.emit(press_event("other"))
    fake_client.subscription = AiviSubscriptionError()
    fake_client.close_stream()
    await until(hass, lambda: runtime.inactive is not None, "inactive")
    await hass.async_block_till_done()

    assert runtime.commands is None
    assert fake_client.stream_opens == 1
    assert all(manager.paused for manager in runtime.managers.values())
    issue = subscription_issue(hass, entry)
    assert issue is not None
    assert issue.translation_key == "subscription_inactive"
    assert issue.translation_placeholders == {"account": "aivi"}


async def test_setup_while_inactive_succeeds_paused(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.subscription = LAPSED
    fake_client.missing_slugs = {"laundry"}
    entry = await two_widgets(hass)

    assert entry.state is ConfigEntryState.LOADED
    inactive = entry.runtime_data.inactive
    assert inactive is not None and inactive.expired_at == LAPSED.expired_at
    # GET /account said so: nothing was listed.
    assert fake_client.listings == 0
    assert fake_client.push_attempts == 0
    assert all(m.paused for m in entry.runtime_data.managers.values())
    # Nothing could be listed, so no binding is reported missing.
    assert issue_ids(hass) == {subscription_issue_id(entry.entry_id)}
    state = hass.states.get("sensor.laundry_update_status")
    assert state is not None
    assert state.state == "no_subscription"


async def test_a_switchboard_stream_waits_for_the_renewal(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    fake_client.subscription = LAPSED
    entry = await _porch(hass)
    assert entry.runtime_data.commands is None
    assert fake_client.stream_opens == 0

    fake_client.subscription = None
    await hour_later(hass, freezer)
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "stream open")


async def test_a_later_402_with_another_date_updates_the_issue(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.subscription = AiviSubscriptionError()
    entry = await two_widgets(hass)
    issue = subscription_issue(hass, entry)
    assert issue is not None
    assert issue.translation_key == "subscription_inactive"

    entry.runtime_data.async_subscription_inactive(LAPSED)
    issue = subscription_issue(hass, entry)
    assert issue is not None
    assert issue.translation_key == "subscription_expired"


async def test_unloading_withdraws_the_issue(hass: HomeAssistant, fake_client) -> None:
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    assert subscription_issue(hass, entry) is not None
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert subscription_issue(hass, entry) is None


async def test_one_account_lapsing_leaves_the_others_alone(
    hass: HomeAssistant, hass_ws_client, freezer, widgets
) -> None:
    clients = {"a": FakeAiviClient(widgets), "b": FakeAiviClient(widgets)}
    hass.data[DATA_CLIENT_FACTORY] = lambda _hass, _url, token: clients[token]
    await async_setup_component(hass, "websocket_api", {})
    hass.states.async_set("sensor.a", "10")
    hass.states.async_set("sensor.b", "10")
    entries = {}
    for token in clients:
        entry = MockConfigEntry(
            domain=DOMAIN,
            data={CONF_TOKEN: token},
            title=f"Account {token}",
            subentries_data=[
                widget_subentry(
                    "laundry", "Laundry", "progress", {"progress": f"sensor.{token}"}
                )
            ],
        )
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        entries[token] = entry
    await hass.async_block_till_done()
    # Connected first: the hour below would expire its access token.
    client = await hass_ws_client(hass)

    clients["b"].subscription = LAPSED
    hass.states.async_set("sensor.a", "20")
    hass.states.async_set("sensor.b", "20")
    await advance_past_debounce(hass)
    assert entries["a"].runtime_data.inactive is None
    assert entries["b"].runtime_data.inactive is not None
    assert issue_ids(hass) == {subscription_issue_id(entries["b"].entry_id)}

    # The other account keeps pushing, and only the paused one is checked.
    pushed = len(clients["a"].pushes)
    hass.states.async_set("sensor.a", "30")
    await advance_past_debounce(hass)
    assert len(clients["a"].pushes) == pushed + 1
    checks = {token: client.access_checks for token, client in clients.items()}
    await hour_later(hass, freezer)
    assert clients["a"].access_checks == checks["a"]
    assert clients["b"].access_checks == checks["b"] + 1

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    assert {a["title"]: a["subscription"] for a in msg["result"]["accounts"]} == {
        "Account a": "active",
        "Account b": "inactive",
    }
    assert {a["title"]: a["subscription_ended"] for a in msg["result"]["accounts"]} == {
        "Account a": None,
        "Account b": LAPSED.expired_at.isoformat(),
    }
