"""The live preview, with feedback for every value the binding sources."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, override

from homeassistant.core import HomeAssistant

from .. import engine
from ..companions import with_companions
from ..history import HistoryCache
from ..sources import DegradingResolver
from ..sourcing import SlotUse
from ..switchboard import MAX_CONTENT_BYTES
from ..templates import TemplateDef
from .template_info import template_status

if TYPE_CHECKING:
    from homeassistant.helpers.template import RenderInfo


class _PreviewResolver(DegradingResolver):
    """Renders each template once per preview, with render info, so the
    feedback (the value, what it updates on, the error) describes the
    render the content was built from. ``renders`` maps each template to
    that render.

    ``states`` stands in for the states of a few entities: the panel's
    "Preview as" shows the widget as it would look at another reading.
    Entity sources and bands read the stand-in; templates read Home
    Assistant as it is."""

    def __init__(
        self,
        hass: HomeAssistant,
        history: HistoryCache,
        states: dict[str, str] | None = None,
    ) -> None:
        super().__init__(hass, history)
        self.hass = hass
        self.renders: dict[str, RenderInfo] = {}
        self._states = states or {}

    @override
    def state(self, entity_id: str) -> str | None:
        if entity_id in self._states:
            return self._states[entity_id]
        return super().state(entity_id)

    @override
    def display_state(self, entity_id: str) -> str | None:
        if entity_id not in self._states:
            return super().display_state(entity_id)
        state = self.hass.states.get(entity_id)
        if state is None:
            return self._states[entity_id]
        return self._translate(state, self._states[entity_id])

    @override
    def render(self, template: str) -> Any:
        info = self.renders.get(template)
        if info is None:
            info = self._template(template).async_render_to_info(parse_result=False)
            self.renders[template] = info
        return None if info.exception is not None else info.result()


def _slot_status(resolver: _PreviewResolver, use: SlotUse) -> dict[str, Any] | None:
    """One sourced slot's feedback, or ``None`` when it has no source.

    Statuses mirror what the runtime will do: ``error`` (Jinja raised; the
    message only, no state echoed back), ``empty`` (renders to nothing, which
    the runtime treats as unresolved), ``fallback`` (unresolved, or resolved
    to something this slot cannot put on the wire, e.g. a color outside the
    closed palette, so the stored literal is in effect; never blocks a save),
    and ``ok`` with the resolved value. A value longer than the slot's
    ``max_length`` adds ``limit``, the length the wire cuts it to. An
    entity, attribute or bands source that does not resolve adds
    ``reading``, what it reads (``SourcedValue.reading``: the raw state,
    ``missing`` or ``empty``). A template's feedback adds what
    ``template_info.template_status`` reads from its render.
    """
    source = use.source()
    if source is None:
        return None
    value = source.resolve(resolver)
    status: dict[str, Any]
    if value is None:
        if source.template is not None:
            status = {"status": "empty"}
        else:
            status = {"status": "fallback"}
            if (reading := source.reading(resolver)) is not None:
                status["reading"] = reading
    elif use.slot.coerce(value) is None:
        # Echo the value so the panel can say why it is falling back.
        status = {"status": "fallback", "value": str(value)}
    else:
        status = {"status": "ok", "value": str(value)}
    # Text the wire takes only so much of is cut there: say where.
    limit = use.slot.max_length
    if limit is not None and value is not None and len(str(value).strip()) > limit:
        status["limit"] = limit
    if source.template is None:
        return status
    info = resolver.renders[source.template]
    return template_status(resolver.hass, info, source.template, status)


def _template_feedback(
    resolver: _PreviewResolver, template: TemplateDef, bindings: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Per-value feedback for every slot the binding uses, keyed by its
    address: ``accent``, ``state__color``, ``<key>.<entity id>.<option>``
    for a selected row, ``<key>.<index>.<slot>`` for a segment (its weight
    is ``source``)."""
    return {
        use.address: status
        for use in engine.slot_uses(template, bindings)
        if (status := _slot_status(resolver, use)) is not None
    }


async def async_preview(
    hass: HomeAssistant,
    template: TemplateDef,
    bindings: dict[str, Any],
    states: dict[str, str] | None = None,
) -> dict[str, Any]:
    """The content the bindings would push, for a live preview. ``content``
    is null when a required field can't resolve, and ``waiting`` then says
    which (``engine.blocker``); ``fields`` is
    ``_template_feedback`` for inline errors and fallbacks. A template
    that measures its content (a switchboard) also gets ``size``: the
    bytes Aivi measures against its cap. Battery rows get their charging
    sensor as a save would fill it in. ``states`` previews the widget as
    if those entities read so (``_PreviewResolver``)."""
    bindings = with_companions(hass, template, bindings)
    history = HistoryCache()
    await history.async_refresh(hass, engine.history_queries(template, bindings))
    resolver = _PreviewResolver(hass, history, states)
    content = engine.resolve(template, bindings, resolver)
    fields = _template_feedback(resolver, template, bindings)
    result: dict[str, Any] = {"content": content, "fields": fields}
    blocker = engine.blocker(template, bindings, resolver) if content is None else None
    if blocker is not None:
        result["waiting"] = blocker.as_dict()
    if content is not None and template.measure is not None:
        result["size"] = {
            "bytes": template.measure(content),
            "limit": MAX_CONTENT_BYTES,
        }
    return result
