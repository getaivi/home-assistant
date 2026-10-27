"""The presses event entity of a binding that accepts input, and the context
that ties a state change to its press."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest
from homeassistant.core import Event, HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import (
    DATA_REGISTRY,
    EVENT_ACTION,
)
from custom_components.aivi.inputs import (
    InputEvent,
)
from custom_components.aivi.switchboard import PRESSED, TOGGLE_OFF, TOGGLE_ON
from custom_components.aivi.templates import (
    PROGRESS,
    SWITCHBOARD,
    TemplateRegistry,
)
from helpers import (
    entity_id_of,
    porch_subentry,
    setup_porch,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("hall", "Hall", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
    ]


def _presses_entity(entity_registry: er.EntityRegistry, entry: Any) -> str:
    subentry_id = next(
        sid for sid, sub in entry.subentries.items() if sub.data["slug"] == "porch"
    )
    entity_id = entity_id_of(entity_registry, "event", f"{subentry_id}_presses")
    assert entity_id is not None
    return entity_id


async def test_a_switchboard_gets_an_enabled_presses_entity(
    hass: HomeAssistant, entity_registry: er.EntityRegistry
) -> None:
    hass.states.async_set("sensor.washer_progress", "40")
    entry = await setup_porch(
        hass,
        porch_subentry(),
        widget_subentry(
            "laundry", "Laundry", "progress", {"progress": "sensor.washer_progress"}
        ),
    )
    presses = _presses_entity(entity_registry, entry)
    registered = entity_registry.async_get(presses)
    assert registered is not None and registered.disabled_by is None
    state = hass.states.get(presses)
    assert state is not None
    assert state.attributes["event_types"] == [TOGGLE_ON, TOGGLE_OFF, PRESSED]
    # A display-only template accepts no input: no presses entity.
    laundry = next(
        sid for sid, sub in entry.subentries.items() if sub.data["slug"] == "laundry"
    )
    assert entity_id_of(entity_registry, "event", f"{laundry}_presses") is None
    # On the binding's own device.
    assert (
        registered.device_id
        == entity_registry.async_get(
            entity_id_of(
                entity_registry,
                "sensor",
                f"{registered.config_subentry_id}_push_status",
            )
        ).device_id
    )


async def test_presses_fire_only_when_played_back(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    calls: list[str] = []

    async def _turn_on(call: ServiceCall) -> None:
        calls.append(call.data["entity_id"])
        if len(calls) == 2:
            raise HomeAssistantError("device offline")

    hass.services.async_register("homeassistant", "turn_on", _turn_on)
    async_mock_service(hass, "homeassistant", "turn_off")
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    presses = _presses_entity(entity_registry, entry)
    await until(hass, lambda: runtime.commands.health.connected, "open")
    fired: list[Any] = []
    hass.bus.async_listen(
        "state_changed",
        lambda event: (
            fired.append(event.data["new_state"])
            if event.data["entity_id"] == presses
            else None
        ),
    )

    fake_client.emit(tile_press("light_porch", slug="porch", kind="toggle", value=True))
    await until(hass, lambda: len(fired) == 1, "the played press")
    state = fired[0]
    assert state.attributes["event_type"] == TOGGLE_ON
    assert state.attributes["action"] == "light_porch"
    assert state.attributes["entity_id"] == "light.porch"
    assert state.attributes["label"] == "Porch light"
    assert state.attributes["value"] is True
    assert state.attributes["request_id"].startswith("act_")

    # Failed, expired, not bound and malformed presses do not fire.
    fake_client.emit(
        tile_press("scene_movie", slug="porch", kind="button")
    )  # the call fails
    fake_client.emit(
        tile_press(
            "light_porch", slug="porch", kind="toggle", value=True, expires_in=-1
        )
    )
    fake_client.emit(tile_press("garage", slug="porch", kind="button"))
    fake_client.emit(tile_press("light_porch", slug="porch", kind="toggle"))
    fake_client.emit(
        tile_press("light_porch", slug="porch", kind="toggle", value=False)
    )
    await until(hass, lambda: len(fired) == 2, "the next played press")
    assert fired[1].attributes["event_type"] == TOGGLE_OFF

    outcomes = [
        (row["outcome"], row["event_type"]) for row in runtime.inputs.log.rows()
    ]
    assert outcomes == [
        ("played", TOGGLE_OFF),
        ("ignored", "toggle"),
        ("not_bound", PRESSED),
        ("expired", TOGGLE_ON),
        ("failed", PRESSED),
        ("played", TOGGLE_ON),
    ]
    failed = runtime.inputs.log.rows()[-2]
    assert failed["error"] == "device offline"
    assert failed["label"] == "Movie night"
    assert failed["subentry_id"] == next(iter(entry.subentries))
    # A tile the binding does not have is still that binding's press.
    assert runtime.inputs.log.rows()[2]["subentry_id"] == failed["subentry_id"]


async def test_play_only_types_are_listed_coalesced_and_never_fire(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    """Which types are recorded is the template's declaration."""
    hass.data[DATA_REGISTRY] = TemplateRegistry(
        [
            replace(
                SWITCHBOARD,
                inputs=(
                    InputEvent(TOGGLE_ON),
                    InputEvent(TOGGLE_OFF),
                    InputEvent(PRESSED, recorded=False),
                ),
            ),
            PROGRESS,
        ]
    )
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    entry = await setup_porch(hass, porch_subentry())
    runtime = entry.runtime_data
    presses = _presses_entity(entity_registry, entry)
    assert hass.states.get(presses).attributes["event_types"] == [
        TOGGLE_ON,
        TOGGLE_OFF,
    ]
    await until(hass, lambda: runtime.commands.health.connected, "open")
    for _ in range(3):
        fake_client.emit(tile_press("scene_movie", slug="porch", kind="button"))
    await until(hass, lambda: len(turn_on) == 3, "three presses")
    await until(hass, lambda: runtime.inputs.log.rows()[0]["count"] == 3, "coalesced")
    (row,) = runtime.inputs.log.rows()
    assert row["recorded"] is False
    assert hass.states.get(presses).state == "unknown"


async def test_the_press_context_reaches_the_state_change(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, fake_client
) -> None:
    """The bus event, the service call and so the state change it causes,
    and the event entity share one context: Home Assistant credits the
    change to the press."""
    assert await async_setup_component(
        hass, "input_boolean", {"input_boolean": {"porch": {"name": "Porch"}}}
    )
    assert await async_setup_component(hass, "homeassistant", {})
    entry = await setup_porch(hass, porch_subentry(["input_boolean.porch"]))
    runtime = entry.runtime_data
    presses = _presses_entity(entity_registry, entry)
    await until(hass, lambda: runtime.commands.health.connected, "open")
    bus: list[Event] = []
    hass.bus.async_listen(EVENT_ACTION, bus.append)

    fake_client.emit(
        tile_press("input_boolean_porch", slug="porch", kind="toggle", value=True)
    )
    await until(hass, lambda: hass.states.get(presses).state != "unknown", "the press")
    (event,) = bus
    changed = hass.states.get("input_boolean.porch")
    assert changed.state == "on"
    assert changed.context.id == event.context.id
    assert hass.states.get(presses).context.id == event.context.id
    # The bus event's fields, plus the account that received the press.
    assert set(event.data) == {
        "slug",
        "subject_kind",
        "entry_id",
        "action",
        "action_kind",
        "value",
        "event_id",
        "request_id",
    }
