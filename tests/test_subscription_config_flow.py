"""The config flow refuses an account without an active subscription."""

from __future__ import annotations

import pytest
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi.const import CONF_TOKEN, DOMAIN
from helpers import (
    LAPSED,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_the_account_flow_blocks_an_unsubscribed_account(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.subscription = LAPSED
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "no_subscription"}


async def test_reauth_blocks_an_unsubscribed_account(
    hass: HomeAssistant, fake_client
) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "old"}, title="aivi")
    entry.add_to_hass(hass)
    result = await entry.start_reauth_flow(hass)
    fake_client.subscription = LAPSED
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "new"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "no_subscription"}
