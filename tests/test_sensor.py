"""The per-binding diagnostic sensors: registry defaults, the last push,
and a status that says why pushes fail without the entities going
unavailable."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from helpers import account_entry, advance_past_debounce, widget_subentry

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _setup_with_sensors(
    hass: HomeAssistant, entity_registry: er.EntityRegistry
) -> tuple[str, str]:
    """Set up one bound widget. Returns its two sensors' entity ids."""
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
    last_pushed = entity_registry.async_get_entity_id(
        "sensor", "aivi", f"{subentry_id}_last_pushed"
    )
    status = entity_registry.async_get_entity_id(
        "sensor", "aivi", f"{subentry_id}_push_status"
    )
    assert last_pushed is not None and status is not None
    # Both are enabled: they are how a binding shows its health.
    assert entity_registry.async_get(last_pushed).disabled_by is None
    assert entity_registry.async_get(status).disabled_by is None
    return last_pushed, status


async def test_sensor_reports_last_push(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    last_pushed, status = await _setup_with_sensors(hass, entity_registry)

    state = hass.states.get(last_pushed)
    assert state is not None
    assert state.state not in ("unavailable", "unknown")
    assert hass.states.get(status).state == "ok"
    assert hass.states.get(status).attributes["last_error"] is None

    first = state.state
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    assert hass.states.get(last_pushed).state >= first


async def test_failing_pushes_show_in_the_status_sensor(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    last_pushed, status = await _setup_with_sensors(hass, entity_registry)
    pushed_at = hass.states.get(last_pushed).state

    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    # Both stay available; the status says why and carries the message.
    assert hass.states.get(last_pushed).state == pushed_at
    failing = hass.states.get(status)
    assert failing.state == "retrying"
    assert failing.attributes["last_error"] == "Cannot reach Aivi: unreachable"

    fake_client.missing_slugs.add("laundry")
    fake_client.reachable = True
    hass.states.async_set("sensor.washer_progress", "81")
    await advance_past_debounce(hass)
    assert hass.states.get(status).state == "not_found"

    # Recovery on the next successful push.
    fake_client.missing_slugs.clear()
    hass.states.async_set("sensor.washer_progress", "82")
    await advance_past_debounce(hass)
    assert hass.states.get(status).state == "ok"
    assert hass.states.get(status).attributes["last_error"] is None
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.82)
