"""The engine that drives every template from its data definition.

Pure functions, template-agnostic: work out which entities a stored
binding depends on, resolve a binding plus current state into the Aivi
content payload, and say why it does not resolve when it doesn't. Nothing
here depends on what ``status`` or ``battery`` mean.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from . import blocks
from .blocks import RootFragment, history_queries_of
from .sources import HistoryQuery, StateResolver
from .sourcing import SlotUse
from .templates import FieldDef, TemplateDef


def slot_uses(template: TemplateDef, bindings: dict[str, Any]) -> Iterator[SlotUse]:
    """Every slot the binding uses: top-level fields, selected rows and
    segments."""
    for field in template.fields:
        yield from blocks.slot_uses(field.block, field.key, bindings)


def dependencies(template: TemplateDef, bindings: dict[str, Any]) -> set[str]:
    """Every entity id the binding references, for the state subscription."""
    deps: set[str] = set()
    for field in template.fields:
        deps |= blocks.depends(field.block, field.key, bindings)
    return deps


def template_sources(template: TemplateDef, bindings: dict[str, Any]) -> set[str]:
    """Every Jinja source the binding uses, for template result tracking."""
    found: set[str] = set()
    for use in slot_uses(template, bindings):
        source = use.source()
        if source is not None and source.template is not None:
            found.add(source.template)
    return found


def resolve(
    template: TemplateDef, bindings: dict[str, Any], resolver: StateResolver
) -> dict[str, Any] | None:
    """The content payload for the current state, tagged with its
    template (Aivi's content is a union told apart by ``template``).

    An unresolved optional field is omitted. Returns ``None`` when a
    required field cannot resolve, since no valid payload exists without
    it; the runtime treats that as "skip this push", and ``blocker`` says
    which field it is."""
    content: dict[str, Any] = {
        "template": template.slug,
        **copy.deepcopy(template.constants),
    }
    for field in template.fields:
        fragment = field.block.resolve(field.key, bindings, resolver)
        if fragment is None:
            if field.required:
                return None
            continue
        parent = _parent(content, field.path)
        if isinstance(fragment, RootFragment):
            parent.update(fragment)
        else:
            parent[field.path[-1]] = fragment
    for key, member in template.requires.items():
        node = content.get(key)
        if isinstance(node, dict) and member not in node:
            del content[key]
    if template.requires_any and not any(
        content.get(key) for key in template.requires_any
    ):
        return None
    return content


@dataclass(frozen=True, slots=True)
class Blocker:
    """Why a binding's content does not resolve: the required field that
    has no value, and what its source reads."""

    #: The required field's key; ``None`` when none of ``fields`` has a
    #: value (``TemplateDef.requires_any``).
    field: str | None
    #: The fields in question: ``field`` alone, or the group of which one
    #: needs a value.
    fields: tuple[str, ...]
    #: The entity the field reads, when it reads one.
    entity_id: str | None = None
    #: What the source reads (``SourcedValue.reading``): the entity's raw
    #: state, ``"missing"`` or ``"empty"``; ``None`` for a field made of
    #: several values (rows, a series) or one with no source.
    reading: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "fields": list(self.fields),
            "entity_id": self.entity_id,
            "reading": self.reading,
        }


def blocker(
    template: TemplateDef, bindings: dict[str, Any], resolver: StateResolver
) -> Blocker | None:
    """Why ``resolve`` gives ``None`` for the current state, worked out
    once for the push log, the log line and the editor; ``None`` when the
    content resolves after all."""
    for field in template.fields:
        if (
            field.required
            and field.block.resolve(field.key, bindings, resolver) is None
        ):
            return _blocked_on(field, bindings, resolver)
    if not template.requires_any or resolve(template, bindings, resolver) is not None:
        return None
    return Blocker(
        field=None,
        fields=tuple(
            field.key
            for field in template.fields
            if field.path[0] in template.requires_any
        ),
    )


def _blocked_on(
    field: FieldDef, bindings: dict[str, Any], resolver: StateResolver
) -> Blocker:
    """A required field that does not resolve, with what its own value
    reads when it has a source of its own."""
    own = next(
        (slot for slot in blocks.slots_of(field.block, field.key) if not slot.suffix),
        None,
    )
    source = own.source(field.key, bindings) if own is not None else None
    if source is None:
        return Blocker(field=field.key, fields=(field.key,))
    return Blocker(
        field=field.key,
        fields=(field.key,),
        entity_id=source.entity_id,
        reading=source.reading(resolver),
    )


def history_queries(
    template: TemplateDef, bindings: dict[str, Any]
) -> set[HistoryQuery]:
    """The recorded history the binding reads, fetched before a resolve."""
    queries: set[HistoryQuery] = set()
    for field in template.fields:
        queries |= history_queries_of(field.block, field.key, bindings)
    return queries


def _parent(content: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    """The object that holds the last key of ``path``, created as needed."""
    node = content
    for part in path[:-1]:
        node = node.setdefault(part, {})
    return node
