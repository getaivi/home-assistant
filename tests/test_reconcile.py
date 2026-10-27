"""Bindings reconciled in place: saving one starts, replaces or stops only
that binding's manager."""

from __future__ import annotations

from datetime import timedelta
from types import MappingProxyType

import pytest
from homeassistant.config_entries import ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi.const import (
    CONF_BINDINGS,
    CONF_NAME,
    CONF_SLUG,
    CONF_TEMPLATE,
    CONF_TOKEN,
    DOMAIN,
    SUBENTRY_WIDGET,
)
from custom_components.aivi.runtime import registered_device
from helpers import (
    account_entry,
    advance_past_debounce,
    subentry_id_of,
    two_widgets,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


def _subentry(slug: str, template: str, bindings: dict) -> ConfigSubentry:
    return ConfigSubentry(
        data=MappingProxyType(
            {
                CONF_SLUG: slug,
                CONF_NAME: slug.title(),
                CONF_TEMPLATE: template,
                CONF_BINDINGS: bindings,
            }
        ),
        subentry_type=SUBENTRY_WIDGET,
        title=slug.title(),
        unique_id=None,
    )


def _press(slug: str, action: str, **data: object) -> dict:
    now = dt_util.utcnow()
    return {
        "id": f"evt_{slug}_{action}_{now.timestamp()}",
        "type": "widget.action.v1",
        "subject": {"kind": "widget", "slug": slug},
        "expires_at": (now + timedelta(seconds=5)).isoformat(),
        "data": {"action": action, **data},
    }


async def test_saving_one_binding_leaves_the_others_alone(
    hass: HomeAssistant, fake_client, entity_registry: er.EntityRegistry
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    before = dict(runtime.managers)
    assert sorted(slug for slug, _ in fake_client.pushes) == ["frontdoor", "laundry"]
    fake_client.pushes.clear()

    # Adding a binding pushes only the new one, and gives it its sensors.
    hass.states.async_set("sensor.phone_battery", "80")
    new = _subentry("batteries", "battery", {"devices": ["sensor.phone_battery"]})
    hass.config_entries.async_add_subentry(entry, new)
    await hass.async_block_till_done()
    assert [slug for slug, _ in fake_client.pushes] == ["batteries"]
    assert entry.runtime_data is runtime
    for subentry_id, manager in before.items():
        assert runtime.managers[subentry_id] is manager
    assert entity_registry.async_get_entity_id(
        "sensor", DOMAIN, f"{new.subentry_id}_push_status"
    )

    # Renaming a binding replaces its manager but sends nothing: the
    # content the phone has is unchanged.
    laundry = subentry_id_of(entry, "laundry")
    hass.config_entries.async_update_subentry(
        entry,
        entry.subentries[laundry],
        data={**entry.subentries[laundry].data, CONF_NAME: "Washer"},
        title="Washer",
    )
    await hass.async_block_till_done()
    assert runtime.managers[laundry] is not before[laundry]
    assert [slug for slug, _ in fake_client.pushes] == ["batteries"]
    # It keeps its predecessor's last push, which nothing new replaced.
    assert runtime.managers[laundry].last_pushed is not None
    assert runtime.managers[laundry].last_pushed == before[laundry].last_pushed
    device = registered_device(dr.async_get(hass), entry.entry_id, laundry)
    assert device is not None and device.name == "Washer"

    # The replaced manager is the one that pushes now.
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert fake_client.last_push == ("laundry", fake_client.last_push[1])
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.7)
    assert len(fake_client.pushes) == 2

    # Removing a binding stops only its manager.
    frontdoor = subentry_id_of(entry, "frontdoor")
    hass.config_entries.async_remove_subentry(entry, frontdoor)
    await hass.async_block_till_done()
    assert frontdoor not in runtime.managers
    hass.states.async_set("binary_sensor.door", "on")
    await advance_past_debounce(hass)
    assert all(slug != "frontdoor" for slug, _ in fake_client.pushes)


async def test_a_binding_moved_to_another_slug_pushes_there(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    fake_client.pushes.clear()
    laundry = subentry_id_of(entry, "laundry")
    hass.config_entries.async_update_subentry(
        entry,
        entry.subentries[laundry],
        data={**entry.subentries[laundry].data, CONF_SLUG: "dryer"},
    )
    await hass.async_block_till_done()
    assert [slug for slug, _ in fake_client.pushes] == ["dryer"]


async def test_switchboards_are_rerouted_without_reconnecting(
    hass: HomeAssistant, fake_client
) -> None:
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    hass.states.async_set("scene.movie", "scening")
    hass.states.async_set("light.hall", "off")
    entry = account_entry(
        hass,
        widget_subentry("porch", "Porch", "switchboard", {"actions": ["scene.movie"]}),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    stream = entry.runtime_data.commands
    assert stream is not None
    await until(hass, lambda: stream.health.connected, "open")

    hall = _subentry("hall", "switchboard", {"actions": ["light.hall"]})
    hass.config_entries.async_add_subentry(entry, hall)
    await hass.async_block_till_done()
    assert entry.runtime_data.commands is stream
    assert fake_client.stream_opens == 1

    fake_client.emit(_press("hall", "light_hall", kind="toggle", value=True))
    await until(hass, lambda: len(turn_on) == 1, "the hall press")
    assert turn_on[0].data == {"entity_id": "light.hall"}

    # Without a switchboard the stream has nothing to route: it stops.
    porch = subentry_id_of(entry, "porch")
    hass.config_entries.async_remove_subentry(entry, porch)
    hass.config_entries.async_remove_subentry(entry, hall.subentry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.commands is None
    assert not stream.health.connected


async def test_an_account_change_reloads_the_entry(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    runtime = entry.runtime_data
    hass.config_entries.async_update_entry(entry, title="Renamed")
    await hass.async_block_till_done()
    assert entry.runtime_data is runtime

    hass.config_entries.async_update_entry(entry, data={CONF_TOKEN: "rotated"})
    await hass.async_block_till_done()
    assert entry.runtime_data is not runtime
    assert entry.runtime_data.account[1] == "rotated"
