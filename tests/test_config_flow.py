"""Account config flow behavior, driven through the real flow manager
against a fake client. Binding is panel-only (see test_websocket.py); the
integration declares no subentry flows."""

from __future__ import annotations

import pytest
from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType, UnknownHandler, section
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.aivi.config_flow import ADVANCED
from custom_components.aivi.const import (
    CONF_BASE_URL,
    CONF_NAME,
    CONF_TOKEN,
    DOMAIN,
    SUBENTRY_WIDGET,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_account_flow_accepts_a_valid_token(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "aivi_sk_valid"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_TOKEN] == "aivi_sk_valid"


async def test_account_flow_offers_base_url_in_a_collapsed_section(
    hass: HomeAssistant,
) -> None:
    """The base URL is always present, folded into a collapsed Advanced
    section, and a value entered there ends up in the entry data."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    schema = result["data_schema"].schema
    advanced = next(v for k, v in schema.items() if k == ADVANCED)
    assert isinstance(advanced, section)
    assert advanced.options == {"collapsed": True}
    assert CONF_BASE_URL in advanced.schema.schema

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_TOKEN: "t", ADVANCED: {CONF_BASE_URL: "https://api.example.test"}},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_BASE_URL] == "https://api.example.test"


async def test_account_reconfigure_changes_the_base_url(hass: HomeAssistant) -> None:
    """Opening the Advanced section on reconfigure swaps the base URL."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_TOKEN: "t", CONF_BASE_URL: "https://old.example.test"},
        title="aivi",
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_TOKEN: "t2", ADVANCED: {CONF_BASE_URL: "https://new.example.test"}},
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert entry.data[CONF_TOKEN] == "t2"
    assert entry.data[CONF_BASE_URL] == "https://new.example.test"


async def test_account_flow_rejects_a_bad_token(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.auth_ok = False
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "bad"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_account_flow_recovers_from_unreachable_api(
    hass: HomeAssistant, fake_client
) -> None:
    """An unreachable API shows cannot_connect; the same flow then
    finishes once the API is back."""
    fake_client.reachable = False
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}

    fake_client.reachable = True
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_account_flow_aborts_on_duplicate_credentials(
    hass: HomeAssistant,
) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "same"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "same"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_reauth_flow_replaces_the_token(hass: HomeAssistant, fake_client) -> None:
    """A rejected token is replaced through reauth; a still-bad token shows
    the error first."""
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "expired"}, title="aivi")
    entry.add_to_hass(hass)

    result = await entry.start_reauth_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "reauth_confirm"

    fake_client.auth_ok = False
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "still-bad"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}

    fake_client.auth_ok = True
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "fresh"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert entry.data[CONF_TOKEN] == "fresh"


async def test_no_subentry_flows_are_declared(hass: HomeAssistant) -> None:
    """Binding is panel-only: no subentry flow handlers, so the
    integrations page offers no "Add widget" and a subentry flow is
    refused."""
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    assert entry.supported_subentry_types == {}
    with pytest.raises(UnknownHandler):
        await hass.config_entries.subentries.async_init(
            (entry.entry_id, SUBENTRY_WIDGET), context={"source": SOURCE_USER}
        )


def _count_listings(fake_client, monkeypatch) -> list[None]:
    calls: list[None] = []
    real = fake_client.list_widgets

    async def _counted():
        calls.append(None)
        return await real()

    monkeypatch.setattr(fake_client, "list_widgets", _counted)
    return calls


async def test_reconfigure_reloads_a_loaded_entry_once(
    hass: HomeAssistant, fake_client, monkeypatch, caplog
) -> None:
    """The update listener owns the reload: one reload, and no use of the
    reload-and-abort helper Home Assistant reports for entries that have
    a listener."""
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    runtime = entry.runtime_data
    listings = _count_listings(fake_client, monkeypatch)
    checks = fake_client.access_checks

    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t2"}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reconfigure_successful"
    # The validation and the setup each ask for the subscription once;
    # the setup lists.
    assert (fake_client.access_checks - checks, len(listings)) == (2, 1)
    assert entry.state is ConfigEntryState.LOADED
    assert entry.runtime_data is not runtime
    assert "update listener" not in caplog.text


async def test_reauth_with_the_same_token_still_reloads(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "t"}, title="aivi")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    runtime = entry.runtime_data

    result = await entry.start_reauth_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t"}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reauth_successful"
    assert entry.runtime_data is not runtime


async def test_reauth_sets_up_an_entry_that_failed_auth(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.auth_ok = False
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "old"}, title="aivi")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR

    fake_client.auth_ok = True
    result = await entry.start_reauth_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "new"}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reauth_successful"
    assert entry.state is ConfigEntryState.LOADED


async def test_account_flow_matches_base_urls_without_trailing_slashes(
    hass: HomeAssistant,
) -> None:
    for base_url, expected in (
        ("https://api.example.test/", FlowResultType.CREATE_ENTRY),
        ("https://api.example.test", FlowResultType.ABORT),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_TOKEN: "t", ADVANCED: {CONF_BASE_URL: base_url}}
        )
        assert result["type"] is expected
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    assert entry.data[CONF_BASE_URL] == "https://api.example.test"


async def test_token_validation_makes_one_minimal_request(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """The account flow checks a token with the access check, never by
    listing the account's widgets (which pages through all of them). The
    only listing is the new entry's setup, which also asks for the
    subscription."""
    listings = _count_listings(fake_client, monkeypatch)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t"}
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert (fake_client.access_checks, len(listings)) == (2, 1)


async def test_reauth_and_reconfigure_validate_with_the_access_check(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_TOKEN: "t"}, title="aivi")
    entry.add_to_hass(hass)
    listings = _count_listings(fake_client, monkeypatch)

    # Each flow validates once and (re)loads the entry once, which asks
    # for the subscription and lists.
    result = await entry.start_reauth_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t2"}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reauth_successful"
    assert (fake_client.access_checks, len(listings)) == (2, 1)
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t3"}
    )
    await hass.async_block_till_done()
    assert result["reason"] == "reconfigure_successful"
    assert (fake_client.access_checks, len(listings)) == (4, 2)


async def test_account_flow_titles_the_entry_by_its_name(hass: HomeAssistant) -> None:
    """The name given in the flow is the entry's title, so two accounts
    read apart on the panel; left empty, the entry is called Aivi."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert CONF_NAME in {str(k) for k in result["data_schema"].schema}
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t", CONF_NAME: "  Family phone  "}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Family phone"
    assert CONF_NAME not in result["data"]

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "t2", CONF_NAME: ""}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Aivi"
