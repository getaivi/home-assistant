"""End-to-end: bind a widget, drive Home Assistant state, assert the payload
the integration pushed. These exercise setup, subscription, debounce, and
resolution together, so implementation can change freely underneath them."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant

from custom_components.aivi import push
from custom_components.aivi.const import (
    DATA_REGISTRY,
)
from custom_components.aivi.templates import STATUS, TemplateRegistry
from helpers import account_entry, advance_past_debounce, widget_subentry

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_pushes_initial_content_on_setup(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.washer_state", "Washing")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress", "state": "sensor.washer_state"},
        ),
    )

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    slug, content = fake_client.last_push
    assert slug == "laundry"
    # Exact equality: wire_number strips the binary float noise
    # of the 0.01 scaling (62 * 0.01 != 0.62 raw), so the wire value is
    # exactly the decimal the user would expect.
    assert content["progress"] == {"style": "simple", "value": 0.62}
    assert content["state"] == {"value": "Washing"}


async def test_pushes_again_when_a_bound_entity_changes(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.washer_state", "Washing")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress", "state": "sensor.washer_state"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    pushes_before = len(fake_client.pushes)

    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    assert len(fake_client.pushes) > pushes_before
    _, content = fake_client.last_push
    assert content["progress"]["value"] == 0.8


async def test_sourced_segment_weight_repushes_on_state_change(
    hass: HomeAssistant, fake_client
) -> None:
    """A segment weight source is part of the state subscription, so its
    changes re-push with the resolved (normalized, 1024th-quantized)
    weights; unavailable falls back to the stored literal weight."""
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.wash_share", "0.5")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {
                "progress": "sensor.washer_progress",
                "segments": [
                    {
                        "value": 0.5,
                        "fill_color": "cyan",
                        "source": "sensor.wash_share",
                    },
                    {"value": 0.5, "fill_color": "gray"},
                ],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["progress"]["segments"][0]["value"] == 0.5

    hass.states.async_set("sensor.wash_share", "1.5")
    await advance_past_debounce(hass)
    segments = fake_client.last_push[1]["progress"]["segments"]
    assert segments[0]["value"] == 768 / 1024  # 1.5 : 0.5
    assert sum(s["value"] for s in segments) == 1.0

    # Unavailable -> the stored fallback weight; the segment never drops.
    hass.states.async_set("sensor.wash_share", "unavailable")
    await advance_past_debounce(hass)
    segments = fake_client.last_push[1]["progress"]["segments"]
    assert [s["value"] for s in segments] == [0.5, 0.5]


async def test_skips_push_while_a_required_entity_is_unavailable(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("sensor.washer_progress", "unavailable")
    hass.states.async_set("sensor.washer_state", "Washing")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress", "state": "sensor.washer_state"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert fake_client.pushes == []

    # Once it becomes available, the widget pushes.
    hass.states.async_set("sensor.washer_progress", "10")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["progress"]["value"] == 0.1


async def test_row_template_maps_selected_entities(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set(
        "sensor.vacuum_battery", "68", {"friendly_name": "Robot vacuum"}
    )
    hass.states.async_set("sensor.lock_battery", "45", {"friendly_name": "Door lock"})
    entry = account_entry(
        hass,
        widget_subentry(
            "batteries",
            "Home batteries",
            "battery",
            {
                # The stored list is the row order: the widget renders the
                # lock before the vacuum because the binding says so.
                "devices": ["sensor.lock_battery", "sensor.vacuum_battery"],
                # Per-row options are in a sibling dict keyed by entity id;
                # rows without an entry keep their bare default shape.
                "devices__options": {
                    "sensor.lock_battery": {"icon": "lock.fill", "color": "teal"}
                },
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    _, content = fake_client.last_push
    assert content["devices"] == [
        {"name": "Door lock", "level": 45, "icon": "lock.fill", "color": "teal"},
        {"name": "Robot vacuum", "level": 68},
    ]
    # Whole-number battery levels serialize as integers, not "68.0".
    assert all(isinstance(d["level"], int) for d in content["devices"])


async def test_a_template_is_followed_by_what_it_reads(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """A template slot is followed by template result tracking only; its
    stored ``__watched`` entities (kept for the panel) subscribe nothing."""
    followed: set[str] = set()
    track_state = push.async_track_state_change_event

    def follow(hass_, entity_ids, action):
        followed.update(entity_ids)
        return track_state(hass_, entity_ids, action)

    monkeypatch.setattr(push, "async_track_state_change_event", follow)
    hass.states.async_set("sensor.temp", "20")
    entry = account_entry(
        hass,
        widget_subentry(
            "w",
            "W",
            "status",
            {
                "state__template": "{{ states('sensor.temp') }}",
                "state__watched": ["sensor.temp", "sensor.stale"],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["state"] == {"value": "20"}
    assert followed == set()

    hass.states.async_set("sensor.temp", "21")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["state"] == {"value": "21"}


async def test_deselected_rows_are_not_followed(
    hass: HomeAssistant, fake_client, monkeypatch
) -> None:
    """Options kept for a row that was deselected subscribe nothing:
    neither their entities nor their templates."""
    followed: set[str] = set()
    tracked: list[str] = []
    track_state = push.async_track_state_change_event
    track_templates = push.async_track_template_result

    def follow(hass_, entity_ids, action):
        followed.update(entity_ids)
        return track_state(hass_, entity_ids, action)

    def track(hass_, templates, action, **kw):
        tracked.extend(t.template.template for t in templates)
        return track_templates(hass_, templates, action, **kw)

    monkeypatch.setattr(push, "async_track_state_change_event", follow)
    monkeypatch.setattr(push, "async_track_template_result", track)
    hass.states.async_set("sensor.picked", "1")
    entry = account_entry(
        hass,
        widget_subentry(
            "rows",
            "Rows",
            "list",
            {
                "rows": ["sensor.picked"],
                "rows__options": {
                    "sensor.picked": {
                        "label__entity": "sensor.picked_label",
                        "icon__template": "{{ 'star' }}",
                    },
                    "sensor.dropped": {
                        "label__entity": "sensor.dropped_label",
                        "icon__template": "{{ states('sensor.dropped_icon') }}",
                        "icon__watched": ["sensor.dropped_icon"],
                    },
                },
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert followed == {"sensor.picked", "sensor.picked_label"}
    assert tracked == ["{{ 'star' }}"]


async def test_advanced_status_binding_carries_color_and_icon(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("binary_sensor.front_door", "Open")
    entry = account_entry(
        hass,
        widget_subentry(
            "frontdoor",
            "Front door",
            "status",
            {
                "state": "binary_sensor.front_door",
                "state__color": "red",
                "icon": "door.left.hand.open",
                "accent": "red",
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    _, content = fake_client.last_push
    assert content["state"] == {"value": "Open", "text_color": "red"}
    assert content["icon"] == "door.left.hand.open"
    assert content["accent"] == "red"


async def test_injected_registry_controls_supported_templates(
    hass: HomeAssistant, fake_client
) -> None:
    """The registry is a dependency, not a global: inject one with only the
    status template and a progress widget is simply not driven."""
    hass.data[DATA_REGISTRY] = TemplateRegistry([STATUS])

    hass.states.async_set("binary_sensor.front_door", "Open")
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "frontdoor",
            "Front door",
            "status",
            {"state": "binary_sensor.front_door"},
        ),
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    pushed_slugs = {slug for slug, _ in fake_client.pushes}
    assert pushed_slugs == {"frontdoor"}
