"""The widget templates."""

from __future__ import annotations

from .. import blocks, defaults, limits, remote, series, showcase
from ..inputs import InputEvent
from ..sourcing import Bare
from ..switchboard import (
    PRESSED,
    SWITCHBOARD_TEMPLATE,
    TOGGLE_OFF,
    TOGGLE_ON,
    ActionRows,
    bound_actions,
    content_size,
    state_words_refusal,
)
from .definition import TemplateDef
from .definition import field_def as _f
from .rows import battery_row, budget_row, energy_source_row, list_row

ICON = _f("icon", blocks.Icon(), advanced=True)
TAP_URL = _f("tap_url", blocks.Url(), advanced=True)
#: What every widget template ends with: its icon, accent and tap URL.
_CHROME = (ICON, _f("accent", blocks.Color(), advanced=True), TAP_URL)

STATUS = TemplateDef(
    slug="status",
    fields=(
        _f("state", blocks.Value(), required=True),
        _f("value", blocks.Value(), advanced=True),
        *_CHROME,
    ),
)

PROGRESS = TemplateDef(
    slug="progress",
    constants={"progress": {"style": "simple"}},
    fields=(
        _f(
            "progress",
            blocks.Number(scale=0.01, minimum=0, maximum=1),
            path=("progress", "value"),
            required=True,
        ),
        _f("state", blocks.Value(), path=("state",), advanced=False),
        _f("end_date", blocks.Timestamp(), advanced=True),
        _f(
            "bar_color",
            blocks.Color(),
            path=("progress", "color"),
            advanced=True,
        ),
        _f(
            "segments",
            blocks.SegmentList(),
            path=("progress", "segments"),
            advanced=True,
        ),
        *_CHROME,
    ),
)

GAUGE = TemplateDef(
    slug="gauge",
    fields=(
        _f("value", blocks.Number(), required=True),
        _f("unit", blocks.Text(max_length=limits.UNIT), advanced=True),
        _f("label", blocks.Text(max_length=limits.LABEL), advanced=True),
        _f("min_value", blocks.NumberLiteral(), advanced=True),
        _f("max_value", blocks.NumberLiteral(), advanced=True),
        _f(
            "ring",
            blocks.ColorRamp(solid_key="color", gradient_key="gradient"),
            advanced=True,
        ),
        *_CHROME,
    ),
)

COUNTDOWN = TemplateDef(
    slug="countdown",
    fields=(
        _f("target", blocks.Timestamp(), required=True),
        _f("subtitle", blocks.Value(), advanced=True),
        _f("expired_text", blocks.Text(max_length=limits.LABEL), advanced=True),
        *_CHROME,
    ),
)

LIST = TemplateDef(
    slug="list",
    fields=(
        _f(
            "rows",
            blocks.EntityRows(
                row_builder=list_row,
                row_options=("label", "icon", "color"),
            ),
            required=True,
        ),
        *_CHROME,
    ),
)

BATTERY = TemplateDef(
    slug="battery",
    fields=(
        _f(
            "devices",
            blocks.EntityRows(
                device_class="battery",
                row_builder=battery_row,
                row_options=("icon", "color", "charging"),
            ),
            required=True,
        ),
        *_CHROME,
    ),
)

BUDGET = TemplateDef(
    slug="budget",
    defaults=defaults.async_budget,
    fields=(
        _f(
            "spent",
            blocks.Amount(domain=["sensor", "input_number"]),
            path=("total", "spent"),
            required=True,
        ),
        _f(
            "budget",
            blocks.Amount(bare=Bare.LITERAL, positive=True),
            path=("total", "budget"),
        ),
        _f("currency", blocks.Currency(), required=True),
        _f("subtitle", blocks.Value()),
        _f(
            "categories",
            blocks.EntityRows(
                domain=["sensor", "input_number"],
                numeric=True,
                device_class_first="monetary",
                row_builder=budget_row,
                row_options=("label", "icon", "color", "budget"),
                max_rows=limits.BUDGET_CATEGORIES,
            ),
        ),
        _f("display", blocks.Enum(["remaining", "spent"]), advanced=True),
        _f(
            "total_color",
            blocks.Color(),
            path=("total", "color"),
            advanced=True,
        ),
        *_CHROME,
    ),
)

TREND = TemplateDef(
    slug="trend",
    fields=(
        _f("value", blocks.Number(domain=["sensor", "input_number"]), required=True),
        _f("points", series.HistoryPoints(follows="value"), required=True),
        _f("state", blocks.Value()),
        _f("unit", blocks.EntityUnit(follows="value"), advanced=True),
        _f("min_value", blocks.NumberLiteral(), advanced=True),
        _f("max_value", blocks.NumberLiteral(), advanced=True),
        _f("color", blocks.Color(), advanced=True),
        *_CHROME,
    ),
)

