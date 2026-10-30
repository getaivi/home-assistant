"""The account's event stream as the runtime runs it: open while a binding
accepts input and the account is subscribed, routed by the bindings as
they are, with each record attributed to its binding and each played press
acknowledged by the widget or Live Activity it came from."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import datetime
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from ..api import AiviClient, AiviSubscriptionError
from ..commands import CommandStream, async_stream_cursor
from ..inputs import AccountInputs, InputEvent, InputRecord
from ..sources import DegradingResolver
from ..switchboard import tile_label, toggle_answers
from .binding import Binding, pressable_managers

if TYPE_CHECKING:
    from ..wire import StreamState, StreamStatus

#: Why an account's event stream is not connected, when it is for good.
REASON_SUBSCRIPTION = "subscription_inactive"
REASON_AUTH = "auth_failed"


class AccountStream:
    """One account's event stream, started and stopped as its bindings and
    its subscription change. ``bindings`` is the runtime's own mapping."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: AiviClient,
        bindings: Mapping[str, Binding],
        inputs: AccountInputs,
        *,
        on_subscription_inactive: Callable[[AiviSubscriptionError], None],
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._client = client
        self._bindings = bindings
        self._inputs = inputs
        self._on_subscription_inactive = on_subscription_inactive
        self.commands: CommandStream | None = None

    @property
    def accepts_input(self) -> bool:
        """Whether any binding of the account accepts input."""
        return any(binding.accepts_input for binding in self._bindings.values())

    def status(self, inactive: AiviSubscriptionError | None) -> StreamStatus | None:
        """How the stream stands; ``None`` while no binding accepts
        input. ``inactive`` is set while the account is not subscribed."""
        if not self.accepts_input:
            return None
        health = self._inputs.health
        reason: str | None = None
        state: StreamState
        if inactive is not None:
            state, reason = "paused", REASON_SUBSCRIPTION
        elif health.ended:
            state, reason = "stopped", REASON_AUTH
        elif health.connected:
            state = "connected"
        else:
            state = "reconnecting"
        connected = state == "connected"
        return {
            "state": state,
            "connected": connected,
            "reason": reason,
            "last_error": str(inactive) if inactive is not None else health.last_error,
            "connected_since": _iso(health.connected_since) if connected else None,
            "last_event": _iso(health.last_event),
            "reconnects": health.reconnects,
        }

    async def async_sync(self, *, subscribed: bool) -> None:
        """Run the stream while a binding accepts input and the account
        is subscribed, with the current routing."""
        if not self.accepts_input or not subscribed:
            await self.async_stop()
            return
        routing = {
            b.resource: b.routes()
            for b in self._bindings.values()
            if b.pressable and b.manager is not None
        }
        if self.commands is not None:
            self.commands.set_routes(routing)
            return
        cursor, store = await async_stream_cursor(self._hass, self._entry.entry_id)
        self.commands = CommandStream(
            self._hass,
            self._client,
            routes=routing,
            entry_id=self._entry.entry_id,
            cursor=cursor,
            store=store,
            on_played=self._on_played,
            on_auth_failed=lambda: self._entry.async_start_reauth(self._hass),
            on_subscription_inactive=self._on_subscription_inactive,
            on_record=self._on_record,
            health=self._inputs.health,
        )
        self.commands.async_start()

    async def async_stop(self) -> None:
        if self.commands is not None:
            stream, self.commands = self.commands, None
            await stream.async_stop()

    @callback
    def _on_record(self, record: InputRecord) -> None:
        """A record from the stream: attributed to its binding, kept for
        the panel, and handed to the binding's listeners."""
        binding = next(
            (
                b
                for b in self._bindings.values()
                if b.accepts_input
                and (b.kind, b.slug) == (record.resource_kind, record.slug)
            ),
            None,
        )
        declared: InputEvent | None = (
            binding.template.input_event(record.event_type)
            if binding is not None and binding.template is not None
            else None
        )
        details = dict(record.details)
        if binding is not None and record.entity_id is not None:
            # The action's label as the device shows it.
            details["label"] = tile_label(
                binding.template,
                binding.bindings,
                record.entity_id,
                DegradingResolver(self._hass),
            )
        record = replace(
            record,
            subentry_id=binding.subentry_id if binding is not None else None,
            recorded=declared.recorded if declared is not None else True,
            details=details,
        )
        self._inputs.append(record)
        if binding is not None:
            binding.record(record)

    @callback
    def _on_played(
        self, resource: tuple[str, str], entity_id: str, value: bool | None
    ) -> None:
        """A press was played back. A button is acknowledged by one
        publish, identical or not; a toggle's answer goes out even if the
        entity was already in the requested state."""
        if (manager := pressable_managers(self._bindings).get(resource)) is None:
            return
        if value is None:
            manager.expect(lambda: True)
            return

        def _answered() -> bool:
            state = self._hass.states.get(entity_id)
            return state is not None and toggle_answers(entity_id, state.state, value)

        manager.expect(_answered)


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat() if moment is not None else None
