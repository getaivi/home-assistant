"""The panel's Suggest over the WebSocket API, against a fake suggester."""

from __future__ import annotations

import pytest

from helpers import setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


class FakeSuggester:
    """Injected through the DATA_SUGGESTER seam, with no patching."""

    def __init__(self, result) -> None:
        self.result = result
        self.instructions: list[str] = []
        #: The repair requests: a first answer that failed its check, sent
        #: back with what the check found. Answered with ``repaired`` when
        #: set, else with the same result again.
        self.repairs: list[str] = []
        self.repaired = None
        self.entity_ids: list[str | None] = []

    def state(self, hass) -> str:
        return "ready"

    def models(self, hass) -> list:
        return [{"entity_id": "ai_task.fake", "name": "Fake", "preferred": True}]

    async def generate(
        self, hass, *, task_name, instructions, structure, entity_id=None
    ):
        if "You already answered this once" in instructions:
            self.repairs.append(instructions)
            if self.repaired is not None:
                return self.repaired
        else:
            self.instructions.append(instructions)
            self.entity_ids.append(entity_id)
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


async def test_suggest_reports_a_crashing_model_integration(
    hass, hass_ws_client, caplog
) -> None:
    """A provider that raises something other than HomeAssistantError (the
    OpenRouter strict-schema adjuster did, with KeyError) still answers
    with what broke, not "Unknown error", and the traceback is logged."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    hass.data[DATA_SUGGESTER] = FakeSuggester(KeyError("type"))
    await setup_account(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "show the washer progress",
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"] == {"code": "suggest_failed", "message": "KeyError: 'type'"}
    assert "AI Task failed while suggesting" in caplog.text


async def test_suggest_sanitizes_model_output(hass, hass_ws_client) -> None:
    """The model's answer is clamped to real entities and palette values."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "progress": "sensor.washer_progress",  # real -> kept
            "state": "sensor.does_not_exist",  # fake -> dropped
            "state__color": "red",  # belongs to a dropped field
            "icon": "washer.fill",  # kept
            "accent": "hotpink",  # not in palette -> dropped
            "bogus_key": "whatever",  # unknown -> dropped
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set(
        "sensor.washer_progress", "62", {"friendly_name": "Washer progress"}
    )
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "show the washer progress",
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "progress": "sensor.washer_progress",
        "icon": "washer.fill",
    }
    prompt = suggester.instructions[0]
    assert "sensor.washer_progress" in prompt
    assert "show the washer progress" in prompt
    # A first fill is a design brief; refinements change what is asked.
    assert "FIRST setup of an empty widget" in prompt

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    assert msg["result"]["suggest_state"] == "ready"


async def test_suggest_keeps_validated_templates(hass, hass_ws_client) -> None:
    """A suggested template survives only if it renders and every entity it
    touches exists; otherwise the entity id wins or the field is dropped."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    conditional = (
        "{% if states('sensor.washer_progress') | float(0) >= 90 %}"
        "Drying{% else %}Washing{% endif %}"
    )
    suggester = FakeSuggester(
        {
            "progress": "sensor.washer_progress",
            "progress__template": "{% broken",  # syntax error -> entity id wins
            "state__template": conditional,  # valid -> kept, with watched
            # references a nonexistent entity -> dropped
            "end_date__template": "{{ states('sensor.nope') }}",
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set(
        "sensor.washer_progress", "95", {"friendly_name": "Washer progress"}
    )
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "washer progress; 90% and above shows drying",
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "progress": "sensor.washer_progress",
        "state__template": conditional,
        "state__watched": ["sensor.washer_progress"],
    }
    prompt = suggester.instructions[0]
    assert "state__template" in prompt


async def test_suggest_refines_with_current_state(hass, hass_ws_client) -> None:
    """A follow-up ask carries the current form state and prior asks."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {"progress": "sensor.washer_progress", "accent": "orange"}
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "make the accent orange",
            "bindings": {"progress": "sensor.washer_progress", "accent": "cyan"},
            "history": ["washer progress, cyan accent"],
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "progress": "sensor.washer_progress",
        "accent": "orange",
    }
    prompt = suggester.instructions[0]
    assert '"accent": "cyan"' in prompt
    assert "washer progress, cyan accent" in prompt
    assert "make the accent orange" in prompt
    assert "Whatever no op touches stays exactly as it is" in prompt
    # "Omit when unsure" would silently clear fields on a refinement.
    assert "FIRST setup of an empty" not in prompt
    # No reply from this model: the panel gets None, not a blank.
    assert msg["result"]["reply"] is None


