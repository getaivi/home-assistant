"""Input from the phone, and what became of it.

A binding accepts input when its template declares input event types
(``TemplateDef.inputs``). Each type is either *recorded* (the binding's
event entity fires and the logbook shows it) or *play-only* (played back
like any other, but shown only in the panel's recent list, coalesced).

Every event the command stream handles ends as one ``InputRecord`` with
its outcome. An account keeps its latest records in a bounded log, the
pushes that went the other way in another (``pushes.py``), and the health
of its event stream in ``StreamHealth``; all three live in
``AccountInputs``, which outlives entry reloads so the panel's view of an
account does not reset when its runtime is rebuilt.

Both logs live in memory and start over when Home Assistant restarts.
An account's "keep the activity log across restarts" option writes them
to a ``Store`` instead: debounced, so a chatty sensor costs one write per
quiet spell rather than one per push, and flushed when Home Assistant
stops. Off by default, since many installs run from an SD card.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey

from .const import CONF_KEEP_LOG, DOMAIN
from .pushes import PushLog, PushRecord

if TYPE_CHECKING:
    from .wire import PressRow

#: Records an account keeps for the panel.
RECENT_LIMIT: Final = 50

_STORAGE_VERSION: Final = 1
#: Log writes are coalesced to one per this many seconds of quiet.
SAVE_DELAY: Final = 30.0


@dataclass(frozen=True, slots=True)
class InputEvent:
    """An input event type a template declares."""

    type: str
    #: Recorded types fire the event entity and reach the logbook;
    #: play-only types are only listed, coalesced, in the panel.
    recorded: bool = True


class Outcome(StrEnum):
    """What became of one event."""

    PLAYED = "played"
    EXPIRED = "expired"
    NOT_BOUND = "not_bound"
    IGNORED = "ignored"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class InputRecord:
    """One event from the stream and its outcome."""

    event_type: str
    #: The subject's kind and slug (``widget``, ``porch``).
    resource_kind: str
    slug: str
    outcome: Outcome
    received_at: datetime
    finished_at: datetime
    #: Template-specific facts: for a tile press the action id, the
    #: requested value and the tile's label.
    details: Mapping[str, Any] = field(default_factory=dict)
    entity_id: str | None = None
    error: str | None = None
    event_id: str | None = None
    request_id: str | None = None
    context: Context | None = None
    #: Set by the runtime: the binding the event was for, if bound here,
    #: and whether its type is recorded.
    subentry_id: str | None = None
    recorded: bool = True
    #: Play-only records coalesce: how many this one stands for.
    count: int = 1

    @property
    def coalesce_key(self) -> tuple[Any, ...]:
        return (
            self.subentry_id,
            self.slug,
            self.event_type,
            self.entity_id,
            self.outcome,
        )

    def entity_attributes(self) -> dict[str, Any]:
        """The attributes the event entity fires with."""
        attributes = {
            key: value for key, value in self.details.items() if value is not None
        }
        if self.entity_id is not None:
            attributes["entity_id"] = self.entity_id
        if self.event_id is not None:
            attributes["event_id"] = self.event_id
        if self.request_id is not None:
            attributes["request_id"] = self.request_id
        return attributes

    def as_row(self) -> PressRow:
        """The record as the panel lists it."""
        return {
            "id": self.event_id,
            "time": self.finished_at.isoformat(),
            "received_at": self.received_at.isoformat(),
            "kind": self.resource_kind,
            "slug": self.slug,
            "subentry_id": self.subentry_id,
            "event_type": self.event_type,
            "entity_id": self.entity_id,
            "label": self.details.get("label"),
            "value": self.details.get("value"),
            "outcome": self.outcome.value,
            "error": self.error,
            "recorded": self.recorded,
            "count": self.count,
        }

    def as_stored(self) -> dict[str, Any]:
        """The record as the activity store keeps it: everything the row
        shows, plus what the row derives from (the details)."""
        return {
            "event_type": self.event_type,
            "resource_kind": self.resource_kind,
            "slug": self.slug,
            "outcome": self.outcome.value,
            "received_at": self.received_at.isoformat(),
            "finished_at": self.finished_at.isoformat(),
            "details": dict(self.details),
            "entity_id": self.entity_id,
            "error": self.error,
            "event_id": self.event_id,
            "request_id": self.request_id,
            "subentry_id": self.subentry_id,
            "recorded": self.recorded,
            "count": self.count,
        }

    @classmethod
    def from_stored(cls, data: Any) -> InputRecord | None:
        """A record back from the store; ``None`` for one that does not
        read, which is dropped rather than failing the load."""
        if not isinstance(data, Mapping):
            return None
        try:
            received = dt_util.parse_datetime(str(data["received_at"]))
            finished = dt_util.parse_datetime(str(data["finished_at"]))
            if received is None or finished is None:
                return None
            details = data.get("details")
            return cls(
                event_type=str(data["event_type"]),
                resource_kind=str(data["resource_kind"]),
                slug=str(data["slug"]),
                outcome=Outcome(data["outcome"]),
                received_at=received,
                finished_at=finished,
                details=dict(details) if isinstance(details, Mapping) else {},
                entity_id=_opt_str(data.get("entity_id")),
                error=_opt_str(data.get("error")),
                event_id=_opt_str(data.get("event_id")),
                request_id=_opt_str(data.get("request_id")),
                subentry_id=_opt_str(data.get("subentry_id")),
                recorded=bool(data.get("recorded", True)),
                count=max(int(data.get("count", 1)), 1),
            )
        except (KeyError, ValueError, TypeError):
            return None


def _opt_str(value: Any) -> str | None:
    return str(value) if value is not None else None


class InputLog:
    """An account's latest records, newest last. A play-only record that
    repeats the newest one is folded into it."""

    def __init__(self, limit: int = RECENT_LIMIT) -> None:
        self._records: deque[InputRecord] = deque(maxlen=limit)

    def append(self, record: InputRecord) -> None:
        if (
            not record.recorded
            and self._records
            and not (last := self._records[-1]).recorded
            and last.coalesce_key == record.coalesce_key
        ):
            self._records[-1] = replace(
                record, received_at=last.received_at, count=last.count + 1
            )
            return
        self._records.append(record)

    def rows(self, subentry_id: str | None = None) -> list[PressRow]:
        """Newest first, optionally only one binding's."""
        return [
            record.as_row()
            for record in reversed(self._records)
            if subentry_id is None or record.subentry_id == subentry_id
        ]

    def __len__(self) -> int:
        return len(self._records)

    def records(self) -> list[InputRecord]:
        """Oldest first."""
        return list(self._records)

    def restore(self, records: list[InputRecord]) -> None:
        """Fill an empty log from stored records (oldest first)."""
        if self._records:
            return
        self._records.extend(records)


