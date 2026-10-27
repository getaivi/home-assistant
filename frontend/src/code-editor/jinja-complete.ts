// What the template editor offers at the caret, as pure functions over
// the text and Home Assistant's states, so the tests drive it without an
// editor. The chunk (editor.ts) turns the answer into CodeMirror
// completions; nothing here knows CodeMirror or the panel's catalog (the
// hints come in through `CompletionEnv`).
//
// Where the caret is decides what is offered:
// - inside the first quotes of states('…'), is_state('…', …) and the
//   other functions that take an entity: entity ids, by id or name;
// - inside the second quotes of state_attr('x', '…') and
//   is_state_attr('x', '…', …): the attributes entity x has now;
// - after states. / states.<domain>. / states.<id>. /
//   states.<id>.attributes.: domains, entities, state properties and
//   attributes;
// - after a |: filters, those that fit what is piped in first (after
//   states('…'): float, int; after a number: round; after a list:
//   selectattr, map, count); after `is`: tests;
// - after loop. inside a {% for %}: the loop's properties;
// - elsewhere inside {{ }} or {% %}: the names {% set %} and {% for %}
//   gave, then functions, the most used first;
// - first in a {% %}: the statements, the end of the innermost open
//   block first.
// Outside {{ }} and {% %} nothing is offered.

export interface EntityLike {
  state: string;
  attributes: Readonly<Record<string, unknown>>;
}

export type StatesLike = Readonly<Record<string, EntityLike>>;

export interface CompletionEnv {
  /** Home Assistant's states, read when the list opens. */
  states(): StatesLike;
  /** The functions and filters there are (jinja-catalog.ts). */
  functions: readonly JinjaFunction[];
  /** The tests there are, after `is`. */
  tests: readonly string[];
  /** The one-line hint for a function or filter, or for a test as
   * "is <name>". */
  hint(name: string): string;
}

/** What an option is; it picks the option's icon. */
export type OptionKind =
  | "entity"
  | "attribute"
  | "property"
  | "domain"
  | "function"
  | "filter"
  | "test"
  | "variable"
  | "statement";

/** One entry of a list. */
export interface JinjaOption {
  label: string;
  type: OptionKind;
  detail?: string;
  info?: string;
  /** The text put in, when it is not the label. */
  apply?: string;
  /** Where the caret lands inside `apply` (its end when absent). */
  caret?: number;
  /** Open the list again after inserting (the caret lands inside an
   * entity's quotes). */
  reopen?: boolean;
  /** Ranks it among options that match the typed text equally well. */
  boost?: number;
}

export interface JinjaCompletions {
  /** Where the replaced text starts. */
  from: number;
  options: JinjaOption[];
  /** Whether the editor narrows the list as the user types (false: the
   * list is already narrowed, and asked for again on every key). */
  filter: boolean;
}

/** A function or filter the list offers, with what it puts in: `|`
 * marks where the caret lands. `fn` is its form as a function, `filter`
 * after a |; either is absent when it is not used that way. */
export interface JinjaFunction {
  name: string;
  args: string;
  fn?: string;
  filter?: string;
  /** What it works on, which ranks it after a |. */
  group: FunctionGroup;
}

export type FunctionGroup = "entity" | "time" | "convert" | "number" | "text" | "list" | "any";

/** Functions whose first argument is an entity id (`states[` is the
 * states['sensor.x'] lookup). expand takes one in every argument. */
const ENTITY_FIRST = new Set([
  "states",
  "states[",
  "is_state",
  "state_attr",
  "is_state_attr",
  "has_value",
  "state_translated",
  "expand",
  "area_name",
  "area_id",
  "device_id",
  "device_attr",
]);

/** Functions whose second argument is an attribute of the first. */
const ATTRIBUTE_SECOND = new Set(["state_attr", "is_state_attr"]);

/** What a state object has, after states.<entity_id>. */
const STATE_PROPERTIES = [
  "state",
  "attributes",
  "name",
  "entity_id",
  "domain",
  "object_id",
  "last_changed",
  "last_updated",
];

