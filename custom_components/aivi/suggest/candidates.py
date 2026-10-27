"""The entities a field could take, ranked by how well they fit the ask."""

from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from ..blocks import slots_of
from ..const import DOMAIN
from ..metadata import describe_template
from ..sourcing import Bare
from ..templates import TemplateDef

# Bounded candidate lists keep the prompt short enough for small local models.
_MAX_CANDIDATES_FILTERED = 40
_MAX_CANDIDATES_OPEN = 60


# Words that say what to do, not what about: "populate ALL slots" must not
# rank "Siren with all features" first. English only; another language's
# asks go unfiltered.
_STOPWORDS = frozenset(
    {
        "a",
        "about",
        "add",
        "all",
        "also",
        "and",
        "another",
        "any",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "change",
        "could",
        "do",
        "each",
        "every",
        "everything",
        "few",
        "fill",
        "for",
        "from",
        "give",
        "has",
        "have",
        "here",
        "how",
        "i",
        "in",
        "instead",
        "into",
        "is",
        "it",
        "its",
        "just",
        "keep",
        "like",
        "make",
        "many",
        "me",
        "more",
        "my",
        "need",
        "new",
        "no",
        "not",
        "now",
        "of",
        "on",
        "one",
        "only",
        "or",
        "other",
        "our",
        "out",
        "please",
        "populate",
        "put",
        "remove",
        "replace",
        "rest",
        "row",
        "rows",
        "set",
        "show",
        "slot",
        "slots",
        "some",
        "still",
        "stuff",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "thing",
        "things",
        "this",
        "tile",
        "tiles",
        "to",
        "too",
        "try",
        "two",
        "up",
        "use",
        "want",
        "was",
        "we",
        "what",
        "when",
        "which",
        "widget",
        "will",
        "with",
        "would",
        "you",
        "your",
    }
)


def _words(text: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s]", " ", text.lower().replace("_", " "))
    return {w for w in cleaned.split() if len(w) > 2 and w not in _STOPWORDS}


def score(name: str, description: str, session: str = "", subject: str = "") -> int:
    """Cheap relevance: words an entity's name shares with the ask. The
    newest ask counts double; earlier asks and the widget's own name count
    once, so a correction like "no, the OTHER washer sensor" keeps the
    session's subject in the list, and "set it up for me" still ranks what
    the widget is named after."""
    newest = _words(description)
    earlier = (_words(session) | _words(subject)) - newest
    words = _words(name)
    return sum(2 for w in words if w in newest) + sum(1 for w in words if w in earlier)


def bound_entity_ids(hass: HomeAssistant, current: dict[str, Any]) -> frozenset[str]:
    """Every real entity id referenced anywhere in the present form state;
    candidate lists must keep them."""
    found: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, str):
            if hass.states.get(value) is not None:
                found.add(value)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    walk(current)
    return frozenset(found)


# Entities that are plumbing, not something a widget shows: left out of
# an open candidate list (a field with its own filter decides for itself).
_PLUMBING_DOMAINS = frozenset(
    {"ai_task", "conversation", "event", "persistent_notification", "stt", "tts"}
    | {"update", "zone"}
)


#: Attributes every entity carries, which say nothing a widget would show.
_PLAIN_ATTRIBUTES = frozenset(
    {
        "friendly_name",
        "icon",
        "entity_picture",
        "supported_features",
        "device_class",
        "state_class",
        "unit_of_measurement",
        "attribution",
        "restored",
        "editable",
    }
)


def candidates(
    hass: HomeAssistant,
    flt: dict[str, Any] | None,
    description: str,
    *,
    session: str = "",
    bound: frozenset[str] = frozenset(),
    subject: str = "",
) -> list[str]:
    """The entities a field could take, most relevant first, each with what
    the model needs to choose well: its name, state, kind, and the area and
    device it belongs to. Ties keep entities of one domain together, by
    name, rather than in the order Home Assistant happened to load them."""
    rows = _ranked(
        hass, flt, description, session=session, bound=bound, subject=subject
    )
    filtered = bool((flt or {}).get("domain") or (flt or {}).get("device_class"))
    cap = _MAX_CANDIDATES_FILTERED if filtered else _MAX_CANDIDATES_OPEN
    return [row[5] for row in rows[:cap]]


