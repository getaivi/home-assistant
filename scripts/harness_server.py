"""Serve the panel harness, with previews and saves from the integration.

The harness (``frontend/harness/``) fakes everything Home Assistant gives the
panel, except the commands that need the integration's own logic:
``aivi/preview``, ``aivi/save`` and ``aivi/defaults`` are POSTed to
``/engine`` here and run through the real WebSocket handlers, over a test
Home Assistant holding the harness's entity states, devices, areas, recorded
history and Energy dashboard (``frontend/harness/sample-data.json``).

Usage: ``make harness`` (``--port`` to pick the port, 0 for any).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import voluptuous as vol
from aiohttp import web
from homeassistant.components.energy.data import async_get_manager
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_test_home_assistant,
)

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "frontend" / "harness" / "sample-data.json"

sys.path.insert(0, str(ROOT))

from custom_components.aivi import history, websocket  # noqa: E402
from custom_components.aivi.const import DOMAIN  # noqa: E402

ENTRY_ID = "acc1"
HANDLERS = {
    "aivi/preview": websocket.ws_preview,
    "aivi/save": websocket.ws_save,
    "aivi/defaults": websocket.ws_defaults,
    "aivi/suggest/starters": websocket.ws_suggest_starters,
}


class _Reply:
    """The slice of a WebSocket connection a handler answers through."""

    user = SimpleNamespace(is_admin=True)

    def __init__(self) -> None:
        self.answer: asyncio.Future[dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )

    def send_result(self, _id: int, result: Any = None) -> None:
        self.answer.set_result({"result": result})

    def send_error(self, _id: int, code: str, message: str) -> None:
        self.answer.set_result({"error": {"code": code, "message": message}})

    def async_handle_exception(self, _msg: dict[str, Any], err: Exception) -> None:
        self.answer.set_exception(err)


class Engine:
    """Answers the harness's engine commands with the real handlers."""

    def __init__(self, hass: HomeAssistant, entry: MockConfigEntry) -> None:
        self._hass = hass
        self._entry = entry

    async def answer(self, msg: dict[str, Any]) -> dict[str, Any]:
        """``{"result": ...}`` or ``{"error": {"code", "message"}}``. A save
        is validated and stored the way the integration would store it,
        then dropped: the harness keeps its own account, so the result is
        the stored bindings."""
        handler = HANDLERS[msg["type"]]
        try:
            # The schema the websocket_command decorator attached.
            msg = handler._ws_schema({**msg, "id": 1})  # noqa: SLF001
        except vol.Invalid as err:
            return {"error": {"code": "invalid_format", "message": str(err)}}
        if msg["type"] == "aivi/save":
            msg = {**msg, "entry_id": ENTRY_ID}
            msg.pop("subentry_id", None)
        reply = _Reply()
        handler(self._hass, reply, msg)
        out = await reply.answer
        if msg["type"] == "aivi/save" and "result" in out:
            subentry_id = out["result"]["subentry_id"]
            stored = self._entry.subentries[subentry_id].data
            self._hass.config_entries.async_remove_subentry(self._entry, subentry_id)
            out = {"result": {"bindings": stored["bindings"]}}
        return out


@asynccontextmanager
async def engine(*, started: float | None = None) -> Any:
    """A test Home Assistant with the harness's data, wrapped in an Engine.
    The entities reported ``reported`` minutes before ``started`` (now,
    unless a recording needs the same moments every run)."""
    data = json.loads(SAMPLES.read_text(encoding="utf-8"))

    async def recorded(_hass: HomeAssistant, query: Any, _now: Any) -> Any:
        return data["history"].get(f"{query.kind}:{query.entity_id}")

    history.async_fetch = recorded
    async with async_test_home_assistant() as hass:
        areas, entities = ar.async_get(hass), er.async_get(hass)
        entry = MockConfigEntry(domain=DOMAIN, entry_id=ENTRY_ID)
        entry.add_to_hass(hass)
        for device_id, device in data["devices"].items():
            # Named the way an integration with has_entity_name names them:
            # the device's name, then the entity's own (none for its main
            # entity).
            found = dr.async_get(hass).async_get_or_create(
                config_entry_id=entry.entry_id,
                identifiers={("harness", device_id)},
                name=device["name"],
            )
            for entity_id, name in device["entities"].items():
                domain, object_id = entity_id.split(".")
                entities.async_get_or_create(
                    domain,
                    "harness",
                    object_id,
                    suggested_object_id=object_id,
                    device_id=found.id,
                    has_entity_name=True,
                    original_name=name,
                )
        for entity_id, area in data["areas"].items():
            domain, object_id = entity_id.split(".")
            entities.async_get_or_create(
                domain, "harness", object_id, suggested_object_id=object_id
            )
            found = areas.async_get_area_by_name(area) or areas.async_create(area)
            entities.async_update_entity(entity_id, area_id=found.id)
        if started is None:
            started = time.time()
        for entity_id, state in data["states"].items():
            ago = data.get("reported", {}).get(entity_id, 0)
            hass.states.async_set(
                entity_id,
                state["state"],
                state["attributes"],
                timestamp=started - ago * 60,
            )
        hass.config.currency = data["currency"]
        energy = await async_get_manager(hass)
        sources = data["energy_sources"]
        energy.data = {"energy_sources": sources, "device_consumption": []}
        yield Engine(hass, entry)
        await hass.async_stop(force=True)


async def serve(port: int) -> None:
    async with engine() as answers:

        async def handle(request: web.Request) -> web.Response:
            return web.json_response(await answers.answer(await request.json()))

        app = web.Application()
        app.router.add_post("/engine", handle)
        app.router.add_static("/", ROOT)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", port)
        await site.start()
        bound = runner.addresses[0][1]
        print(f"http://127.0.0.1:{bound}/frontend/harness/index.html", flush=True)
        await asyncio.Event().wait()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8777)
    with suppress(KeyboardInterrupt):
        asyncio.run(serve(parser.parse_args().port))


if __name__ == "__main__":
    main()
