"""A tile's marks: its subtitle, gradient and picture."""

from __future__ import annotations

import itertools
import math
import re
from typing import Any, Final, cast

from homeassistant.const import STATE_ON
from homeassistant.util import color as color_util

from .. import limits
from ..blocks import COLORS
from ..sources import AreaResolver, StateResolver
from ..values import action_color

_PALETTE: Final = tuple(COLORS)

#: ``gradient`` set to this turns the automatic light gradient off.
GRADIENT_NONE: Final = "none"

#: ``image_source`` set to this opts a tile into the entity's own picture.
IMAGE_FROM_ENTITY: Final = "entity_picture"

# Aivi's image URL rule: https, a non-empty host, no whitespace anywhere.
_HTTPS_URL = re.compile(r"https://[^\s/?#]+[^\s]*")

# Light attributes (the `light` component's names, as strings so this
# module does not import the light integration).
_COLOR_MODE: Final = "color_mode"
_RGB: Final = "rgb_color"
_HS: Final = "hs_color"
_XY: Final = "xy_color"
_KELVIN: Final = "color_temp_kelvin"
_BRIGHTNESS: Final = "brightness"
_PERCENTAGE: Final = "percentage"

#: White light, warm to cool: (kelvin, pale stop, deep stop), interpolated
#: so a bulb never reads as raw blackbody orange or flat white.
_WHITES: Final[tuple[tuple[int, tuple[int, int, int], tuple[int, int, int]], ...]] = (
    (2200, (0xFF, 0xD9, 0xA0), (0xFF, 0x9F, 0x45)),
    (2700, (0xFF, 0xE4, 0xAD), (0xFF, 0xAE, 0x5E)),
    (4000, (0xFF, 0xF4, 0xE2), (0xFF, 0xDB, 0xA8)),
    (6500, (0xF2, 0xF7, 0xFF), (0xB9, 0xD3, 0xFF)),
)


def valid_image_url(url: Any) -> bool:
    """Whether Aivi accepts ``url`` as an ``Image.url``."""
    return (
        isinstance(url, str)
        and len(url) <= limits.IMAGE_URL
        and _HTTPS_URL.fullmatch(url) is not None
    )


def _hex(rgb: tuple[float, float, float]) -> str:
    r, g, b = (min(max(round(c), 0), 255) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def _mix(
    a: tuple[float, float, float], b: tuple[float, float, float], t: float
) -> tuple[float, float, float]:
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


_WHITE: Final = (255.0, 255.0, 255.0)


def white_gradient(kelvin: float) -> list[str]:
    """Two stops for white light at ``kelvin``, warm to cool."""
    first = _WHITES[0]
    if kelvin <= first[0]:
        return [_hex(first[1]), _hex(first[2])]
    for (k1, pale1, deep1), (k2, pale2, deep2) in itertools.pairwise(_WHITES):
        if kelvin <= k2:
            t = (kelvin - k1) / (k2 - k1)
            return [_hex(_mix(pale1, pale2, t)), _hex(_mix(deep1, deep2, t))]
    last = _WHITES[-1]
    return [_hex(last[1]), _hex(last[2])]


def color_gradient(rgb: tuple[float, float, float]) -> list[str]:
    """Two stops for colored light: a pale tint of it, then the color."""
    return [_hex(_mix(rgb, _WHITE, 0.5)), _hex(rgb)]


def _numbers(value: Any, count: int) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) < count:
        return None
    try:
        numbers = tuple(float(v) for v in value[:count])
    except (TypeError, ValueError):
        return None
    return numbers if all(math.isfinite(n) for n in numbers) else None


