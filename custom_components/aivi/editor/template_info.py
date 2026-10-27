"""What the editor says about a template beside its box: the kind of
value it renders to, what it re-renders on, where and why it fails, and
the entity ids it names that Home Assistant does not have.

Everything here reads one render: the ``RenderInfo`` the preview's
resolver keeps, so the feedback describes the value the content was
built from.
"""

from __future__ import annotations

import difflib
import re
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant, split_entity_id, valid_entity_id
from homeassistant.exceptions import TemplateError
from jinja2 import TemplateSyntaxError, UndefinedError

from ..sources import listeners_of, renders_to_nothing
from ..values import finite_number, parse_list

if TYPE_CHECKING:
    from homeassistant.helpers.template import RenderInfo

#: Close matches offered for an entity id Home Assistant does not have.
SUGGESTIONS = 3

#: A run of dotted names (``states.sensor.living_temp.state``): every
#: adjacent pair whose first part is a domain is a candidate entity id.
_DOTTED = re.compile(r"(?<![\w.])[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+")


def value_kind(text: str) -> dict[str, Any]:
    """The kind of value a render reads as: ``nothing`` (what the runtime
    treats as unresolved), ``bool``, ``number``, ``list`` (with ``items``,
    and ``range`` when every item is a number) or ``text``."""
    if renders_to_nothing(text):
        return {"kind": "nothing"}
    stripped = text.strip()
    if stripped.lower() in ("true", "false"):
        return {"kind": "bool"}
    if finite_number(stripped) is not None:
        return {"kind": "number"}
    items = parse_list(stripped)
    if items is not None:
        out: dict[str, Any] = {"kind": "list", "items": len(items)}
        numbers = [n for item in items if (n := finite_number(item)) is not None]
        if numbers and len(numbers) == len(items):
            out["range"] = [min(numbers), max(numbers)]
        return out
    return {"kind": "text"}


def listens(info: RenderInfo) -> dict[str, Any]:
    """What the push re-renders the template on, for the "Updates on"
    line: ``entities``, whole ``domains``, ``all`` states, ``time`` (the
    start of every minute) and the ``rate_limit`` Home Assistant puts on
    domain and every-state listeners, in seconds."""
    read = listeners_of(info)
    out: dict[str, Any] = {
        "entities": [] if read.all_states else list(read.entities),
        "domains": [] if read.all_states else list(read.domains),
        "all": read.all_states,
        "time": read.time,
    }
    if read.rate_limit is not None and read.everything:
        out["rate_limit"] = read.rate_limit
    return out


def _quoted(message: str, pattern: str) -> str | None:
    match = re.search(pattern, message)
    return str(match.group(1)) if match else None


# Jinja's syntax messages, in the order they are tried: a pattern over
# the message, the reason the panel words, and the params it fills in.
_SYNTAX: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        r"^Unexpected end of template\..*needs to be closed is '(\w+)'",
        "unclosed_block",
        ("tag",),
    ),
    (r"^Unexpected end of template", "unexpected_end", ()),
    (r"^Encountered unknown tag '(end\w*)'", "stray_end", ("tag",)),
    (r"^Encountered unknown tag '(\w+)'", "unknown_tag", ("tag",)),
    (r"^No filter named '([^']+)'", "unknown_filter", ("name",)),
    (r"^No test named '([^']+)'", "unknown_test", ("name",)),
    (r"^unexpected char '(.)' at \d+$", "bad_char", ("char",)),
    (r"^unexpected '\}'$", "unclosed", ()),
    (r"^unexpected '[^']+', expected '([^']+)'$", "missing", ("token",)),
    (r"^unexpected 'end of (?:print statement|statement block)'$", "incomplete", ()),
    (r"^expected token '[^']+', got '([^']+)'$", "extra", ("token",)),
    (r"^unexpected '([^']+)'$", "unexpected", ("token",)),
)

# Runtime errors, by the cause's type and message.
_RUNTIME: tuple[tuple[type[Exception], str, str, tuple[str, ...]], ...] = (
    (
        UndefinedError,
        r"^'None' has no attribute '([^']+)'$",
        "none_attribute",
        ("name",),
    ),
    (
        UndefinedError,
        r"^'([^']+)' has no attribute '([^']+)'$",
        "no_attribute",
        ("value", "name"),
    ),
    (UndefinedError, r"^'([^']+)' is undefined$", "undefined", ("name",)),
    (
        ValueError,
        r"^Template error: (\w+) got invalid input '(.*)' when rendering",
        "no_default",
        ("function", "value"),
    ),
    (TypeError, r"", "type", ()),
    (ZeroDivisionError, r"", "division_by_zero", ()),
)


#: The tags that open a block an ``end<tag>`` closes (``set`` only
#: without ``=``: ``{% set x %}…{% endset %}``).
_BLOCKS = frozenset(
    ("if", "for", "macro", "call", "filter", "block", "with", "autoescape", "trans")
)

_OPENER = re.compile(r"\{[{%#]")
_TAG = re.compile(r"\{%[-+]?\s*(\w+)")
_ENDRAW = re.compile(r"\{%[-+]?\s*endraw\s*[-+]?%\}")


def _close_of(source: str, start: int, closer: str) -> int:
    """Where the ``{{``/``{%`` tag at ``start`` ends (past its closer),
    skipping quoted strings; the end of the text when it never does."""
    at = start + 2
    quote = ""
    while at < len(source):
        char = source[at]
        if quote:
            if char == "\\":
                at += 1
            elif char == quote:
                quote = ""
        elif char in "'\"":
            quote = char
        elif source.startswith(closer, at):
            return at + len(closer)
        at += 1
    return len(source)


