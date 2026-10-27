"""The account's Subscription and Health sensors: what they say, and that
the subscription status stays current without calling Aivi more than the
renewal check and a 12-hour refresh do."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi.api import (
    AiviError,
    AiviSubscriptionError,
    SubscriptionState,
    SubscriptionStatus,
)
from custom_components.aivi.push import RETRY_BACKOFF
from custom_components.aivi.runtime import REFRESH_INTERVAL
from helpers import (
    EXPIRED,
    LAPSED,
    advance,
    advance_past_debounce,
    hour_later,
    porch_subentry,
    setup_porch,
    two_widgets,
    until,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")

SUBSCRIPTION = "sensor.aivi_subscription"
PROBLEM = "binary_sensor.aivi_health"
ENDS = datetime(2026, 11, 1, 9, tzinfo=UTC)


def _subscription(hass: HomeAssistant) -> tuple[str, dict]:
    state = hass.states.get(SUBSCRIPTION)
    assert state is not None
    return state.state, dict(state.attributes)


def _problem(hass: HomeAssistant) -> tuple[str, dict]:
    state = hass.states.get(PROBLEM)
    assert state is not None
    attributes = dict(state.attributes)
    for key in ("device_class", "friendly_name", "icon"):
        attributes.pop(key, None)
    return state.state, attributes


async def test_both_sensors_hang_off_the_account_enabled_and_diagnostic(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    fake_client.active = SubscriptionStatus(
        SubscriptionState.ACTIVE, expires_at=ENDS, renews=False
    )
    entry = await two_widgets(hass)
    for entity_id, unique_id in (
        (SUBSCRIPTION, f"{entry.entry_id}_subscription"),
        (PROBLEM, f"{entry.entry_id}_problem"),
    ):
        registered = entity_registry.async_get(entity_id)
        assert registered is not None
        assert registered.unique_id == unique_id
        assert registered.disabled_by is None
        assert registered.entity_category is EntityCategory.DIAGNOSTIC
    state, attributes = _subscription(hass)
    assert state == "active"
    assert attributes["options"] == ["active", "expired", "none"]
    assert attributes["expires_at"] == ENDS.isoformat()
    assert attributes["renews"] is False
    assert "expired_at" not in attributes
    assert _problem(hass) == ("off", {"problems": []})


@pytest.mark.parametrize(
    ("refusal", "state", "attributes"),
    [
        (LAPSED, "expired", {"expired_at": EXPIRED.isoformat()}),
        (AiviSubscriptionError(), "none", {}),
    ],
    ids=["expired", "never"],
)
async def test_setup_without_a_subscription(
    hass: HomeAssistant,
    fake_client,
    refusal: AiviSubscriptionError,
    state: str,
    attributes: dict,
) -> None:
    fake_client.subscription = refusal
    await two_widgets(hass)
    sensor, shown = _subscription(hass)
    assert sensor == state
    assert {k: v for k, v in shown.items() if k in ("expired_at", "expires_at")} == (
        attributes
    )
    # A paused binding is not a problem of its own: the subscription is.
    assert _problem(hass) == ("on", {"problems": [], "subscription": state})


@pytest.mark.parametrize(
    ("refusal", "state"),
    [(LAPSED, "expired"), (AiviSubscriptionError(), "none")],
    ids=["expired", "never"],
)
async def test_a_402_updates_the_status_without_asking(
    hass: HomeAssistant, fake_client, refusal: AiviSubscriptionError, state: str
) -> None:
    entry = await two_widgets(hass)
    checks = fake_client.access_checks
    fake_client.subscription = refusal
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert entry.runtime_data.subscription == SubscriptionStatus.refused(refusal)
    assert _subscription(hass)[0] == state
    assert _problem(hass)[0] == "on"
    assert fake_client.access_checks == checks


async def test_the_hourly_check_keeps_the_status_and_nothing_more_while_paused(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    checks = fake_client.access_checks
    # A day paused: one check an hour, the 12-hour refresh never on top.
    for _ in range(24):
        await hour_later(hass, freezer)
    assert fake_client.access_checks == checks + 24
    assert _subscription(hass)[0] == "expired"

    # A later lapse date, as Aivi says it.
    later = EXPIRED + timedelta(days=30)
    fake_client.subscription = AiviSubscriptionError(expired_at=later)
    await hour_later(hass, freezer)
    assert _subscription(hass)[1]["expired_at"] == later.isoformat()

    fake_client.subscription = None
    fake_client.active = SubscriptionStatus(
        SubscriptionState.ACTIVE, expires_at=ENDS, renews=True
    )
    await hour_later(hass, freezer)
    assert entry.runtime_data.inactive is None
    state, attributes = _subscription(hass)
    assert (state, attributes["expires_at"], attributes["renews"]) == (
        "active",
        ENDS.isoformat(),
        True,
    )
    assert _problem(hass) == ("off", {"problems": []})


async def test_an_active_account_is_refreshed_every_12_hours(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    entry = await two_widgets(hass)
    checks = fake_client.access_checks
    fake_client.active = SubscriptionStatus(
        SubscriptionState.ACTIVE, expires_at=ENDS, renews=False
    )
    freezer.tick(REFRESH_INTERVAL - timedelta(minutes=1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert fake_client.access_checks == checks
    assert _subscription(hass)[1]["renews"] is True

    freezer.tick(timedelta(minutes=1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert fake_client.access_checks == checks + 1
    assert _subscription(hass)[1] == {
        **_subscription(hass)[1],
        "expires_at": ENDS.isoformat(),
        "renews": False,
    }

    # The paid period ended without renewing: the refresh pauses the account.
    fake_client.subscription = AiviSubscriptionError(expired_at=ENDS)
    freezer.tick(REFRESH_INTERVAL)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert entry.runtime_data.inactive is not None
    assert _subscription(hass)[0] == "expired"
    assert all(m.paused for m in entry.runtime_data.managers.values())


async def test_a_failed_refresh_keeps_what_was_known(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    await two_widgets(hass)
    fake_client.reachable = False
    freezer.tick(REFRESH_INTERVAL)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert _subscription(hass)[0] == "active"


async def test_a_check_from_the_panel_or_repair_updates_the_status(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    fake_client.active = SubscriptionStatus(
        SubscriptionState.ACTIVE, expires_at=ENDS, renews=True
    )
    assert await runtime.async_check_subscription()
    await hass.async_block_till_done()
    assert _subscription(hass)[1]["expires_at"] == ENDS.isoformat()

    fake_client.subscription = LAPSED
    assert not await runtime.async_check_subscription()
    await hass.async_block_till_done()
    assert _subscription(hass)[0] == "expired"
    assert runtime.inactive is not None


async def test_resuming_on_another_call_asks_for_the_details_once(
    hass: HomeAssistant, fake_client
) -> None:
    """An answered listing resumes a paused account; the end date is then
    asked for once."""
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    runtime.async_subscription_inactive(LAPSED)
    await hass.async_block_till_done()
    assert _subscription(hass)[0] == "expired"

    fake_client.active = SubscriptionStatus(
        SubscriptionState.ACTIVE, expires_at=ENDS, renews=True
    )
    checks = fake_client.access_checks
    await runtime.async_subscription_active()
    await hass.async_block_till_done()
    assert fake_client.access_checks == checks + 1
    assert _subscription(hass)[1]["expires_at"] == ENDS.isoformat()
    # Already active: another answered call asks nothing.
    await runtime.async_subscription_active()
    await hass.async_block_till_done()
    assert fake_client.access_checks == checks + 1


async def test_a_failing_binding_is_a_problem_until_it_recovers(
    hass: HomeAssistant, fake_client
) -> None:
    await two_widgets(hass)
    fake_client.missing_slugs = {"laundry"}
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert _problem(hass) == (
        "on",
        {"problems": [{"name": "Laundry", "slug": "laundry", "status": "not_found"}]},
    )

    fake_client.missing_slugs = set()
    hass.states.async_set("sensor.washer_progress", "75")
    await advance_past_debounce(hass)
    assert _problem(hass) == ("off", {"problems": []})


async def test_a_retry_is_a_problem_only_once_it_fails_again(
    hass: HomeAssistant, fake_client
) -> None:
    await two_widgets(hass)
    fake_client.push_error = AiviError("Aivi API returned 503")
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    status = hass.states.get("sensor.laundry_update_status")
    assert status is not None and status.state == "retrying"
    assert _problem(hass)[0] == "off"

    await advance(hass, RETRY_BACKOFF[0] + 1)
    assert _problem(hass) == (
        "on",
        {"problems": [{"name": "Laundry", "slug": "laundry", "status": "retrying"}]},
    )

    fake_client.push_error = None
    await advance(hass, RETRY_BACKOFF[1] + 1)
    assert _problem(hass) == ("off", {"problems": []})


async def test_a_removed_binding_takes_its_problem_along(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    fake_client.missing_slugs = {"laundry"}
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert _problem(hass)[0] == "on"

    laundry = next(
        subentry_id
        for subentry_id, subentry in entry.subentries.items()
        if subentry.data["slug"] == "laundry"
    )
    hass.config_entries.async_remove_subentry(entry, laundry)
    await hass.async_block_till_done()
    assert _problem(hass) == ("off", {"problems": []})


async def test_a_stream_stopped_for_the_token_is_a_problem(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    await until(hass, lambda: runtime.commands.health.connected, "open")
    assert _problem(hass)[0] == "off"

    fake_client.auth_ok = False
    fake_client.close_stream()
    await until(hass, lambda: runtime.inputs.health.ended, "stopped")
    await hass.async_block_till_done()
    state, attributes = _problem(hass)
    assert state == "on"
    assert attributes["event_stream"] == "auth_failed"


async def test_a_402_on_the_check_itself_reads_as_the_lapse(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """GET /account answers whatever the subscription; should it answer
    402 anyway, the refusal says how the subscription stands."""
    entry = await two_widgets(hass)

    async def refused() -> SubscriptionStatus:
        raise LAPSED

    monkeypatch.setattr(fake_client, "get_subscription", refused)
    assert not await entry.runtime_data.async_check_subscription()
    await hass.async_block_till_done()
    assert _subscription(hass)[0] == "expired"


async def test_a_check_that_ends_after_unload_starts_no_timer(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    fake_client.subscription = LAPSED
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    fake_client.subscription = None
    gate = asyncio.Event()
    answer = fake_client.get_subscription

    async def slow() -> SubscriptionStatus:
        await gate.wait()
        return await answer()

    fake_client.get_subscription = slow
    checking = asyncio.ensure_future(runtime.async_check_subscription())
    await asyncio.sleep(0)
    await runtime.async_stop()
    gate.set()
    assert await checking
    fake_client.get_subscription = answer
    checks = fake_client.access_checks
    freezer.tick(REFRESH_INTERVAL)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert fake_client.access_checks == checks
