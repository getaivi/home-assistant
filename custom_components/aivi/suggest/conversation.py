"""One turn of the Suggest conversation: ask the model, check its answer,
ask once more when the check finds something to repair, and say what came
of it."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, TypedDict

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from ..const import SUBENTRY_WIDGET
from ..templates import TemplateDef
from .answer import apply_answer, match_of, options_of, reply_of, wordless
from .request import Exchange, build_request, repair_request
from .sanitize import Rejected
from .suggester import Suggester
from .tables import async_load_tables

_LOGGER = logging.getLogger(__name__)


class SuggestFailed(Exception):
    """Asking the model failed; the message says what broke."""


@dataclass(frozen=True, slots=True)
class SuggestAsk:
    """What the panel sends with one ask."""

    name: str
    description: str
    #: The form as it is (possibly hand-edited), so the model revises it.
    bindings: dict[str, Any] | None = None
    #: The exchanges so far: each ask, and the model's reply to it.
    history: list[Exchange] | None = None
    kind: str = SUBENTRY_WIDGET
    #: The AI Task entity to ask; ``None`` asks the preferred one.
    entity_id: str | None = None


class SuggestResult(TypedDict):
    """The answer to one ask, as the panel receives it."""

    bindings: dict[str, Any]
    #: Whether the form is any different: the reply was written before the
    #: answer was checked, so the panel says so itself when a reply reports
    #: work that left the form as it was.
    changed: bool
    match: str | None
    options: list[str]
    #: A reply about work that was rejected in full, or about acting on an
    #: ask that names nothing, is not shown: nothing it describes happened.
    #: Rejections are shown instead.
    reply: str | None
    #: What the answer proposed that was rejected: the reply was written
    #: before the check, so the panel prints these under it.
    rejected: list[Rejected]


def acts(raw: Any) -> bool:
    """Whether an answer means to change the form: not a question back,
    not an answer to one."""
    return match_of(raw) not in ("none", "answer")


def needs_repair(
    raw: Any, rejected: list[Rejected], changed: bool, *, empty: bool = False
) -> bool:
    """Whether an answer gets a second request: it acts on an ask that
    names nothing, something it proposed was rejected, or it reports work
    (not a question, not an answer to one) and the form is as it was."""
    if empty:
        return acts(raw)
    if rejected:
        return True
    if changed or not acts(raw):
        return False
    reply = reply_of(raw)
    return bool(reply) and not reply.rstrip().endswith("?")


def shown(bindings: dict[str, Any]) -> dict[str, Any]:
    """A form without what the integration derives from it."""
    return {k: v for k, v in bindings.items() if not k.endswith("__watched")}


async def async_converse(
    hass: HomeAssistant,
    suggester: Suggester,
    template: TemplateDef,
    ask: SuggestAsk,
) -> SuggestResult:
    """Answer one ask. A failed first request is retried once, and a failed
    repair keeps the first answer; ``SuggestFailed`` says why the model
    gave no answer at all."""
    await async_load_tables(hass)
    instructions, structure = build_request(
        hass,
        template,
        ask.name,
        ask.description,
        current=ask.bindings,
        history=ask.history,
        subentry=ask.kind,
    )
    before = shown(ask.bindings or {})
    # Emoji or punctuation alone names nothing to change, so it changes
    # nothing. Only as the opening ask: later it can answer a question
    # ("👍").
    empty = wordless(ask.description) and not ask.history

    async def generate(text: str) -> Any:
        return await suggester.generate(
            hass,
            # Some backends (OpenRouter/OpenAI) reuse this as the structured
            # -output schema name, which must match ^[a-zA-Z0-9_-]+$.
            task_name="aivi_widget_binding",
            instructions=text,
            structure=structure,
            entity_id=ask.entity_id,
        )

    def applied(raw: Any) -> tuple[dict[str, Any], list[Rejected], bool]:
        """The form after an answer is applied, what the answer proposed that
        was rejected, and whether the form changed."""
        if empty or not acts(raw):
            # Nothing here shows what was asked for, or nothing was asked
            # to change: whatever the answer filled in anyway stays out.
            return dict(ask.bindings or {}), [], False
        bindings, rejected = apply_answer(hass, template, raw, ask.bindings)
        return bindings, rejected, shown(bindings) != before

    try:
        try:
            raw = await generate(instructions)
        except HomeAssistantError:
            # A provider now and then returns an answer its own integration
            # cannot parse; the same request a second time usually succeeds.
            raw = await generate(instructions)
        bindings, rejected, changed = applied(raw)
        if needs_repair(raw, rejected, changed, empty=empty):
            # The reply was written before the answer was checked. Given
            # the check's result, the model gets one more attempt; if that
            # request fails, the first answer is kept.
            try:
                again = await generate(
                    repair_request(
                        instructions, raw, rejected, changed=changed, empty=empty
                    )
                )
            except HomeAssistantError:
                _LOGGER.debug("Suggest repair failed; keeping the first answer")
            else:
                raw = again
                bindings, rejected, changed = applied(raw)
    except HomeAssistantError as err:
        raise SuggestFailed(str(err)) from err
    except Exception as err:
        # The model integration is third-party code (OpenRouter's
        # strict-schema adjuster has raised KeyError): the user gets what
        # broke instead of "Unknown error", the log keeps the traceback.
        _LOGGER.exception("AI Task failed while suggesting")
        raise SuggestFailed(f"{type(err).__name__}: {err}") from err
    # An answer that still acts on an ask that names nothing is not shown:
    # nothing it describes happened.
    unheard = empty and acts(raw)
    return {
        "bindings": bindings,
        "changed": changed,
        "match": "none" if empty else match_of(raw),
        "options": options_of(raw),
        "reply": None if unheard or (rejected and not changed) else reply_of(raw, hass),
        "rejected": rejected,
    }
