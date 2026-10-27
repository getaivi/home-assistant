"""The Aivi integration: feed Home Assistant state into Aivi widgets and Live
Activities."""

from __future__ import annotations

import asyncio

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import CoreState, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .api import (
    AiviAuthError,
    AiviError,
    AiviSubscriptionError,
    SubscriptionStatus,
    client_for,
)
from .commands import async_remove_stream_cursor
from .conflicts import async_watch as async_watch_conflicts
from .conflicts import sync_issues as sync_conflict_issues
from .const import (
    CONF_SLUG,
    DOMAIN,
    SUBENTRY_ACTIVITY,
    SUBENTRY_WIDGET,
)
from .inputs import (
    account_inputs,
    async_apply_log_option,
    async_forget_account_inputs,
)
from .panel import async_register_panel, async_remove_panel
from .runtime import (
    DATA_INACTIVE,
    AiviConfigEntry,
    AiviRuntime,
    account_of,
    async_end_activity,
    binding_content,
    prune_stale_issues,
)
from .websocket import async_register as async_register_websocket

PLATFORMS: list[Platform] = [Platform.BINARY_SENSOR, Platform.EVENT, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_register_websocket(hass)
    async_watch_conflicts(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: AiviConfigEntry) -> bool:
    await async_register_panel(hass)

    client = client_for(hass, entry)
    kinds = {subentry.subentry_type for subentry in entry.subentries.values()}
    inactive: AiviSubscriptionError | None = None
    known: dict[str, set[str] | None] = {}
    try:
        subscription = await client.get_subscription()
        # Without a subscription every listing is refused: set up paused,
        # so the panel, the repair issue and the renewal check all work.
        if subscription.active:
            known = {
                SUBENTRY_WIDGET: {
                    widget.slug for widget in await client.list_widgets()
                },
                SUBENTRY_ACTIVITY: (
                    {activity.slug for activity in await client.list_activities()}
                    if SUBENTRY_ACTIVITY in kinds
                    else None
                ),
            }
    except AiviSubscriptionError as err:
        # The subscription ended between the two calls.
        inactive = err
        subscription = SubscriptionStatus.refused(err)
    except AiviAuthError as err:
        raise ConfigEntryAuthFailed(
            translation_domain=DOMAIN, translation_key="auth_rejected"
        ) from err
    except AiviError as err:
        # The client already says "Cannot reach Aivi"; the message adds
        # that itself, so only the underlying cause goes in.
        raise ConfigEntryNotReady(
            translation_domain=DOMAIN,
            translation_key="cannot_connect",
            translation_placeholders={"error": str(err.__cause__ or err)},
        ) from err
    prune_stale_issues(hass)
    # The account's logs, read back from disk first if it keeps them.
    await async_apply_log_option(hass, entry)

    runtime = AiviRuntime(hass, entry, client)
    try:
        await runtime.async_start(known, subscription, inactive)
        entry.runtime_data = runtime
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    except BaseException:
        # A failed setup is never unloaded: stop what already runs. Not
        # Exception, so that a canceled setup (CancelledError) stops it too.
        await runtime.async_stop()
        raise
    entry.async_on_unload(runtime.async_stop)
    entry.async_on_unload(entry.add_update_listener(_async_entry_updated))
    _sync_conflicts(hass)
    return True


@callback
def _sync_conflicts(hass: HomeAssistant) -> None:
    """Bindings changed: update the issues for automations feeding the same
    slugs. Before Home Assistant has started the automations are not
    loaded yet, and the check runs once they are."""
    if hass.state is CoreState.running:
        sync_conflict_issues(hass)


async def _async_entry_updated(hass: HomeAssistant, entry: AiviConfigEntry) -> None:
    """A binding subentry was added, edited or removed (reconciled in
    place), an option changed (applied in place), or the account itself
    changed (reloaded)."""
    if account_of(entry) != entry.runtime_data.account:
        hass.config_entries.async_schedule_reload(entry.entry_id)
        return
    await async_apply_log_option(hass, entry)
    await entry.runtime_data.async_reconcile()
    _sync_conflicts(hass)


async def async_unload_entry(hass: HomeAssistant, entry: AiviConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded and not any(
        other.state is ConfigEntryState.LOADED
        for other in hass.config_entries.async_entries(DOMAIN)
        if other.entry_id != entry.entry_id
    ):
        async_remove_panel(hass)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: AiviConfigEntry) -> None:
    """End the removed account's Live Activities and drop its stored stream
    cursor and activity log. Widgets keep their last content. An activity
    whose content does not resolve is ended with what it last delivered,
    while this run of Home Assistant delivered any."""
    inactive = hass.data.get(DATA_INACTIVE, set())
    if entry.entry_id in inactive:
        inactive.discard(entry.entry_id)
    else:
        client = client_for(hass, entry)
        last = account_inputs(hass, entry.entry_id).last_content
        ending = [
            async_end_activity(client, subentry.data[CONF_SLUG], content)
            for subentry_id, subentry in entry.subentries.items()
            if subentry.subentry_type == SUBENTRY_ACTIVITY
            and (
                content := binding_content(hass, SUBENTRY_ACTIVITY, subentry.data)
                or last.get(subentry_id)
            )
            is not None
        ]
        await asyncio.gather(*ending)
    await async_remove_stream_cursor(hass, entry.entry_id)
    await async_forget_account_inputs(hass, entry.entry_id)
    _sync_conflicts(hass)


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: AiviConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Allow deleting a binding's device once its subentry is gone; the
    account's own device stays while the account does."""
    return not any(
        identifier in entry.subentries or identifier == entry.entry_id
        for domain, identifier in device.identifiers
        if domain == DOMAIN
    )


__all__ = ["AiviConfigEntry", "AiviRuntime"]