const STATEMENTS = [
  "if",
  "elif",
  "else",
  "endif",
  "for",
  "endfor",
  "set",
  "break",
  "continue",
  "macro",
  "endmacro",
];

/** What `loop` has inside a {% for %}. */
const LOOP_PROPERTIES = [
  "index",
  "index0",
  "first",
  "last",
  "length",
  "revindex",
  "revindex0",
  "previtem",
  "nextitem",
];

/** The functions offered first where any function goes, the most used
 * first. */
const COMMON = ["states", "state_attr", "is_state", "has_value", "now", "iif", "float", "int"];

/** The filters offered first after a |, by what is piped in (pipeKind):
 * the most likely first. */
const PIPED_FIRST: Readonly<Record<PipeKind, readonly string[]>> = {
  state: ["float", "int", "is_number", "default", "lower", "title", "replace"],
  number: ["round", "int", "float", "abs", "string", "default"],
  list: ["selectattr", "map", "list", "count", "join", "first", "sort", "sum"],
  timestamp: ["timestamp_custom", "timestamp_local", "int", "round"],
  datetime: ["as_timestamp", "relative_time", "time_since", "as_local"],
  other: ["default", "string", "float", "int", "round"],
};

type PipeKind = "state" | "number" | "list" | "timestamp" | "datetime" | "other";

/** Functions that give a list, a number, a timestamp or a moment. */
const GIVES: Readonly<Record<string, PipeKind>> = {
  states: "state",
  state_attr: "state",
  expand: "list",
  area_entities: "list",
  area_devices: "list",
  label_entities: "list",
  device_entities: "list",
  integration_entities: "list",
  selectattr: "list",
  rejectattr: "list",
  select: "list",
  reject: "list",
  map: "list",
  sort: "list",
  unique: "list",
  reverse: "list",
  list: "list",
  range: "list",
  float: "number",
  int: "number",
  round: "number",
  abs: "number",
  sum: "number",
  count: "number",
  length: "number",
  min: "number",
  max: "number",
  average: "number",
  median: "number",
  as_timestamp: "timestamp",
  now: "datetime",
  utcnow: "datetime",
  today_at: "datetime",
  as_datetime: "datetime",
  as_local: "datetime",
  strptime: "datetime",
};

/** What the expression before a | gives, as far as the text shows: the
 * last call's result, a quoted string, a number, a list, or a state's
 * moment (last_changed). */
export function pipeKind(before: string): PipeKind {
  const text = before.replace(/\|\s*$/, "").trimEnd();
  if (/\.(?:last_changed|last_updated|last_reported)$/.test(text)) return "datetime";
  if (/(?:^|[^\w.])states\.\w+$/.test(text) || text.endsWith("]")) return "list";
  if (/\d$/.test(text) && /(?:^|[^\w.])-?\d+(?:\.\d+)?$/.test(text)) return "number";
  if (/['"]$/.test(text)) return "state";
  let name: string | undefined;
  if (text.endsWith(")")) {
    // The call the closing bracket ends: its name before the matching (.
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === ")") depth++;
      else if (ch === "(" && --depth === 0) {
        name = /(\w+)\s*$/.exec(text.slice(0, i))?.[1];
        break;
      }
    }
  } else name = /(\w+)$/.exec(text)?.[1];
  return (name && GIVES[name]) || "other";
}

/** The names {% set %} and {% for %} gave before `pos`, and whether
 * `pos` is inside a {% for %} (where `loop` is). */
