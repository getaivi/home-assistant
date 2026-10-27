"""The panel's wire fixture: the shape of what the integration answers to
the panel's commands outside the editor, recorded over a real WebSocket.

``frontend/tests/fixtures/wire.json`` holds, per command, the keys and
value types the integration sent across the states below; the panel's
``tests/wire.test.ts`` holds the harness mock to it. With
``AIVI_WIRE_WRITE`` set (``make fixtures``) this test writes the file
instead of comparing it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.aivi.api import (
    ActivityInfo,
    AiviError,
    WidgetInfo,
)
from custom_components.aivi.const import CONF_STALE_AFTER
from helpers import (
    LAPSED,
    FakeAiviClient,
    account_entry,
    activity_subentry,
    advance_past_debounce,
    porch_subentry,
    tile_press,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")

WIRE = Path(__file__).parent.parent / "frontend" / "tests" / "fixtures" / "wire.json"

#: Values the panel takes as they come: a binding's own keys, the value a
#: press carried, and the body a push sent (shown as it is).
OPAQUE = {
    "bindings": {"type": "object"},
    "value": {"type": "any"},
    "body": {"type": "any"},
}

#: Objects keyed by subentry id, which differs every run: one shape for
#: all their values (``InputsUpdate.status``; a push row's ``status`` is a
#: string).
MAPS = {"status"}


def _shape(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int | float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list):
        out: dict[str, Any] = {"type": "array"}
        for item in value:
            out = _merge(out, {"type": "array", "items": _shape(item)})
        return out
    return {
        "type": "object",
        "keys": {
            key: OPAQUE.get(key)
            or (_map(item) if key in MAPS and isinstance(item, dict) else _shape(item))
            for key, item in sorted(value.items())
        },
    }


def _map(value: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "object"}
    for item in value.values():
        out = _merge(out, {"type": "object", "values": _shape(item)})
    return out


def _merge(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """One shape both values fit: the types of either, the keys of either."""
    types = set(a["type"].split("|")) | set(b["type"].split("|"))
    out: dict[str, Any] = {"type": "|".join(sorted(types))}
    if "keys" in a or "keys" in b:
        keys_a, keys_b = a.get("keys", {}), b.get("keys", {})
        out["keys"] = {
            key: _merge(keys_a[key], keys_b[key])
            if key in keys_a and key in keys_b
            else keys_a.get(key) or keys_b[key]
            for key in sorted(keys_a.keys() | keys_b.keys())
        }
    for part in ("items", "values"):
        if part in a and part in b:
            out[part] = _merge(a[part], b[part])
        elif part in a or part in b:
            out[part] = a.get(part) or b[part]
    return out


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
        WidgetInfo("weather", "Weather", "forecast"),
    ]


@pytest.fixture
def activities() -> list[ActivityInfo]:
    return [
        ActivityInfo("washer", "Washer", "progress"),
        ActivityInfo("radar", "Radar", "radar"),
    ]


async def test_the_panel_wire_fixture_is_current(
    hass: HomeAssistant, hass_ws_client, fake_client: FakeAiviClient
) -> None:
    async_mock_service(hass, "homeassistant", "turn_on")
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    hass.states.async_set("scene.movie", "scening", {"friendly_name": "Movie night"})
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("input_boolean.washer", "on")
    laundry = widget_subentry(
        "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
    )
    laundry["data"] = {**laundry["data"], CONF_STALE_AFTER: 900}
    entry = account_entry(
        hass,
        porch_subentry(),
        laundry,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "input_boolean.washer",
            {"progress": "sensor.washer_progress"},
            # Throttled, so its next change is held.
            throttle=60,
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    # A second account binds nothing that takes input: it has no stream.
    quiet = account_entry(hass, widget_subentry("laundry", "Laundry", "progress", {}))
    assert await hass.config_entries.async_setup(quiet.entry_id)
    await hass.async_block_till_done()
    # Automations feeding slugs: one the panel may turn off, one it may not.
    call = {
        "action": "rest_command.update_widget",
        "data": {"slug": "porch", "payload": "{}"},
    }
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {"id": "1", "alias": "Porch", "triggers": [], "actions": [call]},
                {
                    "alias": "Porch at start",
                    "initial_state": True,
                    "triggers": [],
                    "actions": [call],
                },
            ]
        },
    )
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    async def ask(msg: dict[str, Any]) -> Any:
        await client.send_json_auto_id(msg)
        reply = await client.receive_json()
        assert reply["success"], reply
        return reply["result"]

    answers: dict[str, list[Any]] = {}

    async def record(msg: dict[str, Any]) -> None:
        answers.setdefault(msg["type"], []).append(await ask(msg))

    config = {"type": "aivi/config"}
    listings = [
        {"type": "aivi/widgets", "entry_id": entry.entry_id},
        {"type": "aivi/activities", "entry_id": entry.entry_id},
    ]
    await record(config)
    for listing in listings:
        await record(listing)

    # aivi/inputs/subscribe, on a connection of its own: every change below
    # is sent to it.
    subscriber = await hass_ws_client(hass)
    await subscriber.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": entry.entry_id}
    )
    assert (await subscriber.receive_json())["success"]
    updates: list[Any] = answers.setdefault("aivi/inputs/subscribe", [])

    async def updated(done: Any) -> None:
        while True:
            updates.append((await subscriber.receive_json())["event"])
            if done(updates[-1]):
                return

    def stream_is(state: str) -> Any:
        return lambda update: (update["stream"] or {}).get("state") == state

    await updated(stream_is("connected"))
    # The account without a stream, once.
    other = await hass_ws_client(hass)
    await other.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": quiet.entry_id}
    )
    assert (await other.receive_json())["success"]
    updates.append((await other.receive_json())["event"])

    # Presses: one played, one whose service is missing (turn_off is not
    # registered here), one for a tile the switchboard does not have.
    for press in (
        tile_press("light_porch", slug="porch", kind="toggle", value=True),
        tile_press("light_porch", slug="porch", kind="toggle", value=False),
        tile_press("nope", slug="porch", kind="button"),
    ):
        fake_client.emit(press)
    await updated(lambda update: len(update["presses"]) == 3)
    assert {row["outcome"] for row in updates[-1]["presses"]} == {
        "played",
        "failed",
        "not_bound",
    }

    # A push Aivi refuses, so the log has a failed row with its error
    # beside the delivered ones setup made; the activity's is held.
    fake_client.reject_content = True
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    fake_client.reject_content = False
    await updated(
        lambda update: (
            {"failed", "held"} <= {row["outcome"] for row in update["pushes"]}
        )
    )
    # Nothing to read: the pushes wait.
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    await updated(
        lambda update: any(row["outcome"] == "waiting" for row in update["pushes"])
    )

    # The stream reconnecting: a stream that ends young, and a next open
    # that fails.
    fake_client.stream_error = AiviError("Cannot reach Aivi")
    fake_client.close_stream()
    await updated(stream_is("reconnecting"))
    await record(config)

    # Paused: the account's subscription lapsed, on a date Aivi gave.
    fake_client.subscription = LAPSED
    await client.send_json_auto_id(listings[0])
    assert (await client.receive_json())["error"]["code"] == "subscription_inactive"
    await updated(stream_is("paused"))
    await record(config)
    fake_client.subscription = None
    await record(listings[0])
    await updated(stream_is("connected"))

    # Stopped: the token was rejected.
    fake_client.auth_ok = False
    fake_client.close_stream()
    await updated(stream_is("stopped"))
    await record(config)

    await record({"type": "aivi/automations/turn_off", "entity_ids": []})

    shapes: dict[str, Any] = {}
    for command, results in sorted(answers.items()):
        shape = _shape(results[0])
        for result in results[1:]:
            shape = _merge(shape, _shape(result))
        shapes[command] = shape
    text = json.dumps(shapes, indent=2) + "\n"
    if os.environ.get("AIVI_WIRE_WRITE"):
        WIRE.write_text(text, encoding="utf-8")
    assert WIRE.read_text(encoding="utf-8") == text, (
        "frontend/tests/fixtures/wire.json is stale; run `make fixtures`"
    )
    await hass.config_entries.async_unload(entry.entry_id)
