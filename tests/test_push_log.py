"""The push log: every push cycle's outcome, with the request it sent,
kept per account for the panel and the diagnostics."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from test_contract import assert_valid_request

from custom_components.aivi.api import WireRequest
from custom_components.aivi.blocks import EntityRows
from custom_components.aivi.diagnostics import async_get_config_entry_diagnostics
from custom_components.aivi.pushes import (
    CONTENT_CAP,
    RECENT_PUSHES,
    PushAttempt,
    PushLog,
    PushOutcome,
    PushRecord,
    capped_request,
)
from helpers import (
    LAPSED,
    account_entry,
    advance_past_debounce,
    subentry_id_of,
    two_widgets,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


def _record(n: int, outcome: PushOutcome = PushOutcome.DELIVERED, **changes: Any):
    return PushRecord(
        **{
            "kind": "widget",
            "slug": "laundry",
            "subentry_id": "sub",
            "outcome": outcome,
            "status": "ok",
            "time": dt_util.utcnow() + timedelta(seconds=n),
            "id": f"push_{n}",
            **changes,
        }
    )


def test_repeats_fold_into_the_newest_record_but_deliveries_never_do() -> None:
    log = PushLog(limit=10)
    log.append(_record(0))
    log.append(_record(1))
    log.append(_record(2, PushOutcome.UNCHANGED))
    log.append(_record(3, PushOutcome.UNCHANGED))
    log.append(_record(4, PushOutcome.RETRYING, error="Cannot reach Aivi"))
    log.append(_record(5, PushOutcome.RETRYING, error="Cannot reach Aivi"))
    log.append(_record(6, PushOutcome.RETRYING, error="Timed out"))
    log.append(_record(7, PushOutcome.FAILED, error="Rejected"))
    log.append(_record(8, PushOutcome.FAILED, error="Rejected", subentry_id="other"))
    rows = log.rows()
    assert [(row["outcome"], row["count"], row["error"]) for row in rows] == [
        ("failed", 1, "Rejected"),
        ("failed", 1, "Rejected"),
        ("retrying", 1, "Timed out"),
        ("retrying", 2, "Cannot reach Aivi"),
        ("unchanged", 2, None),
        ("delivered", 1, None),
        ("delivered", 1, None),
    ]
    # A folded record keeps its id (the panel keys rows by it) and takes
    # the newest time.
    assert rows[3]["id"] == "push_4"
    assert rows[3]["time"] > rows[4]["time"]
    assert log.rows("other") == [rows[0]]


def test_the_log_is_bounded_and_newest_first() -> None:
    log = PushLog()
    for n in range(RECENT_PUSHES + 5):
        log.append(_record(n))
    rows = log.rows()
    assert len(rows) == RECENT_PUSHES
    assert rows[0]["id"] == f"push_{RECENT_PUSHES + 4}"
    assert rows[-1]["id"] == "push_5"


def test_a_body_over_the_cap_is_cut_and_marked() -> None:
    small = WireRequest("PATCH", "/widgets/laundry", {"content": {"state": "on"}})
    assert capped_request(small) == (
        {"method": "PATCH", "path": "/widgets/laundry", "body": small.body},
        False,
    )
    assert capped_request(None) == (None, False)
    big = WireRequest(
        "PATCH", "/widgets/laundry", {"content": {"text": "x" * (CONTENT_CAP + 100)}}
    )
    row, truncated = capped_request(big)
    assert truncated
    assert row is not None
    assert row["path"] == "/widgets/laundry"
    assert isinstance(row["body"], str)
    assert len(row["body"]) == CONTENT_CAP


def test_a_record_survives_the_store_and_a_bad_one_is_dropped() -> None:
    record = PushRecord.of(
        PushAttempt(
            PushOutcome.DELIVERED,
            "ok",
            duration_ms=12,
            request=WireRequest(
                "PATCH", "/widgets/laundry", {"content": {"state": "on"}}
            ),
        ),
        kind="widget",
        slug="laundry",
        subentry_id="sub",
    )
    back = PushRecord.from_stored(record.as_stored())
    assert back == record
    assert PushRecord.from_stored({"kind": "widget"}) is None
    assert PushRecord.from_stored("nope") is None
    assert PushRecord.from_stored({**record.as_stored(), "time": "never"}) is None
    assert PushRecord.from_stored({**record.as_stored(), "outcome": "lost"}) is None
    # A record stored with only its content, before records kept the
    # request, loads without one.
    older = {**record.as_stored(), "content": {"state": "on"}}
    del older["request"]
    back = PushRecord.from_stored(older)
    assert back is not None
    assert back.request is None
    garbled = {**record.as_stored(), "request": {"path": "/widgets/laundry"}}
    back = PushRecord.from_stored(garbled)
    assert back is not None
    assert back.request is None


async def test_every_cycle_is_logged_with_what_it_sent(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    inputs = entry.runtime_data.inputs
    laundry = subentry_id_of(entry, "laundry")
    rows = inputs.pushes.rows(laundry)
    assert [row["outcome"] for row in rows] == ["delivered"]
    (first,) = rows
    assert first["kind"] == "widget"
    assert first["slug"] == "laundry"
    assert first["status"] == "ok"
    assert first["request"]["method"] == "PATCH"
    assert first["request"]["path"] == "/widgets/laundry"
    assert first["request"]["body"]["content"]["progress"]["value"] == pytest.approx(
        0.62
    )
    assert_valid_request("patch", "/widgets/laundry", first["request"]["body"])
    assert first["truncated"] is False
    assert isinstance(first["duration_ms"], int)
    assert first["error"] is None

    # A change is delivered; the same content evaluated again is not sent,
    # and the repeats fold into one row.
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    manager = entry.runtime_data.managers[laundry]
    manager.async_refresh()
    await hass.async_block_till_done()
    manager.async_refresh()
    await hass.async_block_till_done()
    rows = inputs.pushes.rows(laundry)
    assert [(row["outcome"], row["count"]) for row in rows] == [
        ("unchanged", 2),
        ("delivered", 1),
        ("delivered", 1),
    ]
    assert rows[0]["request"]["body"]["content"]["progress"]["value"] == pytest.approx(
        0.7
    )

    # A refusal, and an outage: failed for good, and retrying.
    fake_client.reject_content = True
    hass.states.async_set("sensor.washer_progress", "71")
    await advance_past_debounce(hass)
    fake_client.reject_content = False
    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "72")
    await advance_past_debounce(hass)
    rows = inputs.pushes.rows(laundry)
    assert [(row["outcome"], row["status"]) for row in rows[:2]] == [
        ("retrying", "retrying"),
        ("failed", "rejected"),
    ]
    assert rows[0]["error"].startswith("Cannot reach Aivi")
    assert rows[1]["error"] == "Aivi rejected the content"
    assert rows[0]["request"]["body"]["content"]["progress"]["value"] == pytest.approx(
        0.72
    )

    # The log outlives a reload: the rows are still there, and the
    # reloaded binding's first push joins them.
    fake_client.reachable = True
    before = len(inputs.pushes.rows())
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.inputs is inputs
    assert len(inputs.pushes.rows()) > before
    assert inputs.pushes.rows(laundry)[0]["outcome"] == "delivered"


async def test_a_lapsed_subscription_is_logged_as_the_push_that_met_it(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    laundry = subentry_id_of(entry, "laundry")
    fake_client.subscription = LAPSED
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    (row, *_rest) = entry.runtime_data.inputs.pushes.rows(laundry)
    assert row["outcome"] == "failed"
    assert row["status"] == "no_subscription"
    assert "subscription" in row["error"].lower()


async def test_the_subscription_and_the_diagnostics_carry_the_pushes(
    hass: HomeAssistant, hass_ws_client, fake_client
) -> None:
    await async_setup_component(hass, "websocket_api", {})
    entry = await two_widgets(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "aivi/inputs/subscribe", "entry_id": entry.entry_id}
    )
    assert (await client.receive_json())["success"]
    first = (await client.receive_json())["event"]
    assert {row["slug"] for row in first["pushes"]} == {"laundry", "frontdoor"}
    assert first["presses"] == []

    hass.states.async_set("binary_sensor.door", "on")
    await advance_past_debounce(hass)
    async with asyncio.timeout(5):
        while True:
            update = (await client.receive_json())["event"]
            newest = update["pushes"][0]
            if (
                newest["slug"] == "frontdoor"
                and newest["request"]["body"]["content"]["state"]["value"] == "On"
            ):
                break

    await client.send_json_auto_id({"type": "aivi/config"})
    (account,) = (await client.receive_json())["result"]["accounts"]
    assert account["keep_log"] is False

    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["recent_pushes"][0]["slug"] == "frontdoor"
    assert diagnostics["keep_log"] is False


async def test_a_malformed_binding_is_logged_as_failed(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _choke(*_args: object) -> None:
        raise TypeError("malformed")

    monkeypatch.setattr(EntityRows, "resolve", _choke)
    entry = account_entry(
        hass,
        widget_subentry("batteries", "Batteries", "battery", {"devices": [{"bad": 1}]}),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    (row,) = entry.runtime_data.inputs.pushes.rows()
    assert row["outcome"] == "failed"
    assert row["status"] == "error"
    assert row["request"] is None
    assert row["duration_ms"] is None
