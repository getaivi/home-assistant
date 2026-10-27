"""The fix flows. For an inactive subscription, "Check now" asks Aivi
whether the account was renewed: renewed, the bindings resume and the
issue goes away; still inactive or unreachable, the dialog moves to a
step that says so and asks again from there. (A form without fields
shows no error, so the answer is a step of its own.)
For a binding an automation also feeds, confirming turns the automation
off."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.repairs import RepairsFlow
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .api import AiviAuthError, AiviError
from .conflicts import ISSUE_CONFLICT, async_turn_off, feeding, sync_issues
from .const import DOMAIN

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
    from homeassistant.components.repairs import RepairsFlowResult
else:
    import voluptuous as vol


class SubscriptionRepairFlow(RepairsFlow):
    """Check the account's subscription again."""

    def __init__(self, entry_id: str) -> None:
        self._entry_id = entry_id

    async def async_step_init(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        if user_input is None:
            return self._confirm()
        entry = self.hass.config_entries.async_get_entry(self._entry_id)
        if entry is None or entry.state is not ConfigEntryState.LOADED:
            return self.async_abort(reason="not_loaded")
        try:
            active = await entry.runtime_data.async_check_subscription()
        except AiviAuthError:
            entry.async_start_reauth(self.hass)
            return self.async_abort(reason="auth_failed")
        except AiviError:
            return self._confirm("cannot_connect")
        if not active:
            return self._confirm("still_inactive")
        return self.async_create_entry(data={})

    async def async_step_still_inactive(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        return await self.async_step_confirm(user_input)

    async def async_step_cannot_connect(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        return await self.async_step_confirm(user_input)

    def _confirm(self, step_id: str = "confirm") -> RepairsFlowResult:
        issue = ir.async_get(self.hass).async_get_issue(DOMAIN, self.issue_id)
        return self.async_show_form(
            step_id=step_id,
            data_schema=vol.Schema({}),
            description_placeholders=issue.translation_placeholders if issue else None,
        )


class ConflictRepairFlow(RepairsFlow):
    """Turn off the automations that feed what a binding feeds."""

    def __init__(self, entry_id: str, subentry_id: str) -> None:
        self._entry_id = entry_id
        self._subentry_id = subentry_id

    async def async_step_init(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        if user_input is None:
            issue = ir.async_get(self.hass).async_get_issue(DOMAIN, self.issue_id)
            return self.async_show_form(
                step_id="confirm",
                data_schema=vol.Schema({}),
                description_placeholders=issue.translation_placeholders
                if issue
                else None,
            )
        entry = self.hass.config_entries.async_get_entry(self._entry_id)
        subentry = entry.subentries.get(self._subentry_id) if entry else None
        if subentry is not None:
            await async_turn_off(
                self.hass,
                [
                    feeder.entity_id
                    for feeder in feeding(self.hass, subentry)
                    if feeder.keep is None
                ],
            )
        sync_issues(self.hass)
        return self.async_create_entry(data={})


async def async_create_fix_flow(
    hass: HomeAssistant, issue_id: str, data: dict[str, Any] | None
) -> RepairsFlow:
    if issue_id.startswith(f"{ISSUE_CONFLICT}_"):
        return ConflictRepairFlow(
            str((data or {})["entry_id"]), str((data or {})["subentry_id"])
        )
    return SubscriptionRepairFlow(str((data or {})["entry_id"]))
