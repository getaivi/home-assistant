"""Give the qa Home Assistant a working AI Task model, from an OpenRouter key.

    OPENROUTER_API_KEY=sk-or-... make qa

Runs as the `llm-seed` compose service (only with the key set): waits for
Home Assistant, logs in as the seeded dev user, connects Home Assistant's
own OpenRouter integration with the key, adds an AI Task model to it, and
makes that model the AI Task preference. The panel's Suggest then works
against a real model. Idempotent: a second boot leaves an existing
connection alone and only re-checks the preference.

Runs inside the Home Assistant image, which has aiohttp.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import aiohttp

HA = os.environ.get("HA_URL", "http://homeassistant:8123")
API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
# Routed to Google: OpenAI-hosted models (gpt-*) reject the structured
# output schema Home Assistant's OpenRouter integration sends, since it
# leaves out the `additionalProperties: false` OpenAI's strict mode requires
# (home-assistant/core#150294); Google and Anthropic models accept it.
MODEL = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash").strip()
USERNAME, PASSWORD = "dev", "dev"
CLIENT_ID = "http://localhost:8123/"


def log(msg: str) -> None:
    print(f"llm-seed: {msg}", flush=True)


async def wait_for_ha(session: aiohttp.ClientSession) -> None:
    for _ in range(120):
        try:
            async with session.get(f"{HA}/api/") as resp:
                if resp.status in (200, 401):
                    return
        except aiohttp.ClientError:
            pass
        await asyncio.sleep(2)
    raise SystemExit("Home Assistant did not come up")


async def login(session: aiohttp.ClientSession) -> str:
    """The OAuth code flow against the seeded dev/dev user."""
    async with session.post(
        f"{HA}/auth/login_flow",
        json={
            "client_id": CLIENT_ID,
            "handler": ["homeassistant", None],
            "redirect_uri": f"{CLIENT_ID}?auth_callback=1",
        },
    ) as resp:
        flow = await resp.json()
    async with session.post(
        f"{HA}/auth/login_flow/{flow['flow_id']}",
        json={"client_id": CLIENT_ID, "username": USERNAME, "password": PASSWORD},
    ) as resp:
        result = await resp.json()
    if result.get("type") != "create_entry":
        raise SystemExit(f"login failed: {result}")
    async with session.post(
        f"{HA}/auth/token",
        data={
            "grant_type": "authorization_code",
            "code": result["result"],
            "client_id": CLIENT_ID,
        },
    ) as resp:
        token = await resp.json()
    return str(token["access_token"])


class Api:
    def __init__(self, session: aiohttp.ClientSession, token: str) -> None:
        self._session = session
        self._headers = {"Authorization": f"Bearer {token}"}

    async def get(self, path: str) -> Any:
        async with self._session.get(f"{HA}{path}", headers=self._headers) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def delete(self, path: str) -> None:
        async with self._session.delete(f"{HA}{path}", headers=self._headers) as resp:
            resp.raise_for_status()

    async def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        async with self._session.post(
            f"{HA}{path}", headers=self._headers, json=body or {}
        ) as resp:
            data = await resp.json()
            if resp.status >= 400:
                raise SystemExit(f"POST {path} -> {resp.status}: {data}")
            return data

    async def ws(self, token: str, message: dict[str, Any]) -> Any:
        """One authenticated WebSocket command (the preferences API has no
        REST form)."""
        async with self._session.ws_connect(f"{HA}/api/websocket") as ws:
            await ws.receive_json()  # auth_required
            await ws.send_json({"type": "auth", "access_token": token})
            auth = await ws.receive_json()
            if auth.get("type") != "auth_ok":
                raise SystemExit(f"websocket auth failed: {auth}")
            await ws.send_json({"id": 1, **message})
            reply = await ws.receive_json()
            if not reply.get("success"):
                raise SystemExit(f"{message['type']} failed: {reply}")
            return reply.get("result")


async def connect_open_router(api: Api) -> str:
    """The OpenRouter config entry's id: the existing one, or a new one."""
    entries = await api.get("/api/config/config_entries/entry?domain=open_router")
    for entry in entries:
        log(f"OpenRouter already connected ({entry['title']})")
        return str(entry["entry_id"])
    flow = await api.post("/api/config/config_entries/flow", {"handler": "open_router"})
    result = await api.post(
        f"/api/config/config_entries/flow/{flow['flow_id']}", {"api_key": API_KEY}
    )
    if result.get("type") != "create_entry":
        why = result.get("errors") or result
        raise SystemExit(f"OpenRouter refused the key: {why}")
    log(f"OpenRouter connected ({result['title']})")
    return str(result["result"]["entry_id"])


