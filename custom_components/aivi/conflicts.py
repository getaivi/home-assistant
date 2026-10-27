"""Automations that feed a widget or Live Activity the integration can
feed too.

Aivi's blueprints and hand-written automations work without the integration:
they call ``rest_command.update_widget`` or ``update_live_activity`` with a
slug and a payload. One that still runs for a slug bound here overwrites
what the binding pushes, and the other way round. This module finds them
in each automation's resolved configuration (a blueprint's inputs already
substituted), so the panel and a repair issue can report it and offer to turn
the automation off. It never deletes one and never acts by itself.

What it cannot see: a slug computed at run time, a rest_command under
another name, scripts, and feeders outside Home Assistant's automations
(Node-RED, AppDaemon).
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from homeassistant.const import (
    ATTR_ENTITY_ID,
    EVENT_HOMEASSISTANT_STARTED,
    EVENT_STATE_CHANGED,
    SERVICE_TURN_OFF,
)
from homeassistant.core import (
    Context,
    CoreState,
    Event,
    EventStateChangedData,
    HomeAssistant,
    callback,
)
from homeassistant.helpers import issue_registry as ir
from homeassistant.util.hass_dict import HassKey

from .const import CONF_NAME, CONF_SLUG, DOMAIN, SUBENTRY_ACTIVITY, SUBENTRY_WIDGET

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigSubentry

    from .wire import FeederView

AUTOMATION_DOMAIN = "automation"

#: Fired by the automation integration after its configuration reloads.
EVENT_AUTOMATION_RELOADED = "automation_reloaded"

#: The commands the blueprints and the docs have users add, and the kind
#: of binding each feeds.
FEEDS: dict[str, str] = {
    "rest_command.update_widget": SUBENTRY_WIDGET,
    "rest_command.update_live_activity": SUBENTRY_ACTIVITY,
}

#: The repair issue of a binding an enabled automation also feeds: one the
#: fix flow can turn off, or one the user has to look at.
ISSUE_CONFLICT = "automation_conflict"
ISSUE_CONFLICT_MANUAL = "automation_conflict_manual"
CONFLICT_ISSUES = (ISSUE_CONFLICT_MANUAL, ISSUE_CONFLICT)

#: ``{{ slug }}``: a slug that is one variable, as the blueprints write it.
_VARIABLE = re.compile(r"^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$")

_DATA_LISTENING: HassKey[bool] = HassKey(f"{DOMAIN}_conflicts_listening")


@dataclass(frozen=True, slots=True)
class Feeder:
    """One automation feeding one widget or Live Activity."""

    kind: str
    slug: str
    entity_id: str
    name: str
    enabled: bool
    #: Its ``id`` in the configuration, which the automation editor opens
    #: by; ``None`` for one written in YAML without an id.
    config_id: str | None
    #: Built from a blueprint (Aivi's or any other).
    blueprint: bool
    #: Why turning it off is not offered: it feeds other slugs too
    #: (``shared``), or its configuration turns it back on at every start
    #: (``initial_state``). ``None`` when it can simply be turned off.
    keep: Literal["shared", "initial_state"] | None

    def view(self) -> FeederView:
        return {
            "kind": self.kind,
            "slug": self.slug,
            "entity_id": self.entity_id,
            "name": self.name,
            "enabled": self.enabled,
            "config_id": self.config_id,
            "blueprint": self.blueprint,
            "keep": self.keep,
        }


def _calls(node: Any) -> Iterator[Mapping[str, Any]]:
    """Every service call in an automation's configuration, however deep
    (choose, if, sequence, parallel, repeat)."""
    if isinstance(node, Mapping):
        if isinstance(node.get("action", node.get("service")), str):
            yield node
        for value in node.values():
            yield from _calls(value)
    elif isinstance(node, list):
        for item in node:
            yield from _calls(item)


def _slug(call: Mapping[str, Any], variables: Any) -> str | None:
    """The slug a call names: a literal, or one variable of the automation
    (the blueprints pass their ``slug`` input that way)."""
    data = call.get("data") or call.get("data_template")
    slug = data.get("slug") if isinstance(data, Mapping) else None
    if not isinstance(slug, str) or not slug.strip():
        return None
    name = str(slug).strip()
    if (variable := _VARIABLE.match(name)) is not None:
        value = variables.get(variable[1]) if isinstance(variables, Mapping) else None
        return str(value).strip() if isinstance(value, str) and value.strip() else None
    # Any other template is computed at run time.
    return None if "{{" in name or "{%" in name else name


def targets(config: Mapping[str, Any]) -> set[tuple[str, str]]:
    """The (kind, slug) pairs one automation's configuration feeds."""
    found: set[tuple[str, str]] = set()
    variables = config.get("variables")
    for call in _calls(config):
        kind = FEEDS.get(str(call.get("action", call.get("service"))))
        if kind is None:
            continue
        if (slug := _slug(call, variables)) is not None:
            found.add((kind, slug))
    return found