async def test_suggest_is_a_conversation(hass, hass_ws_client) -> None:
    """Each ask carries the exchanges so far, replies included, and the
    answer carries a short reply back; a question keeps the fields."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "progress": "sensor.washer_progress",
            "reply": "  Which dryer do you mean?  There are two.\n" + "x" * 500,
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "and the dryer too",
            "bindings": {"progress": "sensor.washer_progress"},
            "history": [
                {"ask": "washer progress", "reply": "Set the progress sensor."},
                "cyan accent",
            ],
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    prompt = suggester.instructions[0]
    assert 'User: "washer progress"' in prompt
    assert 'You: "Set the progress sensor."' in prompt
    assert 'User: "cyan accent"' in prompt
    assert 'The user now says: "and the dryer too"' in prompt
    assert "Also set `reply`" in prompt
    # The reply is one line, trimmed to a sane length, never in the bindings.
    reply = msg["result"]["reply"]
    assert reply.startswith("Which dryer do you mean? There are two. x")
    assert len(reply) <= 400
    assert "reply" not in msg["result"]["bindings"]
    assert msg["result"]["bindings"] == {"progress": "sensor.washer_progress"}


async def test_suggest_bound_entities_survive_the_candidate_cap(
    hass, hass_ws_client
) -> None:
    """An already-bound entity stays a candidate even when better word
    matches fill the cap, so a refinement can't rotate it out."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester({"progress": "sensor.aquarium_heater"})
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    # More strong word matches than the open-list cap (60); the bound
    # entity's name shares no words with any ask in the session.
    for i in range(70):
        hass.states.async_set(
            f"sensor.washer_progress_{i}",
            "1",
            {"friendly_name": f"Washer progress candidate {i}"},
        )
    hass.states.async_set(
        "sensor.aquarium_heater", "21", {"friendly_name": "Aquarium heater"}
    )
    client = await hass_ws_client(hass)

    base = {
        "type": "aivi/suggest",
        "template": "progress",
        "name": "Laundry",
        "description": "washer progress candidate",
    }
    await client.send_json_auto_id(base)
    msg = await client.receive_json()
    assert msg["success"]
    assert "sensor.aquarium_heater" not in suggester.instructions[0]

    await client.send_json_auto_id(
        {**base, "bindings": {"progress": "sensor.aquarium_heater"}}
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert "sensor.aquarium_heater" in suggester.instructions[1]


async def test_suggest_scores_candidates_against_the_session(
    hass, hass_ws_client
) -> None:
    """Earlier asks in the session anchor candidate scoring, since a
    correction like "no, the other one" carries no signal of its own."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester({"progress": "sensor.washer_progress"})
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    for i in range(5):
        hass.states.async_set(
            f"sensor.noise_{i}", "1", {"friendly_name": f"Garage door {i}"}
        )
    # Added last: with no session signal it would sort behind the noise
    # rows (every score zero, and the sort is stable in insertion order).
    hass.states.async_set(
        "sensor.washer_progress", "62", {"friendly_name": "Washer progress"}
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "use the other one",
            "history": ["washer progress with cyan accent"],
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    prompt = suggester.instructions[0]
    assert prompt.index("sensor.washer_progress — ") < prompt.index("sensor.noise_0 — ")


async def test_suggest_covers_all_field_kinds(hass, hass_ws_client) -> None:
    """The prompt and sanitizer handle every field kind."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "value": "sensor.power",
            "min_value": 0,
            "max_value": "not-a-number",  # junk -> dropped
            "ring": ["green", "hotpink", "red"],  # junk color filtered
            "icon": "x" * 100,  # too long -> dropped
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("sensor.power", "42")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "gauge",
            "name": "Power",
            "description": "power with a green to red ring from 0",
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "value": "sensor.power",
        "min_value": 0,
        "ring": ["green", "red"],
    }
    prompt = suggester.instructions[0]
    assert "(optional; a plain number)" in prompt
    assert "1-4 colours separated by commas" in prompt

    # The rows kind (list template): candidates and list answers survive.
    suggester.result = {
        "rows": ["sensor.power", "sensor.bogus"],
        "accent": "teal",
    }
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "list",
            "name": "Home",
            "description": "everything",
        }
    )
    msg = await client.receive_json()
    assert msg["result"]["bindings"] == {
        "rows": ["sensor.power"],
        "accent": "teal",
    }
    assert "entities, in row order" in suggester.instructions[1]


