"""WebSocket commands backing the custom panel.

The panel is a UI over the same data model as the config flow: these
commands read the account's widgets, describe templates, resolve a live
preview, and create / update / delete binding subentries.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Literal, cast

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState, ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import IntegrationNotLoaded, async_get_loaded_integration

from .api import AiviClient, AiviError, AiviSubscriptionError, client_for
from .conflicts import async_turn_off, feeders, sync_issues
from .const import (
    CONF_ACTIVE,
    CONF_BINDINGS,
    CONF_NAME,
    CONF_SLUG,
    CONF_STALE_AFTER,
    CONF_TEMPLATE,
    CONF_THROTTLE,
    DEFAULT_THROTTLE_SECONDS,
    DOMAIN,
    SUBENTRY_ACTIVITY,
    SUBENTRY_WIDGET,
)
from .editor import async_preview, save_problem, slug_taken, stored_bindings
from .inputs import account_inputs
from .metadata import describe_registry
from .runtime import AiviConfigEntry, AiviRuntime
from .suggest import (
    MAX_ASK,
    SUGGEST_READY,
    SuggestAsk,
    SuggestFailed,
    async_converse,
    get_suggester,
    starters,
)
from .templates import TemplateDef, registry_for
from .wire import (
    AccountView,
    ActivityView,
    BindingStatusRow,
    BindingView,
    ConfigResult,
    InputsUpdate,
    RemoteItem,
    StreamStatus,
    WidgetView,
)

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

KINDS = [SUBENTRY_WIDGET, SUBENTRY_ACTIVITY]


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (
        ws_config,
        ws_widgets,
        ws_activities,
        ws_templates,
        ws_preview,
        ws_save,
        ws_delete,
        ws_suggest,
        ws_inputs_subscribe,
        ws_defaults,
        ws_suggest_starters,
        ws_automations_turn_off,
    ):
        websocket_api.async_register_command(hass, handler)


def _entry(hass: HomeAssistant, entry_id: str) -> AiviConfigEntry | None:
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry and entry.domain == DOMAIN:
        return cast("AiviConfigEntry", entry)
    return None


def _account(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> AiviConfigEntry | None:
    """The account ``msg`` names, or ``None`` once ``not_found`` was sent."""
    entry = _entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Unknown account")
    return entry


def _template(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> TemplateDef | None:
    """The template ``msg`` names, or ``None`` once ``not_found`` was sent."""
    template = registry_for(hass, msg["kind"]).get(msg["template"])
    if template is None:
        connection.send_error(msg["id"], "not_found", "Unknown template")
    return template


def _binding_view(subentry: ConfigSubentry) -> BindingView:
    return {
        "subentry_id": subentry.subentry_id,
        "slug": subentry.data[CONF_SLUG],
        "name": subentry.data[CONF_NAME],
        "template": subentry.data[CONF_TEMPLATE],
        "bindings": dict(subentry.data.get(CONF_BINDINGS, {})),
    }


def _widget_view(subentry: ConfigSubentry) -> WidgetView:
    return {
        **_binding_view(subentry),
        "stale_after": subentry.data.get(CONF_STALE_AFTER),
    }


def _activity_view(subentry: ConfigSubentry) -> ActivityView:
    return {
        **_binding_view(subentry),
        "active": subentry.data.get(CONF_ACTIVE),
        "throttle": subentry.data.get(CONF_THROTTLE, DEFAULT_THROTTLE_SECONDS),
    }


def _runtime(entry: AiviConfigEntry) -> AiviRuntime | None:
    """The entry's ``AiviRuntime``, or ``None`` when it is not running."""
    if entry.state is not ConfigEntryState.LOADED:
        return None
    return entry.runtime_data


def _subscription(entry: AiviConfigEntry) -> Literal["active", "inactive"]:
    """ "inactive" while the running account is paused for its
    subscription, else "active"."""
    runtime = _runtime(entry)
    return "inactive" if runtime is not None and runtime.inactive else "active"


def _subscription_ended(entry: AiviConfigEntry) -> str | None:
    """When the paused account's subscription ended, as Aivi said, for
    the panel's accounts menu; ``None`` while active or when Aivi gave no
    date (the account never had one)."""
    runtime = _runtime(entry)
    inactive = runtime.inactive if runtime is not None else None
    ended = inactive.expired_at if inactive is not None else None
    return ended.isoformat() if ended is not None else None


