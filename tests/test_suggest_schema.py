"""The suggester works on the full schema: everything the form can write
for a template can be expressed in a model's answer, and comes back the
same after sanitizing. The bindings below use every kind of key the form
kit stores: attribute and template sources, a literal with a source behind
it, colors and formats, icon styling, per-row options, segment details,
a trend's window."""

from __future__ import annotations

import json
from typing import Any

import pytest
import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from voluptuous_openapi import convert

from custom_components.aivi.metadata import describe_template
from custom_components.aivi.suggest import (
    apply_answer,
    as_answer,
    build_request,
    expand_ops,
    known_symbol,
    reply_of,
    sanitize,
    sanitize_report,
)
from custom_components.aivi.templates import (
    BUDGET,
    ENERGY,
    GAUGE,
    PROGRESS,
    SWITCHBOARD,
    TREND,
    TemplateDef,
    default_activity_registry,
    default_registry,
)

FULL: list[tuple[TemplateDef, dict[str, Any]]] = [
    (
        PROGRESS,
        {
            "progress": "sensor.washer",
            "progress__attribute": "percent",
            "state__template": "{{ states('sensor.washer_state') }}",
            "state__watched": ["sensor.washer_state"],
            "state__color": "blue",
            "state__formatter": "time_since",
            "end_date": "sensor.washer_end",
            "segments": [
                {
                    "value": 0.7,
                    "fill_color": "blue",
                    "label": "Wash",
                    "track_color": "gray",
                    "track_fill": "hatched",
                    "source": "sensor.dryer",
                },
                {"value": 0.3, "fill_color": "teal"},
            ],
            "segments__display": "layered",
            "icon": "washer.fill",
            "icon__color": "blue",
            "icon__color__entity": "sensor.washer_state",
            "icon__secondary_color": "teal",
            "icon__rendering_mode": "palette",
            "icon__color_rendering": "gradient",
            "accent": "cyan",
            "tap_url": "https://example.com/laundry",
        },
    ),
    (
        GAUGE,
        {
            "value": "sensor.dryer",
            "unit": "°C",
            "label__template": "{{ states('sensor.washer_state') }}",
            "label__watched": ["sensor.washer_state"],
            "min_value": 5,
            "max_value": 40.5,
            "ring": ["green", "red"],
            "icon": "thermometer.medium",
        },
    ),
    (
        BUDGET,
        {
            "spent": "sensor.spent",
            "budget": 1500,
            "budget__entity": "sensor.budget",
            "currency": "EUR",
            "subtitle": "sensor.washer_state",
            "categories": ["sensor.food", "sensor.car"],
            "categories__options": {
                "sensor.food": {
                    "label": "Food",
                    "icon": "fork.knife",
                    "color": "blue",
                    "budget": 300,
                },
                "sensor.car": {"budget__entity": "sensor.budget"},
            },
            "display": "spent",
            "total_color": "green",
        },
    ),
    (
        TREND,
        {
            "value": "sensor.dryer",
            "unit": "kWh",
            "points__hours": 48,
            "points__entity": "sensor.washer",
            "state": "sensor.washer_state",
            "color": "orange",
        },
    ),
    (
        ENERGY,
        {
            "sources": ["sensor.solar"],
            "sources__options": {
                "sensor.solar": {"label": "Roof", "today": "sensor.solar_today"}
            },
            "grid_power": "sensor.grid",
            "battery_power": "sensor.battery",
            "battery_power__invert": True,
        },
    ),
    (
        SWITCHBOARD,
        {
            "actions": ["light.porch", "scene.movie"],
            "actions__options": {
                "light.porch": {
                    "label": "Porch",
                    "icon": "lightbulb.fill",
                    "color": "#3D3DFF",
                    "subtitle": "Front",
                    "gradient": "#3D3DFF, #A64BFF",
                    "state_text_on": "Lit",
                },
                "scene.movie": {"subtitle_mode": "none"},
            },
            "accent": "purple",
        },
    ),
]


