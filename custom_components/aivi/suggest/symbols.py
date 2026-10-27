"""The SF Symbols a model may name: the index, and the short list it is shown.

A model asked for "an SF Symbol" invents plausible names, so it is shown
real ones and its answer is held to the index.
"""

from __future__ import annotations

from functools import cache

from .tables import symbol_index

_VARIANTS = (".fill", ".circle", ".square", ".slash", ".inverse")
_COMMON_SYMBOLS = (
    "bolt",
    "bolt.car",
    "battery.100percent",
    "battery.100percent.bolt",
    "thermometer.medium",
    "thermometer.sun",
    "thermometer.snowflake",
    "humidity",
    "drop",
    "flame",
    "snowflake",
    "wind",
    "sun.max",
    "moon",
    "cloud.rain",
    "sun.horizon",
    "leaf",
    "car",
    "ev.charger",
    "ev.plug.ac.type.2",
    "fuelpump",
    "bicycle",
    "tram",
    "airplane",
    "shippingbox",
    "trash",
    "cart",
    "creditcard",
    "banknote",
    "chart.line.uptrend.xyaxis",
    "chart.bar",
    "gauge.with.needle",
    "timer",
    "clock",
    "alarm",
    "calendar",
    "hourglass",
    "bell",
    "lock",
    "lock.open",
    "key",
    "shield",
    "video",
    "camera",
    "sensor",
    "wifi",
    "antenna.radiowaves.left.and.right",
    "power",
    "powerplug",
    "poweroutlet.type.f",
    "play",
    "pause",
    "music.note",
    "speaker.wave.2",
    "tv",
    "figure.walk",
    "person.2",
    "pawprint",
    "bed.double",
    "cup.and.saucer",
    "fork.knife",
    "sparkles",
    "checkmark.circle",
    "exclamationmark.triangle",
    "solarpanel",
    "sun.max.trianglebadge.exclamationmark",
    "arrow.up.arrow.down",
    "water.waves",
    "robotic.vacuum",
    "printer",
    "server.rack",
    "network",
)


@cache
def symbols() -> frozenset[str]:
    """The name of every symbol in the index."""
    return frozenset(str(row[0]) for row in symbol_index()["symbols"])


@cache
def symbol_shortlist() -> str:
    """The index's home symbols plus a few common ones, as the prompt lists them."""
    index = symbol_index()
    home = index["categories"].index("home")
    names = [
        name
        for name, _, categories, _ in index["symbols"]
        if home in categories
        and "sign." not in name
        and "badge" not in name
        and "gauge.chart" not in name
        and not name.endswith(_VARIANTS)
    ]
    known = symbols()
    return ", ".join(sorted({*names, *(n for n in _COMMON_SYMBOLS if n in known)}))


def known_symbol(name: str) -> str | None:
    """The symbol as the index has it, or the nearest real one a made-up
    name was built on (``fan.and.wake.fan`` is a ``fan``); None when no
    part of it is a symbol."""
    parts = name.strip().split(".")
    while parts:
        if (candidate := ".".join(parts)) in symbols():
            return candidate
        parts.pop()
    return None


#: How many near symbols a repair is shown for a name that does not exist.
_NEAR_SYMBOLS = 6


def near_symbols(name: str) -> list[str]:
    """Real symbols close to a made-up one: those built on its first word,
    shortest first."""
    head = name.strip().split(".")[0]
    if not head:
        return []
    near = [s for s in symbols() if s == head or s.startswith(f"{head}.")]
    return sorted(near, key=lambda s: (len(s), s))[:_NEAR_SYMBOLS]
