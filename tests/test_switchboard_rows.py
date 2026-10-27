"""Switchboard rows: one tile per entity, a toggle for a two-state domain."""

from __future__ import annotations

import pytest

from custom_components.aivi import engine, limits
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.switchboard import (
    bound_actions,
    press_service,
)
from custom_components.aivi.templates import SWITCHBOARD
from helpers import (
    Resolver,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def test_rows_map_entities_to_tiles() -> None:
    resolver = Resolver(
        states={
            "light.porch": "on",
            "switch.fountain": "off",
            "scene.movie": "scening",
            "script.bedtime": "on",
            "input_button.doorbell": "2026-09-22T10:00:00+00:00",
            "fan.attic": "unavailable",
        },
        attrs={
            "light.porch": {"friendly_name": "Porch light"},
            "switch.fountain": {"friendly_name": "Garden fountain"},
            "scene.movie": {"friendly_name": "Movie night"},
            "script.bedtime": {"friendly_name": "A script name past twenty-four"},
        },
    )
    content = engine.resolve(
        SWITCHBOARD,
        {
            "actions": [
                "light.porch",
                "switch.fountain",
                "scene.movie",
                "script.bedtime",
                "input_button.doorbell",
                "fan.attic",
            ],
            "actions__options": {
                "light.porch": {"color": "yellow", "icon": "lamp.floor.fill"},
                "switch.fountain": {"label": "Fountain", "color": "nope"},
            },
            "accent": "indigo",
        },
        resolver,
    )
    assert content == {
        "template": "switchboard",
        "accent": "indigo",
        "actions": [
            {
                "id": "light_porch",
                "label": "Porch light",
                "icon": "lamp.floor.fill",
                "color": "yellow",
                "kind": "toggle",
                "on": True,
            },
            {
                "id": "switch_fountain",
                "label": "Fountain",
                "icon": "power",
                "kind": "toggle",
                "on": False,
            },
            {"id": "scene_movie", "label": "Movie night", "icon": "sparkles"},
            {
                "id": "script_bedtime",
                "label": "A script name past twent",
                "icon": "play.fill",
                "active": True,
            },
            {
                "id": "input_button_doorbell",
                "label": "input_button.doorbell",
                "icon": "hand.tap.fill",
            },
            # Unavailable: the tile stays, off, so the grid keeps its shape.
            {
                "id": "fan_attic",
                "label": "fan.attic",
                "icon": "fan.fill",
                "kind": "toggle",
                "on": False,
            },
        ],
    }
    assert engine.dependencies(SWITCHBOARD, {"actions": ["light.porch"]}) == {
        "light.porch"
    }


def test_rows_are_capped_and_an_empty_pick_resolves_nothing() -> None:
    resolver = Resolver()
    many = [f"switch.s{i}" for i in range(limits.ROWS + 3)]
    content = engine.resolve(SWITCHBOARD, {"actions": many}, resolver)
    assert content is not None
    assert [a["id"] for a in content["actions"]] == [
        f"switch_s{i}" for i in range(limits.ROWS)
    ]
    assert bound_actions({"actions": many}) == {
        f"switch_s{i}": f"switch.s{i}" for i in range(limits.ROWS)
    }
    assert engine.resolve(SWITCHBOARD, {"actions": []}, resolver) is None
    assert engine.resolve(SWITCHBOARD, {"actions": [3, None]}, resolver) is None


def test_press_services_by_kind_and_domain() -> None:
    assert press_service("light.porch", True) == ("homeassistant", "turn_on")
    assert press_service("switch.fountain", False) == ("homeassistant", "turn_off")
    # A toggle needs its requested state.
    assert press_service("light.porch", None) is None
    assert press_service("light.porch", "on") is None
    assert press_service("scene.movie", None) == ("homeassistant", "turn_on")
    assert press_service("script.bedtime", True) == ("homeassistant", "turn_on")
    assert press_service("button.restart", None) == ("button", "press")
    assert press_service("input_button.doorbell", None) == ("input_button", "press")