@pytest.fixture
def states(hass: HomeAssistant) -> None:
    for entity_id, state, attributes in (
        ("sensor.washer", "on", {"percent": 62}),
        ("sensor.washer_state", "Washing", {}),
        (
            "sensor.washer_end",
            "2026-10-03T18:00:00+00:00",
            {"device_class": "timestamp"},
        ),
        ("sensor.dryer", "40", {}),
        ("sensor.spent", "519.30", {"device_class": "monetary"}),
        ("sensor.budget", "1500", {}),
        ("sensor.food", "157.6", {}),
        ("sensor.car", "80", {}),
        ("sensor.solar", "1200", {"device_class": "power", "unit_of_measurement": "W"}),
        ("sensor.solar_today", "4.2", {"device_class": "energy"}),
        ("sensor.grid", "300", {"device_class": "power", "unit_of_measurement": "W"}),
        (
            "sensor.battery",
            "-100",
            {"device_class": "power", "unit_of_measurement": "W"},
        ),
        ("light.porch", "on", {}),
        ("scene.movie", "2026-10-03T12:00:00+00:00", {}),
    ):
        hass.states.async_set(entity_id, state, attributes)


def as_ops(template: TemplateDef, bindings: dict[str, Any]) -> dict[str, Any]:
    """Stored bindings as the ops that would build them on an empty form:
    what a model has to say to produce exactly this."""
    lists = {
        f["key"] for f in describe_template(template)["fields"] if f["kind"] == "rows"
    }

    def text(value: Any) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, list):
            if all(isinstance(item, str) for item in value):
                return ", ".join(value)
            return json.dumps(value)
        return str(value)

    def op(name: str, key: str, entity: str = "", option: str = "", value: str = ""):
        return {
            "op": name,
            "key": key,
            "entity": entity,
            "option": option,
            "value": value,
        }

    ops: list[dict[str, str]] = []
    answer = as_answer(bindings)
    for key in lists & set(answer):
        ops += [op("add", key, entity) for entity in answer[key]]
        for row in answer.get(f"{key}__options", []):
            ops += [
                op("row", key, row["entity_id"], option, text(value))
                for option, value in row.items()
                if option != "entity_id"
            ]
    for key, value in answer.items():
        if key in lists or key.removesuffix("__options") in lists:
            continue
        ops.append(op("set", key, value=text(value)))
    return {"subject": "x", "match": "clear", "ops": ops, "reply": "", "options": []}