async def test_suggest_sanitizes_segments(hass, hass_ws_client) -> None:
    """Suggested segments are sanitized; the prompt describes their shape."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "progress": "sensor.washer_progress",
            "segments": [
                {"value": 0.7, "fill_color": "blue", "label": "Wash"},
                {"value": 0.3, "fill_color": "hotpink"},  # bad color: dropped
                {"value": 0.3, "fill_color": "teal", "label": "Dry"},
            ],
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "10")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "washer with wash and dry phases",
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    segments = msg["result"]["bindings"]["segments"]
    assert [s["fill_color"] for s in segments] == ["blue", "teal"]
    assert (
        "objects {value, fill_color, label, track_color, track_fill, source}"
        in suggester.instructions[0]
    )


async def test_a_refinement_keeps_what_the_model_cannot_express(
    hass, hass_ws_client
) -> None:
    """Asking to change only the accent changes only the accent: explicit
    entity and attribute sources, icon styling and per-row options, which
    the model's answer has no keys for, survive the round."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    await setup_account(hass)
    hass.states.async_set("sensor.washer", "on", {"percent": 62})
    hass.states.async_set("sensor.washer_state", "Washing")
    hass.states.async_set("sensor.a", "1")
    hass.states.async_set("sensor.b", "2")
    client = await hass_ws_client(hass)

    async def refine(template: str, current: dict, answer: dict) -> dict:
        hass.data[DATA_SUGGESTER] = FakeSuggester(answer)
        await client.send_json_auto_id(
            {
                "type": "aivi/suggest",
                "template": template,
                "name": "Laundry",
                "description": "make the accent orange",
                "bindings": current,
                "history": ["washer progress"],
            }
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]["bindings"]

    current = {
        "progress__entity": "sensor.washer",
        "progress__attribute": "percent",
        "state": "sensor.washer_state",
        "state__color": "blue",
        "icon": "washer.fill",
        "icon__rendering_mode": "hierarchical",
        "icon__secondary_color__entity": "sensor.washer_state",
        "segments": [
            {"value": 0.7, "fill_color": "blue", "label": "Wash"},
            {"value": 0.3, "fill_color": "teal", "track_fill": "hatched"},
        ],
        "accent": "cyan",
    }
    # The model repeats what it can: the progress entity, without its
    # attribute, the segments without their track, the rest verbatim.
    answer = {
        "progress": "sensor.washer",
        "state": "sensor.washer_state",
        "state__color": "blue",
        "icon": "washer.fill",
        "segments": [
            {"value": 0.7, "fill_color": "blue", "label": "Wash"},
            {"value": 0.3, "fill_color": "teal"},
        ],
        "accent": "orange",
    }
    assert await refine("progress", current, answer) == {**current, "accent": "orange"}

    rows = {
        "rows": ["sensor.a", "sensor.b"],
        "rows__options": {"sensor.a": {"label": "Kitchen", "color": "red"}},
        "accent": "cyan",
    }
    answer = {"rows": ["sensor.a", "sensor.b"], "accent": "orange"}
    assert await refine("list", rows, answer) == {**rows, "accent": "orange"}


