"""The set of templates a build ships, per subentry kind."""

from __future__ import annotations

from collections.abc import ItemsView, Iterable

from homeassistant.core import HomeAssistant

from ..const import DATA_ACTIVITY_REGISTRY, DATA_REGISTRY, SUBENTRY_ACTIVITY
from .activities import ACTIVITY_MONITOR, ACTIVITY_PROGRESS, ACTIVITY_REMOTE
from .definition import TemplateDef
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


class TemplateRegistry:
    """The set of supported templates, shared through ``hass.data`` so a
    test can inject a different set."""

    def __init__(self, templates: Iterable[TemplateDef]) -> None:
        self._by_slug: dict[str, TemplateDef] = {t.slug: t for t in templates}

    def get(self, slug: str) -> TemplateDef | None:
        return self._by_slug.get(slug)

    def is_supported(self, slug: str) -> bool:
        return slug in self._by_slug

    def items(self) -> ItemsView[str, TemplateDef]:
        return self._by_slug.items()


def default_registry() -> TemplateRegistry:
    """The widget templates this build ships."""
    return TemplateRegistry(
        (
            STATUS,
            PROGRESS,
            GAUGE,
            COUNTDOWN,
            LIST,
            BATTERY,
            BUDGET,
            TREND,
            PRICES,
            ENERGY,
            SWITCHBOARD,
            SHOWCASE,
            REMOTE,
        )
    )


def default_activity_registry() -> TemplateRegistry:
    """The Live Activity templates this build ships."""
    return TemplateRegistry((ACTIVITY_PROGRESS, ACTIVITY_MONITOR, ACTIVITY_REMOTE))


def registry_for(hass: HomeAssistant, kind: str) -> TemplateRegistry:
    """The registry of a subentry kind (widget or activity), built and
    cached on first use. Place a registry on ``hass.data[DATA_REGISTRY]``
    or ``hass.data[DATA_ACTIVITY_REGISTRY]`` before setup to inject one."""
    if kind == SUBENTRY_ACTIVITY:
        key, default = DATA_ACTIVITY_REGISTRY, default_activity_registry
    else:
        key, default = DATA_REGISTRY, default_registry
    registry = hass.data.get(key)
    if registry is None:
        registry = hass.data[key] = default()
    return registry