@pytest.mark.usefixtures("states")
@pytest.mark.parametrize(("template", "bindings"), FULL, ids=[t.slug for t, _ in FULL])
def test_everything_the_form_stores_is_sayable(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> None:
    """A binding said as ops validates against the structure and comes
    back from the sanitizer exactly as stored."""
    _, structure = build_request(hass, template, "Widget", "anything")
    said = as_ops(template, bindings)
    structure(said)
    assert apply_answer(hass, template, said) == (bindings, [])


@pytest.mark.usefixtures("states")
@pytest.mark.parametrize(("template", "bindings"), FULL, ids=[t.slug for t, _ in FULL])
def test_a_refinement_that_repeats_everything_changes_nothing(
    hass: HomeAssistant, template: TemplateDef, bindings: dict[str, Any]
) -> None:
    assert sanitize(hass, template, as_answer(bindings), bindings) == bindings


@pytest.mark.usefixtures("states")
def test_keys_beside_a_value_stay_unless_set_or_removed(hass: HomeAssistant) -> None:
    """An answer that repeats only the values keeps every color, format,
    styling and row option; an empty string removes one; a new value for a
    row option changes only that."""
    _, progress = FULL[0]
    values_only = {
        "progress": "sensor.washer",
        "state__template": "{{ states('sensor.washer_state') }}",
        "end_date": "sensor.washer_end",
        "segments": [
            {"value": 0.7, "fill_color": "blue"},
            {"value": 0.3, "fill_color": "teal"},
        ],
        "icon": "washer.fill",
        "accent": "orange",
        "tap_url": "https://example.com/laundry",
    }
    assert sanitize(hass, PROGRESS, values_only, progress) == {
        **progress,
        "accent": "orange",
    }

    removed = sanitize(
        hass,
        PROGRESS,
        {
            **values_only,
            "accent": "cyan",
            "state__color": "",
            "icon__rendering_mode": "",
        },
        progress,
    )
    assert removed == {
        k: v
        for k, v in progress.items()
        if k not in ("state__color", "icon__rendering_mode")
    }

    _, budget = FULL[2]
    relabelled = sanitize(
        hass,
        BUDGET,
        {
            **{
                k: v for k, v in as_answer(budget).items() if k != "categories__options"
            },
            "categories": ["sensor.food"],
            "categories__options": [{"entity_id": "sensor.food", "label": "Groceries"}],
        },
        budget,
    )
    assert relabelled["categories"] == ["sensor.food"]
    assert relabelled["categories__options"] == {
        "sensor.food": {
            **budget["categories__options"]["sensor.food"],
            "label": "Groceries",
        }
    }


@pytest.mark.usefixtures("states")
def test_what_is_not_true_is_dropped(hass: HomeAssistant) -> None:
    """Row options for a row that is not there, an attribute the entity
    does not have, a color off the palette, an entity that does not
    exist: none of it is kept."""
    assert sanitize(
        hass,
        BUDGET,
        {
            "spent": "sensor.spent",
            "spent__attribute": "nope",
            "currency": "EUR",
            "categories": ["sensor.food", "sensor.ghost"],
            "categories__options": [
                {"entity_id": "sensor.ghost", "label": "Ghost"},
                {
                    "entity_id": "sensor.food",
                    "color": "hotpink",
                    "budget": -5,
                    "label": "Food",
                },
            ],
            "total_color": "hotpink",
        },
    ) == {
        "spent": "sensor.spent",
        "currency": "EUR",
        "categories": ["sensor.food"],
        "categories__options": {"sensor.food": {"label": "Food"}},
    }


@pytest.mark.usefixtures("states")
def test_a_tiles_plain_options_are_held_to_their_own_format(
    hass: HomeAssistant,
) -> None:
    """A gradient the way a model phrases it ("purple to blue") is not a
    gradient; the tile's own parsers decide, and what passes is stored
    the way the form stores it."""
    instructions, _ = build_request(hass, SWITCHBOARD, "Living room", "tiles")
    assert "gradient (2 to 3 colours" in instructions

    def options(**row: str) -> dict[str, Any]:
        answer = {
            "actions": ["light.porch"],
            "actions__options": [{"entity_id": "light.porch", **row}],
        }
        return sanitize(hass, SWITCHBOARD, answer).get("actions__options", {})

    assert options(gradient="purple to blue") == {}
    assert options(gradient="purple,  #3d3dff") == {
        "light.porch": {"gradient": "purple, #3D3DFF"}
    }
    assert options(gradient="None") == {"light.porch": {"gradient": "none"}}
    assert options(subtitle_mode="room") == {}
    assert options(subtitle_mode="state") == {"light.porch": {"subtitle_mode": "state"}}
    assert options(image="http://example.com/a.png") == {}
    assert options(image="https://example.com/a.png", image_alt="A porch") == {
        "light.porch": {"image": "https://example.com/a.png", "image_alt": "A porch"}
    }
    assert options(image_source="thumbnail") == {}
    assert options(state_text_on="x" * 40) == {
        "light.porch": {"state_text_on": "x" * 24}
    }


def test_every_structure_is_a_strict_json_schema(hass: HomeAssistant) -> None:
    """Typed at every level, row and segment objects included, with no open
    object (a dict by entity id): what strict providers require."""

    def typed(node: dict[str, Any]) -> None:
        assert "type" in node, node
        assert node.get("additionalProperties") in (None, False), node
        # A provider's adjuster turns every optional key into a nullable
        # one, with any enum left as it was; Anthropic refuses an enum
        # that lacks its null, and more than 16 nullable keys.
        assert "enum" not in node, node
        assert set(node.get("properties", {})) == set(node.get("required", [])), node
        for prop in node.get("properties", {}).values():
            typed(prop)
        if "items" in node:
            typed(node["items"])

    for registry in (default_registry(), default_activity_registry()):
        for slug, template in registry.items():
            _, structure = build_request(hass, template, slug, "anything")
            assert isinstance(structure, vol.Schema)
            typed(convert(structure))


@pytest.mark.usefixtures("states")
def test_an_invented_entity_keeps_the_field_and_is_reported(
    hass: HomeAssistant,
) -> None:
    """A model that answers "use the dryer" with entities that do not
    exist must not empty the fields it meant: the form keeps what it has,
    and every rejection is reported for the transcript."""
    from custom_components.aivi.suggest import sanitize_report

    current = {
        "progress": "sensor.washer",
        "state": "sensor.washer_state",
        "state__color__template": "{{ 'red' }}",
        "state__color__watched": [],
        "accent": "cyan",
    }
    answer = {
        "progress": "input_number.dryer_progress",
        "state": "input_text.dryer_state",
        "state__color": "hotpink",
        "accent": "orange",
        "end_date": "sensor.washer_end",
        "end_date__attribute": "finishes",
        "segments__display": "stacked",
    }
    bindings, rejected = sanitize_report(hass, PROGRESS, answer, current)
    assert bindings == {**current, "accent": "orange", "end_date": "sensor.washer_end"}
    assert rejected == [
        {
            "key": "progress",
            "value": "input_number.dryer_progress",
            "reason": "no_entity",
        },
        {"key": "state", "value": "input_text.dryer_state", "reason": "no_entity"},
        {
            "key": "end_date",
            "value": "sensor.washer_end: finishes",
            "reason": "no_attribute",
        },
        {"key": "segments", "value": "stacked", "reason": "not_an_option"},
    ]

    # A first fill reports the same way; nothing invented is kept.
    bindings, rejected = sanitize_report(hass, PROGRESS, {"progress": "sensor.ghost"})
    assert bindings == {}
    assert rejected == [
        {"key": "progress", "value": "sensor.ghost", "reason": "no_entity"}
    ]

    # Styling for a field that shows nothing yet is reported, not dropped.
    bindings, rejected = sanitize_report(
        hass, PROGRESS, {"progress": "sensor.washer", "state__color": "red"}
    )
    assert bindings == {"progress": "sensor.washer"}
    assert rejected == [{"key": "state", "value": "", "reason": "no_value"}]

    # Rows: the missing ones are named, the rest stay.
    bindings, rejected = sanitize_report(
        hass,
        SWITCHBOARD,
        {"actions": ["light.porch", "light.ghost"]},
        {"actions": ["light.porch", "scene.movie"]},
    )
    assert bindings == {"actions": ["light.porch"]}
    assert rejected == [
        {"key": "actions", "value": "light.ghost", "reason": "no_entity"}
    ]
    # All of them invented: the list stays as it was.
    bindings, _ = sanitize_report(
        hass, SWITCHBOARD, {"actions": ["light.ghost"]}, {"actions": ["light.porch"]}
    )
    assert bindings == {"actions": ["light.porch"]}


@pytest.mark.usefixtures("states")
def test_a_first_setup_is_briefed_as_a_design_job(hass: HomeAssistant) -> None:
    """An empty form asks for the whole widget (icon, colors, gradients),
    in the words the form itself uses for each field; a form that already
    shows something asks only for what the user says."""
    first, _ = build_request(hass, GAUGE, "Living room", "living room temperature")
    assert "FIRST setup of an empty widget" in first
    assert "Always pick an icon" in first
    assert 'uses the "Gauge" template (A reading within a range)' in first
    # The label, then the hint: the template's own wins over the shared one.
    assert '- value: "Value": The reading the dial points at. (required;' in first
    assert '- ring: "Ring color": How the dial is colored across its range' in first
    # Real symbols to choose from, a home's own among them.
    assert "thermometer.medium" in first
    assert "washer" in first

    # Defaults a new form carries are not a setup; a bound entity is.
    fresh, _ = build_request(
        hass, GAUGE, "Living room", "temperature", current={"min_value": 0}
    )
    assert "FIRST setup" in fresh
    later, _ = build_request(
        hass, GAUGE, "Living room", "make it pop", current={"value": "sensor.dryer"}
    )
    assert "FIRST setup" not in later
    assert "A request about looks" in later

    progress = default_activity_registry().get("progress")
    assert progress is not None
    activity, _ = build_request(
        hass,
        progress,
        "Washer",
        "the washer",
        subentry="activity",
    )
    assert "FIRST setup of an empty Live Activity" in activity


def test_an_icon_is_held_to_the_symbols_that_exist() -> None:
    assert known_symbol("washer.fill") == "washer.fill"
    # A made-up name falls back on the real symbol it was built on.
    assert known_symbol("fan.and.wake.fan") == "fan"
    assert known_symbol("definitely.not.a.symbol") is None


@pytest.mark.usefixtures("states")
def test_an_invented_symbol_is_reported_and_null_filler_is_not(
    hass: HomeAssistant,
) -> None:
    """A name with no symbol in it is dropped and reported; the word "null"
    a model writes into every key it leaves unused is not an answer."""
    bindings, rejected = sanitize_report(
        hass,
        GAUGE,
        {
            "value": "sensor.dryer",
            "icon": "not.a.symbol",
            "accent": "null",
            "label": None,
            "label__template": "null",
            "tap_url": " NULL ",
        },
    )
    assert bindings == {"value": "sensor.dryer"}
    assert rejected == [
        {"key": "icon", "value": "not.a.symbol", "reason": "not_a_symbol"}
    ]
    assert sanitize(hass, GAUGE, {"value": "sensor.dryer", "icon": "fan.wake"}) == {
        "value": "sensor.dryer",
        "icon": "fan",
    }


def test_a_reply_names_entities_instead_of_spelling_their_ids(
    hass: HomeAssistant,
) -> None:
    hass.states.async_set("sensor.washer_state", "Washing", {"friendly_name": "Washer"})
    reply = "I set the state to 'sensor.washer_state' and sensor.unknown_thing."
    assert reply_of({"reply": reply}, hass) == (
        "I set the state to Washer and sensor.unknown_thing."
    )
    assert reply_of({"reply": reply}) == reply


@pytest.mark.usefixtures("states")
def test_the_answer_decides_the_match_before_any_field(hass: HomeAssistant) -> None:
    """The structure opens with the subject and how the home meets it,
    then the ops, and ends with the reply and what to offer next; it is
    the same for every template, and a list says its cap."""
    from custom_components.aivi.suggest import ANSWER, MATCHES, match_of

    instructions, structure = build_request(hass, SWITCHBOARD, "Lights", "my lights")
    assert structure is ANSWER
    assert [str(key) for key in structure.schema] == [
        "subject",
        "match",
        "ops",
        "reply",
        "options",
    ]
    assert "Decide first, before any field" in instructions
    assert "a list of at most 8 entities" in instructions
    assert "How to answer: `ops` is the list of changes" in instructions
    # Plain text in the structure; held to its values on reading.
    assert match_of({"match": "maybe"}) is None
    assert MATCHES == ("clear", "guess", "none", "answer")


def test_options_are_short_distinct_and_few() -> None:
    from custom_components.aivi.suggest import match_of, options_of

    raw = {
        "match": "guess",
        "options": [
            " The front  door lock ",
            "The front door lock",
            "",
            7,
            "x" * 61,
            "The garage door",
            "The porch light",
            "The fountain",
            "One too many",
        ],
    }
    assert match_of(raw) == "guess"
    assert options_of(raw) == [
        "The front door lock",
        "The garage door",
        "The porch light",
        "The fountain",
    ]
    assert match_of({"match": "perhaps"}) is None
    assert match_of("nonsense") is None
    assert options_of({"options": "The washer"}) == []
    assert options_of(None) == []


def test_candidates_rank_by_meaning_and_say_where_things_are(
    hass: HomeAssistant,
) -> None:
    """Words that only say what to do rank nothing; the widget's name
    ranks what it is named after; plumbing and the integration's own
    sensors stay out; ties keep a domain together, by name; and each line
    says the area and device."""
    from homeassistant.helpers import area_registry as ar
    from homeassistant.helpers import entity_registry as er

    from custom_components.aivi.suggest.candidates import candidates, score

    assert score("Siren with all features", "Try to populate all slots") == 0
    assert score("Porch light", "set it up for me", subject="Porch") == 1
    assert score("Washer state", "the washer!") == 2

    entry = MockConfigEntry(domain="demo")
    entry.add_to_hass(hass)
    area = ar.async_get(hass).async_create("Porch")
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("demo", "lamp")}, name="Lamp"
    )
    devices.async_update_device(device.id, area_id=area.id)
    registry = er.async_get(hass)
    lamp = registry.async_get_or_create(
        "light", "demo", "lamp", device_id=device.id, suggested_object_id="lamp"
    )
    own = registry.async_get_or_create(
        "sensor", "aivi", "status", suggested_object_id="porch_push_status"
    )
    diagnostic = registry.async_get_or_create(
        "sensor",
        "demo",
        "signal",
        suggested_object_id="signal",
        entity_category=er.EntityCategory.DIAGNOSTIC,
    )
    for entity_id, name in (
        ("siren.all", "Siren with all features"),
        ("switch.zed", "Zed"),
        ("light.attic", "Attic"),
        (lamp.entity_id, "Lamp"),
        (own.entity_id, "Porch Update status"),
        (diagnostic.entity_id, "Signal"),
        ("update.core", "Core update"),
    ):
        hass.states.async_set(entity_id, "on", {"friendly_name": name})

    lines = candidates(hass, None, "populate all slots", subject="Porch")
    ids = [line.split(" — ")[0] for line in lines]
    # The lamp is in the Porch; the rest tie and sort by domain, then name.
    assert ids == [lamp.entity_id, "light.attic", "siren.all", "switch.zed"]
    assert "[area: Porch] [device: Lamp]" in lines[0]
    # A field with its own filter decides for itself what a diagnostic is.
    filtered = candidates(hass, {"domain": "sensor"}, "anything")
    assert [line.split(" — ")[0] for line in filtered] == [diagnostic.entity_id]
    # What the form already uses is always offered.
    kept = candidates(hass, None, "x", bound=frozenset({"update.core"}))
    assert kept[0].startswith("update.core")


