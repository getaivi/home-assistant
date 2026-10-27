"""Aivi's caps on what a push carries, in one table.

``tests/test_contract.py`` holds each one to the vendored OpenAPI document.
"""

from __future__ import annotations

from typing import Final

#: An SF Symbol name: a widget's icon, a row's, a tile's.
ICON: Final = 64
#: A ``Value``'s text, and a tile's subtitle.
VALUE: Final = 128
TAP_URL: Final = 256
#: A gauge's, a trend's or a price timeline's unit.
UNIT: Final = 16
#: A gauge's label, a countdown's expired text, a monitor column's header
#: and footer, a list row's label, a battery's name, a budget category's
#: label, a segment's label, a tile picture's alt text.
LABEL: Final = 64
#: An energy source's name.
ENERGY_NAME: Final = 30
#: A switchboard tile's label, and each of its state words.
TILE_LABEL: Final = 24
STATE_TEXT: Final = 24
#: A switchboard action's id.
ACTION_ID: Final = 32
#: A tile picture's URL, and a showcase's picture or badge.
IMAGE_URL: Final = 2048
#: A showcase stat's label and unit.
STAT_LABEL: Final = 24
STAT_UNIT: Final = 8
#: The rows of a list or battery widget, and a switchboard's tiles.
ROWS: Final = 8
BUDGET_CATEGORIES: Final = 6
#: A showcase's stats, and a remote's.
STATS: Final = 6
REMOTE_STATS: Final = 3
#: A remote's buttons.
REMOTE_ACTIONS: Final = 5
#: A remote Live Activity's stats and buttons, its picture's URL, its
#: readings, and the label under its value.
ACTIVITY_STATS: Final = 2
ACTIVITY_ACTIONS: Final = 3
ACTIVITY_IMAGE_URL: Final = 512
ACTIVITY_READING: Final = 64
ACTIVITY_VALUE_LABEL: Final = 24
ENERGY_SOURCES: Final = 3
SEGMENTS: Final = 4
#: A gauge ring's gradient stops.
RAMP_STOPS: Final = 4
#: A tile gradient's stops (two at least).
TILE_GRADIENT: Final = 3
#: A trend's points, and a price timeline's entries.
POINTS: Final = 48
PRICE_ENTRIES: Final = 48
