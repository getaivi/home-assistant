"""What a template is: its fields over the reusable blocks, what the
engine needs to know beyond them, and the rules of its own the rest of the
integration applies where a template sets them."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol

from ..blocks import Block
from ..inputs import InputEvent

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant


class Measure(Protocol):
    def __call__(self, content: dict[str, Any], *, state_text: bool = True) -> int:
        """The bytes Aivi measures ``content`` at; ``state_text=False``
        as stored without state words."""
        ...


@dataclass(frozen=True, slots=True)
class FieldDef:
    key: str
    block: Block
    # Where the resolved fragment goes in the content payload.
    path: tuple[str, ...] = ()
    required: bool = False
    advanced: bool = False

    def __post_init__(self) -> None:
        if not self.path:
            object.__setattr__(self, "path", (self.key,))


@dataclass(frozen=True, slots=True)
class TemplateDef:
    slug: str
    fields: tuple[FieldDef, ...]
    # Literal content merged into every payload (e.g. progress style).
    constants: dict[str, Any] = field(default_factory=dict)
    # Nested objects that exist only with a member: an object resolved
    # without it is left out (a monitor column needs its value).
    requires: dict[str, str] = field(default_factory=dict)
    # The input event types a binding of this template accepts from the
    # phone; empty for display-only templates.
    inputs: tuple[InputEvent, ...] = ()
    # At least one of these payload keys must be present, or nothing is
    # pushed (an energy widget needs one node).
    requires_any: tuple[str, ...] = ()
    # The form state a new binding starts from, read from Home Assistant.
    defaults: Callable[[HomeAssistant], Awaitable[dict[str, Any]]] | None = None
    # Why a save of these bindings is refused, beyond what every template
    # checks; None when it may go ahead.
    save_problem: Callable[[dict[str, Any]], str | None] | None = None
    # The size Aivi checks the content against its cap at: the editor
    # shows it, and content over the cap is not sent.
    measure: Measure | None = None
    # Action id -> entity id: where a press on the content is played.
    routes: Callable[[dict[str, Any]], dict[str, str]] | None = None

    def input_event(self, event_type: str) -> InputEvent | None:
        return next((e for e in self.inputs if e.type == event_type), None)


def field_def(
    key: str,
    block: Block,
    *,
    path: tuple[str, ...] = (),
    required: bool = False,
    advanced: bool = False,
) -> FieldDef:
    return FieldDef(
        key=key, block=block, path=path, required=required, advanced=advanced
    )