@pytest.mark.usefixtures("states")
def test_a_list_says_how_full_it_is_and_an_edit_is_framed_as_one(
    hass: HomeAssistant,
) -> None:
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch"})
    first, _ = build_request(hass, SWITCHBOARD, "Porch", "my lights")
    assert "NOW: 0 of 8 used, 8 free." in first
    assert "what the user wants this to show" in first
    assert "A tile gets a fitting built-in icon" in first

    edit, _ = build_request(
        hass,
        SWITCHBOARD,
        "Porch",
        "fill the remaining slots",
        current={"actions": ["light.porch"]},
    )
    assert "NOW: 1 of 8 used, 7 free." in edit
    assert "what the user wants changed" in edit
    assert "Never `remove` an item unless the user asks to remove it" in edit
    assert "what the user wants this to show" not in edit
    full, _ = build_request(
        hass, SWITCHBOARD, "Porch", "more", current={"actions": ["light.porch"] * 8}
    )
    assert "NOW: 8 of 8 used, 0 free. The list is full." in full


@pytest.mark.usefixtures("states")
def test_an_icon_template_is_held_to_real_symbols(hass: HomeAssistant) -> None:
    """An icon template is held to the symbol index too: what it prints now
    and every name written in its other branches must exist."""
    real = (
        "{% if is_state('sensor.washer', 'on') %}washer.fill{% else %}washer{% endif %}"
    )
    fake = (
        "{% if is_state('sensor.washer', 'on') %}washer.spinning"
        "{% else %}washer{% endif %}"
    )
    answer = {"value": "sensor.dryer", "icon__template": real}
    assert sanitize(hass, GAUGE, answer)["icon__template"] == real

    bindings, rejected = sanitize_report(
        hass, GAUGE, {"value": "sensor.dryer", "icon__template": fake}
    )
    assert "icon__template" not in bindings
    assert rejected == [
        {"key": "icon", "value": "washer.spinning", "reason": "not_a_symbol"}
    ]


