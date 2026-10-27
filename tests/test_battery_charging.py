"""A battery row's charging flag: read from a sensor, and the device's own
charging sensor filled in on save for rows that set no charging option."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.aivi import engine
from custom_components.aivi.companions import charging_companion, with_companions
from custom_components.aivi.templates import BATTERY
from helpers import RecordedResolver, setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


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


async def test_the_devices_charging_sensor_is_found(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, phone: dict[str, str]
) -> None:
    assert charging_companion(hass, phone["level"]) == phone["state"]
    plug = entity_registry.async_get_or_create(
        "binary_sensor",
        "mobile_app",
        "phone_charging",
        device_id=phone["device"],
        original_device_class="battery_charging",
    )
    # A battery_charging binary sensor is preferred.
    assert charging_companion(hass, phone["level"]) == plug.entity_id
    assert charging_companion(hass, "sensor.nowhere") is None
    loose = entity_registry.async_get_or_create("sensor", "demo", "loose")
    assert charging_companion(hass, loose.entity_id) is None


async def test_companions_fill_rows_that_do_not_say_otherwise(
    hass: HomeAssistant, phone: dict[str, str]
) -> None:
    level = phone["level"]
    bindings = {"devices": [level, "sensor.other"]}
    assert with_companions(hass, BATTERY, bindings)["devices__options"] == {
        level: {"charging__entity": phone["state"]}
    }
    off = {"devices": [level], "devices__options": {level: {"charging": "off"}}}
    assert with_companions(hass, BATTERY, off) == off
    assert with_companions(hass, BATTERY, {}) == {}


async def test_saving_and_previewing_a_battery_fills_in_charging(
    hass: HomeAssistant, hass_ws_client, phone: dict[str, str]
) -> None:
    entry = await setup_account(hass)
    hass.states.async_set(phone["level"], "40")
    hass.states.async_set(phone["state"], "Charging")
    client = await hass_ws_client(hass)
    bindings = {"devices": [phone["level"]]}
    await client.send_json_auto_id(
        {"type": "aivi/preview", "template": "battery", "bindings": bindings}
    )
    msg = await client.receive_json()
    assert msg["result"]["content"]["devices"][0]["charging"] is True
    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": entry.entry_id,
            "slug": "batteries",
            "name": "Batteries",
            "template": "battery",
            "bindings": bindings,
        }
    )
    msg = await client.receive_json()
    stored = entry.subentries[msg["result"]["subentry_id"]].data["bindings"]
    assert stored["devices__options"] == {
        phone["level"]: {"charging__entity": phone["state"]}
    }


def test_battery_charging_from_a_sensor_or_off() -> None:
    resolver = RecordedResolver(
        states={
            "sensor.phone": "40",
            "sensor.phone_battery_state": "Charging",
            "sensor.lock": "90",
            "sensor.car": "70",
            "binary_sensor.car_charging": "unavailable",
        }
    )
    content = engine.resolve(
        BATTERY,
        {
            "devices": ["sensor.phone", "sensor.lock", "sensor.car"],
            "devices__options": {
                "sensor.phone": {"charging__entity": "sensor.phone_battery_state"},
                "sensor.lock": {"charging": "off"},
                "sensor.car": {"charging__entity": "binary_sensor.car_charging"},
            },
        },
        resolver,
    )
    charging = {d["name"]: d.get("charging") for d in content["devices"]}
    assert charging == {"sensor.phone": True, "sensor.lock": False, "sensor.car": None}
