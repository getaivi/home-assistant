"""Starting points from what Home Assistant knows: a new binding's form
state (aivi/defaults)."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from helpers import setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _defaults(hass_ws_client, hass: HomeAssistant, template: str, **kw: Any):
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "aivi/defaults", "template": template, **kw}
    )
    return await client.receive_json()


async def test_a_budget_starts_in_home_assistants_currency(
    hass, hass_ws_client
) -> None:
    await setup_account(hass)
    await hass.config.async_update(currency="SEK")
    msg = await _defaults(hass_ws_client, hass, "budget")
    assert msg["result"] == {"bindings": {"currency": "SEK"}}
    for template, kind in (("trend", "widget"), ("progress", "activity")):
        msg = await _defaults(hass_ws_client, hass, template, kind=kind)
        assert msg["result"] == {"bindings": {}}
    msg = await _defaults(hass_ws_client, hass, "forecast")
    assert msg["error"]["code"] == "not_found"


async def test_prices_start_on_the_sensor_with_a_timeline(hass, hass_ws_client) -> None:
    await setup_account(hass)
    hass.states.async_set("sensor.temperature", "20", {"forecast": [1, 2]})
    msg = await _defaults(hass_ws_client, hass, "prices")
    assert msg["result"] == {"bindings": {}}
    raw = [
        {"start": "2026-01-15T00:00:00+01:00", "value": 0.1},
        {"start": "2026-01-15T01:00:00+01:00", "value": 0.2},
    ]
    hass.states.async_set("sensor.nordpool", "0.12", {"raw_today": raw})
    msg = await _defaults(hass_ws_client, hass, "prices")
    assert msg["result"] == {"bindings": {"entries": "sensor.nordpool"}}
    # Priced per kWh in a currency: cents read better on the phone.
    hass.states.async_set(
        "sensor.nordpool", "0.12", {"raw_today": raw, "unit_of_measurement": "EUR/kWh"}
    )
    msg = await _defaults(hass_ws_client, hass, "prices")
    assert msg["result"] == {
        "bindings": {"entries": "sensor.nordpool", "scale": "cents"}
    }


async def _energy_prefs(hass: HomeAssistant, sources: list[dict[str, Any]]) -> None:
    from homeassistant.components.energy.data import async_get_manager

    manager = await async_get_manager(hass)
    manager.data = {
        "energy_sources": sources,
        "device_consumption": [],
    }  # type: ignore[assignment]


async def test_energy_starts_from_the_energy_dashboard(hass, hass_ws_client) -> None:
    await setup_account(hass)
    for entity_id, unit in (
        ("sensor.solar_power", "kW"),
        ("sensor.solar_energy", "kWh"),
        ("sensor.grid_power", "W"),
        ("sensor.grid_import", "kWh"),
        ("sensor.battery_power", "W"),
        ("sensor.battery_soc", "%"),
    ):
        hass.states.async_set(entity_id, "1", {"unit_of_measurement": unit})
    await _energy_prefs(
        hass,
        [
            {
                "type": "solar",
                "stat_energy_from": "sensor.solar_energy",
                "stat_rate": "sensor.solar_power",
            },
            {"type": "solar", "stat_energy_from": "external:solar"},
            {
                "type": "grid",
                "flow_from": [{"stat_energy_from": "sensor.grid_import"}],
                "flow_to": [],
                "power": [{"stat_rate": "sensor.grid_power"}],
            },
            {
                "type": "battery",
                "stat_energy_from": "sensor.battery_out",
                "stat_energy_to": "sensor.battery_in",
                "stat_rate": "sensor.battery_power",
                "stat_soc": "sensor.battery_soc",
            },
            {"type": "gas", "stat_energy_from": "sensor.gas"},
        ],
    )
    msg = await _defaults(hass_ws_client, hass, "energy")
    solar = "states('sensor.solar_power') | float(0) * 1000"
    grid = "states('sensor.grid_power') | float(0)"
    battery = "-(states('sensor.battery_power') | float(0))"
    assert msg["result"]["bindings"] == {
        "sources": ["sensor.solar_power"],
        "sources__options": {"sensor.solar_power": {"today": "sensor.solar_energy"}},
        "grid_power": "sensor.grid_power",
        "grid_today": "sensor.grid_import",
        # Home Assistant counts a battery's discharge as positive.
        "battery_power": "sensor.battery_power",
        "battery_power__invert": True,
        "battery_level": "sensor.battery_soc",
        "home_power__template": (
            f"{{{{ (({solar}) + ({grid}) - ({battery})) | round(0) }}}}"
        ),
    }


async def test_energy_power_configs(hass, hass_ws_client) -> None:
    await setup_account(hass)
    for entity_id in ("sensor.a", "sensor.b", "sensor.c", "sensor.d"):
        hass.states.async_set(entity_id, "1", {"unit_of_measurement": "W"})
    await _energy_prefs(
        hass,
        [
            {
                "type": "grid",
                "stat_energy_from": "sensor.nothing",
                "power_config": {"stat_rate_inverted": "sensor.a"},
            },
            {
                "type": "battery",
                "power_config": {
                    "stat_rate_from": "sensor.b",
                    "stat_rate_to": "sensor.c",
                },
            },
        ],
    )
    msg = await _defaults(hass_ws_client, hass, "energy")
    bindings = msg["result"]["bindings"]
    assert bindings["grid_power"] == "sensor.a"
    assert bindings["grid_power__invert"] is True
    # Two battery sensors: charging (to) minus discharging (from).
    assert bindings["battery_power__template"] == (
        "{{ (states('sensor.c') | float(0)) - (states('sensor.b') | float(0)) }}"
    )
    assert "grid_today" not in bindings

    await _energy_prefs(
        hass,
        [
            {"type": "grid", "power_config": {"stat_rate_from": "sensor.a"}},
            {"type": "battery", "power_config": {"stat_rate_inverted": "sensor.d"}},
        ],
    )
    msg = await _defaults(hass_ws_client, hass, "energy")
    bindings = msg["result"]["bindings"]
    assert "grid_power" not in bindings
    assert bindings["battery_power"] == "sensor.d"
    assert "battery_power__invert" not in bindings
    # Without a source or the grid the home's power is not computed.
    assert "home_power__template" not in bindings


@pytest.fixture
def phone(
    hass: HomeAssistant,
    device_registry: dr.DeviceRegistry,
    entity_registry: er.EntityRegistry,
) -> dict[str, str]:
    config = MockConfigEntry(domain="mobile_app")
    config.add_to_hass(hass)
    device = device_registry.async_get_or_create(
        config_entry_id=config.entry_id, identifiers={("mobile_app", "phone")}
    )

    def add(domain: str, key: str, **kw: Any) -> str:
        return entity_registry.async_get_or_create(
            domain,
            "mobile_app",
            key,
            device_id=device.id,
            suggested_object_id=key,
            **kw,
        ).entity_id

    return {
        "level": add("sensor", "phone_battery_level"),
        "state": add("sensor", "phone_battery_state"),
        "device": device.id,
    }
