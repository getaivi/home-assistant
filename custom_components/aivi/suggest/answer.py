"""The answer schema and the operation language a model answers in."""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant

from ..blocks import EntityRows
from ..metadata import describe_template
from ..templates import TemplateDef
from .keys import address_of, answer_keys, bands_of, row_option_keys, slot_group
from .sanitize import Rejected, sanitize_report

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

# The reply is a line or two, never an essay.
MAX_REPLY = 400


#: How the request matches the home: one obvious reading, the most likely
#: of several (acted on, the rest offered), nothing to show it with, or a
#: question about the form that needs an answer and no change.
MATCHES = ("clear", "guess", "none", "answer")
MAX_OPTIONS = 4
MAX_OPTION = 60


#: The answer every template takes: what the user means, whether the home
#: has it, the changes as a list of ops, the reply, and what to offer next.
#:
#: Every key is required and plain text. A provider's schema adjuster
#: (Home Assistant's OpenRouter integration, OpenAI's strict mode) turns
#: each optional key into a nullable one, and Anthropic rejects a schema
#: with more than 16 of those, or with an enum made nullable. A form's own
#: keys (dozens, all optional) therefore cannot be the structure; the ops
#: name them instead.
ANSWER = vol.Schema(
    {
        vol.Required("subject"): str,
        vol.Required("match"): str,
        vol.Required("ops"): [
            {
                vol.Required("op"): str,
                vol.Required("key"): str,
                vol.Required("entity"): str,
                vol.Required("option"): str,
                vol.Required("value"): str,
            }
        ],
        vol.Required("reply"): str,
        vol.Required("options"): [str],
    }
)

OPS = ("set", "clear", "add", "remove", "move", "row")


def as_answer(bindings: dict[str, Any]) -> dict[str, Any]:
    """Stored bindings in the shape the sanitizer reads an answer in: a
    list's options as row objects, and nothing derived."""
    answer: dict[str, Any] = {}
    for key, value in bindings.items():
        if key.endswith("__watched"):
            continue
        if key.endswith("__options") and isinstance(value, dict):
            answer[key] = [
                {"entity_id": entity_id, **options}
                for entity_id, options in value.items()
            ]
        else:
            answer[key] = value
    return answer


def _typed(kind: Any, value: str) -> Any:
    """An op's text as the value its key takes; raises ValueError."""
    text = value.strip()
    if kind is bool:
        if text.lower() not in ("true", "false"):
            raise ValueError(value)
        return text.lower() == "true"
    if isinstance(kind, list):
        if kind == [str]:
            return [part.strip() for part in text.split(",") if part.strip()]
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            raise ValueError(value)
        return parsed
    if kind is str:
        return text
    return float(text)


def _position(value: str, length: int) -> int | None:
    """A 1-based position an op names, as an index; None when it names none."""
    try:
        place = int(float(value))
    except ValueError:
        return None
    return max(0, min(length, place - 1))


def expand_ops(
    template: TemplateDef, raw: Any, current: dict[str, Any] | None
) -> tuple[Any, list[Rejected]]:
    """An answer given as ops, as the complete answer the sanitizer reads:
    the form as it is, with each op applied in order. An op that names no
    key of this template, or a value its key cannot take, is reported and
    skipped. An answer without ``ops`` is already a complete answer and
    passes through."""
    if not isinstance(raw, dict) or not isinstance(raw.get("ops"), list):
        return raw, []
    fields = describe_template(template)["fields"]
    types: dict[str, Any] = {}
    lists: dict[str, dict[str, Any]] = {}
    caps: dict[str, int] = {}
    for field_def, field in zip(template.fields, fields, strict=True):
        types.update(answer_keys(field_def, field))
        if field["kind"] == "rows":
            block = field_def.block
            lists[field["key"]] = (
                row_option_keys(block)
                if isinstance(block, EntityRows) and block.row_options
                else {}
            )
            if cap := field.get("max"):
                caps[field["key"]] = cap
    answer = as_answer(current or {})
    rejected: list[Rejected] = []
    removed: list[tuple[str, str, str]] = []

    def refuse(key: str, value: str, reason: str = "bad_value") -> None:
        rejected.append(Rejected(key=key or "?", value=value[:120], reason=reason))

    def row(key: str, entity: str) -> dict[str, Any]:
        rows = answer.setdefault(f"{key}__options", [])
        for item in rows:
            if item.get("entity_id") == entity:
                return item
        rows.append({"entity_id": entity})
        return rows[-1]

    for item in raw["ops"]:
        if not isinstance(item, dict):
            continue
        op, key, entity, option, value = (
            str(item.get(name) or "").strip()
            for name in ("op", "key", "entity", "option", "value")
        )
        if op in ("add", "remove", "move", "row") and key not in lists:
            refuse(key, f"{op} {entity}".strip(), "not_an_option")
        elif op == "add":
            rows = list(answer.get(key) or [])
            if entity in rows:
                # Reported so the model (and the user) know it added nothing.
                refuse(key, entity, "already_there")
            elif len(rows) >= caps.get(key, len(rows) + 1):
                refuse(key, entity, "list_full")
            else:
                place = _position(value, len(rows))
                rows.insert(len(rows) if place is None else place, entity)
                answer[key] = rows
        elif op == "remove":
            answer[key] = [e for e in answer.get(key) or [] if e != entity]
            answer[f"{key}__options"] = [
                r
                for r in answer.get(f"{key}__options") or []
                if r.get("entity_id") != entity
            ]
        elif op == "move":
            rows = [e for e in answer.get(key) or [] if e != entity]
            place = _position(value, len(rows))
            if place is None or entity not in (answer.get(key) or []):
                refuse(key, f"move {entity} {value}".strip())
            else:
                rows.insert(place, entity)
                answer[key] = rows
        elif op == "row":
            if option not in lists[key] or entity not in (answer.get(key) or []):
                refuse(key, f"{entity}: {option}".strip(), "not_an_option")
            else:
                try:
                    if value:
                        row(key, entity)[option] = _typed(lists[key][option], value)
                    else:
                        # Removed: the merge keeps a row's options unless
                        # they are set, so a removal is carried beside the
                        # answer and applied after it (apply_answer).
                        row(key, entity).pop(option, None)
                        removed.append((key, entity, option))
                except ValueError:
                    refuse(key, f"{entity}: {option} {value}".strip())
        elif op == "clear" and (key in types or key in lists):
            answer[key] = [] if isinstance(types.get(key), list) else ""
            answer.pop(bands_of(address_of(key)), None)
        elif op == "set" and key in types:
            try:
                # An entity for a field is its value: a model that put it
                # in the op's entity slot meant the same thing.
                answer[key] = _typed(types[key], value or entity)
            except ValueError:
                refuse(key, value)
            else:
                # A color set by the answer replaces one by value.
                answer.pop(bands_of(address_of(key)), None)
        else:
            refuse(key, f"{op} {value}".strip(), "not_an_option")
    return {**raw, **answer, _ROWS_REMOVED: removed}, rejected


