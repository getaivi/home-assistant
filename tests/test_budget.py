"""The budget template, resolved against a plain dict resolver."""

from __future__ import annotations

from typing import Any

import pytest

from custom_components.aivi import engine
from custom_components.aivi.templates import BUDGET
from custom_components.aivi.values import (
    wire_money,
)
from helpers import RecordedResolver


def test_budget_total_categories_and_currency() -> None:
    resolver = RecordedResolver(
        states={
            "sensor.spent": "519.30",
            "sensor.food": "157.6",
            "sensor.car": "unavailable",
            "input_number.budget": "1500",
        },
        attrs={"sensor.food": {"friendly_name": "Food"}},
    )
    content = engine.resolve(
        BUDGET,
        {
            "spent": "sensor.spent",
            "budget": "1200",
            "budget__entity": "input_number.budget",
            "currency": "sek",
            "categories": ["sensor.food", "sensor.car"],
            "categories__options": {
                "sensor.food": {"budget": "300", "icon": "fork.knife"},
            },
            "display": "spent",
            "total_color": "yellow",
        },
        resolver,
    )
    assert content == {
        "template": "budget",
        "total": {"spent": "519.30", "budget": "1500", "color": "yellow"},
        "currency": "SEK",
        "categories": [
            {"spent": "157.6", "label": "Food", "budget": "300", "icon": "fork.knife"}
        ],
        "display": "spent",
    }


def test_budget_drops_what_aivi_refuses() -> None:
    resolver = RecordedResolver(states={"sensor.spent": "12", "sensor.food": "3"})
    content = engine.resolve(
        BUDGET,
        {
            "spent": "sensor.spent",
            "budget": "0",
            "currency": "USD",
            "categories": ["sensor.food"],
            "categories__options": {"sensor.food": {"budget": "-5"}},
        },
        resolver,
    )
    assert content is not None
    assert content["total"] == {"spent": "12"}
    assert "budget" not in content["categories"][0]
    # No currency, nothing to push.
    assert engine.resolve(BUDGET, {"spent": "sensor.spent"}, resolver) is None
    assert (
        engine.resolve(BUDGET, {"spent": "sensor.spent", "currency": "€"}, resolver)
        is None
    )


@pytest.mark.parametrize(
    ("value", "money"),
    [
        ("519.30", "519.30"),
        (" -12 ", "-12"),
        ("+5", "5"),
        ("1e3", "1000"),
        (0.1 + 0.2, "0.3"),
        (7, "7"),
        ("nan", None),
        ("inf", None),
        ("12,50", None),
        (True, None),
        (None, None),
        (float("nan"), None),
    ],
)
def test_money_is_a_plain_decimal_string(value: Any, money: str | None) -> None:
    assert wire_money(value) == money
