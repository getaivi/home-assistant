"""The recent list of inputs the panel reads: bounded, newest first, and one
per account."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.const import (
    DATA_CLIENT_FACTORY,
    DOMAIN,
)
from custom_components.aivi.inputs import (
    RECENT_LIMIT,
    InputLog,
    InputRecord,
    Outcome,
)
from custom_components.aivi.switchboard import PRESSED
from helpers import (
    FakeAiviClient,
    porch_subentry,
    stream_sensor_of,
    tile_press,
    until,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("porch", "Porch", "switchboard"),
        WidgetInfo("hall", "Hall", "switchboard"),
        WidgetInfo("laundry", "Laundry", "progress"),
    ]


async def test_each_account_has_its_own_stream_and_recent_list(
    hass: HomeAssistant, entity_registry: er.EntityRegistry, widgets
) -> None:
    clients = {"a": FakeAiviClient(widgets), "b": FakeAiviClient(widgets)}
    hass.data[DATA_CLIENT_FACTORY] = lambda hass, base_url, token: clients[token]
    turn_on = async_mock_service(hass, "homeassistant", "turn_on")
    hass.states.async_set("light.porch", "off", {"friendly_name": "Porch light"})
    hass.states.async_set("light.hall", "off", {"friendly_name": "Hall light"})
    entries = {}
    for token, subentry in (
        ("a", porch_subentry(["light.porch"])),
        (
            "b",
            widget_subentry("hall", "Hall", "switchboard", {"actions": ["light.hall"]}),
        ),
    ):
        entry = MockConfigEntry(
            domain=DOMAIN,
            data={"token": token},
            title=f"Account {token}",
            subentries_data=[subentry],
        )
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        entries[token] = entry
    await hass.async_block_till_done()
    sensors = {
        token: stream_sensor_of(entity_registry, entry)
        for token, entry in entries.items()
    }
    assert len({*sensors.values()}) == 2

    clients["b"].emit(tile_press("light_hall", slug="hall", kind="toggle", value=True))
    clients["a"].emit(tile_press("light_hall", slug="hall", kind="toggle", value=True))
    await until(hass, lambda: len(turn_on) == 1, "account b's press")
    a, b = (entries[t].runtime_data.inputs for t in ("a", "b"))
    await until(hass, lambda: len(a.log.rows()) == 1, "account a's record")
    assert a.log.rows()[0]["outcome"] == "not_bound"
    assert b.log.rows()[0]["outcome"] == "played"
    assert b.log.rows()[0]["label"] == "Hall light"

    # Taking account a down leaves account b's sensor alone.
    assert await hass.config_entries.async_unload(entries["a"].entry_id)
    await hass.async_block_till_done()
    assert hass.states.get(sensors["b"]).state == "on"


def _record(n: int, *, recorded: bool = True, **changes: Any) -> InputRecord:
    now = dt_util.utcnow()
    return InputRecord(
        **{
            "event_type": PRESSED,
            "resource_kind": "widget",
            "slug": "porch",
            "outcome": Outcome.PLAYED,
            "received_at": now,
            "finished_at": now + timedelta(seconds=n),
            "event_id": f"evt_{n}",
            "recorded": recorded,
            **changes,
        }
    )


def test_the_recent_list_is_bounded_and_newest_first() -> None:
    log = InputLog()
    for n in range(RECENT_LIMIT + 10):
        log.append(_record(n))
    rows = log.rows()
    assert len(rows) == RECENT_LIMIT
    assert rows[0]["id"] == f"evt_{RECENT_LIMIT + 9}"
    assert rows[-1]["id"] == "evt_10"


def test_play_only_records_coalesce_with_the_newest_only() -> None:
    log = InputLog(limit=5)
    log.append(_record(0, recorded=False))
    log.append(_record(1, recorded=False))
    log.append(_record(2, recorded=False, outcome=Outcome.EXPIRED))
    log.append(_record(3))
    log.append(_record(4, recorded=False))
    log.append(_record(5, recorded=False, subentry_id="other"))
    rows = log.rows()
    assert [(row["id"], row["count"]) for row in rows] == [
        ("evt_5", 1),
        ("evt_4", 1),
        ("evt_3", 1),
        ("evt_2", 1),
        ("evt_1", 2),
    ]
    assert log.rows("other") == [rows[0]]