export function namesBefore(text: string, pos: number): { names: string[]; inLoop: boolean } {
  const before = text.slice(0, pos);
  const names = new Set<string>();
  for (const m of before.matchAll(/\{%-?\s*set\s+(\w+)(?:\s*,\s*(\w+))?\s*=/g)) {
    if (m[1]) names.add(m[1]);
    if (m[2]) names.add(m[2]);
  }
  let loops = 0;
  for (const m of before.matchAll(/\{%-?\s*(for|endfor)\b(?:\s+(\w+)(?:\s*,\s*(\w+))?\s+in\b)?/g)) {
    if (m[1] === "endfor") {
      loops = Math.max(0, loops - 1);
      continue;
    }
    loops++;
    if (m[2]) names.add(m[2]);
    if (m[3]) names.add(m[3]);
  }
  if (loops > 0) names.add("loop");
  return { names: [...names], inLoop: loops > 0 };
}

/** The blocks open at `pos`, innermost last: "if", "for" or "macro". */
function openBlocks(text: string, pos: number): string[] {
  const stack: string[] = [];
  for (const m of text.slice(0, pos).matchAll(/\{%-?\s*(\w+)/g)) {
    const tag = m[1] ?? "";
    if (tag === "if" || tag === "for" || tag === "macro") stack.push(tag);
    else if (tag.startsWith("end") && stack[stack.length - 1] === tag.slice(3)) stack.pop();
  }
  return stack;
}

/** Entities shown at most: past this the user narrows by typing. */
const MAX_ENTITIES = 100;

/** Where the caret is: in which Jinja tag (if any), and in which quotes. */
interface Place {
  /** The open tag, or null outside any (in text or a comment). */
  tag: "{{" | "{%" | null;
  /** Where the tag's content starts. */
  start: number;
  /** The open quote around the caret, and where it is. */
  quote: string | null;
  quoteAt: number;
}

/** Reads `text` up to `pos`: the tag and the string the caret is in. */
export function placeAt(text: string, pos: number): Place {
  let tag: Place["tag"] = null;
  let start = 0;
  let quote: string | null = null;
  let quoteAt = -1;
  let i = 0;
  while (i < pos) {
    if (tag === null) {
      if (text.startsWith("{#", i)) {
        const end = text.indexOf("#}", i + 2);
        if (end < 0 || end + 2 > pos) return { tag: null, start: 0, quote: null, quoteAt: -1 };
        i = end + 2;
      } else if (text.startsWith("{{", i) || text.startsWith("{%", i)) {
        tag = text.startsWith("{{", i) ? "{{" : "{%";
        i += 2;
        if (text[i] === "-" && i < pos) i++;
        start = i;
      } else i++;
      continue;
    }
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoteAt = i;
    } else if (text.startsWith(tag === "{{" ? "}}" : "%}", i) && i + 2 <= pos) {
      tag = null;
      i += 2;
      continue;
    }
    i++;
  }
  return quote ? { tag, start, quote, quoteAt } : { tag, start, quote: null, quoteAt: -1 };
}

interface Token {
  kind: "name" | "string" | "number" | "punct";
  text: string;
}

const TOKEN = /\s+|([A-Za-z_]\w*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\d+(?:\.\d+)?)|([^\s])/gy;

function tokens(source: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(source); m?.[0]; m = TOKEN.exec(source)) {
    if (m[1]) out.push({ kind: "name", text: m[1] });
    else if (m[2]) out.push({ kind: "string", text: m[2].slice(1, -1) });
    else if (m[3]) out.push({ kind: "number", text: m[3] });
    else if (m[4]) out.push({ kind: "punct", text: m[4] });
  }
  return out;
}

/** The call a string starting at the end of `source` is an argument of:
 * the function's name (null for plain brackets), which argument, and
 * the first argument when it is a string. `whole` is false when the
 * string is not the argument itself but part of a longer expression. */
export function callAt(source: string): {
  fn: string | null;
  arg: number;
  firstArg: string | null;
  whole: boolean;
} {
  interface Frame {
    fn: string | null;
    arg: number;
    firstArg: string | null;
    /** Tokens seen in the current argument. */
    seen: number;
  }
  const stack: Frame[] = [{ fn: null, arg: 0, firstArg: null, seen: 0 }];
  let prev: Token | undefined;
  for (const tok of tokens(source)) {
    const top = stack[stack.length - 1] as Frame;
    if (tok.kind === "punct" && (tok.text === "(" || tok.text === "[")) {
      const name = prev?.kind === "name" ? prev.text + (tok.text === "[" ? "[" : "") : null;
      stack.push({ fn: name, arg: 0, firstArg: null, seen: 0 });
    } else if (tok.kind === "punct" && (tok.text === ")" || tok.text === "]")) {
      if (stack.length > 1) stack.pop();
      (stack[stack.length - 1] as Frame).seen++;
    } else if (tok.kind === "punct" && tok.text === ",") {
      top.arg++;
      top.seen = 0;
    } else {
      if (tok.kind === "string" && top.arg === 0 && top.seen === 0) top.firstArg = tok.text;
      top.seen++;
    }
    prev = tok;
  }
  const top = stack[stack.length - 1] as Frame;
  return { fn: top.fn, arg: top.arg, firstArg: top.firstArg, whole: top.seen === 0 };
}

function friendlyName(entity: EntityLike | undefined): string | undefined {
  const name = entity?.attributes["friendly_name"];
  return typeof name === "string" && name ? name : undefined;
}

/** Entities whose id or name holds `query`, ids starting with it first. */
export function entityOptions(states: StatesLike, query: string): JinjaOption[] {
  const q = query.toLowerCase();
  const ranked: [number, string, JinjaOption][] = [];
  for (const [id, entity] of Object.entries(states)) {
    const name = friendlyName(entity);
    const rank = id.startsWith(q)
      ? 0
      : id.includes(q)
        ? 1
        : name?.toLowerCase().includes(q)
          ? 2
          : -1;
    if (rank < 0) continue;
    const option: JinjaOption = { label: id, type: "entity" };
    if (name) option.detail = name;
    ranked.push([rank, id, option]);
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return ranked.slice(0, MAX_ENTITIES).map(([, , option]) => option);
}

/** A value as the attribute list shows it: short JSON. */
function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "" : text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export function attributeOptions(states: StatesLike, entityId: string): JinjaOption[] {
  const attrs = states[entityId]?.attributes ?? {};
  return Object.keys(attrs)
    .sort()
    .map((name) => ({ label: name, type: "attribute", detail: preview(attrs[name]) }));
}

/** Boosts: names the context puts first (the first highest), above the
 * rest. */
function ranked(first: readonly string[]): (name: string) => number {
  return (name) => {
    const at = first.indexOf(name);
    return at < 0 ? 0 : 50 - at;
  };
}

function functionOption(
  f: JinjaFunction,
  template: string,
  env: CompletionEnv,
  boost: number,
): JinjaOption {
  const caret = template.indexOf("|");
  const apply = template.replace("|", "");
  const option: JinjaOption = { label: f.name, type: "function", info: env.hint(f.name) };
  if (f.args) option.detail = f.args;
  if (apply !== f.name) option.apply = apply;
  if (caret >= 0 && caret < apply.length) option.caret = caret;
  if (ENTITY_FIRST.has(f.name) && template.includes("('|'")) option.reopen = true;
  if (boost) option.boost = boost;
  return option;
}

/** Every function, the most used first. */
export function functionOptions(env: CompletionEnv): JinjaOption[] {
  const boost = ranked(COMMON);
  return env.functions.flatMap((f) => (f.fn ? [functionOption(f, f.fn, env, boost(f.name))] : []));
}

/** Every filter, those that fit what `before` (the text up to the |)
 * pipes in first. */
export function filterOptions(env: CompletionEnv, before = ""): JinjaOption[] {
  const boost = ranked(PIPED_FIRST[pipeKind(before)]);
  return env.functions.flatMap((f) =>
    f.filter
      ? [{ ...functionOption(f, f.filter, env, boost(f.name)), type: "filter" as const }]
      : [],
  );
}

/** The tests, after `is`. */
export function testOptions(env: CompletionEnv): JinjaOption[] {
  return env.tests.map((name) => ({ label: name, type: "test", info: env.hint(`is ${name}`) }));
}

/** The names {% set %} and {% for %} gave, above the functions. */
function nameOptions(names: readonly string[]): JinjaOption[] {
  return names.map((label) => ({ label, type: "variable", boost: 60 }));
}

/** The statements, the end of the innermost open block (and, in an if,
 * else and elif) first; break and continue only in a loop. */
function statementOptions(text: string, pos: number): JinjaOption[] {
  const open = openBlocks(text, pos).at(-1);
  const first =
    open === "if"
      ? ["endif", "else", "elif"]
      : open === "for"
        ? ["endfor", "break", "continue"]
        : open === "macro"
          ? ["endmacro"]
          : ["if", "set", "for"];
  const boost = ranked(first);
  return STATEMENTS.filter((s) => open === "for" || (s !== "break" && s !== "continue")).map(
    (label) => {
      const option: JinjaOption = { label, type: "statement" };
      const b = boost(label);
      if (b) option.boost = b;
      return option;
    },
  );
}

/** The list after a dotted path from `states`, or null for other paths. */
function dottedOptions(path: string[], states: StatesLike): JinjaOption[] | null {
  if (path[0] !== "states") return null;
  const [, domain, object, attributes] = path;
  if (path.length === 1) {
    const domains = new Set(Object.keys(states).map((id) => id.split(".")[0] ?? ""));
    return [...domains].sort().map((d) => ({ label: d, type: "domain" }));
  }
  if (path.length === 2) {
    const prefix = `${domain}.`;
    return Object.keys(states)
      .filter((id) => id.startsWith(prefix))
      .sort()
      .map((id) => {
        const option: JinjaOption = { label: id.slice(prefix.length), type: "entity" };
        const name = friendlyName(states[id]);
        if (name) option.detail = name;
        return option;
      });
  }
  const id = `${domain}.${object}`;
  if (path.length === 3 && states[id]) {
    return STATE_PROPERTIES.map((p) => ({ label: p, type: "property" }));
  }
  if (path.length === 4 && attributes === "attributes") return attributeOptions(states, id);
  return null;
}

/** What to offer at `pos` in `text`, or null for nothing. `explicit` is
 * a request (Ctrl+Space) rather than typing: without one, the list only
 * opens on a typed word, a | or a ., or in an entity's quotes, never on
 * a bare {{ or {%. */
export function complete(
  text: string,
  pos: number,
  explicit: boolean,
  env: CompletionEnv,
): JinjaCompletions | null {
  const place = placeAt(text, pos);
  if (!place.tag) return null;

  if (place.quote) {
    const from = place.quoteAt + 1;
    const prefix = text.slice(from, pos);
    const call = callAt(text.slice(place.start, place.quoteAt));
    if (call.whole && call.fn && ATTRIBUTE_SECOND.has(call.fn) && call.arg === 1) {
      if (!call.firstArg) return null;
      return { from, options: attributeOptions(env.states(), call.firstArg), filter: true };
    }
    const entityArg =
      call.whole &&
      call.fn !== null &&
      ENTITY_FIRST.has(call.fn) &&
      (call.arg === 0 || call.fn === "expand");
    // Any other string offers entities once it looks like an id.
    if (entityArg || explicit || /^[a-z_]+\.\w*$/.test(prefix)) {
      const options = entityOptions(env.states(), prefix);
      return options.length ? { from, options, filter: false } : null;
    }
    return null;
  }

  const inner = text.slice(place.start, pos);
  const word = /[A-Za-z_]\w*$/.exec(inner)?.[0] ?? "";
  const from = pos - word.length;
  const before = inner.slice(0, inner.length - word.length);

  if (before.endsWith(".")) {
    const path = /(?:^|[^\w.])([A-Za-z_]\w*(?:\.\w+)*)\.$/.exec(before)?.[1];
    if (path === "loop") {
      if (!namesBefore(text, pos).inLoop) return null;
      const options = LOOP_PROPERTIES.map((p): JinjaOption => ({ label: p, type: "property" }));
      return { from, options, filter: true };
    }
    const options = path ? dottedOptions(path.split("."), env.states()) : null;
    return options?.length ? { from, options, filter: true } : null;
  }
  if (/\|\s*$/.test(before)) return { from, options: filterOptions(env, before), filter: true };
  if (/(?:^|\s)is\s+(?:not\s+)?$/.test(before))
    return { from, options: testOptions(env), filter: true };

  if (!word && !explicit) return null;
  if (place.tag === "{%" && before.trim() === "")
    return { from, options: statementOptions(text, pos), filter: true };
  const names = nameOptions(namesBefore(text, pos).names);
  return { from, options: [...names, ...functionOptions(env)], filter: true };
}
