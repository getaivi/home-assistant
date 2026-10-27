"""Template definitions, as data.

Each Aivi template is a list of ``FieldDef``s over the reusable blocks;
``engine.py`` turns a definition into the entity subscription and the
content payload.

The package splits by concern: ``definition`` (what a template is),
``rows`` (the row builders of the repeating templates), ``widgets`` and
``activities`` (the templates themselves) and ``registry`` (the set a
build ships).
"""

from __future__ import annotations

from .activities import ACTIVITY_MONITOR, ACTIVITY_PROGRESS, ACTIVITY_REMOTE
from .definition import FieldDef, TemplateDef
from .registry import (
    TemplateRegistry,
    default_activity_registry,
    default_registry,
    registry_for,
)
from .widgets import (
    BATTERY,
    BUDGET,
    COUNTDOWN,
    ENERGY,
    GAUGE,
    LIST,
    PRICES,
    PROGRESS,
    REMOTE,
    SHOWCASE,
    STATUS,
    SWITCHBOARD,
    TREND,
)

__all__ = [
    "ACTIVITY_MONITOR",
    "ACTIVITY_PROGRESS",
    "ACTIVITY_REMOTE",
    "BATTERY",
    "BUDGET",
    "COUNTDOWN",
    "ENERGY",
    "GAUGE",
    "LIST",
    "PRICES",
    "PROGRESS",
    "REMOTE",
    "SHOWCASE",
    "STATUS",
    "SWITCHBOARD",
    "TREND",
    "FieldDef",
    "TemplateDef",
    "TemplateRegistry",
    "default_activity_registry",
    "default_registry",
    "registry_for",
]
