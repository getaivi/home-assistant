"""The energy template, resolved against a plain dict resolver with recorded
history."""

from __future__ import annotations

from custom_components.aivi import engine
from custom_components.aivi.sources import HistoryKind, HistoryQuery
from custom_components.aivi.templates import ENERGY
from helpers import RecordedResolver


def _low(entity_id: str) -> HistoryQuery:
    return HistoryQuery(HistoryKind.DAY_LOW, entity_id)


def test_energy_nodes_units_and_signs() -> None:
    resolver = RecordedResolver(
        states={
            "sensor.solar": "3.2",
            "sensor.grid": "1400",
            "sensor.battery": "-800",
            "sensor.soc": "176",
            "sensor.home": "1000",
            "sensor.solar_energy": "1012.4",
            "sensor.grid_import": "3100",
            "sensor.home_daily": "2.5",
        },
        attrs={
            "sensor.solar": {"unit_of_measurement": "kW"},
            "sensor.grid_import": {"unit_of_measurement": "Wh"},
        },
        history={
            _low("sensor.solar_energy"): 1000,
            _low("sensor.grid_import"): 0,
            _low("sensor.home_daily"): 0,
        },
    )
    bindings = {
        "sources": ["sensor.solar"],
        "sources__options": {
            "sensor.solar": {"label": "Roof", "today": "sensor.solar_energy"}
        },
        "grid_power": "sensor.grid",
        "grid_power__invert": True,
        "grid_today": "sensor.grid_import",
        "battery_power": "sensor.battery",
        "battery_power__invert": True,
        "battery_level": "sensor.soc",
        "home_power": "sensor.home",
        "home_today": "sensor.home_daily",
    }
    assert engine.history_queries(ENERGY, bindings) == {
        _low("sensor.solar_energy"),
        _low("sensor.grid_import"),
        _low("sensor.home_daily"),
    }
    assert engine.resolve(ENERGY, bindings, resolver) == {
        "template": "energy",
        "sources": [{"power": 3200, "name": "Roof", "today": 12.4}],
        "grid": {"power": -1400, "today": 3.1},
        "battery": {"power": 800, "level": 100},
        "home": {"power": 1000, "today": 2.5},
    }


def test_energy_today_counts_from_the_days_low() -> None:
    """A lifetime meter counts from its midnight reading; a daily meter
    from its reset (its low is then 0)."""
    states = {"sensor.lifetime": "1020", "sensor.daily": "4", "sensor.home": "500"}
    resolver = RecordedResolver(
        states=states,
        history={_low("sensor.lifetime"): 1000, _low("sensor.daily"): 0},
    )
    for meter, today in (("sensor.lifetime", 20), ("sensor.daily", 4)):
        content = engine.resolve(
            ENERGY, {"home_power": "sensor.home", "home_today": meter}, resolver
        )
        assert content["home"] == {"power": 500, "today": today}
    # Without history the figure is left out rather than guessed.
    content = engine.resolve(
        ENERGY, {"home_power": "sensor.home", "home_today": "sensor.x"}, resolver
    )
    assert content["home"] == {"power": 500}
    # A template is today's figure already.
    templated = {"home_power": "sensor.home", "home_today__template": "{{ t }}"}
    assert engine.history_queries(ENERGY, templated) == set()
    content = engine.resolve(
        ENERGY, templated, RecordedResolver(states, renders={"{{ t }}": "7"})
    )
    assert content["home"]["today"] == 7


def test_energy_needs_one_node() -> None:
    resolver = RecordedResolver(states={"sensor.soc": "50"})
    # A battery charge without its power is no node, and no node is no push.
    assert engine.resolve(ENERGY, {"battery_level": "sensor.soc"}, resolver) is None
    assert engine.resolve(ENERGY, {}, resolver) is None