def test_starters_come_from_what_the_name_points_at(hass: HomeAssistant) -> None:
    """A widget's name picks the entities its main field could show, ranked
    the way the model's candidates are; a list template gets none, the
    integration's own sensors are never offered, and nothing is invented."""

    from custom_components.aivi.suggest import starters

    own = er.async_get(hass).async_get_or_create(
        "sensor", "aivi", "status", suggested_object_id="living_room_push_status"
    )
    for entity_id, state, name in (
        ("sensor.living_temp", "21", "Living room temperature"),
        ("sensor.living_humidity", "40", "Living room humidity"),
        ("sensor.living_room", "1", "Living room"),
        ("sensor.outside", "12", "Outside temperature"),
        (own.entity_id, "ok", "Living room Update status"),
        ("sensor.nameless", "1", None),
        # A dial draws a number: a window is not offered for one.
        ("cover.living_window", "open", "Living room window"),
    ):
        hass.states.async_set(entity_id, state, {"friendly_name": name} if name else {})

    assert starters(hass, GAUGE, "Living room") == [
        "Living room humidity",
        "Living room temperature",
    ]
    # More shared words rank first.
    assert starters(hass, GAUGE, "Outside temperature now")[0] == "Outside temperature"
    assert starters(hass, GAUGE, "Garage") == []
    # A name made of filler words points at nothing.
    assert starters(hass, GAUGE, "The widget") == []
    assert starters(hass, GAUGE, "  ") == []
    # A name does not pick the rows of a list.
    assert starters(hass, SWITCHBOARD, "Living room") == []


