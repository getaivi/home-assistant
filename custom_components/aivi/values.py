"""Value coercion: what a resolved value becomes on the wire.

A leaf module: it imports nothing from the integration but the limits
table, so every other module can use it.
"""

from __future__ import annotations

import ast
import json
import math
import re
from datetime import UTC, date, datetime, time
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any, Final

from homeassistant.util import dt as dt_util

from . import limits

#: The states that read as on: a Live Activity runs while its active
#: entity reads one, and a yes-or-no value reads one as true. The panel gets
#: them in the template metadata.
ON_STATES: Final = frozenset(
    {
        "on",
        "true",
        "home",
        "open",
        "1",
        "yes",
        "playing",
        "active",
        "charging",
    }
)


def as_bool(value: Any) -> bool:
    return str(value).strip().lower() in ON_STATES


def wire_number(value: float) -> int | float:
    """Normalize a computed number for the wire.

    Rounds to 12 significant digits to strip float noise
    (``41 * 0.01 == 0.41000000000000003``) and collapses integral floats to
    ints. 12 digits is far above real sensor resolution and below float
    noise (16–17), and preserves ``SegmentList``'s 1024ths exactly (at most
    10 digits), keeping its sum-is-exactly-1.0 invariant.
    """
    rounded = float(f"{value:.12g}")
    if rounded.is_integer() and abs(rounded) < 2**53:
        return int(rounded)
    return rounded


def finite_number(value: Any) -> int | float | None:
    """``value`` as a wire number, or ``None`` when it is not a finite
    number (JSON has no NaN or infinity)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return wire_number(number) if math.isfinite(number) else None


def wire_timestamp(value: Any) -> str | None:
    """``value`` as an ISO 8601 timestamp with a UTC offset, or ``None``.

    Takes what states and templates produce: an ISO string (a naive one,
    or a bare date, is read in Home Assistant's time zone), a
    ``datetime``/``date``, or a Unix timestamp in seconds."""
    if isinstance(value, datetime):
        moment: datetime | None = value
    elif isinstance(value, date):
        moment = datetime.combine(value, time())
    else:
        text = str(value).strip()
        try:
            moment = dt_util.parse_datetime(text)
        except ValueError:  # a well-formed but impossible date
            return None
        if moment is None and (day := dt_util.parse_date(text)) is not None:
            moment = datetime.combine(day, time())
        if moment is None and (seconds := finite_number(text)) is not None:
            try:
                moment = datetime.fromtimestamp(seconds, UTC)
            except (OverflowError, OSError, ValueError):
                return None
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_util.get_default_time_zone())
    return moment.isoformat()


def parse_list(value: Any) -> list[Any] | None:
    """A list from an attribute or a template render: a list as is, or
    text holding JSON or a Python literal; ``None`` otherwise."""
    if isinstance(value, list | tuple):
        return list(value)
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = json.loads(text)
    except ValueError:
        try:
            parsed = ast.literal_eval(text)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            return None
    return list(parsed) if isinstance(parsed, list | tuple) else None


def series(value: Any) -> list[float] | None:
    """The finite numbers of a list (``SlotKind.SERIES``), or ``None``."""
    items = parse_list(value)
    if items is None:
        return None
    numbers = [n for item in items if (n := finite_number(item)) is not None]
    return numbers or None


class SlotKind(StrEnum):
    """What a slot holds. Decides the coercer, and tells the panel which
    control to render."""

    COLOR = "color"
    #: A named color or ``#RRGGBB``: Aivi's ``ColorV2``, accepted only on
    #: a switchboard action's ``color`` and ``gradient`` (everywhere else
    #: hex is a 422, so everywhere else stays ``COLOR``).
    ACTION_COLOR = "action_color"
    TEXT = "text"
    #: A link the widget opens (``tap_url``): an absolute URI, else nothing.
    URL = "url"
    ICON = "icon"
    NUMBER = "number"
    #: An amount of money, as the decimal string Aivi stores (no float
    #: rounding of what a sensor reported).
    MONEY = "money"
    #: An ISO 4217 code: three letters, sent uppercase.
    CURRENCY = "currency"
    BOOL = "bool"
    #: A moment, sent as ISO 8601 with a UTC offset (``wire_timestamp``).
    TIMESTAMP = "timestamp"
    #: A list of numbers (a trend's points from an attribute or template).
    SERIES = "series"
    ENUM = "enum"


# Applied to every resolved value regardless of where it came from, so a
# literal is clamped exactly as a template render is. Returning None means
# "no usable value", which is what triggers the fallback.

#: The longest text a text slot takes when its field sets no cap.
TEXT_MAX = 256

#: An absolute URI (RFC 3986): a scheme, then only characters a URI may
#: carry unescaped.
_URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:" r"[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")

#: Aivi's hex color: six digits, no alpha, no three-digit shorthand.
HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")

#: An amount: optional sign, digits, at most one point (Aivi's pattern).
_MONEY = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)")


def wire_money(value: Any) -> str | None:
    """A finite amount as a plain decimal string, else ``None``. A string
    a sensor reported keeps its digits ("519.30"); a float is written at
    the precision ``wire_number`` keeps; exponents are expanded."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        number = finite_number(value)
        if number is None:
            return None
        value = repr(number)
    text = str(value).strip()
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    if not amount.is_finite():
        return None
    out = format(amount, "f")
    return out if _MONEY.fullmatch(out) else None


def action_color(value: Any, names: tuple[str, ...]) -> str | None:
    """A named color from ``names`` (lowercased) or ``#RRGGBB``
    (uppercased, the form Aivi stores), else ``None``."""
    if value is None:
        return None
    text = str(value).strip()
    if HEX_COLOR.fullmatch(text):
        return text.upper()
    name = text.lower()
    return name if name in names else None


def wire_url(value: Any, max_length: int = limits.TAP_URL) -> str | None:
    """An absolute URI no longer than ``max_length``, else ``None``. A
    URL is never shortened: a cut one would open the wrong page."""
    if value is None:
        return None
    text = str(value).strip()
    if len(text) > max_length or not _URL.fullmatch(text):
        return None
    return text


def coerce(
    kind: SlotKind,
    value: Any,
    options: tuple[str, ...] = (),
    max_length: int | None = None,
) -> Any:
    """Clamp a value to what its kind can put on the wire."""
    if value is None:
        return None
    match kind:
        case SlotKind.COLOR | SlotKind.ENUM:
            name = str(value).strip()
            if kind is SlotKind.COLOR:
                name = name.lower()
            return name if name in options else None
        case SlotKind.ACTION_COLOR:
            return action_color(value, options)
        case SlotKind.TEXT:
            text = str(value).strip()[: max_length or TEXT_MAX]
            return text or None
        case SlotKind.URL:
            return wire_url(value, max_length or limits.TAP_URL)
        case SlotKind.ICON:
            name = str(value).strip()[: limits.ICON]
            return name or None
        case SlotKind.NUMBER:
            return finite_number(value)
        case SlotKind.MONEY:
            return wire_money(value)
        case SlotKind.CURRENCY:
            code = str(value).strip().upper()
            return code if re.fullmatch(r"[A-Z]{3}", code) else None
        case SlotKind.BOOL:
            return as_bool(value)
        case SlotKind.TIMESTAMP:
            return wire_timestamp(value)
        case SlotKind.SERIES:
            return series(value)
    return None
