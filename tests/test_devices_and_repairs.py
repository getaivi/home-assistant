"""Widget devices, repair issues, diagnostics, and the
entry-level reconfigure flow."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi import async_remove_config_entry_device
from custom_components.aivi.config_flow import ADVANCED
from custom_components.aivi.const import (
    CONF_BASE_URL,
    CONF_TOKEN,
    DATA_REGISTRY,
    DOMAIN,
)
from custom_components.aivi.diagnostics import (
    async_get_config_entry_diagnostics,
)
from custom_components.aivi.runtime import registered_device
from custom_components.aivi.templates import STATUS, TemplateRegistry
from helpers import (
    account_entry,
    advance_past_debounce,
    subentry_id_of,
    two_widgets,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _laundry(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _issue(hass: HomeAssistant, kind: str, subentry_id: str):
    return ir.async_get(hass).async_get_issue(DOMAIN, f"{kind}_{subentry_id}")


async def test_each_widget_is_a_service_device(
    hass: HomeAssistant, device_registry: dr.DeviceRegistry
) -> None:
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    device = registered_device(device_registry, entry.entry_id, subentry_id)
    assert device is not None
    assert device.name == "Laundry"
    assert device.manufacturer == "Aivi"
    assert device.model == "progress widget"
    assert device.entry_type is dr.DeviceEntryType.SERVICE


async def test_deleted_upstream_widget_raises_a_repair_issue(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    assert _issue(hass, "widget_missing", subentry_id) is None

    # The widget vanishes in Aivi; the next push 404s and reports it.
    fake_client.missing_slugs.add("laundry")
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    assert _issue(hass, "widget_missing", subentry_id) is not None

    # It comes back; the next successful push withdraws the issue.
    fake_client.missing_slugs.clear()
    hass.states.async_set("sensor.washer_progress", "81")
    await advance_past_debounce(hass)
    assert _issue(hass, "widget_missing", subentry_id) is None


async def test_missing_upstream_widget_is_reported_at_setup(
    hass: HomeAssistant, fake_client
) -> None:
    # Deleted upstream: absent from the widget list and pushes 404.
    fake_client._widgets = []
    fake_client.missing_slugs.add("laundry")
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    subentry_id = next(iter(entry.subentries))
    assert _issue(hass, "widget_missing", subentry_id) is not None


async def test_a_listing_notices_a_deleted_widget_without_a_push(
    hass: HomeAssistant, fake_client, hass_ws_client
) -> None:
    """Aivi sends nothing when a widget is deleted in the app, and a quiet
    widget may not push for hours: the panel's listing is when it is
    noticed, and when one that is back stops being reported."""
    await async_setup_component(hass, "websocket_api", {})
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    client = await hass_ws_client(hass)

    async def listing() -> list[str]:
        await client.send_json_auto_id(
            {"type": "aivi/widgets", "entry_id": entry.entry_id}
        )
        msg = await client.receive_json()
        assert msg["success"]
        return [widget["slug"] for widget in msg["result"]["widgets"]]

    assert "laundry" in await listing()
    assert _issue(hass, "widget_missing", subentry_id) is None

    kept = fake_client._widgets
    fake_client._widgets = [w for w in kept if w.slug != "laundry"]
    assert "laundry" not in await listing()
    assert _issue(hass, "widget_missing", subentry_id) is not None

    # Created again in the app: the next listing withdraws the report.
    fake_client._widgets = kept
    await listing()
    assert _issue(hass, "widget_missing", subentry_id) is None


async def test_unsupported_template_raises_a_repair_issue(
    hass: HomeAssistant,
) -> None:
    hass.data[DATA_REGISTRY] = TemplateRegistry([STATUS])
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    issue = _issue(hass, "unsupported_template", subentry_id)
    assert issue is not None
    assert issue.translation_placeholders["template"] == "progress"


async def test_stale_issues_are_pruned_when_the_binding_goes(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    fake_client.missing_slugs.add("laundry")
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    assert _issue(hass, "widget_missing", subentry_id) is not None

    # Removing the binding reloads the entry, which prunes its issues.
    hass.config_entries.async_remove_subentry(entry, subentry_id)
    await hass.async_block_till_done()
    assert _issue(hass, "widget_missing", subentry_id) is None


async def test_diagnostics_redact_the_token(hass: HomeAssistant) -> None:
    entry = await _laundry(hass)
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["entry"][CONF_TOKEN] == "**REDACTED**"
    (widget,) = diagnostics["widgets"]
    assert widget["slug"] == "laundry"
    assert widget["available"] is True
    assert widget["last_pushed"] is not None
    assert widget["last_error"] is None


async def test_entry_reconfigure_updates_credentials(
    hass: HomeAssistant, fake_client
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_TOKEN: "old", CONF_BASE_URL: "https://api.example.test"},
        title="aivi",
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)

    result = await entry.start_reconfigure_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "reconfigure"

    # The collapsed Advanced section prefills the entry's current base URL,
    # so opening it shows (and keeps) the custom value.
    advanced = next(v for k, v in result["data_schema"].schema.items() if k == ADVANCED)
    base_url_key = next(k for k in advanced.schema.schema if k == CONF_BASE_URL)
    assert base_url_key.description == {"suggested_value": "https://api.example.test"}

    fake_client.auth_ok = False
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "bad"}
    )
    assert result["errors"] == {"base": "invalid_auth"}

    fake_client.auth_ok = True
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_TOKEN: "new"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert entry.data[CONF_TOKEN] == "new"
    # base_url preserved when the Advanced section is left unchanged.
    assert entry.data[CONF_BASE_URL] == "https://api.example.test"


async def test_only_devices_of_removed_bindings_can_be_deleted(
    hass: HomeAssistant, device_registry: dr.DeviceRegistry
) -> None:
    entry = await two_widgets(hass)
    laundry = subentry_id_of(entry, "laundry")
    bound = registered_device(device_registry, entry.entry_id, laundry)
    assert bound is not None
    stale = device_registry.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={(DOMAIN, "gone")}
    )
    assert not await async_remove_config_entry_device(hass, entry, bound)
    assert await async_remove_config_entry_device(hass, entry, stale)


async def test_diagnostics_cover_an_open_stream(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("scene.movie", "scening")
    entry = account_entry(
        hass,
        widget_subentry("porch", "Porch", "switchboard", {"actions": ["scene.movie"]}),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "open")

    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["stream"]["state"] == "connected"
    assert diagnostics["stream"]["reconnects"] == 0
    assert diagnostics["stream"]["last_error"] is None
    assert diagnostics["stream"]["last_event"] is None
    (widget,) = diagnostics["widgets"]
    assert widget["status"] == "ok"