async def test_suggest_reports_what_it_rejected(hass, hass_ws_client) -> None:
    """The reply is the model's, written before its answer was checked: the
    result says what the check dropped, and an invented entity leaves the
    field as it was."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    await setup_account(hass)
    hass.states.async_set("sensor.washer", "40")
    hass.data[DATA_SUGGESTER] = FakeSuggester(
        {
            "progress": "input_number.dryer_progress",
            "accent": "orange",
            "reply": "I've changed the progress to input_number.dryer_progress.",
        }
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "use the dryer instead",
            "bindings": {"progress": "sensor.washer"},
            "history": [{"ask": "washer"}],
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "progress": "sensor.washer",
        "accent": "orange",
    }
    assert msg["result"]["rejected"] == [
        {
            "key": "progress",
            "value": "input_number.dryer_progress",
            "reason": "no_entity",
        }
    ]
    # An ask longer than the composer allows is refused outright.
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "x" * 2001,
        }
    )
    assert not (await client.receive_json())["success"]


async def test_suggest_styles_the_icon(hass, hass_ws_client) -> None:
    """The model can set the icon's styling (its rendering mode and the
    layer colors), each clamped to what the field offers."""
    from custom_components.aivi.suggest import DATA_SUGGESTER, build_request
    from custom_components.aivi.templates import PROGRESS

    await setup_account(hass)
    instructions, structure = build_request(hass, PROGRESS, "Laundry", "colourful icon")
    assert "icon__rendering_mode" in instructions
    assert "icon__secondary_color" in instructions
    hass.data[DATA_SUGGESTER] = FakeSuggester(
        {
            "icon": "washer.fill",
            "icon__color": "blue",
            "icon__rendering_mode": "palette",
            "icon__secondary_color": "teal",
            "icon__tertiary_color": "hotpink",  # not a palette color
            "icon__color_rendering": "swirly",  # not a rendering
        }
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "colourful icon",
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "icon": "washer.fill",
        "icon__color": "blue",
        "icon__rendering_mode": "palette",
        "icon__secondary_color": "teal",
    }

    # As a refinement too: the styling applies to an icon already there,
    # and what the answer repeats keeps its sourced form.
    hass.data[DATA_SUGGESTER] = FakeSuggester(
        {
            "icon": "washer.fill",
            "icon__color": "blue",
            "icon__rendering_mode": "palette",
            "icon__secondary_color": "red",
            "icon__tertiary_color": "yellow",
        }
    )
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "multiple colours",
            "bindings": {
                "icon": "washer.fill",
                "icon__color": "blue",
                "icon__color__entity": "sensor.washer_state",
            },
            "history": [{"ask": "washer icon"}],
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {
        "icon": "washer.fill",
        "icon__color": "blue",
        "icon__color__entity": "sensor.washer_state",
        "icon__rendering_mode": "palette",
        "icon__secondary_color": "red",
        "icon__tertiary_color": "yellow",
    }


async def test_a_refinement_that_changes_a_field_replaces_its_source(
    hass, hass_ws_client
) -> None:
    """A field the model changes or leaves out takes the model's answer: a
    stale explicit source would otherwise outrank it."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    await setup_account(hass)
    hass.states.async_set("sensor.washer", "on", {"percent": 62})
    hass.states.async_set("sensor.dryer", "40")
    hass.states.async_set("sensor.washer_state", "Washing")
    hass.data[DATA_SUGGESTER] = FakeSuggester(
        {"progress": "sensor.dryer", "accent": "orange"}
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "use the dryer instead, and drop the state",
            "bindings": {
                "progress__entity": "sensor.washer",
                "progress__attribute": "percent",
                "state": "sensor.washer_state",
                "state__color": "blue",
                "accent": "cyan",
                "accent__template": "{{ 'red' }}",
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["bindings"] == {"progress": "sensor.dryer", "accent": "orange"}


async def test_suggest_unavailable_without_ai_task(hass, hass_ws_client) -> None:
    """No AI Task configured: suggest_state says why and the command errors."""
    await setup_account(hass)
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "aivi/config"})
    msg = await client.receive_json()
    assert msg["result"]["suggest_state"] == "not_loaded"

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "progress",
            "name": "Laundry",
            "description": "anything",
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "unavailable"


