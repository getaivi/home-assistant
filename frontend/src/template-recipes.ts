// The recipes the template workspace's Insert list offers: templates named
// by what they do ("Words for on and off", "Time since it changed"), each
// written out whole for the entity it is chosen for. Which recipes a field
// gets depends on its kind (a number field gets rounding, a trend's points
// a list), and which entities a recipe fits on their domain, device class
// and state (words for on and off fit a door, not a temperature). Pure
// functions over the text and Home Assistant's states, so the tests drive
// them without an editor.

import { type TranslationKey, t } from "./i18n";
import { fitInsert, inTag } from "./template-inserts";
import type { HassEntity } from "./types/hass";

/** The kinds of field a template can be written for, as far as the
 * recipes go. */
export type RecipeKind =
  | "text"
  | "number"
  | "time"
  | "points"
  | "segment"
  | "color"
  | "bool"
  | "icon";

/** An entity as a recipe reads it. */
export type RecipeEntity = Pick<HassEntity, "state" | "attributes">;

/** What a recipe writes: the text, and what is selected in it after it
 * goes in (`from` = `to`: just the caret). */
export interface Written {
  text: string;
  from: number;
  to: number;
}

export interface Recipe {
  /** Its title in the catalog is `sheet.recipe-<id>`. */
  id: string;
  /** Whether it reads an entity (else it is written as it is). */
  entity: boolean;
  /** Whether it fits entity `id` (recipes that read one). */
  fits(id: string, e: RecipeEntity): boolean;
  /** The template for entity `id`, or, with `id` null, with the entity
   * left out: the caret then lands in the quotes it goes in. */
  write(id: string | null, e: RecipeEntity | undefined): Written;
}

/** The parts of a template written with marks: `‹` and `›` around what
 * ends up selected, `$` where the caret lands. The entity's quotes are
 * where the caret lands when there is no entity. */
function marked(source: string): Written {
  const open = source.indexOf("‹");
  if (open >= 0) {
    const text = source.replace("‹", "").replace("›", "");
    const close = source.indexOf("›") - 1;
    return { text, from: open, to: close };
  }
  const at = source.indexOf("$");
  if (at >= 0) return { text: source.replace("$", ""), from: at, to: at };
  return { text: source, from: source.length, to: source.length };
}

/** `make` with the entity id put in, or, without one, empty quotes with
 * the caret in the first of them. */
function withEntity(id: string | null, make: (id: string) => string): Written {
  if (id !== null) {
    const text = make(id);
    return { text, from: text.length, to: text.length };
  }
  const blank = make("\u0000");
  const at = blank.indexOf("\u0000");
  return { text: blank.replaceAll("\u0000", ""), from: at, to: at };
}

