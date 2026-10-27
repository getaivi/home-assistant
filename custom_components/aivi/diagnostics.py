"""Diagnostics for the Aivi integration: entry config, per-widget bindings,
push health (with what a binding waits on, or the throttle holds) and the
activity log, with the token redacted."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from .const import CONF_BINDINGS, CONF_NAME, CONF_SLUG, CONF_TEMPLATE, CONF_TOKEN
from .runtime import AiviConfigEntry

TO_REDACT = {CONF_TOKEN}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: AiviConfigEntry
) -> dict[str, Any]:
    widgets = []
    for subentry_id, manager in entry.runtime_data.managers.items():
        subentry = entry.subentries[subentry_id]
        widgets.append(
            {
                "subentry_id": subentry_id,
                "kind": subentry.subentry_type,
                "slug": subentry.data[CONF_SLUG],
                "name": subentry.data[CONF_NAME],
                "template": subentry.data[CONF_TEMPLATE],
                "bindings": subentry.data.get(CONF_BINDINGS, {}),
                "available": manager.available,
                "status": manager.status.value,
                "last_pushed": (
                    manager.last_pushed.isoformat() if manager.last_pushed else None
                ),
                "last_error": manager.last_error,
                # The required field with no value, while the status is
                # waiting; when a change the throttle holds goes out.
                "waiting": (
                    manager.waiting.as_dict() if manager.waiting is not None else None
                ),
                "held": manager.held.as_row() if manager.held is not None else None,
            }
        )
    runtime = entry.runtime_data
    inactive = runtime.inactive
    status = runtime.subscription
    return {
        "entry": async_redact_data(dict(entry.data), TO_REDACT),
        "subscription": {
            "state": status.state.value,
            "expires_at": _iso(status.expires_at),
            "renews": status.renews,
            "expired_at": _iso(status.expired_at),
            "paused": inactive is not None,
            "code": inactive.code if inactive else None,
        },
        "widgets": widgets,
        "stream": runtime.stream_status(),
        "recent_inputs": runtime.inputs.log.rows(),
        "recent_pushes": runtime.inputs.pushes.rows(),
        "keep_log": runtime.inputs.kept,
    }


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment is not None else None