async def test_suggest_sets_nothing_when_the_home_has_no_match(
    hass, hass_ws_client
) -> None:
    """A model that says nothing here is about the subject, and fills the
    form with something else anyway, changes nothing: the form keeps what
    it has, and the question goes out with what the home does have."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "subject": "pool temperature",
            "match": "none",
            "value": "sensor.outside",
            "icon": "drop.fill",
            "reply": "Nothing here measures a pool. What should it show?",
            "options": ["The outside temperature", "The outside temperature", ""],
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("sensor.outside", "12", {"friendly_name": "Outside"})
    client = await hass_ws_client(hass)

    current = {"min_value": 0}
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "gauge",
            "name": "Pool",
            "description": "pool temperature",
            "bindings": current,
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == {
        "bindings": current,
        "changed": False,
        "match": "none",
        "options": ["The outside temperature"],
        "reply": "Nothing here measures a pool. What should it show?",
        "rejected": [],
    }

    # A guess is acted on, and offers what it passed over.
    suggester.result = {
        "match": "guess",
        "value": "sensor.outside",
        "reply": "I used the outside temperature.",
        "options": ["The thermostat"],
    }
    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "gauge",
            "name": "Temperature",
            "description": "temperature",
        }
    )
    msg = await client.receive_json()
    assert msg["result"]["bindings"] == {"value": "sensor.outside"}
    assert msg["result"]["match"] == "guess"
    assert msg["result"]["options"] == ["The thermostat"]


async def test_suggest_keeps_quiet_about_work_that_was_all_refused(
    hass, hass_ws_client
) -> None:
    """The reply is written before the answer is checked. When everything
    it proposed was refused and the form is as it was, the reply is not
    passed on: the rejections say what happened. A provider error is tried
    once more before it is reported."""
    from homeassistant.exceptions import HomeAssistantError

    from custom_components.aivi.suggest import DATA_SUGGESTER

    class Flaky(FakeSuggester):
        failures = 1

        async def generate(self, hass, **kwargs):
            if self.failures:
                self.failures -= 1
                raise HomeAssistantError("Error with structured response")
            return await super().generate(hass, **kwargs)

    suggester = Flaky(
        {
            "match": "clear",
            "actions": ["light.porch", "vacuum.robot"],
            "reply": "I've added the robot vacuum.",
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch"})
    client = await hass_ws_client(hass)
    request = {
        "type": "aivi/suggest",
        "template": "switchboard",
        "name": "Porch",
        "description": "add the robot vacuum",
        "bindings": {"actions": ["light.porch"]},
    }

    await client.send_json_auto_id(request)
    msg = await client.receive_json()
    assert msg["success"], msg
    assert msg["result"]["changed"] is False
    assert msg["result"]["reply"] is None
    assert msg["result"]["rejected"] == [
        {"key": "actions", "value": "vacuum.robot", "reason": "no_entity"}
    ]

    # Something real changed: the reply stands, beside what was refused.
    hass.states.async_set("light.garden", "on", {"friendly_name": "Garden"})
    suggester.result = {
        "match": "clear",
        "actions": ["light.porch", "light.garden", "vacuum.robot"],
        "reply": "I've added the garden light.",
    }
    await client.send_json_auto_id(request)
    msg = await client.receive_json()
    assert msg["result"]["changed"] is True
    assert msg["result"]["reply"] == "I've added the garden light."

    # Two failures in a row are reported.
    suggester.failures = 2
    await client.send_json_auto_id(request)
    msg = await client.receive_json()
    assert msg["error"]["code"] == "suggest_failed"


async def test_suggest_shows_the_model_its_check_and_asks_once_more(
    hass, hass_ws_client
) -> None:
    """An answer that was refused in part, or that reports work the form
    does not show, goes back to the model once with what the check found;
    the second answer is the one that counts. A question, an answer to a
    question and a clean change are not sent back."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "match": "clear",
            "actions": ["light.porch", "vacuum.robot"],
            "actions__options": [{"entity_id": "light.porch", "icon": "lamp.nope"}],
            "reply": "I've added the robot vacuum.",
        }
    )
    suggester.repaired = {
        "match": "none",
        "reply": "A vacuum can't be a tile here.",
        "options": ["Add the garden light"],
    }
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch"})
    client = await hass_ws_client(hass)
    request = {
        "type": "aivi/suggest",
        "template": "switchboard",
        "name": "Porch",
        "description": "add the robot vacuum",
        "bindings": {"actions": ["light.porch"]},
    }

    await client.send_json_auto_id(request)
    msg = await client.receive_json()
    assert msg["result"] == {
        "bindings": {"actions": ["light.porch"]},
        "changed": False,
        "match": "none",
        "options": ["Add the garden light"],
        "reply": "A vacuum can't be a tile here.",
        "rejected": [],
    }
    assert len(suggester.repairs) == 1
    repair = suggester.repairs[0]
    # The first request, the first answer, and what the check found.
    assert repair.startswith(suggester.instructions[0])
    assert '"vacuum.robot"' in repair
    assert "is not an entity id in that field's candidate list" in repair
    # A made-up symbol comes back with real ones built on the same word.
    assert '"lamp.nope" is not an SF Symbol that exists' in repair
    assert "lamp.table" in repair

    # A reply that reports work on an untouched form is sent back too.
    suggester.repairs.clear()
    suggester.result = {
        "match": "clear",
        "actions": ["light.porch"],
        "reply": "I've made sure all fields are included.",
    }
    await client.send_json_auto_id(request)
    await client.receive_json()
    assert "changed NOTHING" in suggester.repairs[0]

    # Not sent back: a question, an answer, a clean change.
    hass.states.async_set("light.garden", "on", {"friendly_name": "Garden"})
    for result in (
        {"match": "clear", "actions": ["light.porch"], "reply": "Which light?"},
        {"match": "answer", "reply": "Seven more."},
        {"match": "clear", "actions": ["light.porch", "light.garden"], "reply": "Ok."},
    ):
        suggester.repairs.clear()
        suggester.result = result
        await client.send_json_auto_id(request)
        msg = await client.receive_json()
        assert msg["success"]
        assert suggester.repairs == []
    assert msg["result"]["changed"] is True


