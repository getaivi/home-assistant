"""Automations that feed what a binding feeds: listed, reported, and turned
off only on request."""

from __future__ import annotations

import pytest
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.aivi.conflicts import (
    ISSUE_CONFLICT,
    ISSUE_CONFLICT_MANUAL,
    feeders,
    sync_issues,
    targets,
)
from custom_components.aivi.const import DOMAIN
from helpers import account_entry, widget_subentry

pytestmark = pytest.mark.usefixtures("inject_fake_client")

TRIGGER = [{"trigger": "state", "entity_id": "sensor.washer_progress"}]


def _call(slug: str, command: str = "update_widget") -> dict:
    return {
        "action": f"rest_command.{command}",
        "data": {"slug": slug, "payload": "{}"},
    }


async def _automations(hass: HomeAssistant, *configs: dict) -> None:
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": [{"triggers": TRIGGER, **config} for config in configs]},
    )
    await hass.async_block_till_done()


async def _laundry(hass: HomeAssistant) -> MockConfigEntry:
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _issues(hass: HomeAssistant) -> dict[str, ir.IssueEntry]:
    return {
        issue_id: issue
        for (domain, issue_id), issue in ir.async_get(hass).issues.items()
        if domain == DOMAIN and issue_id.startswith("automation_conflict")
    }


def test_targets_reads_literal_and_variable_slugs_however_deep() -> None:
    # A blueprint's resolved configuration: the slug is a variable.
    assert targets(
        {"variables": {"slug": " kitchen "}, "actions": [_call("{{ slug }}")]}
    ) == {("widget", "kitchen")}
    # Hand-written, nested, the `service:` key from before `action:`, an
    # activity.
    assert targets(
        {
            "action": [
                {
                    "choose": [
                        {
                            "conditions": [],
                            "sequence": [
                                {
                                    "service": "rest_command.update_live_activity",
                                    "data": {"slug": "washer"},
                                }
                            ],
                        }
                    ],
                    "default": [{"if": [], "then": [_call("porch")]}],
                }
            ]
        }
    ) == {("activity", "washer"), ("widget", "porch")}
    # A slug computed at run time, an unset variable, another service and
    # a call without data name nothing.
    assert (
        targets(
            {
                "variables": {"other": "x"},
                "actions": [
                    _call("{{ trigger.to_state.state }}"),
                    _call("{{ slug }}"),
                    _call("  "),
                    {"action": "light.turn_on", "data": {"slug": "laundry"}},
                    {"action": "rest_command.update_widget"},
                ],
            }
        )
        == set()
    )


async def test_feeders_name_the_automations_and_why_some_are_kept(
    hass: HomeAssistant,
) -> None:
    assert feeders(hass) == []  # the automation integration is not loaded
    await _automations(
        hass,
        {"id": "one", "alias": "Laundry widget", "actions": [_call("laundry")]},
        {"alias": "Two slugs", "actions": [_call("laundry"), _call("porch")]},
        {
            "id": "sticky",
            # Named with stray spaces, as a hand-typed alias can be.
            "alias": "Comes back ",
            "initial_state": True,
            "actions": [_call("washer", "update_live_activity")],
        },
        {"id": "other", "alias": "Unrelated", "actions": [{"delay": 1}]},
    )
    found = {(f.name, f.kind, f.slug): f for f in feeders(hass)}
    assert set(found) == {
        ("Laundry widget", "widget", "laundry"),
        ("Two slugs", "widget", "laundry"),
        ("Two slugs", "widget", "porch"),
        ("Comes back", "activity", "washer"),
    }
    one = found[("Laundry widget", "widget", "laundry")]
    assert (one.enabled, one.config_id, one.blueprint, one.keep) == (
        True,
        "one",
        False,
        None,
    )
    assert one.view()["entity_id"] == "automation.laundry_widget"
    assert found[("Two slugs", "widget", "porch")].keep == "shared"
    assert found[("Two slugs", "widget", "porch")].config_id is None
    assert found[("Comes back", "activity", "washer")].keep == "initial_state"


