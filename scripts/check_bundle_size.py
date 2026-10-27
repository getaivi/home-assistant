"""Print the panel's built file sizes and fail when one outgrows its budget.

The template editor (aivi-code-editor-<hash>.js) is downloaded the first time a
user opens a template, so it has a budget of its own; the panel bundle
must not take any of it in. Run after `make bundle`:

    uv run python scripts/check_bundle_size.py
"""

from __future__ import annotations

import gzip
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "custom_components" / "aivi" / "frontend"

# Gzipped bytes. The editor is CodeMirror's view, state, language,
# autocomplete and commands (about 106 KB, with the drawn caret and
# selection the expanded editor keeps in view without the focus) plus the
# Jinja support. Each pattern matches exactly one built file.
BUDGETS = {
    "aivi-panel.js": 155_000,
    "aivi-code-editor-*.js": 125_000,
}


def main() -> int:
    failed = False
    for pattern, budget in BUDGETS.items():
        paths = sorted(FRONTEND.glob(pattern))
        if len(paths) != 1:
            print(
                f"{pattern}: {len(paths)} built files, expected one; run `make bundle`"
            )
            failed = True
            continue
        path = paths[0]
        name = path.name
        data = path.read_bytes()
        packed = len(gzip.compress(data, compresslevel=9))
        over = packed > budget
        failed |= over
        print(
            f"{name}: {len(data) / 1000:.1f} kB, {packed / 1000:.1f} kB gzipped"
            f" (budget {budget / 1000:.0f} kB){', over it' if over else ''}"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
