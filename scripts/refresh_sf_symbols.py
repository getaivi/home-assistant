"""Generate the panel's SF Symbols index from Apple's own metadata.

    uv run python scripts/refresh_sf_symbols.py [path to CoreGlyphs.bundle]

macOS ships the complete SF Symbols metadata in
``/System/Library/CoreServices/CoreGlyphs.bundle`` (the SF Symbols app
reads the same files): every symbol name, the release it appeared in (and
so the iOS version it needs), its categories and its search terms, and
the symbols Apple restricts to referring to its own products. This writes
``custom_components/aivi/frontend/sf-symbols.json``, which the integration
serves beside the panel bundle and the icon picker loads on first open.

Only names and metadata are written; the symbol artwork is Apple's and is
never redistributed. Left out: the restricted symbols, the language
variants (``.ar``, ``.hi`` and the like), and names that are only aliases
of another symbol.

A developer step like ``make openapi``: it needs macOS, so CI does not
regenerate it. Run it after a macOS update to pick up new symbols.
"""

from __future__ import annotations

import json
import plistlib
import re
import sys
from pathlib import Path

DEFAULT_BUNDLE = Path("/System/Library/CoreServices/CoreGlyphs.bundle")
TARGET = (
    Path(__file__).resolve().parent.parent
    / "custom_components"
    / "aivi"
    / "frontend"
    / "sf-symbols.json"
)

# Localized variants of a base symbol (``character.book.closed.ar``): the
# base name is what a widget shows.
_LOCALE_SUFFIX = re.compile(
    r"\.(ar|bn|ca|el|gu|he|hi|ja|km|kn|ko|lo|ml|mn|mr|my|ne|or|pa|ru|sa|sat|si|ta|te|th|zh|zh\.traditional)$"
)

# The categories the picker offers, in its order: the ones a Home
# Assistant widget is likely about. The rest are either about the symbol's
# form (variable, multicolor, keyboard, text formatting, shapes, arrows) or
# rarely wanted on a widget; "All" and the search still reach them.
CATEGORIES = [
    "home",
    "devices",
    "objectsandtools",
    "weather",
    "nature",
    "transportation",
    "automotive",
    "privacyandsecurity",
    "human",
    "health",
    "media",
    "commerce",
    "time",
    "communication",
]


def build(bundle: Path) -> dict:
    res = bundle / "Contents" / "Resources"
    with (res / "name_availability.plist").open("rb") as f:
        availability = plistlib.load(f)
    with (res / "symbol_categories.plist").open("rb") as f:
        categories = plistlib.load(f)
    with (res / "symbol_search.plist").open("rb") as f:
        search = plistlib.load(f)
    with (res / "symbol_restrictions.strings").open("rb") as f:
        restricted = plistlib.load(f)
    with (res / "name_aliases.strings").open("rb") as f:
        aliases = plistlib.load(f)

    releases = availability["year_to_release"]
    symbols = availability["symbols"]
    index = {c: i for i, c in enumerate(CATEGORIES)}
    rows: list[list] = []
    for name in sorted(symbols):
        if _LOCALE_SUFFIX.search(name) or name in restricted or name in aliases:
            continue
        ios = releases[symbols[name]]["iOS"]
        cats = sorted(index[c] for c in categories.get(name, []) if c in index)
        terms = sorted(set(search.get(name, [])))
        rows.append([name, ios, cats, terms])
    return {
        "source": "SF Symbols metadata from macOS (CoreGlyphs.bundle)",
        "categories": CATEGORIES,
        "symbols": rows,
    }


def main(argv: list[str]) -> int:
    bundle = Path(argv[1]) if len(argv) > 1 else DEFAULT_BUNDLE
    if not bundle.exists():
        print(f"no SF Symbols metadata at {bundle}: this needs macOS", file=sys.stderr)
        return 1
    data = build(bundle)
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n"
    TARGET.write_text(text, encoding="utf-8")
    print(
        f"wrote {TARGET.relative_to(Path.cwd())}: {len(data['symbols'])} symbols, "
        f"{TARGET.stat().st_size // 1024} KB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