@dataclass(slots=True)
class StreamHealth:
    """How an account's event stream stands, kept across stream restarts."""

    connected: bool = False
    connected_since: datetime | None = None
    last_error: str | None = None
    last_event: datetime | None = None
    opens: int = 0
    #: The stream ended for good (a rejected token) until the entry reloads.
    ended: bool = False
    on_change: Callable[[], None] | None = None

    @property
    def reconnects(self) -> int:
        return max(self.opens - 1, 0)

    @callback
    def update(self, **changes: Any) -> None:
        """Apply the changes; listeners are called only if one took effect."""
        changed = False
        for name, value in changes.items():
            if getattr(self, name) != value:
                setattr(self, name, value)
                changed = True
        if changed and self.on_change is not None:
            self.on_change()


class ActivityStore:
    """One account's activity log on disk, for the accounts that opt in.
    Writes are delayed and coalesced; Home Assistant flushes a pending
    one when it stops."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, _STORAGE_VERSION, _storage_key(entry_id)
        )

    async def async_load(self) -> tuple[list[InputRecord], list[PushRecord]]:
        data = await self._store.async_load()
        if not isinstance(data, dict):
            return [], []
        presses = [
            record
            for item in data.get("presses") or []
            if (record := InputRecord.from_stored(item)) is not None
        ]
        pushes = [
            record
            for item in data.get("pushes") or []
            if (record := PushRecord.from_stored(item)) is not None
        ]
        return presses, pushes

    @callback
    def schedule(self, data: Callable[[], dict[str, Any]]) -> None:
        """Write ``data()`` once the logs have been quiet for a while."""
        self._store.async_delay_save(data, SAVE_DELAY)

    async def async_remove(self) -> None:
        await self._store.async_remove()


def _storage_key(entry_id: str) -> str:
    return f"{DOMAIN}.{entry_id}.activity"


class AccountInputs:
    """One account's recent records (in and out), stream health and
    listeners."""

    def __init__(self) -> None:
        self.log = InputLog()
        self.pushes = PushLog()
        self.health = StreamHealth(on_change=self.changed)
        # What each Live Activity last delivered, by subentry id, kept when
        # the runtime stops: removing the account ends the activities with
        # it when their content does not resolve. In memory only.
        self.last_content: dict[str, dict[str, Any]] = {}
        self._listeners: list[Callable[[], None]] = []
        # Set while the account keeps its logs across restarts.
        self._store: ActivityStore | None = None
        # Whether the store was read since Home Assistant started: it is
        # read once, so a reload never doubles what is already here.
        self._loaded = False

    @property
    def kept(self) -> bool:
        """Whether the logs are written to disk."""
        return self._store is not None

    async def async_keep(self, hass: HomeAssistant, entry_id: str, keep: bool) -> None:
        """Keep the logs across restarts, or stop keeping them (which
        removes what was written)."""
        if keep:
            if self._store is not None:
                return
            store = ActivityStore(hass, entry_id)
            if not self._loaded:
                presses, pushes = await store.async_load()
                self.log.restore(presses)
                self.pushes.restore(pushes)
                self._loaded = True
            self._store = store
            # What is in memory now is kept too, not only what comes next.
            if len(self.log) or len(self.pushes):
                store.schedule(self.as_stored)
            self.changed()
            return
        if self._store is None:
            return
        store, self._store = self._store, None
        await store.async_remove()
        self.changed()

    def as_stored(self) -> dict[str, Any]:
        return {
            "presses": [record.as_stored() for record in self.log.records()],
            "pushes": [record.as_stored() for record in self.pushes.records()],
        }

    @callback
    def add_listener(self, update: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(update)

        @callback
        def _remove() -> None:
            if update in self._listeners:
                self._listeners.remove(update)

        return _remove

    @callback
    def append(self, record: InputRecord) -> None:
        self.log.append(record)
        self._logged()

    @callback
    def record_push(self, record: PushRecord) -> None:
        self.pushes.append(record)
        self._logged()

    @callback
    def _logged(self) -> None:
        if self._store is not None:
            self._store.schedule(self.as_stored)
        self.changed()

    @callback
    def changed(self) -> None:
        for update in list(self._listeners):
            update()


DATA_ACCOUNT_INPUTS: HassKey[dict[str, AccountInputs]] = HassKey(
    f"{DOMAIN}_account_inputs"
)


@callback
def account_inputs(hass: HomeAssistant, entry_id: str) -> AccountInputs:
    """The entry's inputs, created on first use and kept across reloads."""
    return hass.data.setdefault(DATA_ACCOUNT_INPUTS, {}).setdefault(
        entry_id, AccountInputs()
    )


async def async_apply_log_option(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Keep the entry's logs across restarts as its option says."""
    await account_inputs(hass, entry.entry_id).async_keep(
        hass, entry.entry_id, bool(entry.options.get(CONF_KEEP_LOG, False))
    )


async def async_forget_account_inputs(hass: HomeAssistant, entry_id: str) -> None:
    """Drop a removed entry's logs, in memory and on disk."""
    hass.data.get(DATA_ACCOUNT_INPUTS, {}).pop(entry_id, None)
    await ActivityStore(hass, entry_id).async_remove()
