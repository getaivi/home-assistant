"""Write the panel's golden fixtures from the Python implementation.

- ``rules.json``: the rules the panel mirrors client-side (switchboard
  tile marks and presses, tap URLs, budgets, wire caps, which source a
  stored slot reads) answered by the integration for the cases below;
  ``fixtures.test.ts`` holds ``frontend/src`` to them.
- ``engine.json``: every preview, save and defaults request the vitest
  suite makes, with the integration's answer (``harness_server.Engine``
  over ``frontend/harness/sample-data.json``); the suite replays them. Writing it
  runs vitest to record the requests, until a run asks nothing new.
- ``wire.json``: the keys and value types of the integration's answers to
  the panel's other commands (accounts, listings, the event stream,
  presses), recorded over a real WebSocket by ``tests/test_wire.py``;
  ``wire.test.ts`` holds the harness mock to it.

Usage: ``make fixtures`` (``--check`` in ``make check`` writes nothing and
fails when a fixture is stale; it re-answers the recorded requests).
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from freezegun import freeze_time
from harness_server import engine
from pydantic import AnyUrl, Field, TypeAdapter, ValidationError

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "tests" / "fixtures"
RULES = OUT / "rules.json"
ENGINE = OUT / "engine.json"
WIRE = OUT / "wire.json"
#: The moment the recorded harness entities report from, and the clock the
#: recording runs on, so a recorded time or time since is the same every
#: run (2026-10-01T12:00:00Z).
RECORDED_AT = 1_790_856_000.0

sys.path.insert(0, str(ROOT))

from custom_components.aivi import limits  # noqa: E402
from custom_components.aivi.blocks import COLORS, EntityRows  # noqa: E402
from custom_components.aivi.sources import Bands, Source  # noqa: E402
from custom_components.aivi.sourcing import Bare, read_source  # noqa: E402
from custom_components.aivi.switchboard import (  # noqa: E402
    kind_of,
    press_service,
    user_gradient,
    valid_image_url,
)
from custom_components.aivi.values import action_color  # noqa: E402

#: Aivi's ``tap_url``: any absolute URL, at most 256 characters once
#: normalized (the server's own pydantic type).
TAP_URL: TypeAdapter[AnyUrl] = TypeAdapter(Annotated[AnyUrl, Field(max_length=256)])

URLS = [
    "https://example.com",
    "https://images.example.com/fountain.png",
    "https://example.com/a b",
    "https://exa mple.com",
    "https://",
    "https:///path",
    "http://example.com/x.png",
    "example.com",
    "/api/image/serve/movie/512x512",
    " https://example.com",
    "https://example.com/" + "a" * 2028,
    "https://example.com/" + "a" * 2029,
    "homeassistant://navigate/lovelace/0",
    "homeassistant://navigate/history?entity_id=sensor.x",
    "mailto:me@example.com",
    "shortcuts://run-shortcut?name=Lights",
    "HTTP://EXAMPLE.COM",
    "http://x:99999/",
    "https://例え.jp/path",
    "https://example.com/" + "a" * 236,
    "https://example.com/" + "a" * 237,
    "https://example.com",
]

COLOR_INPUTS = [
    "red",
    " Red ",
    "GRAY2",
    "#ffaa00",
    "#FFAA00",
    "#fa0",
    "#ffaa0011",
    "ffaa00",
    "nope",
    "",
    "  ",
]

GRADIENTS = [
    "red, blue",
    "red,blue,green",
    "red, blue, green, yellow",
    "red",
    "red, nope",
    "#FFD27A, #ff8a4c",
    " purple , #FF375F ",
    "red,,blue",
    "none",
    "",
]

#: Budgets as a row stores them (the panel has already read a lone decimal
#: comma as the point).
MONEY = [
    "12",
    "12.50",
    " 12 ",
    "+5",
    ".5",
    "5.",
    "+.5",
    "5.e2",
    "1e3",
    "1E3",
    "1e+3",
    "1e-5",
    "1e-400",
    "1e400",
    "1_000",
    "1e1_0",
    "12.345678901234567890",
    "0",
    "0.0",
    "-0",
    "-5",
    "",
    " ",
    ".",
    ".e3",
    "e3",
    "1e",
    "1e3.5",
    "1,5",
    "1 000",
    "1.2.3",
    "12a",
    "0x10",
    "Infinity",
    "inf",
    "NaN",
]

#: One entity per domain a tile may hold, and one it may not.
PRESSES = [
    "light.kitchen",
    "switch.heater",
    "fan.ceiling",
    "input_boolean.guest",
    "automation.morning",
    "humidifier.bedroom",
    "siren.alarm",
    "cover.garage",
    "valve.garden",
    "lock.front",
    "scene.movie",
    "script.bedtime",
    "button.restart",
    "input_button.bell",
    "climate.living_room",
]

#: Stored scopes, the address read in them and the slot's bare reading.
#: Empty markers are what a mode switched to but not filled in leaves.
SOURCES: list[tuple[dict[str, Any], str, Bare]] = [
    ({}, "x", Bare.LITERAL),
    ({}, "x", Bare.ENTITY),
    ({"x": "red"}, "x", Bare.LITERAL),
    ({"x": "light.a"}, "x", Bare.ENTITY),
    ({"x__entity": "light.a"}, "x", Bare.LITERAL),
    ({"x__entity": "light.a", "x": "red"}, "x", Bare.LITERAL),
    ({"x__entity": "light.b", "x": "light.a"}, "x", Bare.ENTITY),
    ({"x__entity": "", "x": "light.a"}, "x", Bare.ENTITY),
    ({"x__entity": "light.a", "x__attribute": "brightness"}, "x", Bare.LITERAL),
    ({"x": "light.a", "x__attribute": "brightness"}, "x", Bare.ENTITY),
    ({"x__entity": "light.a", "x__attribute": ""}, "x", Bare.LITERAL),
    ({"x__attribute": "brightness"}, "x", Bare.LITERAL),
    ({"x__template": "{{ 1 }}", "x__watched": ["light.a"]}, "x", Bare.LITERAL),
    ({"x__template": "{{ 1 }}", "x__entity": "light.a"}, "x", Bare.LITERAL),
    ({"x__template": "", "x__entity": "light.a"}, "x", Bare.LITERAL),
    ({"x__template": "", "x": "light.a"}, "x", Bare.ENTITY),
    ({"x__color__entity": "light.a", "x": "red"}, "x__color", Bare.LITERAL),
    ({"x__color__template": "{{ 'red' }}"}, "x", Bare.LITERAL),
    ({"source": "sensor.a", "source__attribute": "level"}, "source", Bare.ENTITY),
    (
        {
            "x__bands": {
                "entity": "sensor.a",
                "limits": [1],
                "values": ["red", "blue"],
            },
            "x": "red",
        },
        "x",
        Bare.LITERAL,
    ),
    (
        {
            "x__bands": {"entity": "sensor.a", "limits": [], "values": []},
            "x__entity": "light.a",
        },
        "x",
        Bare.LITERAL,
    ),
    (
        {
            "x__bands": {
                "entity": "sensor.a",
                "limits": [1],
                "values": ["red", "blue"],
            },
            "x__template": "{{ 1 }}",
        },
        "x",
        Bare.LITERAL,
    ),
]

#: Stored bands, read by the integration or not, and the reading each
#: then picks a value for.
BANDS: list[Any] = [
    {"entity": "sensor.a", "limits": [20, 50], "values": ["red", "orange", "green"]},
    {
        "entity": "sensor.a",
        "limits": ["20", 50.5],
        "values": ["red", "orange", "green"],
    },
    {
        "entity": "sensor.a",
        "limits": [-10, 0, 10, 20],
        "values": ["a", "b", "c", "d", "e"],
    },
    {
        "entity": "sensor.a",
        "limits": [1, 2, 3, 4, 5],
        "values": ["a", "b", "c", "d", "e", "f"],
    },
    {"entity": "sensor.a", "limits": [50, 20], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [20, 20], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [20], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [20, "x"], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [20, True], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [20, None], "values": ["red", "orange", "green"]},
    {"entity": "sensor.a", "limits": [], "values": ["red"]},
    {"entity": "", "limits": [20], "values": ["red", "green"]},
    {"entity": "sensor.a", "limits": [20], "values": ["red", 2]},
    {"limits": [20], "values": ["red", "green"]},
    "sensor.a",
    None,
]
READINGS = [
    "-20",
    "0",
    "19.99",
    "20",
    "20.0",
    "35",
    "50",
    "50.5",
    "100",
    " 7 ",
    "1e1",
    "",
    "unavailable",
    "on",
    "nan",
    "inf",
]


def _read(scope: dict[str, Any], address: str, bare: Bare) -> dict[str, Any] | None:
    source = read_source(address, scope, bare=bare)
    if source is None:
        return None
    if source.source is Source.BANDS and source.bands is not None:
        return {"kind": "bands", "bands": source.bands.stored()}
    if source.source is Source.TEMPLATE:
        return {
            "kind": "template",
            "template": source.template,
            "watched": list(source.watched),
        }
    if source.source is Source.ATTRIBUTE:
        return {
            "kind": "attribute",
            "entity": source.entity_id,
            "attribute": source.attribute,
        }
    return {"kind": "entity", "entity": source.entity_id}


#: The slot a row's budget is coerced by when the widget is pushed.
BUDGET = next(slot for slot in EntityRows.ROW_SLOTS if slot.suffix == "budget")


def _url_ok(url: str) -> bool:
    try:
        TAP_URL.validate_python(url)
    except ValidationError:
        return False
    return True


def _rules() -> dict[str, Any]:
    return {
        "colors": list(COLORS),
        "image_url": [[url, valid_image_url(url)] for url in URLS],
        "tap_url": [[url, _url_ok(url)] for url in URLS],
        "action_color": [[c, action_color(c, tuple(COLORS))] for c in COLOR_INPUTS],
        "user_gradient": [[raw, user_gradient(raw)] for raw in GRADIENTS],
        "money": [[raw, BUDGET.coerce(raw)] for raw in MONEY],
        "sources": [
            [scope, address, bare.value, _read(scope, address, bare)]
            for scope, address, bare in SOURCES
        ],
        "bands": [
            [
                raw,
                None if (bands := Bands.parse(raw)) is None else bands.stored(),
                None if bands is None else [[r, bands.pick(r)] for r in READINGS],
            ]
            for raw in BANDS
        ],
        # The (domain, service) a press calls, as a toggle switched on.
        "press": [
            [entity_id, kind_of(entity_id), list(press_service(entity_id, True) or ())]
            for entity_id in PRESSES
        ],
        "limits": {
            "image_url": limits.IMAGE_URL,
            "label": limits.LABEL,
            "tap_url": limits.TAP_URL,
            "rows": limits.ROWS,
        },
    }


def _dump(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


async def _answer(requests: list[str]) -> str:
    """engine.json for these requests (JSON texts), sorted and deduplicated."""
    unique = {
        json.dumps(r, sort_keys=True, ensure_ascii=False): r
        for r in map(json.loads, requests)
    }
    # The event loop keeps the real clock, for the timeouts it waits on.
    with freeze_time(datetime.fromtimestamp(RECORDED_AT, UTC), real_asyncio=True):
        async with engine(started=RECORDED_AT) as answers:
            cases = [
                {"request": unique[key], "answer": await answers.answer(unique[key])}
                for key in sorted(unique)
            ]
    return _dump(cases)


def _record() -> list[str]:
    """The requests one vitest run makes, replaying the current engine.json."""
    with tempfile.NamedTemporaryFile("r", suffix=".jsonl") as log:
        # npx is found on the developer's PATH.
        subprocess.run(
            ["npx", "vitest", "run", "--config", "frontend/vitest.config.ts"],  # noqa: S607
            cwd=ROOT,
            env={**os.environ, "AIVI_ENGINE_RECORD": log.name},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return log.read().splitlines()


def _stored_requests() -> list[str]:
    if not ENGINE.exists():
        return []
    cases = json.loads(ENGINE.read_text(encoding="utf-8"))
    return [json.dumps(case["request"]) for case in cases]


def _wire(*, write: bool) -> bool:
    """Run the test that records wire.json: it writes the file with
    ``write``, else it fails when the file is stale."""
    env = {key: value for key, value in os.environ.items() if key != "AIVI_WIRE_WRITE"}
    if write:
        env["AIVI_WIRE_WRITE"] = "1"
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--no-cov", "tests/test_wire.py"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if run.returncode and write:
        sys.stderr.write(run.stdout[-4000:])
    return run.returncode == 0


def main(argv: list[str]) -> int:
    rules = _dump(_rules())
    if "--check" in argv:
        stale = [
            path.name
            for path, text in (
                (RULES, rules),
                (ENGINE, asyncio.run(_answer(_stored_requests()))),
            )
            if not path.exists() or path.read_text(encoding="utf-8") != text
        ]
        if not _wire(write=False):
            stale.append(WIRE.name)
        if not stale:
            print("frontend/tests/fixtures are up to date")
            return 0
        print(
            f"error: stale fixtures ({', '.join(stale)}); run `make fixtures`",
            file=sys.stderr,
        )
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    RULES.write_text(rules, encoding="utf-8")
    if not _wire(write=True):
        print("error: recording wire.json failed", file=sys.stderr)
        return 1
    # A run may ask what an earlier one did not (an answer leads to the next
    # request, a debounced preview fires or not): record until one adds none.
    seen: set[str] = set()
    for _ in range(5):
        asked = set(_record())
        if asked <= seen:
            break
        seen |= asked
        ENGINE.write_text(asyncio.run(_answer(list(seen))), encoding="utf-8")
    print("regenerated frontend/tests/fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