async def test_the_starters_command_answers_without_a_model(
    hass: HomeAssistant, hass_ws_client: Any
) -> None:
    from homeassistant.setup import async_setup_component

    from custom_components.aivi import websocket

    assert await async_setup_component(hass, "websocket_api", {})
    websocket.async_register(hass)
    hass.states.async_set("sensor.pool", "24", {"friendly_name": "Pool temperature"})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "aivi/suggest/starters", "template": "gauge", "name": "Pool"}
    )
    msg = await client.receive_json()
    assert msg["result"] == {"starters": ["Pool temperature"]}
    await client.send_json_auto_id(
        {"type": "aivi/suggest/starters", "template": "nope", "name": "Pool"}
    )
    assert (await client.receive_json())["error"]["code"] == "not_found"


@pytest.mark.usefixtures("states")
def test_ops_change_only_what_they_name(hass: HomeAssistant) -> None:
    """An answer is a list of changes applied to the form as it is: what
    no op touches stays, a list is edited an item at a time, and an op
    that names nothing of this template is reported and skipped."""
    for entity_id in ("light.porch", "light.garden", "scene.movie", "light.hall"):
        hass.states.async_set(entity_id, "on")
    current = {
        "actions": ["light.porch", "light.garden"],
        "actions__options": {"light.porch": {"label": "Porch", "color": "yellow"}},
        "accent": "green",
    }

    def op(
        name: str, key: str = "", entity: str = "", option: str = "", value: str = ""
    ):
        return {
            "op": name,
            "key": key,
            "entity": entity,
            "option": option,
            "value": value,
        }

    def apply(*ops: dict[str, str]) -> tuple[dict[str, Any], list[Any]]:
        return apply_answer(hass, SWITCHBOARD, {"ops": list(ops)}, current)

    # No ops: nothing changes.
    assert apply() == (current, [])
    # Add keeps what is there; a position puts it where it says.
    bindings, _ = apply(op("add", "actions", "scene.movie"))
    assert bindings["actions"] == ["light.porch", "light.garden", "scene.movie"]
    assert bindings["actions__options"] == current["actions__options"]
    bindings, _ = apply(op("add", "actions", "scene.movie", value="1"))
    assert bindings["actions"] == ["scene.movie", "light.porch", "light.garden"]
    # Remove takes the row's options with it; move reorders.
    bindings, _ = apply(op("remove", "actions", "light.porch"))
    assert bindings["actions"] == ["light.garden"]
    assert "actions__options" not in bindings
    bindings, _ = apply(op("move", "actions", "light.garden", value="1"))
    assert bindings["actions"] == ["light.garden", "light.porch"]
    # One option of one row; "" removes it; the row's others stay.
    bindings, _ = apply(
        op("row", "actions", "light.garden", "label", "Garden"),
        op("row", "actions", "light.porch", "color", ""),
    )
    assert bindings["actions__options"] == {
        "light.porch": {"label": "Porch"},
        "light.garden": {"label": "Garden"},
    }
    # A plain key is set or cleared; everything else stays.
    bindings, _ = apply(op("set", "accent", value="purple"))
    assert bindings == {**current, "accent": "purple"}
    bindings, _ = apply(op("clear", "accent"))
    assert "accent" not in bindings and bindings["actions"] == current["actions"]

    # What names nothing here is reported, and the rest still applies.
    bindings, problems = apply(
        op("set", "colour_of_the_sky", value="blue"),
        op("row", "actions", "light.hall", "label", "Hall"),
        op("paint", "accent", value="red"),
        op("add", "accent", "light.hall"),
        op("add", "actions", "light.hall"),
    )
    assert bindings["actions"] == ["light.porch", "light.garden", "light.hall"]
    assert [p["reason"] for p in problems] == ["not_an_option"] * 4

    # Adding what is there, or to a full list, is reported, not dropped.
    bindings, problems = apply(op("add", "actions", "light.porch"))
    assert bindings == current
    assert problems == [
        {"key": "actions", "value": "light.porch", "reason": "already_there"}
    ]
    full = {"actions": [f"light.l{i}" for i in range(8)]}
    for entity_id in full["actions"]:
        hass.states.async_set(entity_id, "on")
    bindings, problems = apply_answer(
        hass, SWITCHBOARD, {"ops": [op("add", "actions", "light.hall")]}, full
    )
    assert bindings == full
    assert problems == [
        {"key": "actions", "value": "light.hall", "reason": "list_full"}
    ]

    # A value its key cannot take.
    answer, unusable = expand_ops(
        GAUGE, {"ops": [op("set", "min_value", value="low")]}, {"value": "sensor.dryer"}
    )
    assert unusable == [{"key": "min_value", "value": "low", "reason": "bad_value"}]
    # An entity for a field is its value, whichever slot the op put it in.
    answer, unusable = expand_ops(
        GAUGE, {"ops": [op("set", "value", entity="sensor.dryer")]}, None
    )
    assert answer["value"] == "sensor.dryer" and unusable == []
    # An answer given by key, without ops, passes through untouched.
    legacy = {"value": "sensor.dryer"}
    assert expand_ops(GAUGE, legacy, None) == (legacy, [])
    assert apply_answer(hass, GAUGE, legacy) == (legacy, [])


