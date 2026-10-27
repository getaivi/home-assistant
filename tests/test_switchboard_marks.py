"""What a switchboard tile carries beyond its state: a gradient (a light's
live color or a picked one), a subtitle (the room, a reading or custom
text) and a picture (a URL that passes Aivi's rule)."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
)

from custom_components.aivi import engine
from custom_components.aivi.api import WidgetInfo
from custom_components.aivi.sources import HassStateResolver
from custom_components.aivi.switchboard import (
    light_gradient,
    user_gradient,
    valid_image_url,
    white_gradient,
)
from custom_components.aivi.templates import SWITCHBOARD
from helpers import (
    Resolver,
)

pytestmark = pytest.mark.usefixtures("inject_fake_client")


@pytest.fixture
def widgets() -> list[WidgetInfo]:
    return [WidgetInfo("livingroom", "Living room", "switchboard")]


def _tiles(bindings: dict[str, Any], resolver: Any) -> list[dict[str, Any]]:
    content = engine.resolve(SWITCHBOARD, bindings, resolver)
    assert content is not None
    return content["actions"]


def test_light_gradient_follows_the_live_color() -> None:
    def light(**attrs: Any) -> Resolver:
        return Resolver(states={"light.l": "on"}, attrs={"light.l": attrs})

    # rgb, hs and xy all become a pale tint then the color, as #RRGGBB.
    assert light_gradient("light.l", light(rgb_color=[255, 0, 0])) == [
        "#FF8080",
        "#FF0000",
    ]
    hs = light_gradient("light.l", light(hs_color=[240, 100]))
    assert hs == ["#8080FF", "#0000FF"]
    xy = light_gradient("light.l", light(xy_color=[0.1532, 0.0475]))
    assert xy is not None and len(xy) == 2
    assert all(stop.startswith("#") and len(stop) == 7 for stop in xy)
    # A color temperature is white: warm at 2700 K, cool at 6500 K, and
    # in between for 4000 K; the color mode decides even when HA also
    # reports the rgb equivalent.
    warm = light(color_mode="color_temp", color_temp_kelvin=2700, rgb_color=[1, 2, 3])
    assert light_gradient("light.l", warm) == ["#FFE4AD", "#FFAE5E"]
    assert light_gradient(
        "light.l", light(color_mode="color_temp", color_temp_kelvin=6500)
    ) == ["#F2F7FF", "#B9D3FF"]
    assert white_gradient(1500) == white_gradient(2200)
    assert white_gradient(9000) == white_gradient(6500)
    mid = white_gradient(3350)
    assert mid not in (white_gradient(2700), white_gradient(4000))
    # A kelvin alone (no color mode reported) still reads as white.
    assert light_gradient("light.l", light(color_temp_kelvin=2700)) == [
        "#FFE4AD",
        "#FFAE5E",
    ]
    # Off, or a light with no color at all: no gradient.
    off = Resolver(
        states={"light.l": "off"}, attrs={"light.l": {"rgb_color": [1, 2, 3]}}
    )
    assert light_gradient("light.l", off) is None
    assert light_gradient("light.l", light(brightness=128)) is None
    assert light_gradient("light.l", light(rgb_color=["x", 0, 0])) is None


def test_gradient_on_tiles_picked_derived_or_off() -> None:
    resolver = Resolver(
        states={"light.l": "on", "scene.movie": "scening", "script.s": "off"},
        attrs={"light.l": {"rgb_color": [0, 128, 255]}},
    )
    tiles = _tiles(
        {
            "actions": ["light.l", "scene.movie", "script.s"],
            "actions__options": {
                # A scene's own colors are not exposed by Home Assistant:
                # its gradient is the one picked in the panel.
                "scene.movie": {"gradient": "#3d3dff, #A64BFF,purple"},
                "script.s": {"gradient": "red"},  # one stop: ignored
            },
        },
        resolver,
    )
    assert tiles[0]["gradient"] == ["#80C0FF", "#0080FF"]
    assert tiles[1]["gradient"] == ["#3D3DFF", "#A64BFF", "purple"]
    assert "gradient" not in tiles[2]
    # `none` turns the light's automatic gradient off; a picked one wins
    # over the live color.
    none = _tiles(
        {"actions": ["light.l"], "actions__options": {"light.l": {"gradient": "None"}}},
        resolver,
    )
    assert "gradient" not in none[0]
    picked = _tiles(
        {
            "actions": ["light.l"],
            "actions__options": {"light.l": {"gradient": "#000000,#FFFFFF"}},
        },
        resolver,
    )
    assert picked[0]["gradient"] == ["#000000", "#FFFFFF"]
    assert user_gradient("#123456,#GGGGGG") is None
    assert user_gradient("a,b,c,d") is None
    assert user_gradient(7) is None


def test_action_color_takes_names_or_hex() -> None:
    resolver = Resolver(states={"switch.a": "on", "switch.b": "on", "switch.c": "on"})
    tiles = _tiles(
        {
            "actions": ["switch.a", "switch.b", "switch.c"],
            "actions__options": {
                "switch.a": {"color": "#ff8800"},
                "switch.b": {"color": "Teal"},
                "switch.c": {"color": "#f80"},  # no shorthand on the wire
            },
            "accent": "#ff8800",  # the accent stays named-only
        },
        resolver,
    )
    assert tiles[0]["color"] == "#FF8800"
    assert tiles[1]["color"] == "teal"
    assert "color" not in tiles[2]
    content = engine.resolve(
        SWITCHBOARD, {"actions": ["switch.a"], "accent": "#ff8800"}, resolver
    )
    assert content is not None and "accent" not in content


async def test_subtitle_defaults_to_the_area(hass: HomeAssistant) -> None:
    areas = ar.async_get(hass)
    kitchen = areas.async_create("Kitchen")
    porch = areas.async_create("Porch")
    entities = er.async_get(hass)
    lamp = entities.async_get_or_create("light", "test", "lamp")
    entities.async_update_entity(lamp.entity_id, area_id=kitchen.id)
    # An entity without an area of its own inherits its device's.
    config = MockConfigEntry(domain="test")
    config.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=config.entry_id, identifiers={("test", "porch-dev")}
    )
    dr.async_get(hass).async_update_device(device.id, area_id=porch.id)
    fountain = entities.async_get_or_create(
        "switch", "test", "fountain", device_id=device.id
    )
    loose = entities.async_get_or_create("switch", "test", "loose")
    hass.states.async_set(
        lamp.entity_id, "on", {"color_mode": "color_temp", "color_temp_kelvin": 2712}
    )
    hass.states.async_set(fountain.entity_id, "off")
    hass.states.async_set(loose.entity_id, "off")
    hass.states.async_set("fan.attic", "on", {"percentage": 60})

    resolver = HassStateResolver(hass)
    bindings: dict[str, Any] = {
        "actions": [lamp.entity_id, fountain.entity_id, loose.entity_id, "fan.attic"]
    }
    tiles = _tiles(bindings, resolver)
    assert tiles[0]["subtitle"] == {"value": "Kitchen"}
    assert tiles[1]["subtitle"] == {"value": "Porch"}
    assert "subtitle" not in tiles[2]  # no area anywhere
    assert "subtitle" not in tiles[3]  # not in the registry at all

    bindings["actions__options"] = {
        lamp.entity_id: {"subtitle_mode": "state"},
        fountain.entity_id: {"subtitle_mode": "state"},  # off: the room
        loose.entity_id: {"subtitle": "  Garden shed  "},
        "fan.attic": {"subtitle_mode": "state"},
    }
    tiles = _tiles(bindings, resolver)
    assert tiles[0]["subtitle"] == {"value": "2700 K"}
    assert tiles[1]["subtitle"] == {"value": "Porch"}
    assert tiles[2]["subtitle"] == {"value": "Garden shed"}
    assert tiles[3]["subtitle"] == {"value": "60%"}

    hass.states.async_set(lamp.entity_id, "on", {"brightness": 128})
    bindings["actions__options"][lamp.entity_id] = {"subtitle_mode": "state"}
    assert _tiles(bindings, resolver)[0]["subtitle"] == {"value": "50%"}
    bindings["actions__options"][lamp.entity_id] = {"subtitle_mode": "none"}
    assert "subtitle" not in _tiles(bindings, resolver)[0]


def test_image_urls_follow_the_aivi_rule() -> None:
    assert valid_image_url("https://example.com/a.png")
    assert valid_image_url("https://cdn.example.com")
    assert not valid_image_url("http://example.com/a.png")
    assert not valid_image_url("https:///a.png")  # no host
    assert not valid_image_url("https://exa mple.com/a.png")
    assert not valid_image_url("https://example.com/a b.png")
    assert not valid_image_url("/api/image_proxy/camera.front?token=abc")
    assert not valid_image_url("https://e.com/" + "a" * 2040)  # 2054 chars
    assert valid_image_url("https://e.com/" + "a" * 2034)  # exactly 2048
    assert not valid_image_url(None)


def test_tile_pictures() -> None:
    resolver = Resolver(
        states={"scene.a": "x", "scene.b": "x", "scene.c": "x", "scene.d": "x"},
        attrs={
            "scene.a": {"entity_picture": "https://img.example.com/a.png"},
            "scene.b": {"entity_picture": "/api/image/serve/abc/512x512"},
            "scene.c": {"entity_picture": "https://img.example.com/c.png"},
        },
    )
    tiles = _tiles(
        {
            "actions": ["scene.a", "scene.b", "scene.c", "scene.d"],
            "actions__options": {
                "scene.a": {"image_source": "entity_picture", "image_alt": "Sofa"},
                # Relative (authenticated) picture: never forwarded.
                "scene.b": {"image_source": "entity_picture"},
                # Not opted in: the entity picture is not sent.
                "scene.c": {},
                "scene.d": {
                    "image": "https://example.com/d.jpg",
                    "image_alt": "x" * 80,
                },
            },
        },
        resolver,
    )
    assert tiles[0]["image"] == {"url": "https://img.example.com/a.png", "alt": "Sofa"}
    assert "image" not in tiles[1]
    assert "image" not in tiles[2]
    assert tiles[3]["image"] == {"url": "https://example.com/d.jpg", "alt": "x" * 64}
    bad = _tiles(
        {
            "actions": ["scene.d"],
            "actions__options": {"scene.d": {"image": "http://example.com/d.jpg"}},
        },
        resolver,
    )
    assert "image" not in bad[0]
    # The icon is always there, whatever else the tile carries.
    assert all(tile["icon"] for tile in tiles)
