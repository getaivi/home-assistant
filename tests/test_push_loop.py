"""The push loop: a push in flight is not cut short, the debounce has a
ceiling, and identical content is not sent twice."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    async_fire_time_changed,
)

from custom_components.aivi.const import (
    DATA_REGISTRY,
    DEFAULT_DEBOUNCE_SECONDS,
)
from custom_components.aivi.push import (
    MAX_DEBOUNCE_SECONDS,
    URGENT_DELAY_SECONDS,
)
from custom_components.aivi.templates import STATUS, TemplateRegistry
from helpers import (
    account_entry,
    advance,
    advance_past_debounce,
    subentry_id_of,
    two_widgets,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _advance_held(hass: HomeAssistant, seconds: float) -> None:
    """``advance`` while a push is held at the gate, which
    ``async_block_till_done`` would wait on forever."""
    for _ in range(10):
        await asyncio.sleep(0)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    for _ in range(10):
        await asyncio.sleep(0)


async def test_a_slow_push_is_not_cut_short_by_the_next_change(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    fake_client.pushes.clear()
    fake_client.gate = asyncio.Event()

    hass.states.async_set("sensor.washer_progress", "70")
    await _advance_held(hass, 3)  # the send is now in flight, held by Aivi
    hass.states.async_set("sensor.washer_progress", "80")
    await _advance_held(hass, 6)
    assert fake_client.pushes == []

    fake_client.gate.set()
    await hass.async_block_till_done()
    values = [content["progress"]["value"] for _, content in fake_client.pushes]
    assert values == [pytest.approx(0.7), pytest.approx(0.8)]
    assert entry.runtime_data.managers[subentry_id_of(entry, "laundry")].available


async def test_unload_during_an_inflight_push(hass: HomeAssistant, fake_client) -> None:
    entry = await two_widgets(hass)
    fake_client.pushes.clear()
    fake_client.gate = asyncio.Event()
    hass.states.async_set("sensor.washer_progress", "70")
    await _advance_held(hass, 3)

    async with asyncio.timeout(2):
        assert await hass.config_entries.async_unload(entry.entry_id)
    fake_client.gate.set()
    await hass.async_block_till_done()
    assert fake_client.pushes == []


async def test_a_ceiling_push_cancels_the_pending_debounce(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    manager = entry.runtime_data.managers[subentry_id_of(entry, "laundry")]
    cycles: list[None] = []
    start = manager._start_push

    def _counted() -> None:
        cycles.append(None)
        start()

    manager._start_push = _counted  # type: ignore[method-assign]
    hass.states.async_set("sensor.washer_progress", "70")
    await hass.async_block_till_done()
    # The burst has run for the whole ceiling by the next event.
    assert manager._burst_started is not None
    manager._burst_started -= MAX_DEBOUNCE_SECONDS
    hass.states.async_set("sensor.washer_progress", "71")
    await hass.async_block_till_done()
    assert len(cycles) == 1
    await advance(hass, MAX_DEBOUNCE_SECONDS)
    assert len(cycles) == 1


async def test_an_expected_answer_is_not_pushed_back_by_ordinary_changes(
    hass: HomeAssistant, fake_client
) -> None:
    hass.states.async_set("scene.movie", "scening")
    hass.states.async_set("sensor.power", "1")
    entry = account_entry(
        hass,
        widget_subentry(
            "porch",
            "Porch",
            "switchboard",
            {
                "actions": ["scene.movie"],
                "actions__options": {"scene.movie": {"subtitle": "sensor.power"}},
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    manager = next(iter(entry.runtime_data.managers.values()))
    pushes = len(fake_client.pushes)

    manager.expect(lambda: True)
    # A dependency that is not a toggle changes before the answer goes.
    manager._schedule(urgent=False)
    await advance(hass, URGENT_DELAY_SECONDS + 0.1)
    assert len(fake_client.pushes) == pushes + 1


async def test_template_slots_follow_what_the_template_reads(
    hass: HomeAssistant, fake_client
) -> None:
    """A template over a whole domain has no fixed entity list; it still
    re-pushes when its result changes."""
    hass.states.async_set("counter.a", "1")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress__template": "{{ (states.counter | list | count) * 10 }}"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.1)

    hass.states.async_set("counter.b", "1")
    await advance(hass, 2)  # the domain rate limit
    await advance(hass, 6)  # the debounce
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.2)

    assert await hass.config_entries.async_unload(entry.entry_id)
    pushes = len(fake_client.pushes)
    hass.states.async_set("counter.c", "1")
    await advance(hass, 8)
    assert len(fake_client.pushes) == pushes


async def test_chatty_entity_still_pushes_at_the_debounce_ceiling(
    hass: HomeAssistant, fake_client
) -> None:
    """A source changing faster than the trailing debounce must not starve
    the push: the ceiling forces one every MAX_DEBOUNCE_SECONDS."""
    hass.states.async_set("sensor.chatty", "1")
    entry = account_entry(
        hass,
        widget_subentry("w", "W", "status", {"state": "sensor.chatty"}),
    )
    hass.data[DATA_REGISTRY] = TemplateRegistry((STATUS,))
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    pushes_before = len(fake_client.pushes)

    # Tick faster than the debounce for longer than the ceiling.
    step = DEFAULT_DEBOUNCE_SECONDS / 2
    now = dt_util.utcnow()
    for i in range(1, int((MAX_DEBOUNCE_SECONDS / step) + 3)):
        hass.states.async_set("sensor.chatty", str(i))
        await hass.async_block_till_done()
        now += timedelta(seconds=step)
        async_fire_time_changed(hass, now)
        await hass.async_block_till_done()

    assert len(fake_client.pushes) > pushes_before, (
        "a source changing faster than the debounce must still push"
    )


async def test_identical_content_is_not_pushed_twice(
    hass: HomeAssistant, fake_client
) -> None:
    """A state change that resolves to the same payload sends nothing.

    A template like `{{ 'red' if x > 90 else 'green' }}` re-renders the
    same word on every tick of x; the device already has that payload.
    """
    hass.states.async_set("sensor.temp", "20")
    entry = account_entry(
        hass,
        widget_subentry(
            "w",
            "W",
            "status",
            {
                "state__template": "{{ 'hot' if states('sensor.temp')|float > 90"
                " else 'cold' }}",
                "state__watched": ["sensor.temp"],
            },
        ),
    )
    hass.data[DATA_REGISTRY] = TemplateRegistry((STATUS,))
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    pushes_before = len(fake_client.pushes)

    # Still "cold": the payload is unchanged, so nothing is sent.
    hass.states.async_set("sensor.temp", "21")
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes_before

    # Crossing the threshold changes the payload, so it is.
    hass.states.async_set("sensor.temp", "95")
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes_before + 1
    _, content = fake_client.last_push
    assert content["state"]["value"] == "hot"


async def test_suppressed_push_leaves_last_pushed_alone(
    hass: HomeAssistant, fake_client
) -> None:
    """`last_pushed` means "when did Aivi last receive this", so a cycle
    that sent nothing must not move it."""
    hass.states.async_set("sensor.temp", "20")
    entry = account_entry(
        hass,
        widget_subentry("w", "W", "status", {"state": "sensor.temp"}),
    )
    hass.data[DATA_REGISTRY] = TemplateRegistry((STATUS,))
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    manager = next(iter(entry.runtime_data.managers.values()))
    stamped = manager.last_pushed

    # Same state set again: an event fires, the content is identical.
    hass.states.async_set("sensor.temp", "20", force_update=True)
    await advance_past_debounce(hass)
    assert manager.last_pushed == stamped
