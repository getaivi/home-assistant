"""An Aivi API version without ``state_text`` (it refuses unknown fields):
pushes go without the words until it takes them."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
)

from custom_components.aivi.api import AiviValidationError, WidgetInfo
from custom_components.aivi.runtime import push_switchboard
from custom_components.aivi.switchboard import (
    STATE_TEXT_RETRY_SECONDS,
    StateTextSupport,
)
from helpers import (
    OPEN_CLOSED,
    account_entry,
    advance_past_debounce,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


async def test_a_refusal_naming_the_field_retries_without_it() -> None:
    clock = _Clock()
    support = StateTextSupport(clock)
    sent: list[dict[str, Any]] = []
    old_backend = True

    async def push(content: dict[str, Any]) -> None:
        if old_backend and any("state_text" in a for a in content["actions"]):
            raise AiviValidationError(
                "Extra inputs", [("extra_forbidden", ("body", "state_text"))]
            )
        sent.append(content)

    words = {"on": "Open"}
    content = {
        "actions": [{"id": "c", "kind": "toggle", "on": True, "state_text": words}]
    }
    bare = {"actions": [{"id": "c", "kind": "toggle", "on": True}]}

    await push_switchboard(push, content, support)
    assert sent == [bare]
    assert not support.offered
    # Until the window passes, the words are not offered again.
    clock.now += STATE_TEXT_RETRY_SECONDS - 1
    await push_switchboard(push, content, support)
    assert sent == [bare, bare]
    # Then one push offers them again.
    clock.now += 1
    assert support.offered
    old_backend = False
    await push_switchboard(push, content, support)
    assert sent == [bare, bare, content]
    assert support.offered

    # Content without words is never touched.
    await push_switchboard(push, bare, StateTextSupport(clock))
    assert sent[-1] == bare


async def test_other_refusals_are_not_retried() -> None:
    support = StateTextSupport(_Clock())
    calls = 0

    async def push(content: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        raise AiviValidationError(
            "label: too long", [("string_too_long", ("body", "label"))]
        )

    content = {"actions": [{"id": "c", "state_text": {"idle": ""}}]}
    with pytest.raises(AiviValidationError):
        await push_switchboard(push, content, support)
    assert calls == 1
    assert support.offered


async def test_an_old_aivi_still_gets_every_change(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.unknown_action_fields = {"state_text"}
    hass.states.async_set("cover.garage", "closed", {"friendly_name": "Garage"})
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom",
            "Living room",
            "switchboard",
            {"actions": ["cover.garage", "light.porch"]},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    # Refused once, sent again without the words, and nothing reported.
    assert fake_client.refused_pushes == 1
    assert len(fake_client.pushes) == 1
    tiles = fake_client.last_push[1]["actions"]
    assert [t.get("state_text") for t in tiles] == [None, None]
    assert tiles[0]["on"] is False
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager.last_error is None
    # The log shows the push that went through, without the words.
    (row,) = entry.runtime_data.inputs.pushes.rows()
    assert row["request"]["body"] == {"content": fake_client.last_push[1]}

    # Later pushes leave the words out without asking again.
    hass.states.async_set("cover.garage", "open", {"friendly_name": "Garage"})
    await advance_past_debounce(hass)
    assert fake_client.refused_pushes == 1
    assert len(fake_client.pushes) == 2
    assert fake_client.last_push[1]["actions"][0] == {
        "id": "cover_garage",
        "label": "Garage",
        "icon": "blinds.horizontal.closed",
        "kind": "toggle",
        "on": True,
    }


async def test_a_current_aivi_gets_the_words(hass: HomeAssistant, fake_client) -> None:
    hass.states.async_set("cover.garage", "closed", {"friendly_name": "Garage"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom",
            "Living room",
            "switchboard",
            {
                "actions": ["cover.garage"],
                "actions__options": {"cover.garage": {"state_text_off": "Shut"}},
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["actions"][0]["state_text"] == {
        **OPEN_CLOSED,
        "off": "Shut",
    }


async def test_words_come_back_once_aivi_takes_them(
    hass: HomeAssistant, fake_client, freezer
) -> None:
    """After the retry window, the words go out again without waiting for
    a state change."""
    fake_client.unknown_action_fields = {"state_text"}
    hass.states.async_set("cover.garage", "closed", {"friendly_name": "Garage"})
    entry = account_entry(
        hass,
        widget_subentry(
            "livingroom", "Living room", "switchboard", {"actions": ["cover.garage"]}
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.refused_pushes == 1
    assert "state_text" not in fake_client.last_push[1]["actions"][0]
    pushes = len(fake_client.pushes)
    # Nothing changes: no redundant push of the same stripped content.
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes

    fake_client.unknown_action_fields = set()
    freezer.tick(timedelta(seconds=STATE_TEXT_RETRY_SECONDS + 1))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["actions"][0]["state_text"] == OPEN_CLOSED


async def test_a_bad_word_is_not_taken_for_an_unknown_field() -> None:
    """An error located inside ``state_text`` is a real refusal, not a
    server without the field."""

    support = StateTextSupport(_Clock())
    calls = 0

    async def push(content: dict[str, Any]) -> None:
        nonlocal calls
        calls += 1
        raise AiviValidationError(
            "on: String should have at most 24 characters",
            errors=[
                (
                    "string_too_long",
                    ("body", "content", "actions", "toggle", "state_text", "on"),
                )
            ],
        )

    content = {"actions": [{"id": "c", "state_text": {"on": "x" * 25}}]}
    with pytest.raises(AiviValidationError):
        await push_switchboard(push, content, support)
    assert calls == 1
    assert support.offered
