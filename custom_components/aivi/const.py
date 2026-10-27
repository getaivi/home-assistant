"""Constants for the Aivi integration."""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import TYPE_CHECKING, Final

from homeassistant.util.hass_dict import HassKey

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .api import AiviClient
    from .templates import TemplateRegistry

DOMAIN: Final = "aivi"

# The API the integration talks to. An entry can override it in the config
# flow's Advanced section; the environment variable changes the default,
# which is how the QA stack points at its mock.
DEFAULT_BASE_URL: Final = os.getenv("AIVI_BASE_URL", "https://api.getaivi.app").rstrip(
    "/"
)

CONF_TOKEN: Final = "token"  # noqa: S105 (a config key, not a secret)
CONF_BASE_URL: Final = "base_url"

# Entry option: keep the account's activity log (pushes and presses) on
# disk, so it survives a restart. Off by default: a write per quiet spell
# is a cost on an SD card.
CONF_KEEP_LOG: Final = "keep_log"

# Subentry types.
SUBENTRY_WIDGET: Final = "widget"
SUBENTRY_ACTIVITY: Final = "activity"

# Subentry data keys.
CONF_SLUG: Final = "slug"
CONF_NAME: Final = "name"
CONF_TEMPLATE: Final = "template"
CONF_BINDINGS: Final = "bindings"
# Activity subentries only: the entity whose truthiness drives the
# ONGOING/IDLE lifecycle of the Live Activity.
CONF_ACTIVE: Final = "active_entity"
# Widget subentries only, optional: Aivi's ``stale_after`` (seconds) sent
# with every push; 0 clears the widget's setting, absent leaves it alone.
CONF_STALE_AFTER: Final = "stale_after"
# Activity subentries only: the least time between two content pushes
# while the lifecycle state stays the same (seconds; 0 = no throttle).
CONF_THROTTLE: Final = "throttle"
DEFAULT_THROTTLE_SECONDS: Final = 60

DEFAULT_DEBOUNCE_SECONDS: Final = 2.0

# Fired for every action pressed on a device (bound here or not): what it
# was pressed on (``subject_kind``, "widget" or "activity", and its
# ``slug``), the action id, its ``action_kind`` (button or toggle), a
# toggle's requested value, the Aivi delivery id (``event_id``, the dedupe
# key) and the device's ``request_id``; a Live Activity's press also names
# the card it was pressed on (``instance_id``). One event type whatever
# the surface, so an automation on presses works on every one.
EVENT_ACTION: Final = f"{DOMAIN}_action"

# DI seams on hass.data, set by tests before setup: a client factory
# (absent -> the real aiohttp client) and template registries (absent ->
# the defaults).
DATA_CLIENT_FACTORY: HassKey[Callable[[HomeAssistant, str, str], AiviClient]] = HassKey(
    f"{DOMAIN}_client_factory"
)
DATA_REGISTRY: HassKey[TemplateRegistry] = HassKey(f"{DOMAIN}_registry")
DATA_ACTIVITY_REGISTRY: HassKey[TemplateRegistry] = HassKey(
    f"{DOMAIN}_activity_registry"
)

# The public docs, linked from repair issues.
DOCS_URL: Final = "https://docs.getaivi.app/home-assistant/integration/"
