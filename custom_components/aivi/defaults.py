"""A new binding's first form state, read from Home Assistant's own
configuration: a budget in Home Assistant's currency, a price timeline on
the first sensor that carries one, an energy widget wired the way the
Energy dashboard is."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.core import HomeAssistant, valid_entity_id

from . import blocks
from .series import cents_unit, price_entries


async def async_budget(hass: HomeAssistant) -> dict[str, Any]:
    """A budget in Home Assistant's currency."""
    currency = str(hass.config.currency or "").upper()
    return {"currency": currency} if len(currency) == 3 else {}


async def async_prices(hass: HomeAssistant) -> dict[str, Any]:
    """The first sensor with a price timeline in its attributes; in cents
    when it prices in a currency per unit below 10 (the phone shows one
    decimal, so 0.25 EUR/kWh reads better as 25 ct/kWh)."""
    for state in hass.states.async_all(["sensor", "event"]):
        lists = [v for v in state.attributes.values() if isinstance(v, list)]
        found = [entry for value in lists for entry in price_entries(value)]
        if len(found) < 2:
            continue
        out: dict[str, Any] = {"entries": state.entity_id}
        unit = state.attributes.get("unit_of_measurement")
        if cents_unit(unit) and max(abs(price) for _, price, _ in found) < 10:
            out["scale"] = "cents"
        return out
    return {}


def _known(hass: HomeAssistant, entity_id: Any) -> str | None:
    """A statistic id that is an existing entity, else ``None`` (an
    external statistic has no state to follow)."""
    if (
        isinstance(entity_id, str)
        and valid_entity_id(entity_id)
        and hass.states.get(entity_id) is not None
    ):
        return entity_id
    return None


def _watts(hass: HomeAssistant, entity_id: str) -> str:
    """Jinja reading a power entity in watts."""
    state = hass.states.get(entity_id)
    unit = state.attributes.get("unit_of_measurement") if state else None
    factor = blocks.POWER_UNITS.get(str(unit), 1) if unit else 1
    read = f"states('{entity_id}') | float(0)"
    return read if factor == 1 else f"{read} * {factor:g}"


def _power(
    hass: HomeAssistant, config: Mapping[str, Any], positive: str
) -> tuple[dict[str, Any], str] | None:
    """A power field's bindings from an Energy dashboard power config,
    plus the Jinja reading it in Aivi's sign, in watts. ``positive`` is
    the direction Aivi counts as positive: "from" (drawing from the grid)
    or "to" (charging the battery). Home Assistant's single sensor counts
    "from" as positive; its inverted one the opposite."""
    if entity_id := _known(hass, config.get("stat_rate")):
        invert = positive != "from"
    elif entity_id := _known(hass, config.get("stat_rate_inverted")):
        invert = positive == "from"
    else:
        incoming = _known(hass, config.get("stat_rate_from"))
        outgoing = _known(hass, config.get("stat_rate_to"))
        if incoming is None or outgoing is None:
            return None
        plus, minus = (
            (incoming, outgoing) if positive == "from" else (outgoing, incoming)
        )
        jinja = f"({_watts(hass, plus)}) - ({_watts(hass, minus)})"
        return {"__template": f"{{{{ {jinja} }}}}"}, jinja
    jinja = _watts(hass, entity_id)
    return ({"": entity_id, "__invert": True} if invert else {"": entity_id}), (
        f"-({jinja})" if invert else jinja
    )


def _power_config(source: Mapping[str, Any]) -> Mapping[str, Any]:
    """A source's power config, in the current shape or the one earlier
    Home Assistant versions store (a grid's list of power entries)."""
    if isinstance(config := source.get("power_config"), Mapping):
        return config
    if source.get("stat_rate"):
        return {"stat_rate": source["stat_rate"]}
    entries = source.get("power")
    if isinstance(entries, list) and entries and isinstance(entries[0], Mapping):
        return _power_config(entries[0])
    return {}


def _grid_energy(source: Mapping[str, Any]) -> Any:
    if source.get("stat_energy_from"):
        return source["stat_energy_from"]
    flows = source.get("flow_from")
    if isinstance(flows, list) and flows and isinstance(flows[0], Mapping):
        return flows[0].get("stat_energy_from")
    return None


async def async_energy(hass: HomeAssistant) -> dict[str, Any]:
    """The energy widget as the Energy dashboard is configured: solar power
    sensors as sources (with their energy as "today"), the grid, the
    battery and its charge, and the home's power computed from them."""
    # Imported here: the energy component is optional.
    from homeassistant.components.energy.data import (  # noqa: PLC0415
        async_get_manager,
    )

    manager = await async_get_manager(hass)
    prefs = manager.data or {}
    out: dict[str, Any] = {}
    readings: list[str] = []
    battery_reading: str | None = None
    for source in prefs.get("energy_sources", []):
        if not isinstance(source, Mapping):
            continue
        kind = source.get("type")
        if kind == "solar":
            rows = out.setdefault("sources", [])
            entity_id = _known(hass, source.get("stat_rate"))
            if entity_id is None or len(rows) >= 3 or entity_id in rows:
                continue
            rows.append(entity_id)
            readings.append(_watts(hass, entity_id))
            if today := _known(hass, source.get("stat_energy_from")):
                out.setdefault("sources__options", {})[entity_id] = {"today": today}
        elif kind == "grid" and "grid_power" not in out:
            if power := _power(hass, _power_config(source), "from"):
                out.update({f"grid_power{k}": v for k, v in power[0].items()})
                readings.append(power[1])
            if today := _known(hass, _grid_energy(source)):
                out["grid_today"] = today
        elif kind == "battery" and "battery_power" not in out:
            if power := _power(hass, _power_config(source), "to"):
                out.update({f"battery_power{k}": v for k, v in power[0].items()})
                battery_reading = power[1]
            if level := _known(hass, source.get("stat_soc")):
                out["battery_level"] = level
    if not out.get("sources"):
        out.pop("sources", None)
    if readings:
        home = " + ".join(f"({r})" for r in readings)
        if battery_reading:
            home = f"{home} - ({battery_reading})"
        out["home_power__template"] = f"{{{{ ({home}) | round(0) }}}}"
    return out
