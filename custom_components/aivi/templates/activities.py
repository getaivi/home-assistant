"""The Live Activity templates: the same blocks on a different surface.

The Aivi API still lists activities made with "generic", an older template
it no longer supports; this integration does not offer it.
"""

from __future__ import annotations

from .. import blocks, limits, remote, showcase
from .definition import TemplateDef
from .definition import field_def as _f
from .widgets import ICON, PRESSES, TAP_URL

ACTIVITY_PROGRESS = TemplateDef(
    slug="progress",
    constants={"progress": {"style": "simple"}},
    fields=(
        _f(
            "progress",
            blocks.Number(scale=0.01, minimum=0, maximum=1),
            path=("progress", "value"),
            required=True,
        ),
        _f("header_left", blocks.Value(), path=("header_left",)),
        _f("header_right", blocks.Value(), advanced=True),
        _f("footer_left", blocks.Value(), advanced=True),
        _f("footer_right", blocks.Value(), advanced=True),
        _f("compact_value", blocks.Value(), advanced=True),
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
        ICON,
        TAP_URL,
    ),
)

ACTIVITY_MONITOR = TemplateDef(
    slug="monitor",
    requires={"left_column": "value", "right_column": "value"},
    fields=(
        _f(
            "right_value",
            blocks.Value(),
            path=("right_column", "value"),
            required=True,
        ),
        _f(
            "right_header",
            blocks.Text(max_length=limits.LABEL),
            path=("right_column", "header"),
        ),
        _f(
            "right_footer",
            blocks.Text(max_length=limits.LABEL),
            path=("right_column", "footer"),
            advanced=True,
        ),
        _f(
            "left_value",
            blocks.Value(),
            path=("left_column", "value"),
            advanced=True,
        ),
        _f(
            "left_header",
            blocks.Text(max_length=limits.LABEL),
            path=("left_column", "header"),
            advanced=True,
        ),
        _f(
            "left_footer",
            blocks.Text(max_length=limits.LABEL),
            path=("left_column", "footer"),
            advanced=True,
        ),
        _f(
            "primary_column",
            blocks.Enum(["left", "right"]),
            advanced=True,
        ),
        ICON,
        TAP_URL,
    ),
)

#: The remote widget's counterpart on the Lock Screen: a state word, one
#: reading, a bar or up to two stats, and one to three buttons pressed
#: from the Lock Screen and the Dynamic Island. A picture and a bar are
#: sent only with their URL and their reading.
ACTIVITY_REMOTE = TemplateDef(
    slug=remote.REMOTE_TEMPLATE,
    constants={"progress": {"style": "simple"}},
    requires={"image": "url", "progress": "value"},
    fields=(
        _f("value", remote.ActivityReading(), required=True),
        _f("actions", remote.ActivityActions(), required=True),
        _f("state", showcase.StateWord()),
        _f("unit", blocks.Text(max_length=limits.STAT_UNIT)),
        _f("value_label", blocks.Text(max_length=limits.ACTIVITY_VALUE_LABEL)),
        _f(
            "image",
            showcase.PictureUrl(max_length=limits.ACTIVITY_IMAGE_URL),
            path=("image", "url"),
        ),
        _f(
            "image_alt",
            blocks.Text(max_length=limits.LABEL),
            path=("image", "alt"),
            advanced=True,
        ),
        _f(
            "progress",
            blocks.Number(scale=0.01, minimum=0, maximum=1),
            path=("progress", "value"),
            advanced=True,
        ),
        _f(
            "bar_color",
            blocks.Color(),
            path=("progress", "color"),
            advanced=True,
        ),
        _f("stats", remote.ActivityStats(), advanced=True),
        _f("compact_value", remote.ActivityReading(), advanced=True),
        _f("accent", blocks.Color(), advanced=True),
        ICON,
        TAP_URL,
    ),
    inputs=PRESSES,
    routes=remote.bound_activity_actions,
)