def light_gradient(entity_id: str, resolver: StateResolver) -> list[str] | None:
    """The gradient of a light while it is on, from its live color.
    ``None`` while off or for a light with no color: the tile then falls
    back to its icon."""
    if resolver.state(entity_id) != STATE_ON:
        return None
    attr = resolver.attribute
    kelvin = _numbers([attr(entity_id, _KELVIN)], 1)
    if attr(entity_id, _COLOR_MODE) == "color_temp" and kelvin:
        return white_gradient(kelvin[0])
    if rgb := _numbers(attr(entity_id, _RGB), 3):
        return color_gradient((rgb[0], rgb[1], rgb[2]))
    if hs := _numbers(attr(entity_id, _HS), 2):
        return color_gradient(color_util.color_hs_to_RGB(hs[0], hs[1]))
    if xy := _numbers(attr(entity_id, _XY), 2):
        return color_gradient(color_util.color_xy_to_RGB(xy[0], xy[1]))
    if kelvin:
        return white_gradient(kelvin[0])
    return None


def user_gradient(raw: Any) -> list[str] | None:
    """A picked gradient, stored as comma-separated stops (named colors
    or ``#RRGGBB``). ``None`` unless it yields 2 to 3 valid stops."""
    if not isinstance(raw, str):
        return None
    stops = [action_color(part, _PALETTE) for part in raw.split(",") if part.strip()]
    if not 2 <= len(stops) <= limits.TILE_GRADIENT or None in stops:
        return None
    return [stop for stop in stops if stop is not None]


def state_reading(entity_id: str, resolver: StateResolver) -> str | None:
    """A short reading of the entity while it is on: a white light's
    color temperature, a dimmed light's brightness, a fan's speed."""
    if resolver.state(entity_id) != STATE_ON:
        return None
    domain = entity_id.partition(".")[0]
    attr = resolver.attribute
    if domain == "light":
        kelvin = _numbers([attr(entity_id, _KELVIN)], 1)
        if attr(entity_id, _COLOR_MODE) == "color_temp" and kelvin:
            return f"{round(kelvin[0] / 100) * 100} K"
        if brightness := _numbers([attr(entity_id, _BRIGHTNESS)], 1):
            return f"{round(brightness[0] / 255 * 100)}%"
    if domain == "fan" and (percentage := _numbers([attr(entity_id, _PERCENTAGE)], 1)):
        return f"{round(percentage[0])}%"
    return None


def tile_subtitle(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> str | None:
    """The second line: the custom text, else what ``subtitle_mode``
    says: ``area`` (the default) is the entity's room; ``state`` a short
    reading of the entity while it is on ("2700 K", "60%"), falling back
    to the room; ``none`` leaves the line to the phone."""
    if custom := options.get("subtitle"):
        return cast("str", custom)
    mode = options.get("subtitle_mode")
    if mode == "none":
        return None
    reading = state_reading(entity_id, resolver) if mode == "state" else None
    if reading is None and isinstance(resolver, AreaResolver):
        reading = resolver.area_name(entity_id)
    return reading[: limits.VALUE] if reading else None


def tile_gradient(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> list[str] | None:
    """The picked gradient, else a light's live color (unless turned
    off with ``none``). A scene gets only a picked one: Home Assistant
    does not expose the colors a scene sets."""
    raw = options.get("gradient")
    if isinstance(raw, str) and raw.strip().lower() == GRADIENT_NONE:
        return None
    if picked := user_gradient(raw):
        return picked
    if entity_id.partition(".")[0] == "light":
        return light_gradient(entity_id, resolver)
    return None


def tile_image(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, str] | None:
    """The tile's picture: the URL the user set, else (only when opted
    in) the entity's own picture, if Aivi accepts the URL.
    ``entity_picture`` is usually a relative or authenticated path the
    phone cannot fetch, hence opt-in."""
    url = str(options.get("image") or "").strip()
    if not url and options.get("image_source") == IMAGE_FROM_ENTITY:
        url = str(resolver.attribute(entity_id, "entity_picture") or "").strip()
    if not valid_image_url(url):
        return None
    image = {"url": url}
    if alt := str(options.get("image_alt") or "").strip():
        image["alt"] = alt[: limits.LABEL]
    return image
