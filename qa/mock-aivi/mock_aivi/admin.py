"""The mock-only routes: the switches under ``/admin/`` and the page
that lists recent pushes."""

from __future__ import annotations

import json
from html import escape
from typing import Any

from werkzeug.wrappers import Request, Response

from . import state
from .responses import detail, json_response


def admin(path: str, body: dict[str, Any]) -> Response:
    with state.LOCK:
        if path == "/admin/subscription":
            state.STATE["active"] = bool(body.get("active", True))
            active = state.STATE["active"]
            state.STATE["expired_at"] = None if active else body.get("expired_at")
            state.STATE["expires_at"] = body.get("expires_at") if active else None
            state.STATE["renews"] = bool(body.get("renews", True)) and active
            state.STATE["answered_402"] = 0
            state.STATE["account_checks"] = 0
        elif path == "/admin/events":
            state.STATE["refuse"] = int(body.get("refuse", 0))
            if body.get("close"):
                for q in state.STREAMS:
                    q.put(None)
        elif path == "/admin/activities":
            state.STATE["max_ongoing"] = body.get("max_ongoing")
        elif path != "/admin/reset":
            return detail(404, "Not Found")
    if path == "/admin/reset":
        state.reset()
    print(f"[admin] {path}: {json.dumps(body)}", flush=True)
    return json_response(200, {k: state.STATE[k] for k in sorted(state.STATE)})


def status_page(request: Request) -> Response:
    base = f"http://{request.host}"
    with state.LOCK:
        pushes = list(state.PUSHES)
        streams = len(state.STREAMS)
    rows = "".join(
        f"<tr><td>{escape(p['at'])}</td><td><b>{escape(p['slug'])}</b></td>"
        f"<td><pre>{escape(json.dumps(p['content'], indent=2))}</pre></td></tr>"
        for p in pushes
    )
    # The actions of each switchboard and remote as last pushed: a button
    # per request a device could make, so an event is one click away.
    tiles: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for p in reversed(pushes):
        content = p["content"] if isinstance(p["content"], dict) else {}
        if content.get("template") in ("switchboard", "remote"):
            kind = "activity" if "activity" in p else "widget"
            slug = p.get("activity") or p["slug"]
            tiles[(kind, slug)] = content.get("actions") or []

    def button(
        resource: tuple[str, str], tile: dict[str, Any], label: str, value: bool | None
    ) -> str:
        kind, slug = resource
        body: dict[str, Any] = {kind: slug, "action": tile["id"]}
        if value is not None:
            body["value"] = value
        return (
            f"<button data-command='{escape(json.dumps(body))}'>"
            f"{escape(str(tile.get('label') or tile['id']))} · {label}</button>"
        )

    simulator = (
        "".join(
            f"<p><b>{escape(slug)}</b>{' (activity)' if kind == 'activity' else ''} "
            + " ".join(
                button((kind, slug), tile, "On", True)
                + button((kind, slug), tile, "Off", False)
                if tile.get("kind") == "toggle"
                else button((kind, slug), tile, "Press", None)
                for tile in actions
            )
            + "</p>"
            for (kind, slug), actions in tiles.items()
            if actions
        )
        or "<p>No switchboard or remote has been pushed yet: bind one in the"
        " panel first.</p>"
    )
    press = escape(
        f'curl -s -X POST {base}/command -d \'{{"widget": "porch",'
        ' "action": "input_boolean_porch_light", "value": true}\''
    )
    html = f"""<!doctype html><meta charset=utf-8>
    <title>Mock Aivi</title>
    <style>body{{font:14px system-ui;margin:2rem;max-width:900px}}
    table{{border-collapse:collapse;width:100%}}
    td{{border-top:1px solid #ddd;padding:8px;vertical-align:top}}
    pre{{margin:0;white-space:pre-wrap}}h1{{font-size:1.2rem}}h2{{font-size:1rem}}
    code{{background:#eee;padding:1px 4px;border-radius:3px}}
    button{{font:inherit;margin:2px;padding:4px 10px;cursor:pointer}}
    #sent{{color:#666}}</style>
    <h1>Mock Aivi &middot; {len(pushes)} recent pushes &middot;
    {streams} open event stream(s)</h1>
    <p>The integration's pushes land here. Refresh to see new ones.
    Subscription: {"active" if state.STATE["active"] else "inactive"}.
    Stand in for a Home Screen tile press with <code>{press}</code>.</p>
    <h2>Send an event</h2>
    <p>What a device would send for each tile, delivered to the open
    streams. Watch it land in the panel's Events.</p>
    {simulator}<p id=sent></p>
    <script>
    document.addEventListener("click", async (e) => {{
      const body = e.target.dataset && e.target.dataset.command;
      if (!body) return;
      const res = await fetch("/command", {{ method: "POST", body }});
      const out = await res.json();
      document.getElementById("sent").textContent = res.ok
        ? `Sent ${{body}} to ${{out.delivered_to}} stream(s).`
        : `Refused: ${{JSON.stringify(out)}}`;
    }});
    </script>
    <table>{rows or "<tr><td>No pushes yet.</td></tr>"}</table>"""
    return Response(html, content_type="text/html; charset=utf-8")
