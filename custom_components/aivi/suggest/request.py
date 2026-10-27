"""The request sent to the model, and the repair that follows a failed check."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant

from ..blocks import COLORS, FORMATTERS, EntityRows, slots_of
from ..const import SUBENTRY_ACTIVITY, SUBENTRY_WIDGET
from ..metadata import describe_template
from ..sourcing import Bare, ValueSlot
from ..templates import FieldDef, TemplateDef
from ..values import SlotKind
from .answer import ANSWER, UNCLEAR
from .candidates import bound_entity_ids, candidates
from .keys import answer_keys, row_option_keys, takes_entities
from .sanitize import Rejected
from .symbols import near_symbols, symbol_shortlist
from .tables import panel_words

if TYPE_CHECKING:
    # Home Assistant validates with probatio, installed as voluptuous.
    import probatio as vol
else:
    import voluptuous as vol

# An ask is a sentence or a few; the panel's composer holds the same cap.
MAX_ASK = 2000
# How much of a long conversation the model sees.
_MAX_TURNS = 8


def _field_words(slug: str, key: str) -> str:
    """A field the way the form presents it: its label, then its hint (a
    template's own hint for the key wins over the shared one)."""
    words = panel_words()
    label = words["field-label"].get(key)
    hint = words.get(f"field-hint-{slug}", {}).get(key) or words["field-hint"].get(key)
    if label and hint:
        return f'"{label}": {hint}. '
    return f'"{label}". ' if label else ""


# On a first setup the model designs the whole thing, not only what was asked.
_DESIGN_BRIEF = (
    "- This is the FIRST setup of an empty {kind}. First decide whether"
    " the candidates below include what the request is about. If none of"
    " them is about it (a dryer asked for and only a washer there), set"
    " NO fields: say so in `reply` and ask which entities to use. Never"
    " set up a different subject, and never invent an entity id.",
    "- Otherwise design all of it, the way a good product designer who"
    " knows this home would. Binding the required entity alone is a poor"
    " answer.",
    "- Bind every field that has a fitting candidate (the state, the"
    " reading, the finish time, the second line); leave a field out when"
    " no candidate fits. Prefer the entity that already reports a thing"
    " over computing it: write a template only to vary a colour or an"
    " icon with a state.",
    "- Always pick an icon that depicts the subject, and style it: set its"
    " colour, and for a symbol with layers use the hierarchical or"
    " palette rendering mode with a secondary colour.",
    "- Use colour with meaning and keep the palette coherent: orange and"
    " red for heat, power and alerts; blue, cyan and teal for water, cold"
    " and laundry; green and mint for good, eco and charge; yellow for"
    " light; purple and indigo for media and night. Where there is an"
    " accent, set it, in step with the icon.",
    "- Where a field takes several colours (a ring, a gradient), give it a"
    " gradient that follows the scale, e.g. blue, green, orange, red for"
    " a temperature.",
    "- In a list, give every row its own fitting icon and colour, and a"
    " short label when the entity's name is long or repeats the widget's.",
    "- Set a range (minimum, maximum) that suits the reading, a unit when"
    " the entity has none, and a formatter for timestamps.",
    "- Leave out only what needs a decision from the user: where a tap"
    " goes, phases of a progress bar, fixed texts they did not mention."
    " Do not ask about what you left out, and leave a key out rather than"
    " writing null into it.",
)

#: A request the model does not understand, in both prompts. The widget's
#: name is context: it must not stand in for a request.
_UNCLEAR = (
    "- The widget's name is context, not a request. When the user's words"
    " ask for nothing at all (random letters, a word that names nothing"
    " here, emoji or punctuation alone, or a question or remark that is not"
    " about this widget, like the weather somewhere or a joke), set subject"
    ' to exactly "unclear" and match to "none": change nothing, do not fill'
    " anything in from the name, say in `reply` that you did not understand"
    " and ask what they want, and put one or two requests that would work"
    " for this widget in `options`.",
    "- Anything that asks for a change, however short or vague, and in any"
    ' language, is a request: act on it ("red", "bigger", "more", "make it'
    ' better" restyles it, "use the washer").',
)

#: One earlier exchange: what the user asked, and what the model replied.
type Exchange = str | dict[str, Any]


def _ask_of(exchange: Exchange) -> str:
    return exchange if isinstance(exchange, str) else str(exchange.get("ask") or "")


def _reply_of(exchange: Exchange) -> str | None:
    if isinstance(exchange, str):
        return None
    reply = exchange.get("reply")
    return str(reply) if reply else None


def build_request(
    hass: HomeAssistant,
    template: TemplateDef,
    widget_name: str,
    description: str,
    *,
    current: dict[str, Any] | None = None,
    history: list[Exchange] | None = None,
    subentry: str = SUBENTRY_WIDGET,
) -> tuple[str, vol.Schema]:
    """The instructions and the answer structure for one suggestion.

    ``current`` and ``history`` turn a one-shot ask into a refinement: the
    model sees the present form state (which the user may have hand-edited
    since the last round) plus the earlier asks, and returns a complete
    revised configuration.
    """
    desc = describe_template(template)
    turns = history[-_MAX_TURNS:] if history else []
    session = " ".join(_ask_of(turn) for turn in turns)
    bound = bound_entity_ids(hass, current) if current else frozenset()
    words = panel_words()["template"].get(template.slug, {})
    what = "Live Activity" if subentry == SUBENTRY_ACTIVITY else "widget"
    lines = [
        f"You are setting up an iOS {what} that shows a Home Assistant home:"
        " which entities feed it, and how it looks (icons, colours,"
        f' gradients, labels). It is named "{widget_name}" and uses the'
        f' "{words.get("label", template.slug)}" template'
        f" ({words.get('hint', template.slug)}).",
    ]
    if current:
        # __watched is derived server-side; echoing it would only distract.
        shown = {k: v for k, v in current.items() if not k.endswith("__watched")}
        lines += [
            "The widget is currently configured as follows (the user may"
            " have hand-edited this since your last suggestion):",
            f"  {json.dumps(shown, sort_keys=True)}",
        ]
        if any(key.endswith("__bands") for key in shown):
            lines.append(
                "A <key>__bands entry is a colour by value the user set in the"
                " form: the colour follows an entity's reading. It stays as it"
                " is unless you set or clear <key>, which replaces it."
            )
    if turns:
        lines.append("The conversation so far, oldest first:")
        for turn in turns:
            lines.append(f'  User: "{_ask_of(turn)}"')
            if reply := _reply_of(turn):
                lines.append(f'  You: "{reply}"')
    lines.append(f'The user now says: "{description}"')
    # Nothing bound and nothing said yet: the model designs the whole
    # thing. After that it changes what it is asked to.
    if not turns and not bound:
        filling = [line.format(kind=what) for line in _DESIGN_BRIEF]
    else:
        filling = [
            "- Fill required fields; fill optional ones only when the user's"
            " request implies them. A request about looks (nicer, colourful,"
            ' styled, "make it pop") implies the styling fields: icons,'
            " colours, gradients, per-row options. Keep a currently-set"
            " field's value when unsure; omit a field only to clear it.",
        ]
    if turns or bound:
        lines += [
            "",
            "Decide first, before any field:",
            "- `subject`: in a few words, what the user wants changed.",
            "- `match`: whether it can be done with this template and the"
            " candidates below.",
            '  - "clear": it can, one obvious way. Do exactly that and nothing else.',
            '  - "guess": it can, but you had to choose between candidates that'
            " fit about equally. Do the most likely, say which in `reply`, and"
            " put the ones you passed over in `options`.",
            '  - "none": it cannot: what is asked for is not among the'
            " candidates of the field it belongs to, the template has no place"
            " for it, or the list is already full. Then change NOTHING, say why"
            " in one sentence, and offer what is possible in `options`. Never"
            " relabel another entity to stand in for one that is not there.",
            '  - "answer": the user asks about the form and wants nothing'
            ' changed ("how many tiles can I still add?"). Answer in `reply`'
            " from what is written here; change nothing.",
            *_UNCLEAR,
            "- `options`: up to four short things the user could say next, each"
            " a complete request in their own words. Leave it out when match is"
            " clear.",
            "",
            "Lists (tiles, rows, slots, entries all mean the items of a list field):",
            "- The line NOW under a list says how many items it has and how"
            " many are free. Use those numbers; do not count.",
            "- Add with `add` ops, one per item. Never `remove` an item unless"
            " the user asks to remove it.",
            "- Asked to fill the list or use all slots, add items until none"
            " are free, choosing what fits the widget's name and what is"
            " already there. Asked for more without a number, add one or two.",
            "- When more fit the request than there is room for, add what fits"
            " and say in `reply` what was left out.",
            "",
            "Examples of a good answer:",
            '- "fill the remaining slots", NOW: 3 of 8 used, 5 free -> five'
            " `add` ops; reply names the 5 added.",
            '- "add the vacuum", and no vacuum among that field\'s candidates ->'
            " match none, nothing changed; reply \"A vacuum can't be a tile"
            " here. Tiles can be lights, switches, covers, locks, scenes and"
            ' scripts."; options offer two that exist.',
            '- "use better icons" -> only `set` / `row` ops on icons, to names'
            " from the icon list; every entity stays.",
        ]
    else:
        lines += [
            "",
            "Decide first, before any field:",
            "- `subject`: in a few words, what the user wants this to show. When"
            ' they ask you to set it up without naming a subject ("set it up'
            ' for me", "fill it in"), the subject is the name above and'
            " nothing else.",
            "- `match`: how the candidates below meet that subject.",
            '  - "clear": exactly one candidate (or one obvious set) is about the'
            " subject. Do it.",
            '  - "guess": the subject is here, but you had to choose: two or'
            " more candidates could each be it (a door sensor and a door lock;"
            " the outside temperature and a thermostat), or more fit than the"
            " field holds. Do NOT ask. Do the most likely one, say in `reply`"
            " which you chose, and put the ones you passed over in `options`.",
            '  - "none": no candidate is about the subject. A pool asked for and'
            " no pool sensor. A car or charger named and neither among the"
            ' candidates. A name like "Widget 1" or a room alone, which does'
            " not say what to show. A forecast asked of a template that cannot"
            " show one. Then set NO fields at all; in `reply`, say in one"
            " sentence what is missing and ask one specific question; in"
            " `options`, offer the closest things this home does have. A"
            " different subject is never a substitute: the outside temperature"
            " is not the pool, sunrise is not garbage day, solar power is not"
            " the car, the washer is not the living room.",
            *_UNCLEAR,
            "- `options`: up to four short things the user could say next, each"
            ' a complete request in their own words ("Use the front door lock'
            ' instead", "The outside temperature"), naming only things that'
            " are in the candidates. Leave it out when match is clear.",
        ]
    lines += [
        "",
        "Rules:",
        "- Also set `reply`: one or two plain sentences to the user: what you"
        " set or changed, or a question back when the request is unclear or"
        " can't be met with the candidates (then leave the fields as they"
        ' are). Name entities the way the user would ("the washer"), never'
        " by entity id or field key. Never say you set an entity, attribute"
        " or colour that is not in the lists below.",
        f"- Write `reply` in the language of the user's latest message"
        f" (their Home Assistant language is {hass.config.language}).",
        "- Only use entity ids from the candidate lists below, verbatim.",
        f"- Colours must be one of: {', '.join(COLORS)}.",
        f"- Formatters must be one of: {', '.join(FORMATTERS)}.",
        *(
            [
                "- A tile gets a fitting built-in icon for its kind of entity"
                " when you leave its icon out. Set a tile's icon only when the"
                " user asks for one or the built-in would be wrong."
            ]
            if any(f["key"] == "actions" for f in desc["fields"])
            else []
        ),
        "- Icons are Apple SF Symbol names. Only use a name you are certain"
        " exists; most of these also come as <name>.fill:"
        f" {symbol_shortlist()}.",
        *filling,
        "- When the user asks for a conditional, combined, or otherwise"
        " derived value, set <field>__template (instead of <field>) to a"
        " Home Assistant Jinja template, e.g. {% if"
        " states('sensor.washer_progress') | float(0) >= 90 %}Drying"
        "{% else %}Washing{% endif %}. Reference only candidate entity ids."
        " Otherwise always prefer a plain entity id in <field>.",
        "- A colour, icon, unit or text read from an entity (<key>__entity)"
        " takes that entity's state as is: use it only when the state itself"
        " is such a value. To vary a colour or an icon with a state, give"
        " <key>__template a template that prints a colour or symbol name."
        " Never write a template for text an entity already reports.",
        "- To show an attribute of an entity instead of its state, set"
        " <field> to the entity id and <field>__attribute to one of the"
        " attributes listed with that candidate.",
        "",
        "How to answer: `ops` is the list of changes to make, in order."
        " Whatever no op touches stays exactly as it is, and an empty `ops`"
        " changes nothing. Every op carries all five keys; leave the ones it"
        ' does not use as "".',
        "- set: `key`, `value`. Give one of the keys named under Fields a"
        " value: an entity id, text as it is, a number in digits, true or"
        " false, several colours separated by commas. To feed a field from"
        ' an entity: {"op": "set", "key": "<field>", "value": "<entity id>"}.',
        "- clear: `key`. Remove that key's value.",
        "- add: `key` (a list field), `entity`. Add one entity to the end of"
        " the list; `value` may hold the position to put it at (1 is first).",
        "- remove: `key` (a list field), `entity`.",
        "- move: `key` (a list field), `entity`, `value` = its new position.",
        "- row: `key` (a list field), `entity`, `option`, `value`. Set one"
        ' option of one row; a `value` of "" removes it.',
        "",
        "Fields:",
    ]
    for field_def, field in zip(template.fields, desc["fields"], strict=True):
        key = field["key"]
        keys = answer_keys(field_def, field)
        if not keys:
            continue
        required = "required" if field["required"] else "optional"
        lines.append(
            f"- {key}: {_field_words(template.slug, key)}"
            f"({required}; {_describe_answer(field_def, field)})"
        )
        if takes_entities(field_def, field):
            lines.extend(
                f"    {c}"
                for c in candidates(
                    hass,
                    field.get("filter"),
                    description,
                    session=session,
                    bound=bound,
                    subject=widget_name,
                )
            )
        if field["kind"] == "rows" and (cap := field.get("max")):
            # The counts are computed here, so the model does not have to count.
            used = len(current.get(key) or []) if current else 0
            lines.append(
                f"    NOW: {used} of {cap} used, {cap - used} free."
                + (" The list is full." if used >= cap else "")
            )
    return "\n".join(lines), ANSWER


def _describe_answer(field_def: FieldDef, field: dict[str, Any]) -> str:
    """What the field's keys mean, for the prompt."""
    key, kind, block = field["key"], field["kind"], field_def.block
    if kind == "rows":
        cap = field.get("max")
        text = (
            f"a list of at most {cap} entities, in row order, changed with"
            " the add, remove and move ops"
            if cap
            else "a list of entities, in row order, changed with the add,"
            " remove and move ops"
        )
        if isinstance(block, EntityRows) and block.row_options:
            options = ", ".join(
                f"{name} ({note})" if (note := block.OPTION_NOTES.get(name)) else name
                for name in row_option_keys(block)
            )
            text += f"; each row takes these options, set with the row op: {options}"
        return text
    if kind == "segments":
        cap = field.get("max") or 4
        return (
            "ONLY when the user describes phases: set to JSON text, a list of"
            f" 1-{cap} objects"
            " {value, fill_color, label, track_color, track_fill, source}"
            " whose fractional values roughly sum to 1; track_fill is one of"
            f" {', '.join(field.get('track_fills') or [])}; source is an"
            f" entity whose number sizes the phase live. {key}__display is"
            f" one of {', '.join(field.get('displays') or [])}"
        )
    if kind == "points":
        hours = ", ".join(str(h) for h in field.get("hours") or [])
        return (
            f"the chart's history: {key}__hours is the time span (one of"
            f" {hours}), {key}__entity charts another entity than"
            f" {field.get('follows')}"
        )
    if kind == "enum":
        return f"one of {', '.join(field.get('options') or [])}"
    if kind == "number_literal" and not slots_of(block, key):
        return "a plain number"
    if kind == "colors":
        cap = field.get("max") or 4
        return (
            f"1-{cap} colours separated by commas; one means solid, several"
            " make a gradient"
        )
    slots = slots_of(block, key)
    main = slots[0] if slots else None
    if main is not None and main.bare is Bare.ENTITY:
        text = f"ONE entity id, or {key}__template"
        if "attribute" in main.sources:
            text += f", optionally with {key}__attribute"
    elif kind == "icon":
        text = "an SF Symbol name"
    elif kind == "color":
        text = "a colour"
    else:
        text = _slot_words(main) if main is not None else "short text"
        if main is not None and "entity" in main.sources:
            text += f", or live from an entity in {key}__entity"
        if main is not None and "template" in main.sources:
            text += f", or {key}__template"
    extras = [f"{slot.address(key)} ({_slot_words(slot)})" for slot in slots[1:]]
    if field.get("formatter"):
        extras.append(f"{key}__formatter (how the value is shown)")
    if field.get("invert"):
        extras.append(f"{key}__invert (true to reverse the sign)")
    if kind == "icon":
        modes = ", ".join(field.get("rendering_modes") or [])
        renderings = ", ".join(field.get("color_renderings") or [])
        extras.append(
            f"{key}__rendering_mode (one of {modes}; hierarchical and palette"
            " use the colours as layers, multicolor the symbol's own colours)"
        )
        extras.append(f"{key}__color_rendering (one of {renderings})")
    return f"{text}. Also: {', '.join(extras)}" if extras else text


def _slot_words(slot: ValueSlot) -> str:
    return {
        SlotKind.COLOR: "a colour",
        SlotKind.ACTION_COLOR: "a colour or #RRGGBB",
        SlotKind.ICON: "an SF Symbol name",
        SlotKind.NUMBER: "a number",
        SlotKind.MONEY: "an amount",
        SlotKind.BOOL: "true or false",
    }.get(slot.kind, "short text")


_REASONS = {
    "no_entity": "is not an entity id in that field's candidate list",
    "no_attribute": "is not an attribute of that entity",
    "not_a_color": "is not one of the colours",
    "not_a_symbol": "is not an SF Symbol that exists",
    "not_an_option": "is not one of the options",
    "bad_template": "is a template that does not render, or reads an"
    " entity that does not exist",
    "bad_value": "cannot be used there",
    "already_there": "is already in that list, so adding it changed nothing",
    "list_full": "did not fit: the list was already full",
    "no_value": "styles a field that has nothing to show",
}


def repair_request(
    instructions: str,
    raw: Any,
    rejected: list[Rejected],
    *,
    changed: bool,
    empty: bool = False,
) -> str:
    """The same request again, with the result of checking the first
    answer: the model wrote its reply before anything was checked, so it
    is given the check's findings and asked once to answer again.
    ``empty`` says the ask held no words, so no answer may change the
    form."""
    problems: list[str] = []
    if empty:
        problems.append(
            "- The user's message holds no words, only emoji or punctuation,"
            f' so it asks for nothing: set subject to "{UNCLEAR}" and match'
            ' to "none", change nothing, and ask what they want.'
        )
    for item in rejected:
        line = (
            f'- {item["key"]}: "{item["value"]}"'
            f" {_REASONS.get(item['reason'], 'was refused')}."
        )
        if item["reason"] == "not_a_symbol":
            options = {
                symbol
                for name in item["value"].split(",")
                for symbol in near_symbols(name)
            }
            if options:
                line += f" Symbols that do exist: {', '.join(sorted(options))}."
            else:
                line += " Leave that icon out."
        problems.append(line)
    if not changed and not empty:
        problems.append(
            "- Applied, your answer changed NOTHING in the form, while your"
            " reply says otherwise."
        )
    answer = {
        key: value
        for key, value in (raw.items() if isinstance(raw, dict) else ())
        if value not in (None, "", [])
    }
    return "\n".join(
        [
            instructions,
            "",
            "You already answered this once. Your answer was:",
            f"  {json.dumps(answer, sort_keys=True)}",
            "It was checked against the home and the form:",
            *problems,
            "Answer again, complete, with those fixed. Use only entity ids"
            " and symbols written above. If what the user asks for cannot be"
            " done with them, or is not a request you understand, set match"
            ' to "none", change nothing, and say so in `reply`: never claim'
            " what the check refused.",
        ]
    )
