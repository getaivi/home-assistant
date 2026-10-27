"""What the preview says about a template beside its box: the value and
its kind, what it updates on, where and why it fails, and the entity ids
it names that do not exist."""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, cast

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import TemplateError
from jinja2 import TemplateSyntaxError

from custom_components.aivi.editor.template_info import error_details, value_kind
from custom_components.aivi.sources import listeners_of, template_entities
from helpers import setup_account

if TYPE_CHECKING:
    from homeassistant.helpers.template import RenderInfo

pytestmark = pytest.mark.usefixtures("inject_fake_client")

NOTHING = {"entities": [], "domains": [], "all": False, "time": False}


@pytest.fixture
async def feedback(hass: HomeAssistant, hass_ws_client):
    """The feedback for a template sourcing a status widget's state."""
    await setup_account(hass)
    hass.states.async_set("sensor.living_temp", "21.4")
    hass.states.async_set("sensor.outdoor_temp", "14.8")
    hass.states.async_set("light.kitchen", "on")
    client = await hass_ws_client(hass)

    async def ask(template: str, key: str = "state") -> dict[str, Any]:
        await client.send_json_auto_id(
            {
                "type": "aivi/preview",
                "template": "status",
                "bindings": {f"{key}__template": template},
            }
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]["fields"][key]

    return ask


@pytest.mark.parametrize(
    ("template", "value", "kind"),
    [
        ("{{ states('sensor.living_temp') }}", "21.4", {"kind": "number"}),
        ("{{ 'Open' }}", "Open", {"kind": "text"}),
        ("{{ is_state('light.kitchen', 'on') }}", "True", {"kind": "bool"}),
        (
            "{{ [0.14, 0.3, 0.12] }}",
            "[0.14, 0.3, 0.12]",
            {"kind": "list", "items": 3, "range": [0.12, 0.3]},
        ),
        ("{{ ['a', 'b'] }}", "['a', 'b']", {"kind": "list", "items": 2}),
        ("{{ none }}", "None", {"kind": "nothing"}),
    ],
)
async def test_the_value_comes_with_its_kind(feedback, template, value, kind) -> None:
    out = await feedback(template)
    assert out["value"] == value
    assert {k: out[k] for k in kind} == kind
    assert ("items" in out) == ("items" in kind)
    assert ("range" in out) == ("range" in kind)
    assert out["status"] == ("empty" if kind["kind"] == "nothing" else "ok")


async def test_a_long_value_is_sent_in_full(feedback) -> None:
    out = await feedback("{{ 'word ' * 80 }}")
    # Home Assistant trims the render; nothing else is cut.
    assert out["value"] == ("word " * 80).strip()
    # The wire takes 128 characters of it: the feedback says so.
    assert out["limit"] == 128


async def test_a_value_the_wire_takes_whole_has_no_limit(feedback) -> None:
    out = await feedback("{{ 'w' * 128 }}")
    assert "limit" not in out


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("", {"kind": "nothing"}),
        ("unavailable", {"kind": "nothing"}),
        ("FALSE", {"kind": "bool"}),
        (" 7 ", {"kind": "number"}),
        ("nan", {"kind": "text"}),
        ("[1, 'a']", {"kind": "list", "items": 2}),
        ("[]", {"kind": "list", "items": 0}),
        ("{'a': 1}", {"kind": "text"}),
    ],
)
def test_value_kind(text: str, kind: dict[str, Any]) -> None:
    assert value_kind(text) == kind


async def test_it_updates_on_the_entities_it_reads(feedback) -> None:
    out = await feedback(
        "{{ states('sensor.living_temp') | float(0)"
        " - states('sensor.outdoor_temp') | float(0) }}"
    )
    assert out["listens"] == {
        "entities": ["sensor.living_temp", "sensor.outdoor_temp"],
        "domains": [],
        "all": False,
        "time": False,
    }


async def test_a_clock_template_updates_every_minute(feedback) -> None:
    out = await feedback("{{ now().strftime('%H:%M') }}")
    assert out["status"] == "ok"
    assert out["listens"] == {"entities": [], "domains": [], "all": False, "time": True}