def _stream(entry: AiviConfigEntry) -> StreamStatus | None:
    """The account's event stream status; ``None`` while the account is not
    running or binds nothing that accepts input."""
    runtime = _runtime(entry)
    return runtime.stream_status() if runtime is not None else None


def _binding_status(entry: AiviConfigEntry) -> dict[str, BindingStatusRow]:
    """Each running binding's status, by subentry id; none while the
    account is not running."""
    runtime = _runtime(entry)
    if runtime is None:
        return {}
    return {
        subentry_id: manager.status_row()
        for subentry_id, manager in runtime.managers.items()
    }


def _version(hass: HomeAssistant) -> str | None:
    """The manifest's version (the release workflow stamps it)."""
    try:
        version = async_get_loaded_integration(hass, DOMAIN).version
    except IntegrationNotLoaded:
        return None
    return str(version) if version else None


@websocket_api.websocket_command({vol.Required("type"): "aivi/config"})
@websocket_api.require_admin
@callback
def ws_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The connected accounts and their configured widgets."""
    accounts: list[AccountView] = [
        {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "subscription": _subscription(entry),
            "subscription_ended": _subscription_ended(entry),
            "stream": _stream(entry),
            "keep_log": account_inputs(hass, entry.entry_id).kept,
            "widgets": [
                _widget_view(sub)
                for sub in entry.subentries.values()
                if sub.subentry_type == SUBENTRY_WIDGET
            ],
            "activities": [
                _activity_view(sub)
                for sub in entry.subentries.values()
                if sub.subentry_type == SUBENTRY_ACTIVITY
            ],
        }
        for entry in hass.config_entries.async_entries(DOMAIN)
    ]
    result: ConfigResult = {
        "accounts": accounts,
        # "ready", or why not ("not_loaded" / "no_entity"), so the panel
        # can show the "Describe it" box disabled with setup guidance.
        "suggest_state": get_suggester(hass).state(hass),
        # The models a conversation can ask, the preferred one first.
        "suggest_models": get_suggester(hass).models(hass),
        # The integration's own version, for the panel's About lines.
        "version": _version(hass),
        # Automations that feed a widget or Live Activity by its slug
        # (blueprints, hand-written): a binding for the same slug and
        # one of these overwrite each other.
        "automations": [feeder.view() for feeder in feeders(hass)],
    }
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): "aivi/templates"})
@websocket_api.require_admin
@callback
def ws_templates(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Field metadata for every supported widget and activity template."""
    connection.send_result(
        msg["id"],
        describe_registry(
            registry_for(hass, SUBENTRY_WIDGET), registry_for(hass, SUBENTRY_ACTIVITY)
        ),
    )


def _listing(
    kind: str, key: str, fetch: Callable[[AiviClient], Awaitable[list[Any]]]
) -> websocket_api.WebSocketCommandHandler:
    """``aivi/<key>``: the account's widgets or Live Activities from the
    Aivi API, flagged by whether this build can drive them. A 402 pauses
    the account and a success resumes it, like any other call; the
    listing works while the account is not loaded too. While the account
    is paused, the panel opening is when a renewal is most likely, so the
    subscription is checked first, once for both listings."""

    @websocket_api.websocket_command(
        {vol.Required("type"): f"aivi/{key}", vol.Required("entry_id"): str}
    )
    @websocket_api.require_admin
    @websocket_api.async_response
    async def handler(
        hass: HomeAssistant,
        connection: websocket_api.ActiveConnection,
        msg: dict[str, Any],
    ) -> None:
        if (entry := _account(hass, connection, msg)) is None:
            return
        registry = registry_for(hass, kind)
        runtime = _runtime(entry)
        try:
            if (
                runtime is not None
                and runtime.inactive is not None
                and not await runtime.async_check_subscription()
            ):
                # A failed check leaves the account paused on Aivi's answer.
                raise runtime.inactive
            listed = await fetch(client_for(hass, entry))
        except AiviSubscriptionError as err:
            if runtime is not None:
                runtime.async_subscription_inactive(err)
            connection.send_error(msg["id"], "subscription_inactive", str(err))
            return
        except AiviError as err:
            connection.send_error(msg["id"], "cannot_connect", str(err))
            return
        if runtime is not None:
            await runtime.async_subscription_active()
            runtime.async_listed(kind, {item.slug for item in listed})
        items: list[RemoteItem] = [
            {
                "slug": item.slug,
                "name": item.name,
                "template": item.template,
                "supported": registry.is_supported(item.template),
            }
            for item in listed
        ]
        connection.send_result(msg["id"], {key: items})

    return handler