async def add_ai_task_model(api: Api, token: str, entry_id: str) -> None:
    """An AI Task subentry on the OpenRouter entry for the chosen model,
    replacing one for another model (a changed OPENROUTER_MODEL)."""
    flow = await _start_model_flow(api, entry_id)
    # The form lists the models with structured outputs (Suggest needs
    # them) by id and display name; a subentry is titled with the name.
    label = _model_label(flow, MODEL)
    if label is None:
        raise SystemExit(f"{MODEL} is not offered as an AI Task model")
    subentries = await api.ws(
        token, {"type": "config_entries/subentries/list", "entry_id": entry_id}
    )
    for sub in subentries:
        if sub.get("subentry_type") != "ai_task_data":
            continue
        if sub["title"] == label:
            log(f"AI Task model already there ({label})")
            await _abandon_flow(api, flow)
            return
        log(f"replacing the AI Task model {sub['title']} with {label}")
        await api.ws(
            token,
            {
                "type": "config_entries/subentries/delete",
                "entry_id": entry_id,
                "subentry_id": sub["subentry_id"],
            },
        )
        # Dropping a subentry reloads the entry, and a flow started before
        # that aborts with entry_not_loaded: start over once it is back.
        await _abandon_flow(api, flow)
        await _wait_loaded(api, entry_id)
        flow = await _start_model_flow(api, entry_id)
    result = await api.post(
        f"/api/config/config_entries/subentries/flow/{flow['flow_id']}",
        {"model": MODEL},
    )
    if result.get("type") != "create_entry":
        raise SystemExit(f"could not add the model {MODEL}: {result}")
    log(f"AI Task model added ({result['title']})")


async def _start_model_flow(api: Api, entry_id: str) -> dict[str, Any]:
    flow = await api.post(
        "/api/config/config_entries/subentries/flow",
        {"handler": [entry_id, "ai_task_data"]},
    )
    if flow.get("type") == "abort":
        raise SystemExit(f"AI Task model flow aborted: {flow.get('reason')}")
    return flow


async def _abandon_flow(api: Api, flow: dict[str, Any]) -> None:
    await api.delete(f"/api/config/config_entries/subentries/flow/{flow['flow_id']}")


async def _wait_loaded(api: Api, entry_id: str) -> None:
    for _ in range(30):
        entries = await api.get("/api/config/config_entries/entry?domain=open_router")
        if any(e["entry_id"] == entry_id and e["state"] == "loaded" for e in entries):
            return
        await asyncio.sleep(1)
    raise SystemExit("the OpenRouter entry did not reload")


def _model_label(form: dict[str, Any], model: str) -> str | None:
    """The display name the form gives `model`, or None when not offered."""
    for field in form.get("data_schema") or []:
        if field.get("name") != "model":
            continue
        select = (field.get("selector") or {}).get("select") or {}
        for option in select.get("options") or []:
            if isinstance(option, dict) and option.get("value") == model:
                return str(option.get("label", model))
            if option == model:
                return model
    return None


async def prefer_it(api: Api, token: str) -> None:
    """Make the OpenRouter AI Task entity the preference, once it exists."""
    entity_id: str | None = None
    for _ in range(30):
        states = await api.get("/api/states")
        ids = [s["entity_id"] for s in states if s["entity_id"].startswith("ai_task.")]
        if ids:
            entity_id = ids[0]
            break
        await asyncio.sleep(1)
    if not entity_id:
        raise SystemExit("no ai_task entity appeared")
    prefs = await api.ws(token, {"type": "ai_task/preferences/get"})
    if prefs.get("gen_data_entity_id") == entity_id:
        log(f"AI Task preference already {entity_id}")
        return
    await api.ws(
        token, {"type": "ai_task/preferences/set", "gen_data_entity_id": entity_id}
    )
    log(f"AI Task preference set to {entity_id}: Suggest is ready")


async def main() -> int:
    if not API_KEY:
        log("OPENROUTER_API_KEY not set; nothing to do")
        return 0
    async with aiohttp.ClientSession() as session:
        await wait_for_ha(session)
        token = await login(session)
        api = Api(session, token)
        entry_id = await connect_open_router(api)
        await add_ai_task_model(api, token, entry_id)
        await prefer_it(api, token)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except SystemExit as err:
        if err.code not in (0, None):
            log(str(err.code))
            raise SystemExit(1) from None
        raise
    except json.JSONDecodeError as err:
        log(f"unexpected answer from Home Assistant: {err}")
        raise SystemExit(1) from None
