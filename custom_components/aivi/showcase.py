"""The showcase template: a picture of the thing, its state, when it last
reported and one to six readings. Cars, vacuums, printers, plants.
Display only, no actions.

The parts of the content that are not plain blocks: the picture (an https
URL, never fetched by the integration), the state mark's word (a
``Value`` without a formatter, one short line), when the thing last
reported (an entity's ``last_reported``), the stats (one row per entity,
with a unit, a symbol and a gauge ceiling of its own), and the 4 KiB
measure of the content as Aivi stores it.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any, Final, override

from . import blocks, limits
from .blocks import ROW_COLOR, ROW_ICON, EntityRows, row_label
from .sources import (
    ReportedResolver,
    Source,
    StateResolver,
    display_state_of,
    name_in_device_of,
)
from .sourcing import Bare, ValueSlot
from .switchboard.marks import valid_image_url
from .switchboard.size import (
    ICON_KEYS,
    IMAGE_KEYS,
    VALUE_KEYS,
    filled,
    stored_url,
)
from .values import SlotKind, finite_number, wire_number

SHOWCASE_TEMPLATE: Final = "showcase"

#: How a picture fills its slot: a cut-out on a clear background (the
#: default, left out of the content), or a photo cropped to the slot.
PICTURE_FITS: Final[tuple[str, ...]] = ("contain", "cover")

#: The per-stat options, stored under ``stats__options`` as entity id ->
#: {option: string}: the label and unit shown, a symbol for where the stat
#: stands alone, its value's color, and ``max`` for a gauge.
STAT_OPTIONS: Final[tuple[str, ...]] = ("label", "unit", "icon", "color", "max")

#: What a gauge stat's value must look like on the wire: digits, an
#: optional minus and fraction, nothing else (Aivi's rule for ``max``).
_PLAIN_NUMBER: Final = re.compile(r"-?[0-9]+(\.[0-9]+)?")

#: The character categories a state word may not contain: control
#: characters (tabs and line breaks among them), line and paragraph
#: separators, and lone surrogates. Aivi refuses them; here they become
#: spaces, so a sensor that reports one still shows a word.
_WORD_FORBIDDEN: Final = frozenset({"Cc", "Zl", "Zp", "Cs"})


class PictureUrl(blocks.Text):
    """A picture's URL (Aivi's ``Image.url``): https with a host, no
    whitespace, at most 2048 characters. Sourceable, so an entity's own
    ``entity_picture`` or a template can supply it; anything else (a
    Home Assistant address, a plain path) is left out rather than
    refused, as every sourced value is."""

    KIND = SlotKind.URL

    def __init__(self, *, max_length: int = limits.IMAGE_URL) -> None:
        super().__init__(max_length=max_length)

    @override
    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        url = super().resolve(key, data, resolver)
        return url if valid_image_url(url) else None


class PictureFit(blocks.Enum):
    """``contain`` or ``cover``; the default is left out of the content,
    as Aivi stores it."""

    def __init__(self) -> None:
        super().__init__(list(PICTURE_FITS))

    @override
    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        fit = super().resolve(key, data, resolver)
        return None if fit == PICTURE_FITS[0] else fit


def state_word(value: Any) -> str | None:
    """A state mark's word as Aivi takes it: trimmed, one short line of
    at most 24 characters, or nothing. Characters Aivi refuses become
    spaces first, so the word survives a stray tab."""
    if value is None:
        return None
    text = "".join(
        " " if unicodedata.category(char) in _WORD_FORBIDDEN else char
        for char in str(value)
    ).strip()
    text = text[: limits.STATE_TEXT].strip()
    return text or None


class StateWord(blocks.Value):
    """The state mark's word: a ``Value`` (sourceable, with a text color)
    that is a word, not a timer, so it takes no formatter, and is held to
    one short line."""

    FORMATTER = False
    SLOT = ValueSlot(bare=Bare.ENTITY, max_length=limits.STATE_TEXT)

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> dict[str, Any] | None:
        out = super().resolve(key, data, resolver)
        if out is None:
            return None
        word = state_word(out.get("value"))
        if word is None:
            return None
        out["value"] = word
        out.pop("formatter", None)
        return out


def wire_moment(moment: datetime) -> str:
    """A moment as Aivi stores ``reported_at``: UTC, whole seconds,
    ``2026-10-05T07:41:12Z``."""
    return moment.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


class LastReported(blocks.Timestamp):
    """When the thing last reported. From an entity: when Home Assistant
    last heard from it (``last_reported``, so an unchanged reading still
    counts), never its state read as a date; a resolver that cannot say
    leaves it out. From an attribute or a template: the value read as a
    timestamp (a car's ``last_sync`` attribute). Display only on the
    device: it never makes the widget stale."""

    @override
    def resolve(self, key: str, data: dict[str, Any], resolver: StateResolver) -> Any:
        source = self.SLOT.source(key, data)
        if source is None:
            return None
        if source.source is Source.ENTITY:
            if source.entity_id is None or not isinstance(resolver, ReportedResolver):
                return None
            moment = resolver.last_reported(source.entity_id)
            return None if moment is None else wire_moment(moment)
        stamp = super().resolve(key, data, resolver)
        if stamp is None:
            return None
        try:
            return wire_moment(datetime.fromisoformat(str(stamp)))
        except (ValueError, OverflowError):
            return None


def _stat_label(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> str:
    """The stat's label: the user's, else the entity's name. A showcase
    is one thing, so an entity on a device reads by its own name ("Time
    left"), not with the device's in front ("Washer Time left") on every
    row."""
    label = str(options.get("label") or "").strip()
    if not label:
        label = name_in_device_of(resolver, entity_id) or ""
    if not label:
        label = str(resolver.attribute(entity_id, "friendly_name") or "").strip()
    return (label or entity_id)[: limits.STAT_LABEL]


def _stat_unit(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> str | None:
    """The stat's unit: the row's own, else the entity's own
    ``unit_of_measurement``, held to Aivi's cap."""
    unit = options.get("unit")
    if not isinstance(unit, str) or not unit:
        raw = resolver.attribute(entity_id, "unit_of_measurement")
        unit = str(raw).strip() if raw is not None else ""
    return unit[: limits.STAT_UNIT] or None


def _stat_text(entity_id: str, state: str, resolver: StateResolver) -> str:
    """What the stat reads: a number as the sensor wrote it when Aivi
    takes it as one, else as a plain number, else the state in Home
    Assistant's words."""
    if _PLAIN_NUMBER.fullmatch(state):
        return state
    number = finite_number(state)
    if number is not None:
        return str(wire_number(number))
    return str(display_state_of(resolver, entity_id) or state)[: limits.VALUE]


def stat_row(
    entity_id: str, resolver: StateResolver, options: dict[str, Any]
) -> dict[str, Any] | None:
    """One stat, from options coerced by ``StatRows``' row slots. An
    entity Home Assistant has no state for has no stat; an unavailable
    one keeps its stat, reading so in Home Assistant's words, so the
    widget's layout holds. ``max`` goes only with a value Aivi takes as a
    plain number, since the content is refused otherwise."""
    state = resolver.state(entity_id)
    if state is None:
        return None
    text = _stat_text(entity_id, state, resolver)
    value: dict[str, Any] = {"value": text}
    if color := options.get("color"):
        value["text_color"] = color
    row: dict[str, Any] = {
        "label": _stat_label(entity_id, resolver, options),
        "value": value,
    }
    if unit := _stat_unit(entity_id, resolver, options):
        row["unit"] = unit
    if icon := options.get("icon"):
        row["icon"] = icon
    ceiling = options.get("max")
    if ceiling is not None and _PLAIN_NUMBER.fullmatch(text):
        row["max"] = ceiling
    return row


class StatRows(EntityRows):
    """The showcase's stats (one to six) and a remote's (up to three): an
    ordered pick of entities, each a labelled reading."""

    ROW_SLOTS = (
        row_label(limits.STAT_LABEL),
        ValueSlot("unit", SlotKind.TEXT, max_length=limits.STAT_UNIT),
        ROW_ICON,
        ROW_COLOR,
        ValueSlot("max", SlotKind.NUMBER, positive=True),
    )

    def __init__(self, *, max_rows: int = limits.STATS) -> None:
        super().__init__(
            row_builder=stat_row, row_options=STAT_OPTIONS, max_rows=max_rows
        )


def stored_image(image: Any, *, fit: bool) -> Any:
    """A picture as Aivi stores it: ``alt`` present, ``fit`` only when
    it is not the default."""
    if not isinstance(image, dict):
        return image
    stored = filled(image, IMAGE_KEYS)
    if fit and stored.get("fit") == PICTURE_FITS[0]:
        del stored["fit"]
    stored["url"] = stored_url(stored.get("url"))
    return stored


def stored_stat(stat: Any) -> Any:
    if not isinstance(stat, dict):
        return stat
    stored = dict(stat)
    stored["value"] = filled(stored.get("value"), VALUE_KEYS)
    return stored


def content_size(content: dict[str, Any], *, state_text: bool = True) -> int:
    """The size Aivi measures a showcase's content at: compact,
    ASCII-escaped JSON of the content as Aivi stores it. The widget's
    icon, accent and tap URL are stored null when unset, a stat's value
    with its color and formatter; every other optional part is stored
    only when set. ``state_text`` is the measure's signature; a showcase
    has no state words."""
    del state_text
    stored: dict[str, Any] = {
        "icon": None,
        "accent": None,
        "tap_url": None,
        **content,
        "template": SHOWCASE_TEMPLATE,
    }
    stored["icon"] = filled(stored["icon"], ICON_KEYS)
    stored["tap_url"] = stored_url(stored["tap_url"])
    if "image" in stored:
        stored["image"] = stored_image(stored["image"], fit=True)
    if "badge" in stored:
        stored["badge"] = stored_image(stored["badge"], fit=False)
    state = stored.get("state")
    if isinstance(state, dict) and isinstance(state.get("icon"), dict):
        stored["state"] = {**state, "icon": filled(state["icon"], ICON_KEYS)}
    stored["stats"] = [stored_stat(s) for s in stored.get("stats") or []]
    return len(json.dumps(stored, separators=(",", ":")))
