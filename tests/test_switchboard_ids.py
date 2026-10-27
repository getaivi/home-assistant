"""Switchboard action ids: derived from the entity id, valid for Aivi, stable
and unique."""

from __future__ import annotations

import pytest

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.switchboard import (
    action_id,
    action_ids,
    bound_actions,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def test_action_ids_fold_entity_ids_and_stay_within_the_pattern() -> None:
    assert action_id("light.porch") == "light_porch"
    assert action_id("Scene.Movie-Night") == "scene_movie-night"
    assert action_id("switch.déjà vu!") == "switch_d_j_vu"
    # 35 characters: shortened to a prefix plus a stable hash, 32 wide.
    long = action_id("light.living_room_ceiling_lamp_left")
    assert len(long) == 32
    assert long.startswith("light_living_room_ceilin")
    assert long == action_id("light.living_room_ceiling_lamp_left")
    assert action_id("__") == "e"
    assert action_id("_x") == "x"


def test_action_ids_are_unique_in_list_order() -> None:
    ids = action_ids(["light.a_b", "light.a.b", "light.a_b", "switch.a_b"])
    assert ids == {
        "light.a_b": "light_a_b",
        "light.a.b": "light_a_b_2",
        "switch.a_b": "switch_a_b",
    }
    assert bound_actions({"actions": ["light.a_b", "light.a.b", 7, ""]}) == {
        "light_a_b": "light.a_b",
        "light_a_b_2": "light.a.b",
    }
    assert bound_actions({}) == {}