async def test_suggest_changes_nothing_for_a_request_it_did_not_understand(
    hass, hass_ws_client
) -> None:
    """An answer whose subject is "unclear" is a question back, whatever
    its match says: the ops it carries anyway are not applied, and it is
    not sent back for changing nothing."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    suggester = FakeSuggester(
        {
            "subject": "unclear",
            "match": "guess",
            "ops": [
                {
                    "op": "set",
                    "key": "state",
                    "entity": "",
                    "option": "",
                    "value": "lock.front_door",
                }
            ],
            "reply": "I did not understand that. What should it show?",
            "options": ["Show whether the front door is locked"],
        }
    )
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("lock.front_door", "locked", {"friendly_name": "Front door"})
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/suggest",
            "template": "status",
            "name": "Front door",
            "description": "asdasd",
        }
    )
    msg = await client.receive_json()
    assert msg["result"] == {
        "bindings": {},
        "changed": False,
        "match": "none",
        "options": ["Show whether the front door is locked"],
        "reply": "I did not understand that. What should it show?",
        "rejected": [],
    }
    assert suggester.repairs == []
    # The prompt says what an unclear request gets, and that the widget's
    # name does not stand in for one.
    assert "name is context, not a request" in suggester.instructions[0]
    assert '"unclear"' in suggester.instructions[0]


async def test_suggest_changes_nothing_for_emoji_or_punctuation_alone(
    hass, hass_ws_client
) -> None:
    """An opening ask with no words in it changes nothing. An answer that
    acts on it anyway goes back once, told so; an answer that still acts
    is dropped, reply and all. Later in a conversation the same ask can
    answer a question, and is applied."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    acting = {
        "subject": "Front door",
        "match": "clear",
        "ops": [
            {
                "op": "set",
                "key": "state",
                "entity": "",
                "option": "",
                "value": "lock.front_door",
            }
        ],
        "reply": "I set it up for the front door lock.",
        "options": [],
    }
    suggester = FakeSuggester(acting)
    suggester.repaired = {
        "subject": "unclear",
        "match": "none",
        "ops": [],
        "reply": "What should it show?",
        "options": ["The front door lock"],
    }
    hass.data[DATA_SUGGESTER] = suggester
    await setup_account(hass)
    hass.states.async_set("lock.front_door", "locked", {"friendly_name": "Front door"})
    client = await hass_ws_client(hass)
    request = {
        "type": "aivi/suggest",
        "template": "status",
        "name": "Front door",
        "description": "🦄?",
    }

    await client.send_json_auto_id(request)
    msg = await client.receive_json()
    assert msg["result"]["bindings"] == {}
    assert msg["result"]["match"] == "none"
    assert msg["result"]["reply"] == "What should it show?"
    assert len(suggester.repairs) == 1
    assert "holds no words" in suggester.repairs[0]
    assert "changed NOTHING" not in suggester.repairs[0]

    # Still acting after the second request: nothing it says happened.
    suggester.repairs.clear()
    suggester.repaired = acting
    await client.send_json_auto_id({**request, "bindings": {"icon": "lock.fill"}})
    msg = await client.receive_json()
    assert msg["result"]["bindings"] == {"icon": "lock.fill"}
    assert msg["result"]["changed"] is False
    assert msg["result"]["match"] == "none"
    assert msg["result"]["reply"] is None
    assert len(suggester.repairs) == 1

    # In a conversation, "👍" answers the question before it.
    suggester.repairs.clear()
    await client.send_json_auto_id(
        {
            **request,
            "description": "👍",
            "history": [{"ask": "the door", "reply": "Use the lock?"}],
        }
    )
    msg = await client.receive_json()
    assert msg["result"]["bindings"]["state"] == "lock.front_door"
    assert msg["result"]["changed"] is True
    assert suggester.repairs == []


