"""Where an account's event stream resumes: the id of the last event it
received, kept across reloads and, through a ``Store``, restarts."""

from __future__ import annotations

from typing import Any, Final

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util.hass_dict import HassKey

from ..api import StreamCursor
from ..const import DOMAIN

#: The per-entry cursors and their stores, kept across reloads.
DATA_CURSORS: HassKey[dict[str, tuple[StreamCursor, CursorStore]]] = HassKey(
    f"{DOMAIN}_stream_cursors"
)

_STORAGE_VERSION: Final = 1
#: Cursor writes are coalesced to one per this many seconds, flushed on stop.
_SAVE_DELAY: Final = 10.0


def _storage_key(entry_id: str) -> str:
    return f"{DOMAIN}.{entry_id}.events"


class CursorStore:
    """One entry's stream cursor on disk, so a restart resumes the stream
    where it was. Writes are delayed and coalesced."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, _STORAGE_VERSION, _storage_key(entry_id)
        )
        self._saved: str | None = None

    async def async_load(self) -> str | None:
        data = await self._store.async_load()
        last = data.get("last_event_id") if isinstance(data, dict) else None
        self._saved = last if isinstance(last, str) and last else None
        return self._saved

    @callback
    def save(self, cursor: StreamCursor) -> None:
        """Schedule a write when the cursor moved since the last one."""
        last = cursor.last_event_id
        if last is None or last == self._saved:
            return
        self._saved = last
        self._store.async_delay_save(lambda: {"last_event_id": last}, _SAVE_DELAY)

    async def async_remove(self) -> None:
        await self._store.async_remove()


async def async_stream_cursor(
    hass: HomeAssistant, entry_id: str
) -> tuple[StreamCursor, CursorStore]:
    """The entry's stream cursor and its store: kept in memory across
    reloads, loaded from disk on the first setup after a restart."""
    cursors = hass.data.setdefault(DATA_CURSORS, {})
    if entry_id not in cursors:
        store = CursorStore(hass, entry_id)
        cursor = StreamCursor(last_event_id=await store.async_load())
        cursors[entry_id] = (cursor, store)
    return cursors[entry_id]


async def async_remove_stream_cursor(hass: HomeAssistant, entry_id: str) -> None:
    """Forget a removed entry's cursor, in memory and on disk. The cached
    store is the one that removes the file, so a write it still has
    pending is dropped rather than recreating the file afterwards."""
    cached = hass.data.get(DATA_CURSORS, {}).pop(entry_id, None)
    store = cached[1] if cached is not None else CursorStore(hass, entry_id)
    await store.async_remove()
