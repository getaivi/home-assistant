"""The panel's live preview over the WebSocket API: the content the bindings
would push, and feedback for every value they source."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.template import Template

from custom_components.aivi import history
from helpers import setup_account

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def test_preview_resolves_current_state(hass, hass_ws_client) -> None:
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "template": "progress",
            "bindings": {"progress": "sensor.washer_progress"},
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["content"]["progress"]["value"] == pytest.approx(0.62)


async def test_preview_resolves_sourced_segment_weights(hass, hass_ws_client) -> None:
    """Sourced segment weights resolve like the push path: a live source sets
    the share, an unavailable one falls back to the stored literal weight."""
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.wash_share", "0.6")
    client = await hass_ws_client(hass)
    bindings = {
        "progress": "sensor.washer_progress",
        "segments": [
            {"value": 0.5, "fill_color": "cyan", "source": "sensor.wash_share"},
            {"value": 0.4, "fill_color": "blue"},
        ],
    }

    await client.send_json_auto_id(
        {"type": "aivi/preview", "template": "progress", "bindings": bindings}
    )
    msg = await client.receive_json()
    assert msg["success"]
    segments = msg["result"]["content"]["progress"]["segments"]
    assert segments[0]["value"] == 614 / 1024
    assert sum(s["value"] for s in segments) == 1.0
    assert "source" not in segments[0]

    # Unavailable source: back to the stored weights, 0.5 vs 0.4.
    hass.states.async_set("sensor.wash_share", "unavailable")
    await client.send_json_auto_id(
        {"type": "aivi/preview", "template": "progress", "bindings": bindings}
    )
    msg = await client.receive_json()
    segments = msg["result"]["content"]["progress"]["segments"]
    assert segments[0]["value"] == 569 / 1024


async def test_preview_reports_template_feedback(hass, hass_ws_client) -> None:
    """Per-field feedback is ok / empty / error / fallback; a broken template
    degrades the preview instead of failing the command."""
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    async def preview(bindings):
        await client.send_json_auto_id(
            {"type": "aivi/preview", "template": "progress", "bindings": bindings}
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]

    res = await preview(
        {
            "progress__template": "{{ states('sensor.washer_progress') }}",
            "progress__watched": ["sensor.washer_progress"],
        }
    )
    assert res["fields"] == {
        "progress": {
            "status": "ok",
            "value": "62",
            "kind": "number",
            "listens": {
                "entities": ["sensor.washer_progress"],
                "domains": [],
                "all": False,
                "time": False,
            },
        }
    }
    assert res["content"]["progress"]["value"] == pytest.approx(0.62)

    # error: a syntax error is reported per field, the command still
    # succeeds, and the required field degrades the content to null.
    res = await preview({"progress__template": "{% broken"})
    assert res["content"] is None
    feedback = res["fields"]["progress"]
    assert feedback["status"] == "error"
    assert feedback["error"]

    # error on an optional field: the rest of the content still resolves.
    res = await preview(
        {
            "progress": "sensor.washer_progress",
            "state__template": "{{ 1 / 0 }}",
        }
    )
    assert res["content"]["progress"]["value"] == pytest.approx(0.62)
    assert "state" not in res["content"]
    assert res["fields"]["state"]["status"] == "error"

    # empty: renders, but to nothing usable, which is not an error.
    res = await preview({"state__template": "{{ states('sensor.nope') }}"})
    assert res["fields"]["state"]["status"] == "empty"
    assert res["fields"]["state"]["value"] == "unknown"
    assert res["fields"]["state"]["kind"] == "nothing"

    # Entity-sourced fields report too, so the editor can explain a color
    # falling back to its swatch.
    res = await preview({"progress": "sensor.washer_progress"})
    assert res["fields"] == {"progress": {"status": "ok", "value": "62"}}

    # An entity that isn't ready reports the fallback, not an error.
    res = await preview({"progress": "sensor.missing"})
    assert res["fields"]["progress"] == {"status": "fallback", "reading": "missing"}


@pytest.mark.parametrize(
    ("kind", "template", "bindings", "address"),
    [
        ("widget", "gauge", {"value__template": "{{ 'abc' }}"}, "value"),
        ("widget", "countdown", {"target__template": "{{ 'soon' }}"}, "target"),
        ("widget", "energy", {"home_power__template": "{{ 'abc' }}"}, "home_power"),
        ("widget", "budget", {"budget__template": "{{ -5 }}"}, "budget"),
        ("widget", "budget", {"budget__template": "{{ 0 }}"}, "budget"),
    ],
)
async def test_feedback_falls_back_where_the_push_drops_the_value(
    hass, hass_ws_client, kind, template, bindings, address
) -> None:
    """A number, timestamp or positive amount the push leaves out is not
    reported as ok."""
    await setup_account(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "kind": kind,
            "template": template,
            "bindings": bindings,
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["fields"][address]["status"] == "fallback"


async def test_preview_reports_segment_source_feedback(hass, hass_ws_client) -> None:
    """Sourced segment weights get feedback under ``<key>.<index>.source``;
    ``fallback`` means the stored literal weight is in effect."""
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.wash_share", "0.6")
    hass.states.async_set("sensor.dry_share", "unavailable")
    client = await hass_ws_client(hass)

    async def preview(segments):
        await client.send_json_auto_id(
            {
                "type": "aivi/preview",
                "template": "progress",
                "bindings": {
                    "progress": "sensor.washer_progress",
                    "segments": segments,
                },
            }
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]

    # The broken template's segment falls back to its literal weight, so
    # the content still resolves with both segments.
    res = await preview(
        [
            {"value": 0.5, "fill_color": "cyan", "source": "sensor.wash_share"},
            {"value": 0.5, "fill_color": "blue", "source__template": "{% broken"},
        ]
    )
    assert res["fields"]["segments.0.source"] == {"status": "ok", "value": "0.6"}
    feedback = res["fields"]["segments.1.source"]
    assert feedback["status"] == "error"
    assert feedback["error"]
    assert len(res["content"]["progress"]["segments"]) == 2

    res = await preview(
        [
            {
                "value": 0.5,
                "fill_color": "cyan",
                "source__template": "{{ states('sensor.nope') }}",
            }
        ]
    )
    assert res["fields"]["segments.0.source"]["status"] == "empty"

    # fallback, not error: an unavailable entity, and a template rendering
    # to something that isn't a finite positive weight.
    res = await preview(
        [
            {"value": 0.5, "fill_color": "cyan", "source": "sensor.dry_share"},
            {"value": 0.5, "fill_color": "blue", "source__template": "{{ 'hot' }}"},
        ]
    )
    assert res["fields"]["segments.0.source"] == {
        "status": "fallback",
        "reading": "unavailable",
    }
    feedback = res["fields"]["segments.1.source"]
    assert (feedback["status"], feedback["value"]) == ("fallback", "hot")

    # Sourceless segments produce no per-segment entries.
    res = await preview([{"value": 1.0, "fill_color": "cyan"}])
    assert not any(k.startswith("segments.") for k in res["fields"])

    # A boolean and a negative number are no weights either: the push
    # uses the stored ones.
    hass.states.async_set("sensor.flags", "on", {"done": True})
    res = await preview(
        [
            {
                "value": 0.5,
                "fill_color": "cyan",
                "source": "sensor.flags",
                "source__attribute": "done",
            },
            {"value": 0.5, "fill_color": "blue", "source__template": "{{ -1 }}"},
        ]
    )
    assert res["fields"]["segments.0.source"]["status"] == "fallback"
    assert res["fields"]["segments.1.source"]["status"] == "fallback"
    assert [s["value"] for s in res["content"]["progress"]["segments"]] == [0.5, 0.5]


async def test_preview_reports_row_option_and_segment_feedback(
    hass, hass_ws_client
) -> None:
    """Sourced per-row options and segment colors and labels get feedback
    too, keyed ``<key>.<entity id>.<option>`` and ``<key>.<index>.<slot>``;
    rows that are not selected get none."""
    await setup_account(hass)
    hass.states.async_set("sensor.a", "1")
    hass.states.async_set("sensor.name", "Kitchen")
    hass.states.async_set("sensor.color", "chartreuse")
    hass.states.async_set("sensor.washer_progress", "62")
    client = await hass_ws_client(hass)

    async def preview(template, bindings):
        await client.send_json_auto_id(
            {"type": "aivi/preview", "template": template, "bindings": bindings}
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]["fields"]

    fields = await preview(
        "list",
        {
            "rows": ["sensor.a"],
            "rows__options": {
                "sensor.a": {"label__entity": "sensor.name", "color__entity": "x.y"},
                "sensor.gone": {"label__entity": "sensor.name"},
            },
        },
    )
    assert fields == {
        "rows.sensor.a.label": {"status": "ok", "value": "Kitchen"},
        "rows.sensor.a.color": {"status": "fallback", "reading": "missing"},
    }

    fields = await preview(
        "battery",
        {
            "devices": ["sensor.a"],
            "devices__options": {"sensor.a": {"charging__entity": "sensor.name"}},
        },
    )
    assert fields["devices.sensor.a.charging"] == {"status": "ok", "value": "Kitchen"}

    fields = await preview(
        "progress",
        {
            "progress": "sensor.washer_progress",
            "segments": [
                {
                    "value": 1,
                    "fill_color": "cyan",
                    "fill_color__entity": "sensor.color",
                    "label__template": "{{ 'Wash' }}",
                }
            ],
        },
    )
    assert fields["segments.0.fill_color"] == {
        "status": "fallback",
        "value": "chartreuse",
    }
    assert fields["segments.0.label"] == {
        "status": "ok",
        "value": "Wash",
        "kind": "text",
        "listens": {"entities": [], "domains": [], "all": False, "time": False},
    }


async def test_a_preview_renders_each_template_once(
    hass, hass_ws_client, monkeypatch
) -> None:
    """Feedback and content come from the same render, so a template whose
    output changes between renders reads the same in both."""
    await setup_account(hass)
    client = await hass_ws_client(hass)
    renders: list[str] = []

    def render(self, *args, **kwargs):
        renders.append(self.template)
        return str(len(renders))

    monkeypatch.setattr(Template, "async_render", render)
    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "template": "progress",
            "bindings": {
                "progress__template": "{{ 50 }}",
                "state__template": "{{ now() }}",
                "state__color__template": "{{ 'red' }}",
            },
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    result = msg["result"]
    assert sorted(renders) == ["{{ 'red' }}", "{{ 50 }}", "{{ now() }}"]
    assert result["fields"]["state"]["value"] == result["content"]["state"]["value"]


async def test_preview_gauge_full_schema(hass, hass_ws_client) -> None:
    """Literal bounds pass through; the ring pick becomes color (one) or
    gradient (several), never both."""
    await setup_account(hass)
    hass.states.async_set("sensor.power", "42")
    client = await hass_ws_client(hass)

    async def preview(bindings):
        await client.send_json_auto_id(
            {"type": "aivi/preview", "template": "gauge", "bindings": bindings}
        )
        msg = await client.receive_json()
        assert msg["success"]
        return msg["result"]["content"]

    base = {"value": "sensor.power", "min_value": 0, "max_value": 100}
    solid = await preview({**base, "ring": ["teal"]})
    assert solid["value"] == 42.0
    assert solid["min_value"] == 0.0
    assert solid["max_value"] == 100.0
    assert solid["color"] == "teal"
    assert "gradient" not in solid

    ramp = await preview({**base, "ring": ["green", "yellow", "red"]})
    assert ramp["gradient"] == ["green", "yellow", "red"]
    assert "color" not in ramp


async def test_preview_reports_the_switchboard_size(hass, hass_ws_client) -> None:
    """Preview reports the size Aivi will measure against the 4 KiB cap."""

    await setup_account(hass)
    hass.states.async_set("light.porch", "on", {"friendly_name": "Porch"})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "template": "switchboard",
            "bindings": {"actions": ["light.porch"]},
        }
    )
    msg = await client.receive_json()
    assert msg["success"]
    size = msg["result"]["size"]
    assert size["limit"] == 4096
    assert 150 < size["bytes"] < 400
    await client.send_json_auto_id(
        {"type": "aivi/preview", "template": "progress", "bindings": {}}
    )
    msg = await client.receive_json()
    assert "size" not in msg["result"]


async def test_the_preview_reads_history(
    hass: HomeAssistant, hass_ws_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    await setup_account(hass)
    hass.config.components.add("recorder")

    async def recorded(*_args: Any) -> list:
        return []

    monkeypatch.setattr(history, "_async_recorded", recorded)
    hass.states.async_set("sensor.temp", "21")
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "template": "trend",
            "bindings": {"value": "sensor.temp", "points__template": "[1, 2]"},
        }
    )
    msg = await client.receive_json()
    assert msg["result"]["content"]["points"] == [1, 2]
    # History with no recorded states yet: one live point is no chart.
    await client.send_json_auto_id(
        {
            "type": "aivi/preview",
            "template": "trend",
            "bindings": {"value": "sensor.temp"},
        }
    )
    msg = await client.receive_json()
    assert msg["result"]["content"] is None
