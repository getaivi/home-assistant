"""How the integration behaves when the Aivi API fails: retries with backoff,
one warning (not a flood), recovery logging, reauth on rejected tokens, and
a sensor that becomes unavailable."""

from __future__ import annotations

import logging

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi.api import (
    AiviQuotaError,
    AiviTemplateMismatchError,
)
from custom_components.aivi.const import (
    DOMAIN,
)
from custom_components.aivi.push import (
    RETRY_BACKOFF,
    PushStatus,
)
from helpers import (
    account_entry,
    advance,
    advance_past_debounce,
    subentry_id_of,
    two_widgets,
    washer_activity,
    widget_subentry,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


async def _laundry_entry(hass: HomeAssistant, fake_client) -> MockConfigEntry:
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {"progress": "sensor.washer_progress"},
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_aborts_when_unreachable(hass: HomeAssistant, fake_client) -> None:
    """An unreachable API means setup retries later instead of claiming success."""
    fake_client.reachable = False
    entry = account_entry(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state.name == "SETUP_RETRY"
    # The reason names the cause once, not "Cannot reach Aivi: Cannot reach
    # Aivi: ...".
    assert entry.reason == "Couldn't reach Aivi: unreachable"


async def test_setup_starts_reauth_on_rejected_token(
    hass: HomeAssistant, fake_client
) -> None:
    fake_client.auth_ok = False
    entry = account_entry(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state.name == "SETUP_ERROR"
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert any(f["context"]["source"] == "reauth" for f in flows)


async def test_transient_failure_retries_with_backoff_and_logs_once(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    entry = await _laundry_entry(hass, fake_client)
    assert len(fake_client.pushes) == 1

    caplog.set_level(logging.WARNING)
    caplog.clear()
    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1

    # The first retry fires after the first backoff step and fails silently
    # (no second warning).
    await advance(hass, RETRY_BACKOFF[0] + 1)
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1

    # The API comes back; the second retry succeeds and recovery is logged.
    caplog.set_level(logging.INFO)
    fake_client.reachable = True
    await advance(hass, RETRY_BACKOFF[1] + 1)
    assert len(fake_client.pushes) == 2
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.80)
    assert any("working again" in r.message for r in caplog.records)

    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager.available
    assert manager.last_error is None


async def test_rejected_token_mid_flight_starts_reauth(
    hass: HomeAssistant, fake_client
) -> None:
    await _laundry_entry(hass, fake_client)
    assert not hass.config_entries.flow.async_progress_by_handler(DOMAIN)

    fake_client.auth_ok = False
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert any(f["context"]["source"] == "reauth" for f in flows)


async def test_permanent_failures_do_not_retry(
    hass: HomeAssistant, fake_client
) -> None:
    """A deleted widget (404) is not retried in a loop; the next
    state change may try again, but no timer-driven retry is scheduled."""
    entry = await _laundry_entry(hass, fake_client)
    fake_client.missing_slugs.add("laundry")
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager.last_error is not None
    pushes = len(fake_client.pushes)

    # No retry fires even after the longest backoff interval.
    await advance(hass, RETRY_BACKOFF[-1] + 1)
    assert len(fake_client.pushes) == pushes


async def test_fresh_content_supersedes_a_pending_retry(
    hass: HomeAssistant, fake_client
) -> None:
    """A state change while a retry is pending pushes immediately and
    cancels the stale retry (no duplicate push later)."""
    await _laundry_entry(hass, fake_client)
    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)

    fake_client.reachable = True
    hass.states.async_set("sensor.washer_progress", "75")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.75)
    pushes = len(fake_client.pushes)

    await advance(hass, RETRY_BACKOFF[0] + 1)
    assert len(fake_client.pushes) == pushes  # the old retry never fired


async def test_rejected_content_reports_and_does_not_retry(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await _laundry_entry(hass, fake_client)
    fake_client.reject_content = True
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    manager = next(iter(entry.runtime_data.managers.values()))
    assert "rejected" in manager.last_error
    pushes = len(fake_client.pushes)
    await advance(hass, RETRY_BACKOFF[-1] + 1)
    assert len(fake_client.pushes) == pushes


def _aivi_warnings(caplog) -> list[logging.LogRecord]:
    return [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING and "Aivi push" in r.message
    ]


async def test_required_template_error_skips_push_until_it_recovers(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    """A required field's template that starts raising at runtime skips the
    push without killing the task: reported once, no retry timer, and
    pushing resumes by itself when the template resolves again."""
    hass.states.async_set("sensor.washer_progress", "62")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {
                "progress__template": (
                    "{{ states('sensor.washer_progress') | float }}"
                ),
                "progress__watched": ["sensor.washer_progress"],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.62)

    caplog.set_level(logging.WARNING)
    caplog.clear()
    # `float` without a default raises TemplateError on junk input.
    hass.states.async_set("sensor.washer_progress", "definitely-not-a-number")
    await advance_past_debounce(hass)
    pushes = len(fake_client.pushes)

    manager = next(iter(entry.runtime_data.managers.values()))
    assert not manager.available
    assert "Template error" in manager.last_error
    # The push task survived: no unhandled task exception was logged.
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(_aivi_warnings(caplog)) == 1

    # More junk: still skipped, still just the one warning, and no
    # timer-driven retry fires later.
    hass.states.async_set("sensor.washer_progress", "still junk")
    await advance_past_debounce(hass)
    assert len(_aivi_warnings(caplog)) == 1
    await advance(hass, RETRY_BACKOFF[-1] + 1)
    assert len(fake_client.pushes) == pushes

    # The template renders again: pushing resumes and recovery is logged.
    caplog.set_level(logging.INFO)
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.80)
    assert manager.available
    assert manager.last_error is None
    assert any("working again" in r.message for r in caplog.records)


async def test_broken_required_template_does_not_break_setup(
    hass: HomeAssistant, fake_client
) -> None:
    """A binding saved with a template that raises (allowed on save for
    anything the user insists on keeping, and always possible when state
    changes underneath) must not fail entry setup."""
    hass.states.async_set("sensor.washer_progress", "junk")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {
                "progress__template": (
                    "{{ states('sensor.washer_progress') | float }}"
                ),
                "progress__watched": ["sensor.washer_progress"],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert fake_client.pushes == []

    manager = next(iter(entry.runtime_data.managers.values()))
    assert "Template error" in manager.last_error

    # The entity starts reporting numbers: the widget pushes on its own.
    hass.states.async_set("sensor.washer_progress", "25")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["progress"]["value"] == pytest.approx(0.25)


async def test_optional_template_error_degrades_the_field_and_recovers(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    """A broken template on an optional field is omitted, the push still
    goes out, the binding stays healthy, and the degradation is logged once
    per breakage."""
    caplog.set_level(logging.WARNING)
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("sensor.washer_state", "Washing")
    entry = account_entry(
        hass,
        widget_subentry(
            "laundry",
            "Laundry",
            "progress",
            {
                "progress": "sensor.washer_progress",
                "state__template": "{{ states('sensor.washer_state') | float }}",
                "state__watched": ["sensor.washer_state"],
            },
        ),
    )
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # The push happened, without the broken optional field.
    _, content = fake_client.last_push
    assert content["progress"]["value"] == pytest.approx(0.62)
    assert "state" not in content
    manager = next(iter(entry.runtime_data.managers.values()))
    assert manager.available
    assert manager.last_error is None
    assert len(_aivi_warnings(caplog)) == 1

    # Another state change while still broken does not warn again.
    hass.states.async_set("sensor.washer_state", "still not a number")
    await advance_past_debounce(hass)
    assert "state" not in fake_client.last_push[1]
    assert len(_aivi_warnings(caplog)) == 1

    # The template renders again: the field is back and recovery is logged.
    caplog.set_level(logging.INFO)
    hass.states.async_set("sensor.washer_state", "42")
    await advance_past_debounce(hass)
    assert fake_client.last_push[1]["state"] == {"value": "42.0"}
    assert any("render again" in r.message for r in caplog.records)


async def test_unload_stops_pushing(hass: HomeAssistant, fake_client) -> None:
    entry = await _laundry_entry(hass, fake_client)
    pushes = len(fake_client.pushes)

    assert await hass.config_entries.async_unload(entry.entry_id)
    hass.states.async_set("sensor.washer_progress", "99")
    await advance_past_debounce(hass)
    assert len(fake_client.pushes) == pushes


async def test_unload_cancels_a_pending_retry(hass: HomeAssistant, fake_client) -> None:
    """A retry scheduled before unload never fires after it."""
    entry = await _laundry_entry(hass, fake_client)
    fake_client.reachable = False
    hass.states.async_set("sensor.washer_progress", "80")
    await advance_past_debounce(hass)

    assert await hass.config_entries.async_unload(entry.entry_id)
    fake_client.reachable = True
    pushes = len(fake_client.pushes)
    await advance(hass, RETRY_BACKOFF[0] + 1)
    assert len(fake_client.pushes) == pushes


async def test_an_unexpected_error_is_reported_not_raised(
    hass: HomeAssistant, fake_client, caplog
) -> None:
    fake_client.push_error = RuntimeError("bug")
    entry = await two_widgets(hass)
    manager = entry.runtime_data.managers[subentry_id_of(entry, "laundry")]
    assert manager.status is PushStatus.ERROR
    assert any(
        r.levelno == logging.ERROR and "unexpected error" in r.message
        for r in caplog.records
    )

    fake_client.push_error = None
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.OK


async def test_a_template_mismatch_is_a_repair_issue_without_retries(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await two_widgets(hass)
    laundry = subentry_id_of(entry, "laundry")
    manager = entry.runtime_data.managers[laundry]
    fake_client.push_error = AiviTemplateMismatchError()
    hass.states.async_set("sensor.washer_progress", "70")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.TEMPLATE_MISMATCH
    issue = ir.async_get(hass).async_get_issue(DOMAIN, f"template_mismatch_{laundry}")
    assert issue is not None
    assert issue.translation_placeholders["template"] == "progress"

    fake_client.push_error = None
    await advance(hass, RETRY_BACKOFF[-1] + 1)
    assert manager.status is PushStatus.TEMPLATE_MISMATCH  # nothing retried

    hass.states.async_set("sensor.washer_progress", "71")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.OK
    assert not ir.async_get(hass).async_get_issue(
        DOMAIN, f"template_mismatch_{laundry}"
    )


async def test_the_activity_quota_is_its_own_repair_issue(
    hass: HomeAssistant, fake_client
) -> None:
    entry = await washer_activity(hass)
    subentry_id = next(iter(entry.subentries))
    manager = entry.runtime_data.managers[subentry_id]
    fake_client.push_error = AiviQuotaError("Too many ongoing activities")
    hass.states.async_set("sensor.washer_progress", "50")
    await advance_past_debounce(hass)
    assert manager.status is PushStatus.QUOTA_EXCEEDED
    issues = ir.async_get(hass)
    assert issues.async_get_issue(DOMAIN, f"activity_quota_{subentry_id}")
    assert not issues.async_get_issue(DOMAIN, f"content_rejected_{subentry_id}")
