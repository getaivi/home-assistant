"""Vendor the Aivi public API's OpenAPI document into contract/.

    uv run python scripts/refresh_openapi.py [URL or path]

The default source is the public API's own ``/openapi.json``. The document
is checked to be a valid OpenAPI 3.1 description before it is written; the
contract tests and the QA mock both read the vendored copy.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from openapi_spec_validator import validate

DEFAULT_SOURCE = "https://api.getaivi.app/openapi.json"
TARGET = Path(__file__).resolve().parent.parent / "contract" / "aivi-openapi.json"


def load(source: str) -> dict:
    if source.startswith(("https://", "http://")):
        # The scheme is checked on the line above.
        # The API's edge refuses Python's default User-Agent.
        request = urllib.request.Request(  # noqa: S310
            source, headers={"User-Agent": "aivi-home-assistant/refresh-openapi"}
        )
        with urllib.request.urlopen(request, timeout=30) as resp:  # noqa: S310
            return json.load(resp)
    return json.loads(Path(source).read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    source = argv[1] if len(argv) > 1 else DEFAULT_SOURCE
    document = load(source)
    validate(document)
    TARGET.parent.mkdir(exist_ok=True)
    TARGET.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {TARGET.relative_to(Path.cwd())} from {source}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