async def test_a_domain_and_every_state_carry_their_rate_limit(feedback) -> None:
    out = await feedback(
        "{{ states.light | selectattr('state', 'eq', 'on') | list | count }}"
    )
    assert out["listens"]["domains"] == ["light"]
    assert out["listens"]["rate_limit"] == 1
    out = await feedback("{{ states | list | count }}")
    assert out["listens"]["all"] is True
    assert out["listens"]["entities"] == []
    assert out["listens"]["rate_limit"] == 60
    # Counting the states listens to every entity coming and going.
    out = await feedback("{{ states | count }}")
    assert out["listens"]["all"] is True


async def test_a_static_template_listens_to_nothing(feedback) -> None:
    out = await feedback("{{ 42 }}")
    assert out["listens"] == {
        "entities": [],
        "domains": [],
        "all": False,
        "time": False,
    }


async def test_a_syntax_error_names_its_line(feedback) -> None:
    out = await feedback(
        "{% set t = states('sensor.living_temp') %}\n{{ t | round(1) }"
    )
    assert out["status"] == "error"
    assert out["error"] == "TemplateSyntaxError: unexpected '}'"
    assert out["line"] == 2
    assert out["reason"] == "unclosed"
    assert "column" not in out
    assert "listens" not in out


async def test_a_bad_character_names_its_column(feedback) -> None:
    out = await feedback("{{ 1 }}\n{{ 3 !! 4 }}")
    assert (out["line"], out["column"]) == (2, 6)
    assert out["reason"] == "bad_char"
    assert out["params"] == {"char": "!"}


async def test_an_unclosed_block_points_at_its_opening_tag(feedback) -> None:
    # Jinja names the line the template ends on; the place to fix is the
    # tag left open.
    out = await feedback(
        "{% set t = states('sensor.living_temp') | float(0) %}\n"
        "{% if t > 30 %}\n"
        "  Hot\n"
        "{% endif %}\n"
        "  {%- if t < 5 %}\n"
        "  Cold\n"
        "{{ t }}"
    )
    assert out["reason"] == "unclosed_block"
    assert (out["line"], out["column"]) == (5, 3)


async def test_the_innermost_unclosed_block_is_named(feedback) -> None:
    out = await feedback(
        "{% for x in [1] %}\n"
        "{# {% if a %} in a comment #}\n"
        "{% if x %}{% raw %}{% if %}{% endraw %}\n"
        "{% set y %}y{% endset %}{% set z = 1 %}\n"
        "x"
    )
    assert out["params"] == {"tag": "if"}
    assert (out["line"], out["column"]) == (3, 1)


async def test_tag_text_in_an_expression_opens_no_block(feedback) -> None:
    out = await feedback("{{ '{% for }}' }}\n{% if 1 %}x\n")
    assert out["params"] == {"tag": "if"}
    assert (out["line"], out["column"]) == (2, 1)


def test_an_unclosed_block_not_found_keeps_jinjas_line() -> None:
    # Jinja names a block the text does not show open: its own line
    # stays, without a column.
    cause = TemplateSyntaxError(
        "Unexpected end of template. Jinja was looking for the following"
        " tags: 'endfor'. The innermost block that needs to be closed is 'for'.",
        3,
    )
    err = TemplateError(str(cause))
    err.__cause__ = cause
    out = error_details(err, "a\nb\n{{ 'it\\'s }}' }}{% if 1 %}")
    assert out["line"] == 3
    assert "column" not in out
    # A tag the text never closes still counts as opened.
    out = error_details(err, "a\n  {% for x in y")
    assert (out["line"], out["column"]) == (2, 3)


async def test_a_runtime_error_has_no_line(feedback) -> None:
    out = await feedback("{{ 'a' + 1 }}")
    assert out["status"] == "error"
    assert "line" not in out
    assert out["reason"] == "type"