def _open_blocks(source: str) -> list[tuple[str, int]]:
    """The blocks left open at the end of ``source``, outermost first:
    each tag's name and the offset of its ``{%``. Comments, raw blocks
    and the strings inside tags open nothing."""
    stack: list[tuple[str, int]] = []
    at = 0
    while match := _OPENER.search(source, at):
        start = match.start()
        kind = match.group()
        if kind == "{#":
            end = source.find("#}", start + 2)
            at = len(source) if end < 0 else end + 2
            continue
        at = _close_of(source, start, "}}" if kind == "{{" else "%}")
        if kind == "{{":
            continue
        tag = _TAG.match(source, start)
        name = tag.group(1) if tag else ""
        if name == "raw":
            end = _ENDRAW.search(source, at)
            at = len(source) if end is None else end.end()
        elif name in _BLOCKS or (name == "set" and "=" not in source[start:at]):
            stack.append((name, start))
        elif name.startswith("end") and stack and stack[-1][0] == name[3:]:
            stack.pop()
    return stack


def _unclosed_at(source: str, tag: str) -> int | None:
    """The offset of the innermost open block's tag, when it is the
    ``tag`` Jinja names; None when the text shows no such block."""
    stack = _open_blocks(source)
    if stack and stack[-1][0] == tag:
        return stack[-1][1]
    return None


def _reason(
    message: str, rules: tuple[tuple[str, str, tuple[str, ...]], ...]
) -> tuple[str, dict[str, str]] | None:
    for pattern, reason, names in rules:
        match = re.search(pattern, message, re.DOTALL)
        if match:
            return reason, dict(zip(names, match.groups(), strict=True))
    return None


def error_details(err: TemplateError, source: str) -> dict[str, Any]:
    """Where and why a template fails, beside Home Assistant's message
    (``error``): the ``line`` (and ``column`` where Jinja names a
    position, or for an unclosed block, its opening tag) of a syntax
    error, and a ``reason`` with its ``params`` for
    the messages the panel words plainly. Home Assistant wraps Jinja's
    exception, so both are read from the cause, and only when it is
    there."""
    out: dict[str, Any] = {"status": "error", "error": str(err)}
    cause = err.__cause__
    found: tuple[str, dict[str, str]] | None = None
    if isinstance(cause, TemplateSyntaxError):
        message = str(cause.message or "")
        if cause.lineno > 0:
            out["line"] = cause.lineno
        position = _quoted(message, r" at (\d+)$")
        if position is not None and int(position) <= len(source):
            at = int(position)
            out["line"] = source.count("\n", 0, at) + 1
            out["column"] = at - source.rfind("\n", 0, at)
        found = _reason(message, _SYNTAX)
        if found is not None and found[0] == "unclosed_block":
            # Jinja names the line the template ends on; the place to
            # fix is the tag left open.
            opened = _unclosed_at(source, found[1]["tag"])
            if opened is not None:
                out["line"] = source.count("\n", 0, opened) + 1
                out["column"] = opened - source.rfind("\n", 0, opened)
    elif cause is not None:
        message = str(cause)
        for kind, pattern, reason, names in _RUNTIME:
            match = re.search(pattern, message, re.DOTALL)
            if isinstance(cause, kind) and match:
                found = reason, dict(zip(names, match.groups(), strict=True))
                break
    if found is not None:
        out["reason"], params = found
        if params:
            out["params"] = params
    return out


def unknown_entities(
    hass: HomeAssistant, info: RenderInfo, source: str
) -> list[dict[str, Any]]:
    """The entity ids the template reads or names that Home Assistant does
    not have, each with the closest ids it does have in the same domain
    (``suggestions``, best first), sorted by id. Render info lists what a render read,
    missing or not; the text adds the ids a failed or skipped branch
    names (``states.sensor.typo.state`` raises before it reads on)."""
    domains = {split_entity_id(e)[0] for e in hass.states.async_entity_ids()}
    named: list[str] = list(info.entities)
    for run in _DOTTED.findall(source):
        parts = run.split(".")
        named.extend(
            f"{domain}.{object_id}"
            for domain, object_id in zip(parts, parts[1:], strict=False)
            if domain in domains
        )
    out: list[dict[str, Any]] = []
    for entity_id in sorted(set(named)):
        # Text that is not an id at all (half typed: states('living'))
        # names nothing to suggest for.
        if not valid_entity_id(entity_id) or hass.states.get(entity_id) is not None:
            continue
        domain, object_id = split_entity_id(entity_id)
        others = {
            split_entity_id(other)[1]: other
            for other in hass.states.async_entity_ids(domain)
        }
        close = difflib.get_close_matches(object_id, others, SUGGESTIONS, 0.6)
        out.append({"id": entity_id, "suggestions": [others[o] for o in close]})
    return out


def template_status(
    hass: HomeAssistant,
    info: RenderInfo,
    source: str,
    status: dict[str, Any],
) -> dict[str, Any]:
    """A template slot's feedback: ``status`` (from the slot's rules) with
    the render's kind, what it updates on, where it fails and the ids it
    names that do not exist."""
    if info.exception is not None:
        out = error_details(info.exception, source)
    else:
        rendered = info.result()
        out = {**status, **value_kind(rendered), "listens": listens(info)}
        # The value in full, as it rendered, for "ok" and "empty" alike.
        out.setdefault("value", rendered)
    if unknown := unknown_entities(hass, info, source):
        out["unknown"] = unknown
    return out
