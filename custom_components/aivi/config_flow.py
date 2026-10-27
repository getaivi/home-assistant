"""The account config flow.

Paste a token, validated live with one minimal request. Validation goes through
``api.get_client`` so a test's fake client is used with no patching.

Binding widgets and Live Activities happens exclusively in the Aivi panel,
which writes config subentries over the WebSocket API (``websocket.py``);
there are no subentry flows.

The options flow holds the one account setting the panel does not: whether
the activity log is kept across restarts (off by default, as it writes to
disk).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, override

from homeassistant.config_entries import (
    SOURCE_REAUTH,
    ConfigEntry,
    ConfigEntryState,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import section
from homeassistant.helpers.selector import (
    BooleanSelector,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import AiviAuthError, AiviError, AiviSubscriptionError, get_client
from .const import (
    CONF_BASE_URL,
    CONF_KEEP_LOG,
    CONF_NAME,
    CONF_TOKEN,
    DEFAULT_BASE_URL,
    DOMAIN,
)
from .runtime import AiviConfigEntry

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

# The collapsed section that holds every non-essential field.
ADVANCED = "advanced"
DEFAULT_TITLE = "Aivi"


def _account_schema() -> vol.Schema:
    """Token flat; the base URL folded into a collapsed 'Advanced' section."""
    return vol.Schema(
        {
            vol.Required(CONF_TOKEN): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)
            ),
            # The API exposes no account identity, so the name that tells
            # two accounts apart on the panel comes from the user.
            vol.Optional(CONF_NAME, default=DEFAULT_TITLE): TextSelector(),
            vol.Optional(ADVANCED): section(
                vol.Schema(
                    {
                        vol.Optional(
                            CONF_BASE_URL, default=DEFAULT_BASE_URL
                        ): TextSelector()
                    }
                ),
                {"collapsed": True},
            ),
        }
    )


class AiviConfigFlow(ConfigFlow, domain=DOMAIN):
    """Connect an Aivi account."""

    VERSION = 1
    MINOR_VERSION = 1

    @staticmethod
    @callback
    @override
    def async_get_options_flow(config_entry: ConfigEntry) -> AiviOptionsFlow:
        return AiviOptionsFlow()

    @override
    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            advanced = user_input.get(ADVANCED) or {}
            base_url = _normalized(advanced.get(CONF_BASE_URL, DEFAULT_BASE_URL))
            # The API exposes no stable account id, so duplicates are
            # detected on the credentials themselves (the documented
            # fallback for the unique-config-entry rule).
            self._async_abort_entries_match(
                {CONF_TOKEN: user_input[CONF_TOKEN], CONF_BASE_URL: base_url}
            )
            error = await _validate_token(self.hass, base_url, user_input[CONF_TOKEN])
            if error is None:
                return self.async_create_entry(
                    title=str(user_input.get(CONF_NAME) or "").strip() or DEFAULT_TITLE,
                    data={
                        CONF_TOKEN: user_input[CONF_TOKEN],
                        CONF_BASE_URL: base_url,
                    },
                )
            errors["base"] = error
        return self.async_show_form(
            step_id="user",
            data_schema=_account_schema(),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Change the token and (under Advanced options) the base URL in place."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            advanced = user_input.get(ADVANCED) or {}
            base_url = _normalized(
                advanced.get(
                    CONF_BASE_URL, entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL)
                )
            )
            error = await _validate_token(self.hass, base_url, user_input[CONF_TOKEN])
            if error is None:
                return self._update_and_finish(
                    entry,
                    {CONF_TOKEN: user_input[CONF_TOKEN], CONF_BASE_URL: base_url},
                )
            errors["base"] = error
        schema = self.add_suggested_values_to_schema(
            _account_schema(),
            {
                ADVANCED: {
                    CONF_BASE_URL: entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL)
                },
            },
        )
        return self.async_show_form(
            step_id="reconfigure", data_schema=schema, errors=errors
        )

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            base_url = entry.data.get(CONF_BASE_URL, DEFAULT_BASE_URL)
            error = await _validate_token(self.hass, base_url, user_input[CONF_TOKEN])
            if error is None:
                return self._update_and_finish(
                    entry, {CONF_TOKEN: user_input[CONF_TOKEN]}
                )
            errors["base"] = error
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TOKEN): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    )
                }
            ),
            errors=errors,
        )

    def _update_and_finish(
        self, entry: AiviConfigEntry, updates: dict[str, Any]
    ) -> ConfigFlowResult:
        """Store the new account data and finish. A loaded entry's update
        listener reloads it when the data changed; otherwise (unchanged,
        or the entry is not running) the reload is scheduled here."""
        # Read before the update: the listener starts the reload at once.
        loaded = entry.state is ConfigEntryState.LOADED
        changed = self.hass.config_entries.async_update_entry(
            entry, data={**entry.data, **updates}
        )
        if not changed or not loaded:
            self.hass.config_entries.async_schedule_reload(entry.entry_id)
        return self.async_abort(
            reason="reauth_successful"
            if self.source == SOURCE_REAUTH
            else "reconfigure_successful"
        )


class AiviOptionsFlow(OptionsFlow):
    """The account's options: whether its activity log is kept on disk.
    The running entry applies a change in place (its update listener)."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(
                data={CONF_KEEP_LOG: bool(user_input.get(CONF_KEEP_LOG, False))}
            )
        schema = vol.Schema(
            {vol.Optional(CONF_KEEP_LOG, default=False): BooleanSelector()}
        )
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                schema, dict(self.config_entry.options)
            ),
        )


def _normalized(base_url: str) -> str:
    """The base URL without trailing slashes, so the same API is one
    account however it was typed."""
    return base_url.strip().rstrip("/")


async def _validate_token(hass: HomeAssistant, base_url: str, token: str) -> str | None:
    """Return an error key, or ``None`` when the token works."""
    client = get_client(hass, base_url, token)
    try:
        await client.check_access()
    except AiviAuthError:
        return "invalid_auth"
    except AiviSubscriptionError:
        return "no_subscription"
    except AiviError:
        return "cannot_connect"
    return None