async def test_a_fed_binding_gets_a_fixable_issue_that_turns_the_automation_off(
    hass: HomeAssistant,
) -> None:
    assert await async_setup_component(hass, "repairs", {})
    await _automations(
        hass, {"id": "one", "alias": "Laundry widget", "actions": [_call("laundry")]}
    )
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    issue = _issues(hass)[f"{ISSUE_CONFLICT}_{subentry_id}"]
    assert issue.is_fixable
    assert issue.translation_placeholders == {
        "name": "Laundry",
        "slug": "laundry",
        "automations": "Laundry widget",
    }

    manager = repairs_flow_manager(hass)
    flow = await manager.async_init(
        DOMAIN, data={"issue_id": issue.issue_id}, context={}
    )
    assert flow["type"] is FlowResultType.FORM
    assert flow["description_placeholders"]["automations"] == "Laundry widget"
    done = await manager.async_configure(flow["flow_id"], {})
    await hass.async_block_till_done()
    assert done["type"] is FlowResultType.CREATE_ENTRY
    assert hass.states.get("automation.laundry_widget").state == "off"
    assert _issues(hass) == {}

    # Turned back on, it is a conflict again; the binding gone, it is not.
    await hass.services.async_call(
        "automation", "turn_on", {"entity_id": "automation.laundry_widget"}
    )
    await hass.async_block_till_done()
    assert list(_issues(hass)) == [f"{ISSUE_CONFLICT}_{subentry_id}"]
    hass.config_entries.async_remove_subentry(entry, subentry_id)
    await hass.async_block_till_done()
    assert _issues(hass) == {}


async def test_an_automation_it_will_not_turn_off_gets_a_plain_issue(
    hass: HomeAssistant,
) -> None:
    await _automations(
        hass, {"alias": "Two slugs", "actions": [_call("laundry"), _call("porch")]}
    )
    entry = await _laundry(hass)
    subentry_id = next(iter(entry.subentries))
    issue = _issues(hass)[f"{ISSUE_CONFLICT_MANUAL}_{subentry_id}"]
    assert not issue.is_fixable
    # An automation that feeds nothing bound here is not a conflict.
    await hass.services.async_call(
        "automation", "turn_off", {"entity_id": "automation.two_slugs"}
    )
    await hass.async_block_till_done()
    assert _issues(hass) == {}


async def test_automations_reloading_refreshes_the_issues(hass: HomeAssistant) -> None:
    await _automations(hass, {"id": "other", "alias": "Other", "actions": []})
    await _laundry(hass)
    assert _issues(hass) == {}
    sync_issues(hass)
    assert _issues(hass) == {}
    hass.bus.async_fire("automation_reloaded")
    await hass.async_block_till_done()
    assert _issues(hass) == {}


async def test_the_panel_lists_feeders_and_turns_off_only_what_it_may(
    hass: HomeAssistant, hass_ws_client
) -> None:
    await _automations(
        hass,
        {"id": "one", "alias": "Laundry widget", "actions": [_call("laundry")]},
        {"alias": "Two slugs", "actions": [_call("laundry"), _call("porch")]},
    )
    await _laundry(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "aivi/config"})
    listed = (await client.receive_json())["result"]["automations"]
    assert [(f["name"], f["slug"], f["keep"]) for f in listed] == [
        ("Laundry widget", "laundry", None),
        ("Two slugs", "laundry", "shared"),
        ("Two slugs", "porch", "shared"),
    ]

    await client.send_json(
        {
            "id": 2,
            "type": "aivi/automations/turn_off",
            "entity_ids": ["automation.two_slugs"],
        }
    )
    refused = await client.receive_json()
    assert not refused["success"]
    assert refused["error"]["code"] == "not_allowed"
    assert hass.states.get("automation.two_slugs").state == "on"

    await client.send_json(
        {
            "id": 3,
            "type": "aivi/automations/turn_off",
            "entity_ids": ["automation.laundry_widget", "light.kitchen"],
        }
    )
    assert not (await client.receive_json())["success"]
    assert hass.states.get("automation.laundry_widget").state == "on"

    await client.send_json(
        {
            "id": 4,
            "type": "aivi/automations/turn_off",
            "entity_ids": ["automation.laundry_widget"],
        }
    )
    turned = await client.receive_json()
    assert turned["success"]
    assert hass.states.get("automation.laundry_widget").state == "off"
    assert {f["name"]: f["enabled"] for f in turned["result"]["automations"]} == {
        "Laundry widget": False,
        "Two slugs": True,
    }