@pytest.mark.parametrize(
    ("template", "reason", "params"),
    [
        (
            "{% if 1 %}x",
            "unclosed_block",
            {"tag": "if"},
        ),
        ("{% for x in y %}x", "unclosed_block", {"tag": "for"}),
        ("{% endif %}", "stray_end", {"tag": "endif"}),
        ("{% iff 1 %}{% endif %}", "unknown_tag", {"tag": "iff"}),
        ("{{ 1 | nofilter }}", "unknown_filter", {"name": "nofilter"}),
        ("{{ 1 is nottest }}", "unknown_test", {"name": "nottest"}),
        ("{{ (1 }}", "missing", {"token": ")"}),
        ("{{ 1 + }}", "incomplete", None),
        ("{{ x y }}", "extra", {"token": "y"}),
        ("{{ 1 +* 2 }}", "unexpected", {"token": "*"}),
        ("{{ undefined_thing.attr }}", "undefined", {"name": "undefined_thing"}),
        ("{{ 'a'.b() }}", "no_attribute", {"value": "str object", "name": "b"}),
        ("{{ states.sensor.gone.state }}", None, None),
        ("{{ 'x' | float }}", "no_default", {"function": "float", "value": "x"}),
        ("{{ 1 / 0 }}", "division_by_zero", None),
    ],
)
async def test_common_errors_get_a_reason(feedback, template, reason, params) -> None:
    out = await feedback(template)
    if reason is None:
        # Reading a missing entity's state renders empty, not an error.
        assert out["status"] == "empty"
        return
    assert out["status"] == "error"
    assert out.get("reason") == reason
    assert out.get("params") == params


def test_a_reason_needs_a_known_message() -> None:
    err = TemplateError(RuntimeError("something odd"))
    err.__cause__ = RuntimeError("something odd")
    assert error_details(err, "{{ x }}") == {
        "status": "error",
        "error": "RuntimeError: something odd",
    }
    # No cause at all: the message alone.
    bare = TemplateError("plain")
    assert error_details(bare, "") == {"status": "error", "error": "plain"}


async def test_a_none_attribute_points_at_a_missing_entity(feedback) -> None:
    out = await feedback("{{ states.sensor.living_tmp.last_changed.year }}")
    assert out["status"] == "error"
    assert out["reason"] == "none_attribute"
    assert out["unknown"] == [
        {"id": "sensor.living_tmp", "suggestions": ["sensor.living_temp"]}
    ]


async def test_an_unknown_entity_gets_did_you_mean(feedback) -> None:
    out = await feedback("{{ states('sensor.livingroom_temp') }}")
    assert out["status"] == "empty"
    assert out["unknown"] == [
        {"id": "sensor.livingroom_temp", "suggestions": ["sensor.living_temp"]}
    ]


async def test_an_unknown_entity_in_a_dotted_path_and_one_with_no_match(
    feedback,
) -> None:
    out = await feedback(
        "{{ states.sensor.outdoor_tmp.state }} {{ states('switch.nothing_like') }}"
    )
    assert out["unknown"] == [
        {"id": "sensor.outdoor_tmp", "suggestions": ["sensor.outdoor_temp"]},
        {"id": "switch.nothing_like", "suggestions": []},
    ]


async def test_text_that_is_not_an_entity_id_is_not_unknown(feedback) -> None:
    """Half typed in the editor: neither a crash nor a suggestion."""
    for source in ("{{ states('living') }}", "{{ states('sensor.') }}"):
        out = await feedback(source)
        assert out["status"] == "empty"
        assert "unknown" not in out


async def test_existing_entities_are_not_unknown(feedback) -> None:
    out = await feedback("{{ states.sensor.living_temp.state }}")
    assert "unknown" not in out


async def test_save_reads_the_same_listeners(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.living_temp", "21.4")
    read = template_entities(hass, "{{ now() }} {{ states('sensor.living_temp') }}")
    assert read is not None
    assert read.time is True
    assert read.entities == ("sensor.living_temp",)
    assert read.everything is False
    read = template_entities(hass, "{{ states | count }}")
    assert read is not None
    assert read.everything is True
    assert template_entities(hass, "{% broken") is None


def test_an_older_rate_limit_as_a_timedelta_reads_in_seconds() -> None:
    """Home Assistant before the seconds constants kept the limit as a
    ``timedelta``."""
    info = SimpleNamespace(
        entities=set(),
        domains={"light"},
        domains_lifecycle=set(),
        all_states=False,
        all_states_lifecycle=False,
        has_time=False,
        rate_limit=timedelta(seconds=1),
    )
    read = listeners_of(cast("RenderInfo", info))
    assert read.rate_limit == 1.0
    assert read.domains == ("light",)
