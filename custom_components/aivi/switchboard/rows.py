"""The switchboard's rows: one tile per bound entity."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final, override

from homeassistant.const import STATE_ON

from .. import limits
from ..blocks import COLORS, ROW_ICON, EntityRows, row_label
from ..sources import Naming, StateResolver, entity_name_of
from ..sourcing import ValueSlot
from ..values import SlotKind
from .ids import ACTION_DOMAINS, action_ids, kind_of
from .marks import (
    GRADIENT_NONE,
    IMAGE_FROM_ENTITY,
    tile_gradient,
    tile_image,
    tile_subtitle,
    user_gradient,
    valid_image_url,
)
from .words import STATE_TEXT_OPTION, state_text, toggle_on

if TYPE_CHECKING:
    from ..templates import TemplateDef

#: The glyph a tile gets when its row sets none: one SF Symbol per domain.
_DEFAULT_ICONS: Final[dict[str, str]] = {
    "light": "lightbulb.fill",
    "switch": "power",
    "fan": "fan.fill",
    "input_boolean": "switch.2",
    "automation": "gearshape.2.fill",
    "humidifier": "humidity.fill",
    "siren": "light.beacon.max.fill",
    "scene": "sparkles",
    "script": "play.fill",
    "button": "hand.tap.fill",
    "input_button": "hand.tap.fill",
    "cover": "blinds.horizontal.closed",
    "valve": "spigot.fill",
    "lock": "lock.fill",
    "climate": "thermometer.medium",
}
#: A garage door gets its own glyph (a cover's ``device_class``).
_GARAGE_ICON: Final = "door.garage.closed"
_FALLBACK_ICON: Final = "switch.2"

_PALETTE: Final = tuple(COLORS)

#: The per-row options a tile takes, stored under ``actions__options``
#: as entity id -> {option: string}. ``subtitle_mode`` is area,
#: state or none (``tile_subtitle``); ``gradient`` is 2 to 3 comma-separated stops, or
#: ``none``; ``image_source`` is ``entity_picture`` to opt in to the
#: entity's own picture.
ROW_OPTIONS: Final[tuple[str, ...]] = (
    "label",
    "icon",
    "color",
    "subtitle",
    "subtitle_mode",
    "gradient",
    "image",
    "image_alt",
    "image_source",
    # One per ``STATE_TEXT_KEYS`` word.
    "state_text_on",
    "state_text_off",
    "state_text_turning_on",
    "state_text_turning_off",
    "state_text_no_response",
    "state_text_idle",
    "state_text_active",
    "state_text_sent",
)


def _label(
    entity_id: str, resolver: StateResolver, options: dict[str, Any], naming: Naming
) -> str:
    """The label a tile shows: the user's, else the entity's name."""
    label = str(options.get("label") or "").strip()
    if not label:
        label = entity_name_of(resolver, entity_id, naming)
    return label[: limits.TILE_LABEL]


def action_row(
    entity_id: str,
    action: str,
    resolver: StateResolver,
    options: dict[str, Any],
    *,
    tiles: bool = True,
    naming: Naming = Naming.FULL,
) -> dict[str, Any]:
    """One tile, from options coerced by ``ActionRows``' row slots. An
    unavailable entity still gets its tile (off), so the grid keeps its
    shape. The icon is always set, since some surfaces draw nothing
    else. Without ``tiles`` (a Live Activity's buttons) the row is its
    id, label, icon, color and state only: Aivi refuses the rest there."""
    domain = entity_id.partition(".")[0]
    state = resolver.state(entity_id)
    label = _label(entity_id, resolver, options, naming)
    icon = options.get("icon")
    if (
        not icon
        and domain == "cover"
        and resolver.attribute(entity_id, "device_class") == "garage"
    ):
        icon = _GARAGE_ICON
    row: dict[str, Any] = {
        "id": action,
        "label": label,
        "icon": icon or _DEFAULT_ICONS.get(domain, _FALLBACK_ICON),
    }
    if color := options.get("color"):
        row["color"] = color
    if tiles:
        if subtitle := tile_subtitle(entity_id, resolver, options):
            row["subtitle"] = {"value": subtitle}
        if gradient := tile_gradient(entity_id, resolver, options):
            row["gradient"] = gradient
        if image := tile_image(entity_id, resolver, options):
            row["image"] = image
        if words := state_text(entity_id, state, options):
            row["state_text"] = words
    if kind_of(entity_id) == "toggle":
        row["kind"] = "toggle"
        row["on"] = toggle_on(entity_id, state)
    elif domain == "script" and state == STATE_ON:
        row["active"] = True
    return row


#: The per-row options of a Live Activity's buttons, which draw no
#: subtitle, gradient, picture or state words.
BUTTON_OPTIONS: Final[tuple[str, ...]] = ("label", "icon", "color")


class ActionRows(EntityRows):
    """The switchboard's rows (and a remote's buttons): an ordered pick of
    entities resolved to Aivi actions with their derived ids.
    ``tiles=False`` keeps only what a Live Activity's buttons draw;
    ``naming`` is how a row without a label names its entity (a
    switchboard mixes devices, so its tiles keep the full name)."""

    #: The action color takes hex too.
    ROW_SLOTS = (
        ValueSlot("color", SlotKind.ACTION_COLOR, options=_PALETTE),
        ROW_ICON,
        row_label(limits.TILE_LABEL),
        ValueSlot("subtitle", SlotKind.TEXT, max_length=limits.VALUE),
    )

    MAX = limits.ROWS

    OPTION_NOTES = {
        "subtitle_mode": "what the second line shows when no subtitle is set:"
        " area (the room), state (a short reading while on) or none",
        "gradient": "2 to 3 colours (palette names or #RRGGBB) separated by"
        " commas, painted while the tile is on; or none",
        "image": "an https URL of a picture for the tile",
        "image_alt": "what the picture shows, for VoiceOver",
        "image_source": "entity_picture to use the entity's own picture",
        **{
            option: "the word shown for that state"
            for option in ROW_OPTIONS
            if option.startswith(STATE_TEXT_OPTION)
        },
    }

    @override
    def clean_option(self, option: str, value: Any) -> Any | None:
        if not isinstance(value, str) or not (text := value.strip()):
            return None
        if option == "subtitle_mode":
            return text if text in ("area", "state", "none") else None
        if option == "gradient":
            if text.lower() == GRADIENT_NONE:
                return GRADIENT_NONE
            stops = user_gradient(text)
            return ", ".join(stops) if stops else None
        if option == "image":
            return text if valid_image_url(text) else None
        if option == "image_source":
            return text if text == IMAGE_FROM_ENTITY else None
        if option.startswith(STATE_TEXT_OPTION):
            return text[: limits.STATE_TEXT]
        return super().clean_option(option, text)

    def __init__(
        self,
        *,
        max_rows: int | None = None,
        tiles: bool = True,
        naming: Naming = Naming.FULL,
    ) -> None:
        super().__init__(
            domain=list(ACTION_DOMAINS),
            row_options=ROW_OPTIONS if tiles else BUTTON_OPTIONS,
            max_rows=max_rows,
            naming=naming,
        )
        self.tiles = tiles

    @override
    def resolve(
        self, key: str, data: dict[str, Any], resolver: StateResolver
    ) -> list[dict[str, Any]] | None:
        entity_ids = self.entity_ids(key, data)
        ids = action_ids(entity_ids)
        rows = [
            action_row(
                entity_id,
                ids[entity_id],
                resolver,
                self.tile_options(key, data, entity_id, resolver),
                tiles=self.tiles,
                naming=self.naming,
            )
            for entity_id in entity_ids
        ]
        return rows or None

    def tile_options(
        self,
        key: str,
        data: dict[str, Any],
        entity_id: str,
        resolver: StateResolver,
    ) -> dict[str, Any]:
        """The row's options, plus its state words as stored: the shared
        path drops empty strings, and ``""`` is a word here (hidden)."""
        options = self._options_for(key, data, entity_id, resolver)
        if not self.tiles:
            return options
        for option, value in self._stored_options(key, data, entity_id).items():
            if option.startswith(STATE_TEXT_OPTION) and option in ROW_OPTIONS:
                options[option] = value
        return options


_ROWS = ActionRows()


def tile_label(
    template: TemplateDef | None,
    bindings: dict[str, Any],
    entity_id: str,
    resolver: StateResolver,
) -> str:
    """The label ``entity_id``'s tile or button shows on the content
    ``bindings`` configure, from the row's options as the push resolves
    them, by the naming of ``template``'s ``actions`` (the field presses
    route through)."""
    rows = _ROWS
    if template is not None:
        rows = next(
            (
                field.block
                for field in template.fields
                if field.key == "actions" and isinstance(field.block, ActionRows)
            ),
            _ROWS,
        )
    options = rows.tile_options("actions", bindings, entity_id, resolver)
    return _label(entity_id, resolver, options, rows.naming)
