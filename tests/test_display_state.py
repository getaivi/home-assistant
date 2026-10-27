"""States shown as text go out the way Home Assistant words them: "Away",
not ``not_home``; "Open" for a door that is ``on``. Numbers, switches and
moments still read the raw state they parse."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.aivi import engine
from custom_components.aivi.sources import HassStateResolver, display_state_of
from custom_components.aivi.templates import LIST, PROGRESS, STATUS


async def _words(hass: HomeAssistant) -> None:
    """Load the domains whose state words the tests read."""
    for domain in ("switch", "device_tracker", "binary_sensor", "sensor"):
        assert await async_setup_component(hass, domain, {})
    await hass.async_block_till_done()


async def test_states_read_as_home_assistant_words_them(hass: HomeAssistant) -> None:
    await _words(hass)
    hass.states.async_set("switch.ac", "off")
    hass.states.async_set("device_tracker.anne", "not_home")
    hass.states.async_set("binary_sensor.front_door", "on", {"device_class": "door"})
    hass.states.async_set("sensor.living_temp", "21.5", {"unit_of_measurement": "°C"})
    hass.states.async_set("sensor.washer_state", "Washing")
    resolver = HassStateResolver(hass)

    assert resolver.display_state("switch.ac") == "Off"
    assert resolver.display_state("device_tracker.anne") == "Away"
    # The device class decides the word: a door is open, not "on".
    assert resolver.display_state("binary_sensor.front_door") == "Open"
    # What has no word of its own stays as it is.
    assert resolver.display_state("sensor.living_temp") == "21.5"
    assert resolver.display_state("sensor.washer_state") == "Washing"
    assert resolver.display_state("sensor.gone") is None


async def test_a_status_and_a_list_push_the_words(hass: HomeAssistant) -> None:
    await _words(hass)
    hass.states.async_set("switch.ac", "off", {"friendly_name": "AC"})
    hass.states.async_set("device_tracker.anne", "not_home", {"friendly_name": "Anne"})
    resolver = HassStateResolver(hass)

    status = engine.resolve(STATUS, {"state": "device_tracker.anne"}, resolver)
    assert status is not None and status["state"]["value"] == "Away"

    rows = engine.resolve(
        LIST, {"rows": ["switch.ac", "device_tracker.anne"]}, resolver
    )
    assert rows is not None
    assert [(row["label"], row["value"]["value"]) for row in rows["rows"]] == [
        ("AC", "Off"),
        ("Anne", "Away"),
    ]


async def test_numbers_and_unavailable_states_are_untouched(
    hass: HomeAssistant,
) -> None:
    await _words(hass)
    hass.states.async_set("sensor.washer_progress", "62")
    hass.states.async_set("switch.ac", "unavailable")
    resolver = HassStateResolver(hass)

    # A number slot parses the raw state.
    content = engine.resolve(PROGRESS, {"progress": "sensor.washer_progress"}, resolver)
    assert content is not None and content["progress"]["value"] == 0.62
    # An unavailable entity still resolves to nothing, never to a word.
    assert engine.resolve(STATUS, {"state": "switch.ac"}, resolver) is None


def test_a_resolver_without_translations_gives_the_raw_state() -> None:
    class Plain:
        def state(self, entity_id: str) -> str | None:
            return "not_home"

    assert display_state_of(Plain(), "device_tracker.anne") == "not_home"  # type: ignore[arg-type]