/** A recipe's literal words, quoted for Jinja. */
function quoted(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const domainOf = (id: string): string => id.slice(0, id.indexOf("."));

/** Whether a state reads as a number. */
export function isNumeric(state: string): boolean {
  return state.trim() !== "" && Number.isFinite(Number(state));
}

/** Whether an entity holds a moment: a timestamp sensor, a date and time
 * helper, or a state that reads as one. */
function holdsTime(id: string, e: RecipeEntity): boolean {
  if (e.attributes["device_class"] === "timestamp") return true;
  if (domainOf(id) === "input_datetime") return e.attributes["has_time"] !== false;
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(e.state);
}

/** The state an entity counts as on in, and the words for it and for the
 * rest: catalog keys (`sheet.word-<key>`). */
interface TwoStates {
  on: string;
  yes: string;
  no: string;
}

/** Binary sensors' words, by device class. */
const BINARY_WORDS: Readonly<Record<string, [string, string]>> = {
  door: ["open", "closed"],
  garage_door: ["open", "closed"],
  window: ["open", "closed"],
  opening: ["open", "closed"],
  motion: ["detected", "clear"],
  occupancy: ["detected", "clear"],
  presence: ["home", "away"],
  moisture: ["wet", "dry"],
  smoke: ["detected", "clear"],
  gas: ["detected", "clear"],
  carbon_monoxide: ["detected", "clear"],
  sound: ["detected", "clear"],
  vibration: ["detected", "clear"],
  tamper: ["detected", "clear"],
  problem: ["problem", "ok"],
  safety: ["unsafe", "safe"],
  connectivity: ["connected", "disconnected"],
  lock: ["unlocked", "locked"],
  battery: ["low", "normal"],
  battery_charging: ["charging", "not-charging"],
};

/** Domains that are on or off. */
const ON_OFF = new Set([
  "switch",
  "light",
  "input_boolean",
  "fan",
  "automation",
  "siren",
  "remote",
  "humidifier",
  "script",
]);

/** How entity `id` reads as two states, or null when it has more. */
export function twoStates(id: string, e: RecipeEntity): TwoStates | null {
  const domain = domainOf(id);
  if (domain === "binary_sensor") {
    const [yes, no] = BINARY_WORDS[String(e.attributes["device_class"] ?? "")] ?? ["on", "off"];
    return { on: "on", yes, no };
  }
  if (ON_OFF.has(domain)) return { on: "on", yes: "on", no: "off" };
  if (domain === "lock") return { on: "locked", yes: "locked", no: "unlocked" };
  if (domain === "cover" || domain === "valve") return { on: "open", yes: "open", no: "closed" };
  if (domain === "person" || domain === "device_tracker")
    return { on: "home", yes: "home", no: "away" };
  return null;
}

/** A word of a recipe, in the panel's language. */
function word(key: string): string {
  return t(`sheet.word-${key}` as TranslationKey);
}

const every = (): boolean => true;
const numeric = (_id: string, e: RecipeEntity): boolean => isNumeric(e.state);
const twoState = (id: string, e: RecipeEntity): boolean => twoStates(id, e) !== null;

/** Words for on and off: the entity's own pair (Open and Closed for a
 * door), or On and Off without one. */
function wordsFor(id: string | null, e: RecipeEntity | undefined): TwoStates {
  return (id && e ? twoStates(id, e) : null) ?? { on: "on", yes: "on", no: "off" };
}

/** The SF Symbols for on and off of a binary sensor, by device class. */
const BINARY_SYMBOLS: Readonly<Record<string, [string, string]>> = {
  door: ["door.left.hand.open", "door.left.hand.closed"],
  opening: ["door.left.hand.open", "door.left.hand.closed"],
  garage_door: ["door.garage.open", "door.garage.closed"],
  window: ["window.vertical.open", "window.vertical.closed"],
  motion: ["figure.walk.motion", "figure.stand"],
  occupancy: ["figure.walk.motion", "figure.stand"],
  presence: ["house.fill", "figure.walk.departure"],
  moisture: ["drop.fill", "drop"],
  smoke: ["exclamationmark.triangle.fill", "checkmark.shield.fill"],
  gas: ["exclamationmark.triangle.fill", "checkmark.shield.fill"],
  carbon_monoxide: ["exclamationmark.triangle.fill", "checkmark.shield.fill"],
  problem: ["exclamationmark.triangle.fill", "checkmark.circle.fill"],
  safety: ["exclamationmark.triangle.fill", "checkmark.circle.fill"],
  tamper: ["exclamationmark.triangle.fill", "checkmark.circle.fill"],
  sound: ["bell.fill", "bell.slash"],
  vibration: ["bell.fill", "bell.slash"],
  connectivity: ["wifi", "wifi.slash"],
  lock: ["lock.open.fill", "lock.fill"],
  battery: ["battery.0percent", "battery.100percent"],
  battery_charging: ["battery.100percent.bolt", "battery.100percent"],
};

/** The SF Symbols for on and off of the other two-state domains. */
const DOMAIN_SYMBOLS: Readonly<Record<string, [string, string]>> = {
  light: ["lightbulb.fill", "lightbulb"],
  fan: ["fan.fill", "fan"],
  humidifier: ["humidifier.fill", "humidifier"],
  lock: ["lock.fill", "lock.open.fill"],
  cover: ["blinds.vertical.open", "blinds.vertical.closed"],
  valve: ["spigot.fill", "spigot"],
  person: ["house.fill", "figure.walk.departure"],
  device_tracker: ["house.fill", "figure.walk.departure"],
};

/** The symbols entity `id` shows on and off: its device class's or its
 * domain's, else a power symbol filled or not. */
function symbolsFor(id: string | null, e: RecipeEntity | undefined): [string, string] {
  const fallback: [string, string] = ["power.circle.fill", "power.circle"];
  if (!id || !e) return fallback;
  const domain = domainOf(id);
  const dc = String(e.attributes["device_class"] ?? "");
  if (domain === "binary_sensor") return BINARY_SYMBOLS[dc] ?? fallback;
  if (domain === "cover" && (dc === "garage" || dc === "door"))
    return dc === "garage"
      ? (BINARY_SYMBOLS["garage_door"] ?? fallback)
      : (BINARY_SYMBOLS["door"] ?? fallback);
  return DOMAIN_SYMBOLS[domain] ?? fallback;
}

/** The symbols a level steps through, lowest first, and the limits
 * between them: a battery's own, else a gauge's needle. */
function levelSymbols(e: RecipeEntity | undefined): { names: string[]; limits: number[] } {
  if (e?.attributes["device_class"] === "battery")
    return {
      names: [
        "battery.0percent",
        "battery.25percent",
        "battery.50percent",
        "battery.75percent",
        "battery.100percent",
      ],
      limits: [10, 35, 60, 85],
    };
  return {
    names: [
      "gauge.with.dots.needle.0percent",
      "gauge.with.dots.needle.33percent",
      "gauge.with.dots.needle.50percent",
      "gauge.with.dots.needle.67percent",
      "gauge.with.dots.needle.100percent",
    ],
    limits: [20, 40, 60, 80],
  };
}

/** Whether a reading is a level from 0 to 100: a battery, or a percentage. */
function isLevel(_id: string, e: RecipeEntity): boolean {
  return (
    isNumeric(e.state) &&
    (e.attributes["device_class"] === "battery" || e.attributes["unit_of_measurement"] === "%")
  );
}

/** The first attribute of `e` holding a list of numbers. */
function listAttribute(e: RecipeEntity): string | null {
  for (const [name, value] of Object.entries(e.attributes)) {
    if (Array.isArray(value) && value.length > 1 && value.every((v) => isNumeric(String(v))))
      return name;
  }
  return null;
}

/** A limit for a number: 20 for a battery (low below it), else the
 * reading rounded, to be typed over. */
function limitFor(e: RecipeEntity | undefined): string {
  if (!e || !isNumeric(e.state)) return "20";
  return String(Math.round(Number(e.state)));
}

const R = {
  words: {
    id: "words",
    entity: true,
    fits: twoState,
    write: (id, e) => {
      const w = wordsFor(id, e);
      return withEntity(
        id,
        (x) =>
          `{{ ${quoted(word(w.yes))} if is_state('${x}', '${w.on}') else ${quoted(word(w.no))} }}`,
      );
    },
  },
  roundedUnit: {
    id: "rounded-unit",
    entity: true,
    fits: (_id, e) => isNumeric(e.state) && typeof e.attributes["unit_of_measurement"] === "string",
    write: (id) => withEntity(id, (x) => `{{ states('${x}', rounded=True, with_unit=True) }}`),
  },
  translated: {
    id: "translated",
    entity: true,
    fits: (_id, e) => !isNumeric(e.state),
    write: (id) => withEntity(id, (x) => `{{ state_translated('${x}') }}`),
  },
  fallback: {
    id: "fallback",
    entity: true,
    fits: every,
    write: (id) =>
      withEntity(
        id,
        (x) => `{{ states('${x}') if has_value('${x}') else ${quoted(word("no-data"))} }}`,
      ),
  },
  timeSince: {
    id: "time-since",
    entity: true,
    fits: every,
    write: (id) => withEntity(id, (x) => `{{ relative_time(states['${x}'].last_changed) }}`),
  },
  timeOfDay: {
    id: "time-of-day",
    entity: true,
    fits: holdsTime,
    write: (id) =>
      withEntity(id, (x) => `{{ as_timestamp(states('${x}')) | timestamp_custom('%H:%M') }}`),
  },
  rounded: {
    id: "rounded",
    entity: true,
    fits: numeric,
    write: (id) => withEntity(id, (x) => `{{ states('${x}') | float(0) | round(1) }}`),
  },
  number: {
    id: "number",
    entity: true,
    fits: numeric,
    write: (id) => withEntity(id, (x) => `{{ states('${x}') | float(0) }}`),
  },
  share: {
    id: "share",
    entity: true,
    // A percentage: a reading in %.
    fits: (_id, e) => isNumeric(e.state) && e.attributes["unit_of_measurement"] === "%",
    write: (id) => withEntity(id, (x) => `{{ states('${x}') | float(0) / 100 }}`),
  },
  entityTime: {
    id: "entity-time",
    entity: true,
    fits: holdsTime,
    write: (id) => withEntity(id, (x) => `{{ states('${x}') }}`),
  },
  lastChanged: {
    id: "last-changed",
    entity: true,
    fits: every,
    write: (id) => withEntity(id, (x) => `{{ states['${x}'].last_changed }}`),
  },
  inMinutes: {
    id: "in-minutes",
    entity: false,
    fits: every,
    write: () => marked("{{ now() + timedelta(minutes=‹5›) }}"),
  },
  attributeList: {
    id: "attribute-list",
    entity: true,
    fits: (_id, e) => listAttribute(e) !== null,
    write: (id, e) => {
      const name = (e && listAttribute(e)) ?? "";
      if (id === null) return marked("{{ state_attr('$', '') | map('float', 0) | list }}");
      return marked(`{{ state_attr('${id}', '${name}') | map('float', 0) | list }}`);
    },
  },
  colorByState: {
    id: "color-by-state",
    entity: true,
    fits: twoState,
    write: (id, e) => {
      const w = wordsFor(id, e);
      return withEntity(id, (x) => `{{ 'green' if is_state('${x}', '${w.on}') else 'red' }}`);
    },
  },
  colorByNumber: {
    id: "color-by-number",
    entity: true,
    fits: numeric,
    write: (id, e) => {
      const limit = limitFor(e);
      if (id === null)
        return marked(`{{ 'red' if states('$') | float(0) > ${limit} else 'blue' }}`);
      return marked(`{{ 'red' if states('${id}') | float(0) > ‹${limit}› else 'blue' }}`);
    },
  },
  iconOnOff: {
    id: "icon-on-off",
    entity: true,
    fits: twoState,
    write: (id, e) => {
      const w = wordsFor(id, e);
      const [on, off] = symbolsFor(id, e);
      return withEntity(id, (x) => `{{ '${on}' if is_state('${x}', '${w.on}') else '${off}' }}`);
    },
  },
  iconByLevel: {
    id: "icon-by-level",
    entity: true,
    fits: isLevel,
    write: (id, e) => {
      const { names, limits } = levelSymbols(e);
      const steps = limits.map((limit, i) => `'${names[i]}' if v < ${limit} else `).join("");
      const last = names[names.length - 1];
      return withEntity(
        id,
        (x) => `{% set v = states('${x}') | float(0) %}{{ ${steps}'${last}' }}`,
      );
    },
  },
  isOn: {
    id: "is-on",
    entity: true,
    fits: twoState,
    write: (id, e) => {
      const w = wordsFor(id, e);
      return withEntity(id, (x) => `{{ is_state('${x}', '${w.on}') }}`);
    },
  },
  above: {
    id: "above",
    entity: true,
    fits: numeric,
    write: (id, e) => {
      const limit = limitFor(e);
      if (id === null) return marked(`{{ states('$') | float(0) > ${limit} }}`);
      return marked(`{{ states('${id}') | float(0) > ‹${limit}› }}`);
    },
  },
} satisfies Record<string, Recipe>;

/** The recipes each kind of field offers, the most common first. */
export const RECIPES: Readonly<Record<RecipeKind, readonly Recipe[]>> = {
  text: [R.words, R.roundedUnit, R.fallback, R.timeSince, R.translated, R.timeOfDay],
  number: [R.rounded, R.number],
  time: [R.entityTime, R.lastChanged, R.inMinutes],
  points: [R.attributeList],
  segment: [R.number, R.share, R.rounded],
  color: [R.colorByState, R.colorByNumber],
  bool: [R.isOn, R.above],
  icon: [R.iconOnOff, R.iconByLevel],
};

/** The recipe kind of a slot kind (values.py's SlotKind), or of the
 * places that are not slots: a trend's points ("points") and a phase's
 * size ("segment"). Anything else reads as text. */
export function recipeKind(slotKind: string): RecipeKind {
  switch (slotKind) {
    case "number":
    case "money":
      return "number";
    case "timestamp":
      return "time";
    case "points":
    case "series":
      return "points";
    case "segment":
      return "segment";
    case "color":
    case "action_color":
      return "color";
    case "bool":
      return "bool";
    case "icon":
      return "icon";
    default:
      return "text";
  }
}

export function recipesFor(slotKind: string): readonly Recipe[] {
  return RECIPES[recipeKind(slotKind)];
}

/** The recipes of a field's kind that fit entity `id`. */
export function recipesForEntity(slotKind: string, id: string, e: RecipeEntity): Recipe[] {
  return recipesFor(slotKind).filter((r) => r.entity && r.fits(id, e));
}

export function recipeTitle(recipe: Recipe): TranslationKey {
  return `sheet.recipe-${recipe.id}` as TranslationKey;
}

/** A recipe's code as the list shows it: the entity, which the row is
 * for or has yet to be picked, as an ellipsis. */
export function recipeCode(recipe: Recipe, id: string | null, e?: RecipeEntity): string {
  const text = recipe.write(id, e).text;
  return id === null ? text.replaceAll("''", "'…'") : text.replaceAll(`'${id}'`, "…");
}

/** An output tag, `{{ … }}`: where it starts and ends, and the
 * expression in it. */
interface Output {
  start: number;
  end: number;
  inner: string;
}

/** The `{{ … }}` holding offsets `from`..`to` of `doc`, if one does. */
function outputAround(doc: string, from: number, to: number): Output | null {
  const start = doc.lastIndexOf("{{", from);
  if (start < 0 || !inTag(doc, Math.max(from, start + 2))) return null;
  const close = doc.indexOf("}}", start + 2);
  if (close < 0 || close + 2 < to) return null;
  return { start, end: close + 2, inner: doc.slice(start + 2, close).trim() };
}

/** The `{{ … }}` that is the whole of `doc`, if one is. */
function outputWhole(doc: string): Output | null {
  const m = /^(\s*)\{\{([\s\S]*?)\}\}\s*$/.exec(doc);
  const inner = m?.[2];
  if (inner === undefined || /\{\{|\}\}|\{%/.test(inner)) return null;
  return { start: (m?.[1] ?? "").length, end: doc.trimEnd().length, inner: inner.trim() };
}

/** Whether `expr` only reads entity `id`'s state or one of its
 * attributes: what a recipe for that entity is written to replace. */
function readsOnly(expr: string, id: string): boolean {
  const q = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^(?:states\\(['"]${q}['"]\\)|state_attr\\(['"]${q}['"], *['"][^'"]*['"]\\))$`,
  ).test(expr);
}

/** What picking a recipe does to `doc` with `from`..`to` selected: the
 * stretch it replaces, the text it puts there, and what is selected
 * after (from the start of that text).
 *  - It takes the place of the {{ states('<id>') }} the caret is in, or
 *    that is the whole template, when it is for that entity: it reads
 *    the same entity better.
 *  - Else it goes in at the caret, over the selection: whole, or, inside
 *    a tag already, the expression of a one-expression recipe ({{ x }}
 *    becomes x), apart from the text around it. */
export function recipeInsert(
  recipe: Recipe,
  id: string | null,
  e: RecipeEntity | undefined,
  doc: string,
  from: number,
  to: number = from,
): { from: number; to: number; text: string; select: [number, number] } {
  const written = recipe.write(id, e);
  if (id !== null) {
    const around = outputAround(doc, from, to) ?? outputWhole(doc);
    if (around && readsOnly(around.inner, id))
      return {
        from: around.start,
        to: around.end,
        text: written.text,
        select: [written.from, written.to],
      };
  }
  const bare = /^\{\{ (.*) \}\}$/.exec(written.text)?.[1];
  const inside = bare !== undefined && !bare.includes("}}") && inTag(doc, from);
  const body = inside ? bare : written.text;
  const place = (at: number): number => (inside ? Math.min(Math.max(at - 3, 0), body.length) : at);
  const fitted = fitInsert(doc, from, to, { text: body, caret: place(written.from) });
  const lead = fitted.caret - place(written.from);
  return {
    from,
    to,
    text: fitted.text,
    select: [place(written.from) + lead, place(written.to) + lead],
  };
}