def test_near_symbols_are_real_and_built_on_the_same_word() -> None:
    from custom_components.aivi.suggest import near_symbols, symbols

    near = near_symbols("battery.25")
    assert near and all(name in symbols() for name in near)
    assert all(name.split(".")[0] == "battery" for name in near)
    assert near_symbols("zzznothing.here") == []
    assert near_symbols("") == []


async def test_a_refinement_keeps_a_color_by_value_until_it_sets_the_color(
    hass, hass_ws_client
) -> None:
    """Colors by value are the form's: the model reads them and cannot
    write them. An answer that leaves the color alone keeps them; one that
    sets or clears the color replaces them."""
    from custom_components.aivi.suggest import DATA_SUGGESTER

    await setup_account(hass)
    hass.states.async_set("sensor.phone_battery", "64", {"device_class": "battery"})
    client = await hass_ws_client(hass)
    bands = {
        "entity": "sensor.phone_battery",
        "limits": [20, 50],
        "values": ["red", "orange", "green"],
    }
    current = {
        "state": "sensor.phone_battery",
        "state__color": "gray",
        "state__color__bands": bands,
        "accent": "green",
        "accent__bands": bands,
    }

    async def refine(ops: list[dict[str, str]]) -> tuple[dict, list[str]]:
        suggester = FakeSuggester({"match": "clear", "ops": ops, "reply": "Done."})
        hass.data[DATA_SUGGESTER] = suggester
        await client.send_json_auto_id(
            {
                "type": "aivi/suggest",
                "template": "status",
                "name": "Phone",
                "description": "make the icon a phone",
                "bindings": current,
                "history": ["phone battery"],
            }
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]["bindings"], suggester.instructions

    op = {"op": "set", "key": "icon", "entity": "", "option": "", "value": "bolt.fill"}
    bindings, instructions = await refine([op])
    assert bindings == {**current, "icon": "bolt.fill"}
    assert "<key>__bands entry is a colour by value" in instructions[0]

    accent = {**op, "key": "accent", "value": "orange"}
    clear = {**op, "op": "clear", "key": "state__color", "value": ""}
    bindings, _ = await refine([accent, clear])
    assert bindings == {"state": "sensor.phone_battery", "accent": "orange"}