async def test_suggestions_reach_a_trends_window_but_not_its_points(
    hass: HomeAssistant,
) -> None:
    """The model never writes the recorded points; it may set the window and
    the charted entity."""
    from custom_components.aivi.suggest import build_request, sanitize
    from custom_components.aivi.templates import TREND

    hass.states.async_set("sensor.temp", "21")
    hass.states.async_set("sensor.outside", "9")
    instructions, _ = build_request(hass, TREND, "Indoor", "living room temperature")
    assert "points__hours" in instructions
    answer = {
        "value": "sensor.temp",
        "points": "x",
        "points__hours": 48,
        "points__entity": "sensor.outside",
    }
    assert sanitize(hass, TREND, answer) == {
        "value": "sensor.temp",
        "points__hours": 48,
        "points__entity": "sensor.outside",
    }
    # A span the chart does not offer, and an entity that is not there.
    assert sanitize(
        hass,
        TREND,
        {"value": "sensor.temp", "points__hours": 5, "points__entity": "sensor.nope"},
    ) == {"value": "sensor.temp"}


def test_suggest_structures_convert_to_strict_json_schema(hass: HomeAssistant) -> None:
    """Every template's answer structure survives the conversion the
    OpenRouter AI Task does: a typed node at every level (`anyOf` has no
    `type`, and its strict-mode adjuster raised KeyError on one)."""
    from voluptuous_openapi import convert

    from custom_components.aivi.suggest import build_request
    from custom_components.aivi.templates import (
        default_activity_registry,
        default_registry,
    )

    def typed(node: dict) -> None:
        assert "type" in node, node
        for prop in node.get("properties", {}).values():
            typed(prop)
        if "items" in node:
            typed(node["items"])

    for registry in (default_registry(), default_activity_registry()):
        for slug, template in registry.items():
            _, structure = build_request(hass, template, slug, "anything")
            typed(convert(structure))


def test_an_unclear_subject_matches_nothing() -> None:
    """A model that calls the request unclear asks a question, whatever
    its match says."""
    from custom_components.aivi.suggest import match_of

    assert match_of({"subject": "unclear", "match": "clear"}) == "none"
    assert match_of({"subject": " Unclear. ", "match": "guess"}) == "none"
    assert match_of({"subject": "the unclear sensor", "match": "clear"}) == "clear"


def test_wordless_asks() -> None:
    """Emoji and punctuation alone name nothing; a word or a number in
    any script does."""
    from custom_components.aivi.suggest import wordless

    for ask in ("?", ".", "🦄🦄", " ", "—!", "___", "👍"):
        assert wordless(ask), ask
    for ask in ("asdasd", "red", "größer", "红色", "3", "👍 ok"):
        assert not wordless(ask), ask