PRICES = TemplateDef(
    slug="prices",
    defaults=defaults.async_prices,
    fields=(
        _f("entries", series.PriceEntries(scale_key="scale"), required=True),
        _f("scale", blocks.Setting(series.SCALES), advanced=True),
        _f("unit", blocks.Text(max_length=limits.UNIT), advanced=True),
        *_CHROME,
    ),
)

#: Grid power is positive when importing, battery power when charging.
ENERGY = TemplateDef(
    slug="energy",
    defaults=defaults.async_energy,
    requires={"grid": "power", "battery": "power", "home": "power"},
    requires_any=("sources", "grid", "battery", "home"),
    fields=(
        _f(
            "sources",
            blocks.EnergySources(
                row_builder=energy_source_row, max_rows=limits.ENERGY_SOURCES
            ),
        ),
        _f(
            "grid_power",
            blocks.Measure(
                units=blocks.POWER_UNITS,
                invertible=True,
                domain="sensor",
                device_class="power",
            ),
            path=("grid", "power"),
        ),
        _f(
            "battery_power",
            blocks.Measure(
                units=blocks.POWER_UNITS,
                invertible=True,
                domain="sensor",
                device_class="power",
            ),
            path=("battery", "power"),
        ),
        _f(
            "battery_level",
            blocks.Number(
                minimum=0, maximum=100, domain="sensor", device_class="battery"
            ),
            path=("battery", "level"),
        ),
        _f(
            "home_power",
            blocks.Measure(
                units=blocks.POWER_UNITS, domain="sensor", device_class="power"
            ),
            path=("home", "power"),
        ),
        _f(
            "grid_today",
            blocks.EnergyToday(domain="sensor", device_class="energy"),
            path=("grid", "today"),
            advanced=True,
        ),
        _f(
            "home_today",
            blocks.EnergyToday(domain="sensor", device_class="energy"),
            path=("home", "today"),
            advanced=True,
        ),
        *_CHROME,
    ),
)

#: A picture of the thing, its state, when it last reported and one to
#: six readings. A picture, a badge or a state mark is sent only with its
#: URL or its word.
SHOWCASE = TemplateDef(
    slug=showcase.SHOWCASE_TEMPLATE,
    requires={"image": "url", "badge": "url", "state": "text"},
    fields=(
        _f("image", showcase.PictureUrl(), path=("image", "url")),
        _f("image_fit", showcase.PictureFit(), path=("image", "fit")),
        _f(
            "image_alt",
            blocks.Text(max_length=limits.LABEL),
            path=("image", "alt"),
            advanced=True,
        ),
        _f("state", showcase.StateWord(), path=("state", "text")),
        _f("state_icon", blocks.Icon(), path=("state", "icon")),
        _f("reported_at", showcase.LastReported()),
        _f("stats", showcase.StatRows(), required=True),
        _f("badge", showcase.PictureUrl(), path=("badge", "url"), advanced=True),
        _f(
            "badge_alt",
            blocks.Text(max_length=limits.LABEL),
            path=("badge", "alt"),
            advanced=True,
        ),
        *_CHROME,
    ),
    measure=showcase.content_size,
)

#: The press inputs a template with buttons takes (commands.CommandStream).
PRESSES = (InputEvent(TOGGLE_ON), InputEvent(TOGGLE_OFF), InputEvent(PRESSED))

#: A picture of the thing, one big reading, when it last reported, up to
#: three stats and one to five buttons, pressed like a switchboard's tiles.
REMOTE = TemplateDef(
    slug=remote.REMOTE_TEMPLATE,
    requires={"image": "url"},
    fields=(
        _f("image", showcase.PictureUrl(), path=("image", "url")),
        _f("image_fit", showcase.PictureFit(), path=("image", "fit")),
        _f(
            "image_alt",
            blocks.Text(max_length=limits.LABEL),
            path=("image", "alt"),
            advanced=True,
        ),
        _f("value", remote.Reading(), required=True),
        _f("actions", remote.RemoteActions(), required=True),
        _f("stats", remote.RemoteStats()),
        _f("reported_at", showcase.LastReported()),
        *_CHROME,
    ),
    inputs=PRESSES,
    save_problem=state_words_refusal,
    measure=remote.content_size,
    routes=remote.bound_remote_actions,
)

SWITCHBOARD = TemplateDef(
    slug=SWITCHBOARD_TEMPLATE,
    fields=(
        _f("actions", ActionRows(), required=True),
        *_CHROME,
    ),
    inputs=PRESSES,
    save_problem=state_words_refusal,
    measure=content_size,
    routes=bound_actions,
)
