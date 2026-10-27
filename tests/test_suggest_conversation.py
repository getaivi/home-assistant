"""One Suggest turn as a unit, against a fake suggester: the retry, the
repair request and what the answer reports. The WebSocket tests cover the
command's wiring over the same loop."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from test_websocket_suggest import FakeSuggester

from custom_components.aivi.suggest import (
    SuggestAsk,
    SuggestFailed,
    async_converse,
)
from custom_components.aivi.suggest.conversation import needs_repair, shown
from custom_components.aivi.templates import default_registry

SWITCHBOARD = next(t for slug, t in default_registry().items() if slug == "switchboard")
ASK = SuggestAsk(
    name="Porch",
    description="add the robot vacuum",
    bindings={"actions": ["light.porch"]},
)


class Failing(FakeSuggester):
    """Raises ``errors`` in order, then answers like the fake."""

    def __init__(self, result: Any, errors: list[BaseException]) -> None:
        super().__init__(result)
        self.errors = errors
        self.calls = 0

    async def generate(self, hass, **kwargs):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return await super().generate(hass, **kwargs)


@pytest.fixture(autouse=True)
def porch(hass: HomeAssistant) -> None:
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch"})
    hass.states.async_set("light.garden", "on", {"friendly_name": "Garden"})


@pytest.mark.parametrize(
    ("raw", "rejected", "changed", "expected"),
    [
        ({"reply": "Done."}, [{"key": "k", "value": "v", "reason": "r"}], True, True),
        ({"match": "clear", "reply": "I've added it."}, [], False, True),
        ({"match": "clear", "reply": "Which light?"}, [], False, False),
        ({"match": "answer", "reply": "Seven more."}, [], False, False),
        ({"match": "none", "reply": "Nothing here."}, [], False, False),
        ({"match": "clear", "reply": "I've added it."}, [], True, False),
        ({"match": "clear"}, [], False, False),
    ],
)
def test_an_answer_is_repaired_when_its_check_finds_something(
    raw: dict[str, Any], rejected: list[Any], changed: bool, expected: bool
) -> None:
    assert needs_repair(raw, rejected, changed) is expected


def test_the_form_is_compared_without_what_the_integration_derives() -> None:
    assert shown({"value__template": "{{ 1 }}", "value__watched": ["a.b"]}) == {
        "value__template": "{{ 1 }}"
    }


async def test_a_clean_change_is_answered_in_one_request(hass: HomeAssistant) -> None:
    suggester = FakeSuggester(
        {
            "match": "clear",
            "actions": ["light.porch", "light.garden"],
            "reply": "I've added the garden light.",
            "options": ["Add the porch"],
        }
    )
    result = await async_converse(hass, suggester, SWITCHBOARD, ASK)
    assert result == {
        "bindings": {"actions": ["light.porch", "light.garden"]},
        "changed": True,
        "match": "clear",
        "options": ["Add the porch"],
        "reply": "I've added the garden light.",
        "rejected": [],
    }
    assert len(suggester.instructions) == 1
    assert suggester.repairs == []


async def test_a_failed_repair_keeps_the_first_answer(hass: HomeAssistant) -> None:
    class RepairFails(FakeSuggester):
        async def generate(self, hass, **kwargs):
            if "You already answered this once" in kwargs["instructions"]:
                raise HomeAssistantError("the provider is down")
            return await super().generate(hass, **kwargs)

    suggester = RepairFails(
        {
            "match": "clear",
            "actions": ["light.porch", "vacuum.robot"],
            "reply": "I've added the robot vacuum.",
        }
    )
    result = await async_converse(hass, suggester, SWITCHBOARD, ASK)
    assert result["bindings"] == {"actions": ["light.porch"]}
    assert result["rejected"] == [
        {"key": "actions", "value": "vacuum.robot", "reason": "no_entity"}
    ]
    assert result["reply"] is None


async def test_a_failed_request_is_tried_once_more(hass: HomeAssistant) -> None:
    suggester = Failing(
        {"match": "answer", "reply": "Seven more."},
        [HomeAssistantError("Error with structured response")],
    )
    result = await async_converse(hass, suggester, SWITCHBOARD, ASK)
    assert suggester.calls == 2
    assert result["reply"] == "Seven more."


@pytest.mark.parametrize(
    ("errors", "message"),
    [
        (
            [HomeAssistantError("first"), HomeAssistantError("second")],
            "second",
        ),
        ([KeyError("type")], "KeyError: 'type'"),
    ],
)
async def test_a_model_that_gives_no_answer_says_why(
    hass: HomeAssistant, errors: list[BaseException], message: str
) -> None:
    suggester = Failing({}, errors)
    with pytest.raises(SuggestFailed, match=message):
        await async_converse(hass, suggester, SWITCHBOARD, ASK)
