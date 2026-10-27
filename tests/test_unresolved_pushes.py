"""A push whose content does not resolve, or that the throttle holds back:
the log says why (waiting, held), the editor's preview names the field,
and a Live Activity turned off meanwhile is still ended."""

from __future__ import annotations

import logging
from datetime import timedelta

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import CoreState, HomeAssistant
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.aivi import engine
from custom_components.aivi.const import DEFAULT_THROTTLE_SECONDS
from custom_components.aivi.pushes import (
    Hold,
    PushAttempt,
    PushLog,
    PushOutcome,
    PushRecord,
)
from custom_components.aivi.sources import SourcedValue
from custom_components.aivi.templates import ACTIVITY_PROGRESS, ACTIVITY_REMOTE, ENERGY
from helpers import (
    Resolver,
    account_entry,
    activity_subentry,
    advance_past_debounce,
    setup_account,
    washer_activity,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")

PROGRESS = {"progress": "sensor.p"}


def _blocker(bindings: dict, **states: str) -> engine.Blocker | None:
    return engine.blocker(
        ACTIVITY_PROGRESS,
        bindings,
        Resolver({key.replace("__", "."): value for key, value in states.items()}),
    )


def test_the_blocker_names_the_field_and_what_its_entity_reads() -> None:
    for reading in ("unknown", "unavailable", "abc"):
        assert _blocker(PROGRESS, sensor__p=reading) == engine.Blocker(
            "progress", ("progress",), "sensor.p", reading
        )
    # An entity Home Assistant does not have.
    assert _blocker(PROGRESS) == engine.Blocker(
        "progress", ("progress",), "sensor.p", "missing"
    )
    # Content that resolves has no blocker.
    assert _blocker(PROGRESS, sensor__p="40") is None


def test_the_blocker_reads_templates_attributes_and_unbound_fields() -> None:
    template = {"progress__template": "{{ x }}"}
    assert _blocker(template) == engine.Blocker(
        "progress", ("progress",), None, "empty"
    )
    attribute = {"progress__entity": "sensor.p", "progress__attribute": "level"}
    assert _blocker(attribute).reading == "missing"
    assert _blocker(attribute, sensor__p="on").reading == "empty"
    assert engine.blocker(
        ACTIVITY_PROGRESS,
        attribute,
        Resolver({"sensor.p": "on"}, {"sensor.p": {"level": "x"}}),
    ) == engine.Blocker("progress", ("progress",), "sensor.p", "x")
    # Nothing bound: the field, with nothing to read.
    assert _blocker({}) == engine.Blocker("progress", ("progress",))
    assert SourcedValue.tmpl("{{ 1 }}").reading(Resolver(renders={"{{ 1 }}": 1})) == "1"


def test_the_blocker_of_compound_fields_and_of_a_group() -> None:
    # A field made of several values names no reading.
    remote = engine.blocker(
        ACTIVITY_REMOTE, {"value": "sensor.v"}, Resolver({"sensor.v": "1"})
    )
    assert remote == engine.Blocker("actions", ("actions",))
    # Energy needs one of its nodes: the group, no field of its own.
    energy = engine.blocker(ENERGY, {}, Resolver())
    assert energy is not None
    assert energy.field is None
    assert {"sources", "grid_power", "battery_power", "home_power"} <= set(
        energy.fields
    )
    assert energy.as_dict()["fields"] == list(energy.fields)


def _waiting(reading: str, field: str = "progress") -> dict:
    return {
        "field": field,
        "fields": [field],
        "entity_id": "sensor.p",
        "reading": reading,
    }


def test_waiting_records_fold_per_reading_and_survive_the_store() -> None:
    log = PushLog()

    def record(outcome: PushOutcome, **kw) -> PushRecord:
        return PushRecord.of(
            PushAttempt(outcome, "ok", **kw), kind="activity", slug="w", subentry_id="s"
        )

    log.append(record(PushOutcome.WAITING, waiting=_waiting("unknown")))
    log.append(record(PushOutcome.WAITING, waiting=_waiting("unknown")))
    log.append(record(PushOutcome.WAITING, waiting=_waiting("unavailable")))
    rows = log.rows()
    assert [(row["outcome"], row["count"]) for row in rows] == [
        ("waiting", 1),
        ("waiting", 2),
    ]
    assert rows[0]["waiting"] == _waiting("unavailable")
    assert rows[0]["held"] is None

    until = record(PushOutcome.DELIVERED).time + timedelta(seconds=60)
    held = record(PushOutcome.HELD, held=Hold(until, 60))
    assert held.as_row()["held"] == {"until": until.isoformat(), "interval": 60}
    for kept in (held, log.records()[-1]):
        assert PushRecord.from_stored(kept.as_stored()) == kept
    # A stored hold that does not read is dropped, not the record.
    bad = {**held.as_stored(), "held": {"until": "never", "interval": 60}}
    back = PushRecord.from_stored(bad)
    assert back is not None
    assert back.held is None
    assert Hold.from_stored("nope") is None


async def _activity(hass: HomeAssistant, progress: str, throttle: int = 0):
    hass.states.async_set("binary_sensor.washer_running", "on")
    hass.states.async_set("sensor.washer_progress", progress)
    entry = account_entry(
        hass,
        activity_subentry(
            "washer",
            "Washer",
            "progress",
            "binary_sensor.washer_running",
            {"progress": "sensor.washer_progress"},
            throttle=throttle,
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _rows(entry) -> list[dict]:
    return [dict(row) for row in entry.runtime_data.inputs.pushes.rows()]


async def test_a_push_that_waits_is_logged_with_why(
    hass: HomeAssistant, fake_client, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="custom_components.aivi.push")
    entry = await _activity(hass, "unknown")
    assert fake_client.activity_pushes == []
    (row,) = _rows(entry)
    assert row["outcome"] == "waiting"
    assert row["request"] is None
    assert row["waiting"] == {
        "field": "progress",
        "fields": ["progress"],
        "entity_id": "sensor.washer_progress",
        "reading": "unknown",
    }
    (manager,) = entry.runtime_data.managers.values()
    # The same reading again folds; another reading starts a row.
    manager.async_refresh()
    await hass.async_block_till_done()
    hass.states.async_set("sensor.washer_progress", "unavailable")
    await advance_past_debounce(hass)
    rows = _rows(entry)
    assert [(r["outcome"], r["count"], r["waiting"]["reading"]) for r in rows] == [
        ("waiting", 1, "unavailable"),
        ("waiting", 2, "unknown"),
    ]
    # Once per reading in the log, and once when it resolves again.
    hass.states.async_set("sensor.washer_progress", "50")
    await advance_past_debounce(hass)
    assert _rows(entry)[0]["outcome"] == "delivered"
    lines = [r.getMessage() for r in caplog.records if r.name.endswith(".push")]
    assert lines == [
        "Aivi push for washer not sent: progress is unresolved"
        " (sensor.washer_progress reads 'unknown')",
        "Aivi push for washer not sent: progress is unresolved"
        " (sensor.washer_progress reads 'unavailable')",
        "Aivi push for washer: progress resolves again",
    ]
    assert manager.status.value == "ok"


async def test_an_unbound_field_is_logged_without_an_entity(
    hass: HomeAssistant, fake_client, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, logger="custom_components.aivi.push")
    entry = account_entry(
        hass, activity_subentry("x", "X", "progress", "binary_sensor.x", {})
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert "Aivi push for x not sent: progress is unresolved" in caplog.text
    assert _rows(entry)[0]["waiting"]["reading"] is None


async def test_nothing_waits_in_the_log_before_home_assistant_runs(
    hass: HomeAssistant, fake_client
) -> None:
    hass.set_state(CoreState.starting)
    entry = await _activity(hass, "unknown")
    assert _rows(entry) == []
    hass.set_state(CoreState.running)
    (manager,) = entry.runtime_data.managers.values()
    manager.async_refresh()
    await hass.async_block_till_done()
    assert [row["outcome"] for row in _rows(entry)] == ["waiting"]


async def _later(
    hass: HomeAssistant, freezer: FrozenDateTimeFactory, seconds: float
) -> None:
    await hass.async_block_till_done()
    freezer.tick(timedelta(seconds=seconds))
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


async def test_a_change_the_throttle_holds_is_logged_until_it_goes(
    hass: HomeAssistant, fake_client, freezer: FrozenDateTimeFactory
) -> None:
    entry = await _activity(hass, "10", throttle=DEFAULT_THROTTLE_SECONDS)
    (delivered,) = _rows(entry)
    for value in ("20", "30"):
        hass.states.async_set("sensor.washer_progress", value)
        await _later(hass, freezer, 5)
    held, first = _rows(entry)
    assert (held["outcome"], held["count"]) == ("held", 2)
    assert held["request"]["path"] == "/activities/washer"
    assert held["request"]["body"]["state"] == "ONGOING"
    assert held["request"]["body"]["content"]["progress"]["value"] == pytest.approx(0.3)
    sent = first["time"]
    assert sent == delivered["time"]
    (manager,) = entry.runtime_data.managers.values()
    assert manager.last_pushed is not None
    assert held["held"] == {
        "until": (
            manager.last_pushed + timedelta(seconds=DEFAULT_THROTTLE_SECONDS)
        ).isoformat(),
        "interval": DEFAULT_THROTTLE_SECONDS,
    }
    # When it goes out, the delivered row follows the held one.
    await _later(hass, freezer, DEFAULT_THROTTLE_SECONDS)
    assert [row["outcome"] for row in _rows(entry)] == [
        "delivered",
        "held",
        "delivered",
    ]


async def test_an_activity_turned_off_ends_with_its_last_content(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    assert fake_client.activity_pushes[-1][:2] == ("washer", "ONGOING")
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    assert len(fake_client.activity_pushes) == 1
    hass.states.async_set("binary_sensor.washer_running", "off")
    await advance_past_debounce(hass)
    slug, state, content = fake_client.activity_pushes[-1]
    assert (slug, state) == ("washer", "IDLE")
    assert content["progress"]["value"] == pytest.approx(0.4)
    ended, *_ = _rows(entry)
    assert ended["outcome"] == "delivered"
    # The log shows the request as it went: the lifecycle state with the
    # content.
    assert ended["request"] == {
        "method": "PATCH",
        "path": "/activities/washer",
        "body": {"state": "IDLE", "content": content},
    }
    # Ended: nothing more goes out while the content does not resolve,
    # not even when the activity turns on again.
    (manager,) = entry.runtime_data.managers.values()
    manager.async_refresh()
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.washer_running", "on")
    await advance_past_debounce(hass)
    assert len(fake_client.activity_pushes) == 2
    assert _rows(entry)[0]["outcome"] == "waiting"


async def test_an_activity_that_never_delivered_has_nothing_to_end_with(
    hass: HomeAssistant, fake_client
) -> None:
    await _activity(hass, "unknown")
    hass.states.async_set("binary_sensor.washer_running", "off")
    await advance_past_debounce(hass)
    assert fake_client.activity_pushes == []


async def test_a_removed_activity_ends_with_its_last_content(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    hass.config_entries.async_remove_subentry(entry, next(iter(entry.subentries)))
    await hass.async_block_till_done(wait_background_tasks=True)
    slug, state, content = fake_client.activity_pushes[-1]
    assert (slug, state) == ("washer", "IDLE")
    assert content["progress"]["value"] == pytest.approx(0.4)


async def test_a_removed_account_ends_its_activities_with_their_last_content(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    hass.states.async_set("sensor.washer_progress", "unknown")
    await advance_past_debounce(hass)
    fake_client.activity_pushes.clear()
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    ((slug, state, content),) = fake_client.activity_pushes
    assert (slug, state) == ("washer", "IDLE")
    assert content["progress"]["value"] == pytest.approx(0.4)


async def test_the_preview_says_what_the_content_waits_on(
    hass: HomeAssistant, hass_ws_client
) -> None:
    await setup_account(hass)
    hass.states.async_set("sensor.washer_progress", "unknown")
    client = await hass_ws_client(hass)

    async def preview(bindings: dict) -> dict:
        await client.send_json_auto_id(
            {
                "type": "aivi/preview",
                "template": "progress",
                "kind": "activity",
                "bindings": bindings,
            }
        )
        reply = await client.receive_json()
        assert reply["success"], reply
        return reply["result"]

    res = await preview({"progress": "sensor.washer_progress"})
    assert res["content"] is None
    assert res["waiting"] == {
        "field": "progress",
        "fields": ["progress"],
        "entity_id": "sensor.washer_progress",
        "reading": "unknown",
    }
    assert res["fields"]["progress"] == {"status": "fallback", "reading": "unknown"}
    hass.states.async_set("sensor.washer_progress", "40")
    assert "waiting" not in await preview({"progress": "sensor.washer_progress"})
