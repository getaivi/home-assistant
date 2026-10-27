"""Saving a binding over the WebSocket API: what is stored, what is refused,
and the watched entities derived server-side."""

from __future__ import annotations

import pytest

from helpers import setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_save_creates_a_widget_that_pushes(
    hass, hass_ws_client, fake_client
) -> None:
    entry = await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": entry.entry_id,
            "slug": "laundry",
            "name": "Laundry",
            "template": "progress",
            "bindings": {"progress": "sensor.washer_progress"},
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    # Saving fires the entry's update listener, which reloads the runtime.
    await hass.async_block_till_done()

    assert any(slug == "laundry" for slug, _ in fake_client.pushes)

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    widgets = msg["result"]["accounts"][0]["widgets"]
    assert [w["slug"] for w in widgets] == ["laundry"]
    # The panel's About lines say which version of the integration this is.
    from homeassistant.loader import async_get_integration

    integration = await async_get_integration(hass, "aivi")
    assert msg["result"]["version"] == str(integration.version)

    subentry_id = widgets[0]["subentry_id"]
    await client.send_json_auto_id(
        {
            "type": "aivi/delete",
            "entry_id": entry.entry_id,
            "subentry_id": subentry_id,
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    await hass.async_block_till_done()

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    assert msg["result"]["accounts"][0]["widgets"] == []


async def test_ws_save_updates_an_existing_subentry(hass, hass_ws_client) -> None:
    entry = await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    save = {
        "type": "aivi/save",
        "entry_id": entry.entry_id,
        "slug": "laundry",
        "name": "Laundry",
        "template": "progress",
        "bindings": {"progress": "sensor.washer_progress"},
    }
    await client.send_json_auto_id(save)
    msg = await client.receive_json()
    subentry_id = msg["result"]["subentry_id"]
    await hass.async_block_till_done()

    await client.send_json_auto_id(
        {**save, "subentry_id": subentry_id, "name": "Laundry 2"}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["subentry_id"] == subentry_id
    await hass.async_block_till_done()
    assert entry.subentries[subentry_id].title == "Laundry 2"


async def _save_bindings(hass, hass_ws_client, bindings: dict) -> dict:
    """Save a status widget with these bindings; return what was stored."""
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/save",
            "entry_id": entry.entry_id,
            "slug": "w",
            "name": "W",
            "template": "status",
            "bindings": bindings,
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    await hass.async_block_till_done()
    subentry = next(s for s in entry.subentries.values() if s.data.get("slug") == "w")
    return dict(subentry.data["bindings"])


async def test_save_derives_watched_entities_the_regex_would_miss(
    hass, hass_ws_client, fake_client
) -> None:
    """`expand(...)` hides group members from the panel's literal-id regex;
    the server derives them from Home Assistant."""
    hass.states.async_set("light.a", "on")
    hass.states.async_set("light.b", "off")
    hass.states.async_set("group.lamps", "on", {"entity_id": ["light.a", "light.b"]})

    stored = await _save_bindings(
        hass,
        hass_ws_client,
        {
            "state__template": (
                "{{ expand('group.lamps') | selectattr('state','eq','on')"
                " | list | count }}"
            ),
            # What the panel's regex would have sent: the group only.
            "state__watched": ["group.lamps"],
        },
    )
    assert set(stored["state__watched"]) >= {"light.a", "light.b"}


async def test_save_refuses_to_watch_a_template_that_reads_everything(
    hass, hass_ws_client, fake_client
) -> None:
    """A template reading every state keeps what was sent rather than
    subscribing to every state change."""
    stored = await _save_bindings(
        hass,
        hass_ws_client,
        {
            "state__template": (
                "{{ states | selectattr('state','eq','on') | list | count }}"
            ),
            "state__watched": [],
        },
    )
    assert stored["state__watched"] == []


_SAVE = {
    "type": "aivi/save",
    "slug": "laundry",
    "name": "Laundry",
    "template": "progress",
    "bindings": {"progress": "sensor.washer_progress"},
}


async def _save(client, entry_id: str, **overrides) -> dict:
    await client.send_json_auto_id({**_SAVE, "entry_id": entry_id, **overrides})
    return await client.receive_json()


async def test_save_refuses_what_the_runtime_could_not_run(
    hass, hass_ws_client
) -> None:
    entry = await setup_account(hass)
    client = await hass_ws_client(hass)
    msg = await _save(client, entry.entry_id)
    assert msg["success"]
    laundry = msg["result"]["subentry_id"]
    await hass.async_block_till_done()
    assert entry.subentries[laundry].unique_id == "widget:laundry"

    async def _refused(code: str, **overrides) -> None:
        msg = await _save(client, entry.entry_id, **overrides)
        assert not msg["success"], overrides
        assert msg["error"]["code"] == code, msg["error"]

    # A second binding for the same widget would push over the first.
    await _refused("already_configured")
    await _refused("already_configured", name="Other name")
    # Unknown subentry ids are not silently turned into new bindings.
    await _refused("not_found", subentry_id="nope")
    # An update keeps the binding's kind.
    await _refused(
        "invalid_format", subentry_id=laundry, kind="activity", active="light.x"
    )
    await _refused("not_found", template="nope", slug="other")
    # Bindings the runtime could not resolve.
    await _refused("invalid_format", slug="b1", bindings={"progress": 5})
    await _refused(
        "invalid_format",
        slug="b2",
        template="battery",
        bindings={"devices": [{"entity_id": "sensor.x"}]},
    )
    await _refused(
        "invalid_format",
        slug="b3",
        template="battery",
        bindings={"devices": ["sensor.ok", 7]},
    )
    await _refused(
        "invalid_format",
        slug="b5",
        template="battery",
        bindings={"devices": "sensor.ok"},
    )
    await _refused(
        "invalid_format",
        slug="b6",
        bindings={"progress__template": "{{ 5 }}", "progress__watched": ["nope"]},
    )
    await _refused("invalid_format", slug="b4", kind="activity", active="not an entity")

    # The same slug as another kind is fine: slugs are unique per kind.
    msg = await _save(
        client, entry.entry_id, kind="activity", active="binary_sensor.washer"
    )
    assert msg["success"]
    # And updating a binding keeps its own slug.
    msg = await _save(client, entry.entry_id, subentry_id=laundry, name="Washer")
    assert msg["success"]
    assert len(entry.subentries) == 2
