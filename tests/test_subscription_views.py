"""The subscription as the diagnostics and the panel see it."""

from __future__ import annotations

import asyncio
import logging

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.aivi.diagnostics import async_get_config_entry_diagnostics
from helpers import (
    LAPSED,
    two_widgets,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_diagnostics_expose_the_subscription(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["subscription"] == {
        "state": "active",
        "expires_at": None,
        "renews": True,
        "expired_at": None,
        "paused": False,
        "code": None,
    }

    entry.runtime_data.async_subscription_inactive(LAPSED)
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["subscription"] == {
        "state": "expired",
        "expires_at": None,
        "renews": None,
        "expired_at": "2026-09-01T12:00:00+00:00",
        "paused": True,
        "code": "subscription_inactive",
    }
    assert {w["status"] for w in diagnostics["widgets"]} == {"no_subscription"}


async def test_the_panel_sees_and_settles_the_subscription(
    hass: HomeAssistant, hass_ws_client, fake_client, caplog
) -> None:
    caplog.set_level(logging.INFO)
    await async_setup_component(hass, "websocket_api", {})
    entry = await two_widgets(hass)
    client = await hass_ws_client(hass)

    async def call(msg: dict) -> dict:
        await client.send_json_auto_id(msg)
        return await client.receive_json()

    msg = await call({"type": "aivi/config"})
    assert msg["result"]["accounts"][0]["subscription"] == "active"

    # A refused listing says why, and pauses the account.
    fake_client.subscription = LAPSED
    for kind in ("widgets", "activities"):
        msg = await call({"type": f"aivi/{kind}", "entry_id": entry.entry_id})
        assert not msg["success"]
        assert msg["error"]["code"] == "subscription_inactive"
    assert entry.runtime_data.inactive is not None
    msg = await call({"type": "aivi/config"})
    assert msg["result"]["accounts"][0]["subscription"] == "inactive"

    # An answered listing proves it renewed.
    fake_client.subscription = None
    msg = await call({"type": "aivi/widgets", "entry_id": entry.entry_id})
    assert msg["success"]
    await hass.async_block_till_done()
    assert entry.runtime_data.inactive is None
    msg = await call({"type": "aivi/config"})
    assert msg["result"]["accounts"][0]["subscription"] == "active"


async def test_the_panel_checks_a_paused_account_once_before_listing(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    """While paused, opening the panel asks Aivi about the subscription
    once for both listings, and lists nothing until it is active."""
    await async_setup_component(hass, "websocket_api", {})
    entry = await two_widgets(hass)
    client = await hass_ws_client(hass)
    fake_client.subscription = LAPSED
    entry.runtime_data.async_subscription_inactive(LAPSED)
    checks, listings = fake_client.access_checks, fake_client.listings

    for kind in ("widgets", "activities"):
        await client.send_json_auto_id(
            {"type": f"aivi/{kind}", "entry_id": entry.entry_id}
        )
    for _ in range(2):
        msg = await client.receive_json()
        assert msg["error"]["code"] == "subscription_inactive"
    assert fake_client.access_checks - checks == 1
    assert fake_client.listings == listings

    # Renewed: the check resumes the account and the listing follows.
    fake_client.subscription = None
    await client.send_json_auto_id({"type": "aivi/widgets", "entry_id": entry.entry_id})
    msg = await client.receive_json()
    assert msg["success"]
    assert entry.runtime_data.inactive is None
    assert fake_client.listings == listings + 1


async def test_concurrent_subscription_checks_share_one_request(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    fake_client.subscription = LAPSED
    before = fake_client.access_checks
    assert await asyncio.gather(
        runtime.async_check_subscription(), runtime.async_check_subscription()
    ) == [False, False]
    assert fake_client.access_checks - before == 1
    # Once answered, the next check asks again.
    fake_client.subscription = None
    assert await runtime.async_check_subscription() is True
    assert fake_client.access_checks - before == 2