def _ranked(
    hass: HomeAssistant,
    flt: dict[str, Any] | None,
    description: str,
    *,
    session: str = "",
    bound: frozenset[str] = frozenset(),
    subject: str = "",
) -> list[tuple[int, int, str, str, str, str, str]]:
    """Every entity a field could take as (bound first, minus relevance,
    domain, lowercased name, name, prompt line, entity id), in ranked
    order."""
    flt = flt or {}
    domains = flt.get("domain")
    if domains is not None and not isinstance(domains, list):
        domains = [domains]
    device_class = flt.get("device_class")
    filtered = bool(domains or device_class)
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    areas = ar.async_get(hass)

    # Already-bound entities sort ahead of any word match: there are only a
    # handful, and letting them rotate out mid-session breaks refinement.
    rows: list[tuple[int, int, str, str, str, str, str]] = []
    for state in hass.states.async_all():
        entity_id = state.entity_id
        domain = entity_id.split(".")[0]
        if domains and domain not in domains:
            continue
        if device_class and state.attributes.get("device_class") != device_class:
            continue
        entry = entities.async_get(entity_id)
        is_bound = entity_id in bound
        if not is_bound and (
            (not filtered and domain in _PLUMBING_DOMAINS)
            or (
                entry is not None
                # The integration's own status sensors always; what Home
                # Assistant files as diagnostic or configuration only where
                # the field takes anything (a battery list needs exactly
                # those sensors).
                and (
                    entry.platform == DOMAIN
                    or (not filtered and entry.entity_category is not None)
                )
            )
        ):
            continue
        name = state.attributes.get("friendly_name") or entity_id
        unit = state.attributes.get("unit_of_measurement") or ""
        line = f"{entity_id} — {name} (now: {state.state}{unit})"
        if device := state.attributes.get("device_class"):
            line += f" [{device}]"
        device_entry = (
            devices.async_get(entry.device_id) if entry and entry.device_id else None
        )
        area_id = (entry.area_id if entry else None) or (
            device_entry.area_id if device_entry else None
        )
        area = areas.async_get_area(area_id) if area_id else None
        where = " ".join(
            part
            for part in (
                f"[area: {area.name}]" if area else "",
                f"[device: {device_entry.name_by_user or device_entry.name}]"
                if device_entry and (device_entry.name_by_user or device_entry.name)
                else "",
            )
            if part
        )
        if where:
            line += f" {where}"
        if extra := [a for a in state.attributes if a not in _PLAIN_ATTRIBUTES][:6]:
            line += f" [attributes: {', '.join(extra)}]"
        relevance = score(f"{name} {where}", description, session, subject)
        rows.append(
            (
                0 if is_bound else 1,
                -relevance,
                domain,
                str(name).lower(),
                str(name),
                line,
                entity_id,
            )
        )

    rows.sort(key=lambda r: r[:4])
    return rows


MAX_STARTERS = 2


def starters(hass: HomeAssistant, template: TemplateDef, name: str) -> list[str]:
    """What this home has that the widget's name points at: the names of
    the entities its main field could show, best match first, ranked the
    way the model's candidates are. A gauge named "Living room" in a home
    with a living room temperature and a living room humidity is offered
    both, one press each, before any model is asked. Nothing when the name
    matches nothing, or when the template's main field is a list (a name
    does not pick rows)."""
    fields = describe_template(template)["fields"]
    main = next(
        (
            field
            for field_def, field in zip(template.fields, fields, strict=True)
            if field["required"]
            and (slots := slots_of(field_def.block, field["key"]))
            and slots[0].bare is Bare.ENTITY
        ),
        None,
    )
    if main is None or not _words(name):
        return []
    found: list[str] = []
    for row in _ranked(hass, main.get("filter"), name):
        relevance, label, entity_id = row[1], row[4], row[6]
        # A name that only repeats the widget's own says nothing new, and
        # a field that draws a number is not offered a door.
        if (
            relevance < 0
            and label != name
            and label not in found
            and _fits(hass, main["kind"], entity_id)
        ):
            found.append(label)
    return found[:MAX_STARTERS]


def _fits(hass: HomeAssistant, kind: str, entity_id: str) -> bool:
    """Whether the entity's own state is the kind of value the field
    shows: a number for a dial, a moment for a countdown."""
    state = hass.states.get(entity_id)
    if state is None:
        return False
    if kind in ("number", "money"):
        try:
            float(state.state)
        except ValueError:
            return False
        return True
    if kind == "timestamp":
        return bool(state.attributes.get("device_class") == "timestamp")
    return True
