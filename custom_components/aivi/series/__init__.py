"""Blocks whose value is a series: a trend's history points and a price
timeline.

Both read a list from wherever Home Assistant keeps it: the recorder (a
sensor's history), an attribute (a price sensor's timeline), or a
template that renders a list (JSON, or a Python literal).
"""

from __future__ import annotations

from .points import HistoryPoints
from .prices import SCALES, PriceEntries, cents_unit, price_entries

__all__ = [
    "SCALES",
    "HistoryPoints",
    "PriceEntries",
    "cents_unit",
    "price_entries",
]
