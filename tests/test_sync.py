"""Guard against the strings.json / translations mirror drifting.

hassfest validates each file on its own but not their equality; this test
does. It needs no Home Assistant instance, so the autouse fixtures from
conftest.py (which pull in ``hass``) are overridden with no-ops.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

COMPONENT = Path(__file__).parent.parent / "custom_components" / "aivi"
STRINGS = COMPONENT / "strings.json"
EN_TRANSLATION = COMPONENT / "translations" / "en.json"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations() -> None:
    """Override conftest's autouse fixture: no hass needed here."""


@pytest.fixture(autouse=True)
def inject_fake_client() -> None:
    """Override conftest's autouse fixture: no hass needed here."""


def test_en_translation_mirrors_strings() -> None:
    """translations/en.json must be an exact copy of strings.json."""
    strings_raw = STRINGS.read_bytes()
    translation_raw = EN_TRANSLATION.read_bytes()

    # Structural equality first, for a readable diff when they diverge...
    assert json.loads(strings_raw) == json.loads(translation_raw), (
        "custom_components/aivi/translations/en.json has diverged from "
        "strings.json; run `make catalog`"
    )
    # ...then byte equality, so formatting cannot drift either.
    assert strings_raw == translation_raw, (
        "strings.json and translations/en.json are semantically equal but "
        "differ in formatting; run `make catalog`"
    )
