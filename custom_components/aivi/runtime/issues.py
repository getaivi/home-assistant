"""The repair issues a binding raises, by kind and subentry."""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from ..const import (
    CONF_NAME,
    CONF_TEMPLATE,
    DOMAIN,
    SUBENTRY_ACTIVITY,
    SUBENTRY_WIDGET,
)
from .binding import Binding

#: Repair issues raised per binding subentry.
ISSUE_KINDS = (
    "widget_missing",
    "activity_missing",
    "content_rejected",
    "content_too_large",
    "unsupported_template",
    "template_mismatch",
    "activity_quota",
)

#: The subentry kinds that push, with the repair issue raised when Aivi no
#: longer has their slug.
MISSING_KINDS = {
    SUBENTRY_WIDGET: "widget_missing",
    SUBENTRY_ACTIVITY: "activity_missing",
}

#: Issues a successful push withdraws: all but a template this build
#: does not ship, which no push can fix.
HEALED_BY_SUCCESS = tuple(k for k in ISSUE_KINDS if k != "unsupported_template")


def issue_id(kind: str, subentry_id: str) -> str:
    return f"{kind}_{subentry_id}"


@callback
def report(hass: HomeAssistant, binding: Binding, kind: str) -> None:
    """Raise the binding's repair issue of ``kind``."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id(kind, binding.subentry_id),
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=kind,
        translation_placeholders={
            "name": binding.data[CONF_NAME],
            "slug": binding.slug,
            "template": binding.data.get(CONF_TEMPLATE, ""),
        },
    )


@callback
def prune_stale_issues(hass: HomeAssistant) -> None:
    """Drop repair issues whose binding subentry no longer exists (on any
    of the domain's entries: issue ids carry no entry)."""
    valid = {
        issue_id(kind, subentry_id)
        for kind in ISSUE_KINDS
        for account in hass.config_entries.async_entries(DOMAIN)
        for subentry_id in account.subentries
    }
    registry = ir.async_get(hass)
    for domain, existing in list(registry.issues):
        if (
            domain == DOMAIN
            and existing.startswith(ISSUE_KINDS)
            and existing not in valid
        ):
            ir.async_delete_issue(hass, DOMAIN, existing)
