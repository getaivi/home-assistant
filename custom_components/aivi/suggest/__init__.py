"""AI-assisted binding suggestions ("Suggest", a conversation).

Turns a free-text ask ("show the washer's progress, cyan accent") into
proposed bindings by asking the LLM the *user* configured in Home
Assistant, via the AI Task integration's structured generation. Aivi never
receives a key or a prompt; with a local model nothing leaves the network.

AI Task is single-shot, so the panel holds the conversation: every ask
comes with the exchanges so far (each ask and the model's reply) and the
present form state, and the answer carries both the revised configuration
and a short reply in the user's words: what changed, or a question back
when the ask can't be met.

Trust model: the model only ever produces a *suggestion*. Its output is
sanitized against the template's field map and the real entity registry
(unknown keys dropped, nonexistent entities dropped, colors clamped to the
palette), then lands in the editor as pre-filled form state where the live
preview shows exactly what would be pushed. Saving stays a human action.

The suggester is an injectable seam (``DATA_SUGGESTER`` on ``hass.data``),
like the API client: tests provide a fake, production calls AI Task.
"""

from .answer import (
    ANSWER,
    MATCHES,
    MAX_OPTION,
    MAX_OPTIONS,
    MAX_REPLY,
    OPS,
    UNCLEAR,
    apply_answer,
    as_answer,
    expand_ops,
    match_of,
    options_of,
    reply_of,
    wordless,
)
from .candidates import MAX_STARTERS, starters
from .conversation import SuggestAsk, SuggestFailed, SuggestResult, async_converse
from .request import MAX_ASK, Exchange, build_request, repair_request
from .sanitize import Rejected, sanitize, sanitize_report
from .suggester import (
    DATA_SUGGESTER,
    SUGGEST_NO_ENTITY,
    SUGGEST_NOT_LOADED,
    SUGGEST_READY,
    AiTaskSuggester,
    Suggester,
    SuggestModel,
    SuggestState,
    get_suggester,
)
from .symbols import known_symbol, near_symbols, symbols
from .tables import async_load_tables

__all__ = [
    "ANSWER",
    "DATA_SUGGESTER",
    "MATCHES",
    "MAX_ASK",
    "MAX_OPTION",
    "MAX_OPTIONS",
    "MAX_REPLY",
    "MAX_STARTERS",
    "OPS",
    "SUGGEST_NOT_LOADED",
    "SUGGEST_NO_ENTITY",
    "SUGGEST_READY",
    "AiTaskSuggester",
    "Exchange",
    "Rejected",
    "SuggestAsk",
    "SuggestFailed",
    "SuggestModel",
    "SuggestResult",
    "SuggestState",
    "UNCLEAR",
    "Suggester",
    "apply_answer",
    "as_answer",
    "async_converse",
    "async_load_tables",
    "build_request",
    "expand_ops",
    "get_suggester",
    "known_symbol",
    "match_of",
    "near_symbols",
    "options_of",
    "reply_of",
    "repair_request",
    "sanitize",
    "sanitize_report",
    "starters",
    "symbols",
    "wordless",
]
