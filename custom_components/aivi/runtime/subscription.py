"""The account's subscription, as Aivi last answered for it.

While it is inactive one fixable repair issue says so, and Aivi is asked
again every hour. While it is active Aivi is asked every 12 hours, so the
end of the paid period and whether it renews stay current.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey

from ..api import (
    AiviAuthError,
    AiviError,
    AiviSubscriptionError,
    SubscriptionState,
    SubscriptionStatus,
)
from ..const import DOCS_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

#: How often an inactive account asks Aivi whether it was renewed.
PROBE_INTERVAL = timedelta(hours=1)
#: How often an active account asks Aivi how its subscription stands.
REFRESH_INTERVAL = timedelta(hours=12)

#: The entries whose subscription was last seen inactive, kept past their
#: runtime so that removing one does not call Aivi.
DATA_INACTIVE: HassKey[set[str]] = HassKey(f"{DOMAIN}_inactive")


def subscription_issue_id(entry_id: str) -> str:
    """The account's one repair issue for an inactive subscription."""
    return f"subscription_inactive_{entry_id}"


class Subscription:
    """Whether one account is subscribed. ``check`` asks Aivi; it is what
    the hourly probe runs while the account is inactive, and the 12-hour
    refresh while it is active. ``on_change`` is called whenever
    ``status`` changes."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        check: Callable[[], Awaitable[bool]],
        on_change: Callable[[], None],
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._check = check
        self._on_change = on_change
        self._cancel_probe: Callable[[], None] | None = None
        self._cancel_refresh: Callable[[], None] | None = None
        # Once the runtime stops, a check still in flight starts no timer.
        self._stopped = False
        # Set while the account has no active subscription.
        self.inactive: AiviSubscriptionError | None = None
        self.status = SubscriptionStatus(SubscriptionState.ACTIVE)

    @callback
    def lapsed(
        self, err: AiviSubscriptionError, status: SubscriptionStatus | None = None
    ) -> bool:
        """Aivi refused a call for the subscription, or ``status`` (from
        ``GET /account``) says it is not active. Returns whether the
        account was active until now."""
        self._set_status(status or SubscriptionStatus.refused(err))
        if self.inactive is not None:
            if err.expired_at != self.inactive.expired_at:
                self.inactive = err
                self._raise_issue()
            return False
        self.inactive = err
        self._hass.data.setdefault(DATA_INACTIVE, set()).add(self._entry.entry_id)
        _LOGGER.warning(
            "The Aivi account %s has no active subscription; pushes are paused"
            " and resume once it is renewed in the Aivi app",
            self._entry.title,
        )
        self._raise_issue()
        self._cancel_timers()
        if not self._stopped:
            self._cancel_probe = async_track_time_interval(
                self._hass, self._probe, PROBE_INTERVAL, cancel_on_shutdown=True
            )
        return True

    @callback
    def renewed(self, status: SubscriptionStatus | None = None) -> None:
        """Aivi answers for the account: it is not, or no longer, inactive.
        ``status`` is what ``GET /account`` said; without one (another
        call was answered) the details are asked for once."""
        if status is not None:
            self._set_status(status)
        elif not self.status.active:
            self._set_status(SubscriptionStatus(SubscriptionState.ACTIVE))
            self._probe(dt_util.utcnow())
        if self.inactive is None and self._cancel_refresh is not None:
            return
        self.inactive = None
        self._hass.data.setdefault(DATA_INACTIVE, set()).discard(self._entry.entry_id)
        self._withdraw()
        if not self._stopped:
            self._cancel_refresh = async_track_time_interval(
                self._hass, self._probe, REFRESH_INTERVAL, cancel_on_shutdown=True
            )

    @callback
    def stop(self) -> None:
        """Stop asking, for good."""
        self._stopped = True
        self._withdraw()

    @callback
    def _withdraw(self) -> None:
        """Stop asking, and withdraw the repair issue: its fix flow needs
        a running entry, and setup raises it again."""
        self._cancel_timers()
        ir.async_delete_issue(
            self._hass, DOMAIN, subscription_issue_id(self._entry.entry_id)
        )

    @callback
    def _cancel_timers(self) -> None:
        if self._cancel_probe is not None:
            self._cancel_probe()
            self._cancel_probe = None
        if self._cancel_refresh is not None:
            self._cancel_refresh()
            self._cancel_refresh = None

    @callback
    def _set_status(self, status: SubscriptionStatus) -> None:
        if status != self.status:
            self.status = status
            self._on_change()

    @callback
    def _raise_issue(self) -> None:
        expired_at = self.inactive.expired_at if self.inactive else None
        placeholders = {"account": self._entry.title}
        if expired_at is not None:
            placeholders["expired"] = _date(expired_at)
        ir.async_create_issue(
            self._hass,
            DOMAIN,
            subscription_issue_id(self._entry.entry_id),
            is_fixable=True,
            severity=ir.IssueSeverity.ERROR,
            translation_key="subscription_expired"
            if expired_at is not None
            else "subscription_inactive",
            translation_placeholders=placeholders,
            learn_more_url=DOCS_URL,
            data={"entry_id": self._entry.entry_id},
        )

    @callback
    def _probe(self, _now: datetime) -> None:
        self._entry.async_create_task(
            self._hass, self._async_probe(), "aivi subscription check"
        )

    async def _async_probe(self) -> None:
        try:
            await self._check()
        except AiviAuthError:
            self._entry.async_start_reauth(self._hass)
        except AiviError as err:
            _LOGGER.debug("Aivi subscription check failed: %s", err)


def _date(moment: datetime) -> str:
    """A day as the repair issue shows it, in Home Assistant's time zone."""
    return dt_util.as_local(moment).date().isoformat()
