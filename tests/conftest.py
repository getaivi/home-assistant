"""Test fixtures.

The one seam these tests rely on is the client factory: a ``FakeAiviClient``
is placed on ``hass.data`` before anything runs, so the config flow and the
runtime both use it. No aiohttp, no mock.patch. Tests then drive real Home
Assistant state and assert on what the fake recorded.
"""

from __future__ import annotations

import pytest

from custom_components.aivi.api import (
    ActivityInfo,
    WidgetInfo,
)
from custom_components.aivi.const import DATA_CLIENT_FACTORY
from helpers import FakeAiviClient


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Load custom_components/aivi in every test."""
    yield


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [
        WidgetInfo("laundry", "Laundry", "progress"),
        WidgetInfo("frontdoor", "Front door", "status"),
        WidgetInfo("batteries", "Home batteries", "battery"),
    ]


@pytest.fixture
def activities() -> list[ActivityInfo]:
    return [
        ActivityInfo("washer", "Washer", "progress"),
        ActivityInfo("grill", "Grill", "monitor"),
    ]


@pytest.fixture
def fake_client(widgets, activities) -> FakeAiviClient:
    return FakeAiviClient(widgets, activities)


@pytest.fixture(autouse=True)
def inject_fake_client(hass, fake_client) -> FakeAiviClient:
    hass.data[DATA_CLIENT_FACTORY] = lambda hass, base_url, token: fake_client
    return fake_client