ws_widgets = _listing(SUBENTRY_WIDGET, "widgets", lambda client: client.list_widgets())
ws_activities = _listing(
    SUBENTRY_ACTIVITY, "activities", lambda client: client.list_activities()
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/preview",
        vol.Required("template"): str,
        vol.Required("bindings"): dict,
        vol.Optional("kind", default=SUBENTRY_WIDGET): vol.In(KINDS),
        # Entity states to preview as, in place of the real ones.
        vol.Optional("states"): {str: str},
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A live preview of the current bindings (``editor.async_preview``)."""
    if (template := _template(hass, connection, msg)) is not None:
        connection.send_result(
            msg["id"],
            await async_preview(hass, template, msg["bindings"], msg.get("states")),
        )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/save",
        vol.Required("entry_id"): str,
        vol.Optional("subentry_id"): str,
        vol.Required("slug"): str,
        vol.Required("name"): str,
        vol.Required("template"): str,
        vol.Required("bindings"): dict,
        vol.Optional("kind", default=SUBENTRY_WIDGET): vol.In(KINDS),
        # Activities only: the lifecycle entity.
        vol.Optional("active"): str,
        # Widgets only: Aivi's stale_after in seconds; 0 clears it, and
        # leaving it out leaves the widget's own setting alone.
        vol.Optional(CONF_STALE_AFTER): vol.Any(
            0, vol.All(int, vol.Range(min=60, max=604800))
        ),
        # Activities only: the least seconds between content pushes.
        vol.Optional(CONF_THROTTLE): vol.All(int, vol.Range(min=0, max=3600)),
    }
)
@websocket_api.require_admin
@callback
def ws_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create or update a binding subentry. The entry's update listener
    starts or replaces that binding's push manager, so pushing (re)starts
    on its own."""
    if (entry := _account(hass, connection, msg)) is None:
        return
    kind = msg["kind"]
    subentry_id = msg.get("subentry_id")
    if subentry_id is not None:
        existing = entry.subentries.get(subentry_id)
        if existing is None:
            connection.send_error(msg["id"], "not_found", "Unknown binding")
            return
        if existing.subentry_type != kind:
            connection.send_error(
                msg["id"], "invalid_format", f"That binding is not a {kind}"
            )
            return
    if slug_taken(entry, kind, msg["slug"], subentry_id):
        connection.send_error(
            msg["id"],
            "already_configured",
            f"Another binding already pushes to the {kind} {msg['slug']}",
        )
        return
    if (template := _template(hass, connection, msg)) is None:
        return
    if (
        problem := save_problem(
            hass, kind, template, msg["bindings"], active=msg.get("active")
        )
    ) is not None:
        connection.send_error(msg["id"], "invalid_format", problem)
        return
    data = {
        CONF_SLUG: msg["slug"],
        CONF_NAME: msg["name"],
        CONF_TEMPLATE: msg["template"],
        CONF_BINDINGS: stored_bindings(hass, template, msg["bindings"]),
    }
    if kind == SUBENTRY_WIDGET and CONF_STALE_AFTER in msg:
        data[CONF_STALE_AFTER] = msg[CONF_STALE_AFTER]
    if kind == SUBENTRY_ACTIVITY and CONF_THROTTLE in msg:
        data[CONF_THROTTLE] = msg[CONF_THROTTLE]
    if kind == SUBENTRY_ACTIVITY:
        data[CONF_ACTIVE] = msg["active"]
    unique_id = f"{kind}:{msg['slug']}"
    if subentry_id is not None:
        hass.config_entries.async_update_subentry(
            entry,
            entry.subentries[subentry_id],
            data=data,
            title=msg["name"],
            unique_id=unique_id,
        )
    else:
        subentry = ConfigSubentry(
            data=MappingProxyType(data),
            subentry_type=kind,
            title=msg["name"],
            unique_id=unique_id,
        )
        hass.config_entries.async_add_subentry(entry, subentry)
        subentry_id = subentry.subentry_id
    connection.send_result(msg["id"], {"subentry_id": subentry_id})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/delete",
        vol.Required("entry_id"): str,
        vol.Required("subentry_id"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove a binding (widget or Live Activity)."""
    entry = _entry(hass, msg["entry_id"])
    if entry is None or msg["subentry_id"] not in entry.subentries:
        connection.send_error(msg["id"], "not_found", "Unknown binding")
        return
    hass.config_entries.async_remove_subentry(entry, msg["subentry_id"])
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/suggest",
        vol.Required("template"): str,
        vol.Optional("kind", default=SUBENTRY_WIDGET): vol.In(KINDS),
        vol.Required("name"): str,
        vol.Required("description"): vol.All(str, vol.Length(max=MAX_ASK)),
        # Refinement: the current form state (possibly hand-edited) and the
        # prior asks this session, so the model revises instead of restarting.
        vol.Optional("bindings"): dict,
        # The conversation so far: each ask, and the model's reply to it.
        # A plain ask is what the 0.1.0 panel sends, which a browser can
        # still hold after the integration is updated.
        vol.Optional("history"): [
            vol.Any(str, {vol.Required("ask"): str, vol.Optional("reply"): str})
        ],
        # The AI Task entity to ask; left out, the preferred one.
        vol.Optional("entity_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_suggest(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Ask the user's LLM (via AI Task) to propose bindings from a free-text
    description, sanitized against the template and real entities. The
    result is form state only; nothing is saved."""
    if (template := _template(hass, connection, msg)) is None:
        return
    suggester = get_suggester(hass)
    if suggester.state(hass) != SUGGEST_READY:
        connection.send_error(
            msg["id"],
            "unavailable",
            "No AI Task entity is configured in Home Assistant",
        )
        return
    entity_id = msg.get("entity_id")
    if entity_id is not None and entity_id not in {
        m["entity_id"] for m in suggester.models(hass)
    }:
        connection.send_error(
            msg["id"], "unknown_model", f"No AI Task model {entity_id}"
        )
        return
    ask = SuggestAsk(
        name=msg["name"],
        description=msg["description"],
        bindings=msg.get("bindings"),
        history=msg.get("history"),
        kind=msg["kind"],
        entity_id=entity_id,
    )
    try:
        result = await async_converse(hass, suggester, template, ask)
    except SuggestFailed as err:
        connection.send_error(msg["id"], "suggest_failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/inputs/subscribe",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_inputs_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The account's event stream status, recent presses and recent
    pushes, sent now and again on every change, until unsubscribed."""
    if (entry := _account(hass, connection, msg)) is None:
        return
    inputs = account_inputs(hass, entry.entry_id)

    @callback
    def _send() -> None:
        update: InputsUpdate = {
            "stream": _stream(entry),
            "presses": inputs.log.rows(),
            "pushes": inputs.pushes.rows(),
            "status": _binding_status(entry),
        }
        connection.send_message(websocket_api.event_message(msg["id"], update))

    connection.subscriptions[msg["id"]] = inputs.add_listener(_send)
    connection.send_result(msg["id"])
    _send()


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/automations/turn_off",
        vol.Required("entity_ids"): [str],
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_automations_turn_off(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Turn off automations that feed what a binding feeds, as the user
    who asked. Only automations found feeding a slug, and none that would
    take other slugs down with it or come back on at the next start."""
    allowed = {feeder.entity_id for feeder in feeders(hass) if feeder.keep is None}
    if refused := sorted(set(msg["entity_ids"]) - allowed):
        connection.send_error(
            msg["id"],
            "not_allowed",
            f"Not an automation Aivi can turn off: {', '.join(refused)}",
        )
        return
    await async_turn_off(hass, sorted(set(msg["entity_ids"])), connection.context(msg))
    sync_issues(hass)
    connection.send_result(
        msg["id"], {"automations": [feeder.view() for feeder in feeders(hass)]}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/suggest/starters",
        vol.Required("template"): str,
        vol.Optional("kind", default=SUBENTRY_WIDGET): vol.In(KINDS),
        vol.Required("name"): str,
    }
)
@websocket_api.require_admin
@callback
def ws_suggest_starters(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Conversation starters from this home: the entities the widget's
    name points at. No model is asked."""
    if (template := _template(hass, connection, msg)) is None:
        return
    connection.send_result(
        msg["id"], {"starters": starters(hass, template, msg["name"])}
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "aivi/defaults",
        vol.Required("template"): str,
        vol.Optional("kind", default=SUBENTRY_WIDGET): vol.In(KINDS),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_defaults(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The form state a new binding starts from: what Home Assistant
    already has (its currency, a price sensor, the Energy dashboard)."""
    if (template := _template(hass, connection, msg)) is None:
        return
    bindings = await template.defaults(hass) if template.defaults else {}
    connection.send_result(msg["id"], {"bindings": bindings})