@callback
def feeders(hass: HomeAssistant) -> list[Feeder]:
    """Every automation that feeds a widget or Live Activity, enabled or
    not, by name. Empty while the automation integration is not loaded."""
    component = hass.data.get(AUTOMATION_DOMAIN)
    if component is None:
        return []
    found: list[Feeder] = []
    for entity in component.entities:
        config = getattr(entity, "raw_config", None)
        # An automation that failed validation has no usable configuration.
        if not isinstance(config, Mapping):
            continue
        fed = targets(config)
        if not fed:
            continue
        state = hass.states.get(entity.entity_id)
        config_id = config.get("id")
        keep = (
            "shared"
            if len(fed) > 1
            else "initial_state"
            if config.get("initial_state") is True
            else None
        )
        found.extend(
            Feeder(
                kind=kind,
                slug=slug,
                entity_id=entity.entity_id,
                name=str(
                    entity.name or config.get("alias") or entity.entity_id
                ).strip(),
                enabled=state is not None and state.state == "on",
                config_id=config_id if isinstance(config_id, str) else None,
                blueprint=getattr(entity, "referenced_blueprint", None) is not None,
                keep=keep,
            )
            for kind, slug in sorted(fed)
        )
    return sorted(found, key=lambda f: (f.kind, f.slug, f.name.lower(), f.entity_id))


@callback
def feeding(hass: HomeAssistant, subentry: ConfigSubentry) -> list[Feeder]:
    """The enabled automations feeding what this binding feeds."""
    slug = subentry.data.get(CONF_SLUG)
    return [
        feeder
        for feeder in feeders(hass)
        if feeder.enabled
        and feeder.kind == subentry.subentry_type
        and feeder.slug == slug
    ]


async def async_turn_off(
    hass: HomeAssistant, entity_ids: list[str], context: Context | None = None
) -> None:
    """Turn automations off the way the user would: the automation
    service, stopping what is running, which Home Assistant remembers
    across restarts."""
    if not entity_ids:
        return
    await hass.services.async_call(
        AUTOMATION_DOMAIN,
        SERVICE_TURN_OFF,
        {ATTR_ENTITY_ID: entity_ids, "stop_actions": True},
        blocking=True,
        context=context,
    )


def conflict_issue_id(kind: str, subentry_id: str) -> str:
    return f"{kind}_{subentry_id}"


@callback
def sync_issues(hass: HomeAssistant) -> None:
    """One repair issue per binding that an enabled automation also feeds,
    withdrawn when either side goes away. Fixable when every such
    automation can simply be turned off."""
    wanted: dict[str, tuple[str, ConfigSubentry, str, list[Feeder]]] = {}
    for entry in hass.config_entries.async_entries(DOMAIN):
        for subentry in entry.subentries.values():
            if not (found := feeding(hass, subentry)):
                continue
            kind = (
                ISSUE_CONFLICT_MANUAL
                if any(feeder.keep for feeder in found)
                else ISSUE_CONFLICT
            )
            wanted[conflict_issue_id(kind, subentry.subentry_id)] = (
                kind,
                subentry,
                entry.entry_id,
                found,
            )
    registry = ir.async_get(hass)
    for domain, existing in list(registry.issues):
        if (
            domain == DOMAIN
            and existing.startswith(CONFLICT_ISSUES)
            and existing not in wanted
        ):
            ir.async_delete_issue(hass, DOMAIN, existing)
    for issue, (kind, subentry, entry_id, found) in wanted.items():
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue,
            is_fixable=kind == ISSUE_CONFLICT,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=kind,
            translation_placeholders={
                "name": str(subentry.data.get(CONF_NAME) or subentry.title),
                "slug": str(subentry.data.get(CONF_SLUG)),
                "automations": ", ".join(feeder.name for feeder in found),
            },
            data={"entry_id": entry_id, "subentry_id": subentry.subentry_id},
        )


@callback
def async_watch(hass: HomeAssistant) -> None:
    """Keep the repair issues in sync with the automations: checked once Home
    Assistant has started (automations load after config entries), when
    automations reload, and when one is turned on or off."""
    if hass.data.get(_DATA_LISTENING):
        return
    hass.data[_DATA_LISTENING] = True

    @callback
    def _sync(_: Event[Any] | None = None) -> None:
        sync_issues(hass)

    @callback
    def _toggled(event_data: EventStateChangedData) -> bool:
        if not event_data["entity_id"].startswith(f"{AUTOMATION_DOMAIN}."):
            return False
        old, new = event_data["old_state"], event_data["new_state"]
        # A trigger rewrites the automation's attributes only.
        return (old.state if old else None) != (new.state if new else None)

    hass.bus.async_listen(EVENT_AUTOMATION_RELOADED, _sync)
    hass.bus.async_listen(EVENT_STATE_CHANGED, _sync, event_filter=_toggled)
    if hass.state is CoreState.running:
        _sync()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _sync)
