"""Score Suggest against the scenarios in qa/suggest-evals.json.

    uv run python scripts/suggest_eval.py [--runs 2] [--only PREFIX]
        [--model ai_task.entity] [--out results.json]

Needs the qa stack running with a model (``OPENROUTER_API_KEY=... make qa``,
see qa/README.md). Each scenario is one ``aivi/suggest`` request against the
qa home, repeated ``--runs`` times, and graded in code on what came back:
the form it produced, what was rejected, and whether the reply is true to
it. A scenario passes only when every run passes.

Nothing is saved in Home Assistant: a suggestion is form state only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "qa" / "suggest-evals.json"
SYMBOLS = ROOT / "custom_components" / "aivi" / "frontend" / "sf-symbols.json"
HA = "http://localhost:8123"
CLIENT_ID = f"{HA}/"

# A symbol name inside a template: dotted lowercase words. Entity ids look
# the same but start with a domain, which has no place in a symbol name.
_DOTTED = re.compile(r"[a-z][a-z0-9]*(?:\.[a-z0-9]+)+")
_DOMAINS = frozenset(
    {
        "alarm_control_panel",
        "automation",
        "binary_sensor",
        "button",
        "climate",
        "cover",
        "device_tracker",
        "fan",
        "humidifier",
        "input_boolean",
        "input_number",
        "input_select",
        "input_text",
        "light",
        "lock",
        "media_player",
        "number",
        "person",
        "scene",
        "script",
        "select",
        "sensor",
        "siren",
        "state_attr",
        "states",
        "sun",
        "switch",
        "timer",
        "update",
        "vacuum",
        "valve",
        "water_heater",
        "weather",
        "zone",
    }
)


def _symbols() -> frozenset[str]:
    index = json.loads(SYMBOLS.read_text(encoding="utf-8"))
    return frozenset(row[0] for row in index["symbols"])


def _icons(value: Any, key: str = "") -> list[str]:
    """Every icon name in a form: literal icon values, and the names an
    icon template prints."""
    found: list[str] = []
    if isinstance(value, dict):
        for name, inner in value.items():
            found += _icons(inner, str(name))
    elif isinstance(value, list):
        for inner in value:
            found += _icons(inner, key)
    elif isinstance(value, str):
        if key == "icon" or key.endswith("__icon"):
            found.append(value)
        elif key == "icon__template" or key.endswith("icon__template"):
            found += [
                token
                for token in _DOTTED.findall(value)
                if token.split(".")[0] not in _DOMAINS
            ]
    return found


def _pruned(bindings: dict[str, Any]) -> dict[str, Any]:
    """The form without what the integration derives."""
    return json.loads(
        json.dumps(bindings, sort_keys=True),
        object_hook=lambda d: {
            k: v for k, v in d.items() if not k.endswith("__watched")
        },
    )


def grade(
    case: dict[str, Any], result: dict[str, Any], symbols: frozenset[str]
) -> list[str]:
    """Why this run fails the scenario; empty when it passes."""
    before = _pruned(case.get("bindings") or {})
    after = _pruned(result.get("bindings") or {})
    reply = (result.get("reply") or "").strip()
    changed = before != after
    asked = result.get("match") == "none" or reply.endswith("?")
    answered = result.get("match") == "answer"
    failures: list[str] = []

    for check in case["expect"]:
        if "rows" in check:
            key = check["rows"]
            rows = after.get(key) or []
            was = before.get(key) or []
            added = [row for row in rows if row not in was]
            if "count" in check and len(rows) != check["count"]:
                failures.append(f"{key}: {len(rows)} rows, wanted {check['count']}")
            if "max" in check and len(rows) > check["max"]:
                failures.append(f"{key}: {len(rows)} rows, at most {check['max']}")
            if "min" in check and len(rows) < check["min"]:
                failures.append(f"{key}: {len(rows)} rows, at least {check['min']}")
            if check.get("keeps") and (gone := [row for row in was if row not in rows]):
                failures.append(f"{key}: dropped {gone}")
            for wanted in check.get("includes", []):
                if wanted not in rows:
                    failures.append(f"{key}: missing {wanted}")
            for unwanted in check.get("excludes", []):
                if unwanted in rows:
                    failures.append(f"{key}: still has {unwanted}")
            if "first" in check and rows[:1] != [check["first"]]:
                failures.append(f"{key}: first is {rows[:1]}, wanted {check['first']}")
            if "added_domains" in check and (
                odd := [
                    r for r in added if r.split(".")[0] not in check["added_domains"]
                ]
            ):
                failures.append(f"{key}: added {odd}")
        elif "field" in check:
            key = check["field"]
            value = after.get(key)
            if "is" in check and value != check["is"]:
                failures.append(f"{key}: {value!r}, wanted {check['is']!r}")
            if "in" in check and value not in check["in"]:
                failures.append(f"{key}: {value!r}, wanted one of {check['in']}")
            if "set" in check and (value not in (None, "", [])) != check["set"]:
                failures.append(f"{key}: {'set' if check['set'] else 'unset'} wanted")
        elif "unchanged" in check:
            if changed:
                failures.append("the form changed")
        elif "changed" in check:
            if not changed:
                failures.append("nothing changed")
        elif "match" in check:
            if result.get("match") != check["match"]:
                failures.append(f"match {result.get('match')}, wanted {check['match']}")
        elif "asks" in check:
            if not asked:
                failures.append("did not ask back")
        elif "options" in check:
            if len(result.get("options") or []) < check["options"]:
                failures.append("offered no options")
        elif "rejected" in check:
            if len(result.get("rejected") or []) > check["rejected"]:
                failures.append(f"rejected: {result.get('rejected')}")
        elif "icons" in check:
            if fake := [name for name in _icons(after) if name not in symbols]:
                failures.append(f"icons that do not exist: {sorted(set(fake))}")
        elif "reply" in check:
            if not any(word.lower() in reply.lower() for word in check["reply"]):
                failures.append(f"reply lacks any of {check['reply']}")
        else:
            failures.append(f"unknown check {check}")

    # Whatever the scenario: a reply that reports work on a form it left
    # untouched, or stays silent about what was refused, is not true.
    if (
        reply
        and not changed
        and not asked
        and not answered
        and not case.get("answer_only")
    ):
        failures.append("claims a change, changed nothing")
    return failures


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


async def _token(session: aiohttp.ClientSession) -> str:
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
        json={"client_id": CLIENT_ID, "username": "dev", "password": "dev"},
    ) as resp:
        code = (await resp.json())["result"]
    async with session.post(
        f"{HA}/auth/token",
        data={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID},
    ) as resp:
        return (await resp.json())["access_token"]


async def _answer(ws: Any, msg_id: int) -> dict[str, Any]:
    """The reply to ``msg_id``; a late reply to an earlier message (one that
    ran out of time) is skipped by its id."""
    while True:
        reply = await ws.receive_json()
        if reply.get("id") == msg_id:
            return reply


async def run(args: argparse.Namespace) -> int:
    cases = [
        case
        for case in json.loads(CASES.read_text(encoding="utf-8"))["cases"]
        if not args.only or case["id"].startswith(args.only)
    ]
    symbols = _symbols()
    report: list[dict[str, Any]] = []
    async with aiohttp.ClientSession() as session:
        token = await _token(session)
        async with session.ws_connect(f"{HA}/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": token})
            await ws.receive_json()
            number = 0
            for case in cases:
                runs = []
                for _ in range(args.runs):
                    number += 1
                    message = {
                        "id": number,
                        "type": "aivi/suggest",
                        "template": case["template"],
                        "kind": case.get("kind", "widget"),
                        "name": case["name"],
                        "description": case["ask"],
                    }
                    for key in ("bindings", "history"):
                        if case.get(key):
                            message[key] = case[key]
                    if args.model:
                        message["entity_id"] = args.model
                    started = time.monotonic()
                    await ws.send_json(message)
                    # A model that never answers fails its scenario instead
                    # of stalling the run.
                    try:
                        async with asyncio.timeout(args.timeout):
                            answer = await _answer(ws, message["id"])
                    except TimeoutError:
                        answer = {
                            "success": False,
                            "error": f"no answer within {args.timeout:.0f} s",
                        }
                    took = time.monotonic() - started
                    if answer.get("success"):
                        failures = grade(case, answer["result"], symbols)
                    else:
                        failures = [f"error: {answer.get('error')}"]
                    runs.append(
                        {
                            "seconds": round(took, 1),
                            "failures": failures,
                            "result": answer.get("result"),
                        }
                    )
                passed = all(not r["failures"] for r in runs)
                report.append(
                    {
                        "id": case["id"],
                        "group": case["group"],
                        "passed": passed,
                        "runs": runs,
                    }
                )
                mark = "PASS" if passed else "FAIL"
                good = sum(1 for r in runs if not r["failures"])
                print(
                    f"{mark}  {case['id']:<34} {good}/{len(runs)}  {case['ask'][:50]}",
                    flush=True,
                )
                for r in runs:
                    for failure in r["failures"]:
                        print(f"        {failure}")

    groups: dict[str, list[bool]] = {}
    for row in report:
        groups.setdefault(row["group"], []).append(row["passed"])
    print()
    for group, results in groups.items():
        print(f"{group:<28} {sum(results)}/{len(results)}")
    total = sum(row["passed"] for row in report)
    seconds = [r["seconds"] for row in report for r in row["runs"]]
    print(
        f"{'ALL':<28} {total}/{len(report)}"
        f"   median {sorted(seconds)[len(seconds) // 2]}s"
    )
    if args.out:
        _write(Path(args.out), json.dumps(report, indent=1))
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--only", help="only scenarios whose id starts with this")
    parser.add_argument("--model", help="the AI Task entity to ask")
    parser.add_argument("--out", help="write the full results here as JSON")
    parser.add_argument(
        "--timeout",
        type=float,
        default=120,
        help="seconds to wait for each answer before failing it",
    )
    return asyncio.run(run(parser.parse_args(argv[1:])))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
