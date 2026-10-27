"""The model behind Suggest: the ``Suggester`` seam and its AI Task backend.

The suggester is an injectable seam (``DATA_SUGGESTER`` on ``hass.data``),
like the API client: tests provide a fake, production calls AI Task.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, Protocol, TypedDict

from homeassistant.core import HomeAssistant, callback
from homeassistant.util.hass_dict import HassKey

from ..const import DOMAIN

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

DATA_SUGGESTER: HassKey[Suggester] = HassKey(f"{DOMAIN}_suggester")


# Lets the panel explain what's missing instead of hiding the box.
# Mirrored in SuggestState (frontend/src/api.ts).
type SuggestState = Literal["ready", "no_entity", "not_loaded"]
SUGGEST_READY: SuggestState = "ready"
SUGGEST_NO_ENTITY: SuggestState = "no_entity"
SUGGEST_NOT_LOADED: SuggestState = "not_loaded"


class SuggestModel(TypedDict):
    """One AI Task entity the user can pick for a conversation."""

    entity_id: str
    name: str
    #: Home Assistant's preferred data-generation entity: the default.
    preferred: bool


class Suggester(Protocol):
    """What the WebSocket layer needs from an LLM backend."""

    @callback
    def state(self, hass: HomeAssistant) -> SuggestState: ...

    @callback
    def models(self, hass: HomeAssistant) -> list[SuggestModel]: ...

    async def generate(
        self,
        hass: HomeAssistant,
        *,
        task_name: str,
        instructions: str,
        structure: vol.Schema,
        entity_id: str | None = None,
    ) -> Any: ...


class AiTaskSuggester:
    """Production backend: Home Assistant's AI Task integration."""

    @callback
    def state(self, hass: HomeAssistant) -> SuggestState:
        """How far the user is from a working "Describe it".

        - ``not_loaded``: the AI Task integration isn't loaded: no
          configured integration provides it (or this HA predates it).
        - ``no_entity``: AI Task is loaded, but no model provides data
          generation yet (no ``ai_task`` entity), so there is nothing to
          ask; the fix is on HA's AI preferences page.
        - ``ready``: at least one model exists. The conversation asks the
          one the user picked, else Home Assistant's preferred one, else
          the first.
        """
        if "ai_task" not in hass.config.components:
            return SUGGEST_NOT_LOADED
        return SUGGEST_READY if self.models(hass) else SUGGEST_NO_ENTITY

    @callback
    def models(self, hass: HomeAssistant) -> list[SuggestModel]:
        """Every AI Task entity, the preferred one first."""
        if "ai_task" not in hass.config.components:
            return []
        # Imported lazily: ai_task is an optional runtime dependency.
        from homeassistant.components import ai_task  # noqa: PLC0415

        prefs = hass.data.get(ai_task.DATA_PREFERENCES)
        preferred = prefs.gen_data_entity_id if prefs else None
        models = [
            SuggestModel(
                entity_id=state.entity_id,
                name=state.name,
                preferred=state.entity_id == preferred,
            )
            for state in hass.states.async_all("ai_task")
        ]
        models.sort(key=lambda m: (not m["preferred"], m["name"].lower()))
        return models

    async def generate(
        self,
        hass: HomeAssistant,
        *,
        task_name: str,
        instructions: str,
        structure: vol.Schema,
        entity_id: str | None = None,
    ) -> Any:
        # Imported lazily: ai_task is an optional runtime dependency.
        from homeassistant.components import ai_task  # noqa: PLC0415

        if entity_id is None:
            # Passed by id, so a Home Assistant without a preference set
            # still answers from the first model.
            first = next(iter(self.models(hass)), None)
            entity_id = first["entity_id"] if first is not None else None
        result = await ai_task.async_generate_data(
            hass,
            task_name=task_name,
            entity_id=entity_id,
            instructions=instructions,
            structure=structure,
        )
        return result.data


def get_suggester(hass: HomeAssistant) -> Suggester:
    injected = hass.data.get(DATA_SUGGESTER)
    return injected if injected is not None else AiTaskSuggester()
