"""One account entry's runtime: a manager per binding, started, replaced
and stopped in place as the entry's subentries change."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping
from functools import partial
from typing import Any, cast

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from ..api import AiviClient, AiviSubscriptionError, SubscriptionStatus
from ..commands import CommandStream
from ..const import (
    CONF_BASE_URL,
    CONF_NAME,
    CONF_SLUG,
    CONF_TEMPLATE,
    CONF_TOKEN,
    DEFAULT_BASE_URL,
    DOMAIN,
    SUBENTRY_ACTIVITY,
)
from ..engine import Blocker
from ..inputs import AccountInputs, account_inputs
from ..push import PushManager, PushStatus
from ..pushes import PushAttempt, PushRecord
from ..switchboard import STATE_TEXT_RETRY_SECONDS, StateTextSupport
from ..templates import registry_for
from ..wire import StreamStatus
from .binding import (
    Binding,
    async_end_activity,
    binding_content,
    binding_model,
    pressable_managers,
    registered_device,
    signal_binding_changed,
)
from .delivery import delivery_for
from .issues import (
    HEALED_BY_SUCCESS,
    MISSING_KINDS,
    issue_id,
    prune_stale_issues,
    report,
)
from .stream import AccountStream
from .subscription import Subscription

_LOGGER = logging.getLogger(__name__)

#: An account's config entry, which holds its ``AiviRuntime`` while loaded.
type AiviConfigEntry = ConfigEntry[AiviRuntime]


def account_of(entry: AiviConfigEntry) -> tuple[str, str]:
    """The entry data a runtime is built from; any change needs a reload."""
    return cast(
        "tuple[str, str]",
        (entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL), entry.data[CONF_TOKEN]),
    )


class AiviRuntime:
    """One account entry's managers and event stream."""

    def __init__(
        self, hass: HomeAssistant, entry: AiviConfigEntry, client: AiviClient
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._client = client
        self.account = account_of(entry)
        # Unsupported templates included, which get no manager.
        self.bindings: dict[str, Binding] = {}
        # Recent records and stream health, kept across reloads.
        self.inputs: AccountInputs = account_inputs(hass, entry.entry_id)
        self._lock = asyncio.Lock()
        self._checking: asyncio.Task[bool] | None = None
        self._listeners: list[Callable[[], None]] = []
        self._subscription = Subscription(
            hass, entry, self.async_check_subscription, self._notify
        )
        self._stream = AccountStream(
            hass,
            entry,
            client,
            self.bindings,
            self.inputs,
            on_subscription_inactive=self.async_subscription_inactive,
        )
        self._cancel_offer: Callable[[], None] | None = None
        # Whether Aivi takes custom state words: one answer per account,
        # taken from the outcome of its switchboards' pushes.
        self.state_text = StateTextSupport(
            lambda: dt_util.utcnow().timestamp(), self._offer_words_again
        )

    @property
    def managers(self) -> dict[str, PushManager]:
        """The running managers, by subentry id."""
        return {
            subentry_id: binding.manager
            for subentry_id, binding in self.bindings.items()
            if binding.manager is not None
        }

    @property
    def inactive(self) -> AiviSubscriptionError | None:
        """Set while the account has no active subscription."""
        return self._subscription.inactive

    @property
    def subscription(self) -> SubscriptionStatus:
        """The account's subscription, as Aivi last answered for it."""
        return self._subscription.status

    @callback
    def add_listener(self, update: Callable[[], None]) -> Callable[[], None]:
        """Call ``update`` when the subscription, or any binding's status,
        changes, and when bindings come or go."""
        self._listeners.append(update)
        return lambda: self._listeners.remove(update)

    @callback
    def _notify(self) -> None:
        for update in list(self._listeners):
            update()

    @property
    def commands(self) -> CommandStream | None:
        """The account's event stream, while it runs."""
        return self._stream.commands

    @property
    def accepts_input(self) -> bool:
        """Whether any binding of the account accepts input."""
        return self._stream.accepts_input

    def stream_status(self) -> StreamStatus | None:
        """How the account's event stream stands; ``None`` while no
        binding accepts input."""
        return self._stream.status(self.inactive)

    async def async_start(
        self,
        known: Mapping[str, set[str] | None],
        subscription: SubscriptionStatus,
        inactive: AiviSubscriptionError | None = None,
    ) -> None:
        """Start every binding. ``known`` holds the slugs Aivi listed per
        kind (``None``: not listed), so a missing one is reported before
        its first push. ``subscription`` is what setup found; while it is
        not active (or ``inactive``, a refusal of setup's listing, says so)
        the bindings start paused."""
        async with self._lock:
            if inactive is None:
                inactive = subscription.refusal()
                if inactive is None:
                    self._subscription.renewed(subscription)
            if inactive is not None:
                self._subscription.lapsed(inactive)
            for subentry_id, subentry in self._bindings().items():
                binding = self.bindings[subentry_id] = Binding(subentry)
                self._add(binding, known.get(subentry.subentry_type))
            await self._sync_stream()
            self.inputs.changed()

    async def async_stop(self) -> None:
        async with self._lock:
            if self._cancel_offer is not None:
                self._cancel_offer()
                self._cancel_offer = None
            self._subscription.stop()
            for subentry_id, binding in self.bindings.items():
                manager = binding.stop()
                if (
                    manager is not None
                    and binding.kind == SUBENTRY_ACTIVITY
                    and manager.last_content is not None
                ):
                    self.inputs.last_content[subentry_id] = manager.last_content
            if self.commands is not None:
                await self.commands.async_stop()
            self.inputs.changed()

    async def async_reconcile(self) -> None:
        """Bring the managers in line with the entry's subentries, touching
        only the bindings that were added, changed or removed."""
        async with self._lock:
            current = self._bindings()
            for subentry_id in [s for s in self.bindings if s not in current]:
                binding = self.bindings.pop(subentry_id)
                manager = binding.stop()
                if manager is not None and binding.kind == SUBENTRY_ACTIVITY:
                    self._end_activity(binding.data, manager.last_content)
            changed: list[str] = []
            for subentry_id, subentry in current.items():
                binding = self.bindings.get(subentry_id)
                if binding is None:
                    binding = self.bindings[subentry_id] = Binding(subentry)
                    self._add(binding, None)
                    if binding.manager is not None:
                        changed.append(subentry_id)
                    continue
                built = (binding.kind, binding.data)
                if built == (subentry.subentry_type, subentry.data):
                    continue
                before = binding.capabilities
                previous = binding.stop()
                binding.kind, binding.data = subentry.subentry_type, subentry.data
                same_slug = (
                    built[0] == binding.kind and built[1][CONF_SLUG] == binding.slug
                )
                self._add(binding, None, previous if same_slug else None)
                self._update_device(subentry)
                binding.notify()
                if binding.capabilities != before:
                    changed.append(subentry_id)
            prune_stale_issues(self._hass)
            await self._sync_stream()
            self.inputs.changed()
        self._notify()
        for subentry_id in changed:
            async_dispatcher_send(
                self._hass, signal_binding_changed(self._entry.entry_id), subentry_id
            )

    @callback
    def async_subscription_inactive(self, err: AiviSubscriptionError) -> None:
        """Aivi refused a call for the subscription: pause everything."""
        if self._subscription.lapsed(err):
            self._pause()

    @callback
    def _pause(self) -> None:
        for manager in self.managers.values():
            manager.async_pause()
        if self.commands is not None:
            self._entry.async_create_task(
                self._hass, self._async_stop_stream(), "aivi stop stream"
            )
        self.inputs.changed()

    async def async_check_subscription(self) -> bool:
        """Ask Aivi whether the account is subscribed, resuming or pausing
        to match. Errors other than an inactive subscription are raised.
        Callers that ask at the same time share one request."""
        if self._checking is None or self._checking.done():
            self._checking = self._hass.async_create_task(
                self._async_check_subscription(), "aivi subscription check"
            )
        return await asyncio.shield(self._checking)

    async def _async_check_subscription(self) -> bool:
        try:
            status = await self._client.get_subscription()
        except AiviSubscriptionError as err:
            self.async_subscription_inactive(err)
            return False
        if (err := status.refusal()) is not None:
            if self._subscription.lapsed(err, status):
                self._pause()
            return False
        await self.async_subscription_active(status)
        return True

    async def async_subscription_active(
        self, status: SubscriptionStatus | None = None
    ) -> None:
        """Aivi answered a call (``status``: ``GET /account`` did): resume
        if the account was paused."""
        async with self._lock:
            if self.inactive is None:
                if status is not None:
                    self._subscription.renewed(status)
                return
            self._subscription.renewed(status)
            _LOGGER.info(
                "The Aivi subscription for %s is active again; resuming pushes",
                self._entry.title,
            )
            for manager in self.managers.values():
                manager.async_resume()
            await self._sync_stream()
            self.inputs.changed()

    @callback
    def async_listed(self, kind: str, slugs: set[str]) -> None:
        """Aivi just listed what the account holds of ``kind`` (the panel
        asked): the API sends no notification when something is created or deleted
        in the app, so this is when a deleted widget is noticed without
        waiting for its next push, and when one that is back stops being
        reported."""
        missing_kind = MISSING_KINDS[kind]
        for binding in self.bindings.values():
            if binding.kind != kind:
                continue
            if binding.slug in slugs:
                ir.async_delete_issue(
                    self._hass, DOMAIN, issue_id(missing_kind, binding.subentry_id)
                )
            else:
                report(self._hass, binding, missing_kind)

    def _bindings(self) -> dict[str, ConfigSubentry]:
        return {
            subentry_id: subentry
            for subentry_id, subentry in self._entry.subentries.items()
            if subentry.subentry_type in MISSING_KINDS
        }

    @callback
    def _add(
        self,
        binding: Binding,
        known_slugs: set[str] | None,
        previous: PushManager | None = None,
    ) -> None:
        """Start the binding's manager; ``previous`` ran the same widget
        or activity and hands over what it last delivered."""
        hass = self._hass
        subentry_id = binding.subentry_id
        template_slug = cast("str", binding.data[CONF_TEMPLATE])
        template = binding.template = registry_for(hass, binding.kind).get(
            template_slug
        )
        if template is None:
            _LOGGER.warning(
                "%s %s uses template %r, which this version does not"
                " support; it will not push until the integration is updated",
                binding.kind,
                binding.slug,
                template_slug,
            )
            report(hass, binding, "unsupported_template")
            return
        ir.async_delete_issue(
            hass, DOMAIN, issue_id("unsupported_template", subentry_id)
        )

        # The status the panel was last told of, so a change reaches it
        # once (aivi/inputs/subscribe).
        shown: tuple[PushStatus, Blocker | None] | None = None

        @callback
        def _on_status() -> None:
            nonlocal shown
            # A later success (widget recreated, content fixed) withdraws
            # the repair issues; content waiting for a value is no success.
            if manager.last_error is None and manager.status is not PushStatus.WAITING:
                for issue_kind in HEALED_BY_SUCCESS:
                    ir.async_delete_issue(
                        hass, DOMAIN, issue_id(issue_kind, subentry_id)
                    )
            binding.notify()
            self._notify()
            if (now := (manager.status, manager.waiting)) != shown:
                shown = now
                self.inputs.changed()

        @callback
        def _on_record(attempt: PushAttempt) -> None:
            self.inputs.record_push(
                PushRecord.of(
                    attempt,
                    kind=binding.kind,
                    slug=binding.slug,
                    subentry_id=subentry_id,
                )
            )

        manager = binding.manager = PushManager(
            hass,
            delivery_for(hass, self._client, binding, self.state_text),
            slug=binding.slug,
            template=template,
            bindings=binding.bindings,
            on_status=_on_status,
            on_issue=partial(report, hass, binding),
            # Deduplicated by the flow manager if several bindings hit it.
            on_auth_failed=lambda: self._entry.async_start_reauth(hass),
            on_subscription_inactive=self.async_subscription_inactive,
            on_record=_on_record,
            previous=previous,
            paused=self.inactive is not None,
        )
        if known_slugs is not None and binding.slug not in known_slugs:
            report(hass, binding, MISSING_KINDS[binding.kind])
        manager.async_start()

    @callback
    def _update_device(self, subentry: ConfigSubentry) -> None:
        """Carry an edited binding's name and template onto its device."""
        registry = dr.async_get(self._hass)
        device = registered_device(registry, self._entry.entry_id, subentry.subentry_id)
        if device is not None:
            registry.async_update_device(
                device.id,
                name=subentry.data[CONF_NAME],
                model=binding_model(subentry),
            )

    @callback
    def _end_activity(
        self, data: Mapping[str, Any], last: dict[str, Any] | None
    ) -> None:
        """A removed activity binding ends its Live Activity on the phone,
        best effort, with its current content or else ``last``, what it
        last delivered; nothing is sent while the account is paused."""
        if self.inactive is not None:
            return
        content = binding_content(self._hass, SUBENTRY_ACTIVITY, data) or last
        if content is None:
            return
        slug = data[CONF_SLUG]
        # Not an entry task: it must outlive the binding's removal.
        self._hass.async_create_background_task(
            async_end_activity(self._client, slug, content),
            f"aivi end activity {slug}",
        )

    @callback
    def _offer_words_again(self) -> None:
        """Once the hour after a refusal is up, re-evaluate every
        switchboard: the words are offered again, and the send context
        (``StateTextSupport.epoch``) makes even unchanged content go."""

        @callback
        def _refresh(_now: Any) -> None:
            self._cancel_offer = None
            for manager in pressable_managers(self.bindings).values():
                manager.async_refresh()

        if self._cancel_offer is not None:
            self._cancel_offer()
        self._cancel_offer = async_call_later(
            self._hass, STATE_TEXT_RETRY_SECONDS + 1, _refresh
        )

    async def _sync_stream(self) -> None:
        await self._stream.async_sync(subscribed=self.inactive is None)

    async def _async_stop_stream(self) -> None:
        async with self._lock:
            if self.inactive is not None:
                await self._stream.async_stop()
