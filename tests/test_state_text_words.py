"""The state words a switchboard tile shows (``state_text``): the automatic
ones by domain, where ``on`` must mean what the words say, and the user's
own over them key by key."""

from __future__ import annotations

import json
from typing import Any

import pytest

from custom_components.aivi import engine
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.switchboard import (
    press_service,
    toggle_on,
)
from custom_components.aivi.templates import SWITCHBOARD
from helpers import (
    OPEN_CLOSED,
    Resolver,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


LOCKED_UNLOCKED = {
    "on": "Locked",
    "off": "Unlocked",
    "turning_on": "Locking",
    "turning_off": "Unlocking",
}


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def _tile(
    entity_id: str,
    state: str,
    options: dict[str, str] | None = None,
    attrs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bindings: dict[str, Any] = {"actions": [entity_id]}
    if options is not None:
        bindings["actions__options"] = {entity_id: options}
    content = engine.resolve(
        SWITCHBOARD,
        bindings,
        Resolver(states={entity_id: state}, attrs={entity_id: attrs or {}}),
    )
    assert content is not None
    return content["actions"][0]


@pytest.mark.parametrize("domain", ["cover", "valve"])
@pytest.mark.parametrize(
    ("state", "on", "words"),
    [
        ("open", True, OPEN_CLOSED),
        ("closed", False, OPEN_CLOSED),
        # Moving: published as the side it is heading for (the press that
        # started it is answered at once), saying it is still moving.
        ("opening", True, {**OPEN_CLOSED, "on": "Opening"}),
        ("closing", False, {**OPEN_CLOSED, "off": "Closing"}),
        # Neither side: off, and saying so rather than "Closed".
        ("unknown", False, {**OPEN_CLOSED, "off": "Unknown"}),
        ("unavailable", False, {**OPEN_CLOSED, "off": "Unavailable"}),
    ],
)
def test_covers_and_valves_are_on_when_open(
    domain: str, state: str, on: bool, words: dict[str, str]
) -> None:
    tile = _tile(f"{domain}.main", state)
    assert tile["kind"] == "toggle"
    assert tile["on"] is on
    assert tile["state_text"] == words


@pytest.mark.parametrize(
    ("state", "on", "words"),
    [
        ("locked", True, LOCKED_UNLOCKED),
        ("unlocked", False, LOCKED_UNLOCKED),
        ("locking", True, {**LOCKED_UNLOCKED, "on": "Locking"}),
        ("unlocking", False, {**LOCKED_UNLOCKED, "off": "Unlocking"}),
        # Never "Locked" unless it is, and never "Unlocked" for a lock
        # that is jammed, unlatched or not reporting.
        ("jammed", False, {**LOCKED_UNLOCKED, "off": "Jammed"}),
        ("open", False, {**LOCKED_UNLOCKED, "off": "Open"}),
        ("opening", False, {**LOCKED_UNLOCKED, "off": "Opening"}),
        ("unknown", False, {**LOCKED_UNLOCKED, "off": "Unknown"}),
        ("unavailable", False, {**LOCKED_UNLOCKED, "off": "Unavailable"}),
    ],
)
def test_locks_are_on_when_locked(state: str, on: bool, words: dict[str, str]) -> None:
    tile = _tile("lock.front_door", state)
    assert tile["kind"] == "toggle"
    assert tile["on"] is on
    assert tile["state_text"] == words


@pytest.mark.parametrize(
    ("entity_id", "state"),
    [
        ("switch.fountain", "on"),
        ("light.porch", "off"),
        ("fan.attic", "on"),
        ("input_boolean.guest", "off"),
        ("scene.movie", "scening"),
        ("script.bedtime", "on"),
        ("button.restart", "unknown"),
    ],
)
def test_other_domains_and_buttons_keep_the_app_words(
    entity_id: str, state: str
) -> None:
    assert "state_text" not in _tile(entity_id, state)


def test_on_for_the_two_state_domains() -> None:
    assert toggle_on("light.porch", "on") is True
    assert toggle_on("light.porch", "unavailable") is False
    assert toggle_on("cover.garage", "open") is True
    assert toggle_on("cover.garage", "opening") is True
    assert toggle_on("cover.garage", "closing") is False
    assert toggle_on("cover.garage", None) is False
    assert toggle_on("lock.front_door", "locked") is True
    assert toggle_on("lock.front_door", "jammed") is False
    assert toggle_on("valve.garden", "open") is True


def test_new_toggles_get_their_glyphs_and_services() -> None:
    assert _tile("cover.garage", "closed", attrs={"device_class": "garage"})[
        "icon"
    ] == ("door.garage.closed")
    assert _tile("cover.blinds", "closed")["icon"] == "blinds.horizontal.closed"
    assert _tile("lock.front_door", "locked")["icon"] == "lock.fill"
    assert _tile("valve.garden", "closed")["icon"] == "spigot.fill"
    assert press_service("cover.garage", True) == ("cover", "open_cover")
    assert press_service("cover.garage", False) == ("cover", "close_cover")
    assert press_service("valve.garden", True) == ("valve", "open_valve")
    assert press_service("valve.garden", False) == ("valve", "close_valve")
    assert press_service("lock.front_door", True) == ("lock", "lock")
    assert press_service("lock.front_door", False) == ("lock", "unlock")
    assert press_service("lock.front_door", None) is None


def test_user_words_override_key_by_key() -> None:
    tile = _tile(
        "cover.garage", "closed", {"state_text_on": "Up", "state_text_off": " Down "}
    )
    assert tile["state_text"] == {**OPEN_CLOSED, "on": "Up", "off": "Down"}
    # A motion word the user set is also what a moving tile says.
    tile = _tile("cover.garage", "opening", {"state_text_turning_on": "Going up"})
    assert tile["state_text"] == {
        **OPEN_CLOSED,
        "on": "Going up",
        "turning_on": "Going up",
    }


def test_an_empty_word_hides_it_and_passes_through() -> None:
    tile = _tile("cover.garage", "closed", {"state_text_off": ""})
    assert tile["state_text"] == {**OPEN_CLOSED, "off": ""}
    tile = _tile("light.porch", "off", {"state_text_off": "", "state_text_on": ""})
    assert tile["state_text"] == {"on": "", "off": ""}
    # Reaches the wire as "", not dropped as empty.
    assert '"off":""' in json.dumps(tile, separators=(",", ":"))


def test_words_on_any_tile_of_their_kind() -> None:
    tile = _tile(
        "light.porch",
        "off",
        {"state_text_no_response": "Offline", "state_text_on": "Lit"},
    )
    assert tile["state_text"] == {"on": "Lit", "no_response": "Offline"}
    tile = _tile(
        "scene.movie",
        "scening",
        {"state_text_idle": "Tap", "state_text_active": "", "state_text_sent": "Done"},
    )
    assert tile["state_text"] == {"idle": "Tap", "active": "", "sent": "Done"}
    # Another kind's key or a bad word (stored by other means): left out
    # of the push rather than refused by Aivi.
    tile = _tile(
        "scene.movie", "scening", {"state_text_on": "On", "state_text_sent": "x" * 25}
    )
    assert "state_text" not in tile
    tile = _tile("cover.garage", "closed", {"state_text_idle": "Tap"})
    assert tile["state_text"] == OPEN_CLOSED


@pytest.mark.parametrize("domain", ["lock", "cover", "valve"])
def test_a_missing_or_unrecognized_state_is_unknown(domain: str) -> None:
    """A missing entity or an unrecognized state never reads Unlocked or
    Closed."""
    tile = engine.resolve(SWITCHBOARD, {"actions": [f"{domain}.x"]}, Resolver())
    assert tile is not None
    assert tile["actions"][0]["on"] is False
    assert tile["actions"][0]["state_text"]["off"] == "Unknown"
    assert _tile(f"{domain}.x", "something_new")["state_text"]["off"] == "Unknown"