#: Where an expanded answer carries the row options its ops removed.
_ROWS_REMOVED = "__row_options_removed"


def apply_answer(
    hass: HomeAssistant,
    template: TemplateDef,
    raw: Any,
    current: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[Rejected]]:
    """The form after an answer, and the parts of the answer that were
    rejected: ops expanded onto the form as it is, the result sanitized
    (``sanitize_report``), then the row options the ops removed taken
    out."""
    answer, unusable = expand_ops(template, raw, current)
    bindings, rejected = sanitize_report(hass, template, answer, current)
    removed = answer.get(_ROWS_REMOVED, []) if isinstance(answer, dict) else []
    for key, entity, option in removed:
        rows = dict(bindings.get(f"{key}__options") or {})
        row = {
            name: value
            for name, value in (rows.get(entity) or {}).items()
            if name not in slot_group(option)
        }
        if row:
            rows[entity] = row
        else:
            rows.pop(entity, None)
        if rows:
            bindings[f"{key}__options"] = rows
        else:
            bindings.pop(f"{key}__options", None)
    return bindings, unusable + rejected


#: The subject a model gives a request it did not understand. The prompt
#: asks for this word, so an answer that calls the request unclear and
#: still fills the form is read as the question it says it is.
UNCLEAR = "unclear"


def match_of(raw: Any) -> str | None:
    """What the model decided before it filled anything in. A request the
    model called unclear matches nothing, whatever ``match`` says."""
    if not isinstance(raw, dict):
        return None
    subject = raw.get("subject")
    if isinstance(subject, str) and subject.strip().strip(".").lower() == UNCLEAR:
        return "none"
    value = raw.get("match")
    return value if isinstance(value, str) and value in MATCHES else None


def wordless(ask: str) -> bool:
    """Whether an ask holds no word or number in any script: emoji or
    punctuation alone. Nothing in it can name a change."""
    return not re.search(r"[^\W_]", ask)


def options_of(raw: Any) -> list[str]:
    """The follow-ups the answer offers, as short one-press requests."""
    given = raw.get("options") if isinstance(raw, dict) else None
    if not isinstance(given, list):
        return []
    out: list[str] = []
    for item in given:
        text = " ".join(item.split()) if isinstance(item, str) else ""
        if text and len(text) <= MAX_OPTION and text not in out:
            out.append(text)
    return out[:MAX_OPTIONS]


_ENTITY_ID = re.compile(r"['\"`]?\b([a-z_]+\.[a-z0-9_]+)\b['\"`]?")


def reply_of(raw: Any, hass: HomeAssistant | None = None) -> str | None:
    """The model's reply to the user, trimmed to a line or two; None when
    it gave none. With ``hass``, an entity id the reply spells out is
    replaced by the entity's name: models write ids even when the prompt
    tells them not to."""
    if not isinstance(raw, dict):
        return None
    reply = raw.get("reply")
    if not isinstance(reply, str) or not reply.strip():
        return None
    text = " ".join(str(reply).split())
    if hass is not None:

        def named(match: re.Match[str]) -> str:
            state = hass.states.get(match[1])
            name = state and state.attributes.get("friendly_name")
            return str(name) if name else match[0]

        text = _ENTITY_ID.sub(named, text)
    return text if len(text) <= MAX_REPLY else text[: MAX_REPLY - 1].rstrip() + "…"
