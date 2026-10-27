// Reading and writing a value's source in the stored bindings, so the
// marker convention lives in one place and no component hand-assembles
// suffixed keys.
//
// Not to be confused with slots.ts (preview regions): a value slot is
// where a value comes from; a preview slot is where it is drawn. The
// backend keeps the same distinction (sourcing.py vs the region map).
//
// Storage is a flat marker convention:
//
//   <addr>              the literal value, or, for an
//                       entity-bare slot, the entity id
//   <addr>__entity      entity id
//   <addr>__attribute   attribute name
//   <addr>__template    Jinja source
//   <addr>__watched     entities the template touches
//   <addr>__bands       a color by value: {entity, limits, values}
//                       (bands.ts)
//
// The mode is derived from which marker key is present, even when its
// value is empty, so a just-switched mode sticks across re-renders while
// the user fills it in; `pruneSlots` drops the empties at save time.
// Every component that switches modes must go through here, and no other
// module spells a marker key out (tests/value-source.test.ts checks).
//
// A segment's weight is the same scheme at the address `source`, typed
// as `SegmentBinding`; the `segment*` functions below read and write it.

import { type BandsBinding, bandsTemplate, parseBands } from "./bands";
import { recall, remember } from "./session-memory";
import {
  asString,
  asStringArray,
  type Bindings,
  type ScopeMap,
  type SegmentBinding,
  STATE_TEXT_OPTION,
} from "./types/bindings";

export type SlotMode = "literal" | "entity" | "attribute" | "template" | "bands";

/** A marker key's suffix, without the `__` joining it to the address. */
export type Marker = "entity" | "attribute" | "template" | "watched" | "bands";

const MARKER_NAMES: readonly Marker[] = ["entity", "attribute", "template", "watched", "bands"];

/** The key `addr`'s `marker` is stored under. */
export function markerKey(addr: string, marker: Marker): string {
  return `${addr}__${marker}`;
}

/** Every marker key of `addr`. */
export function markerKeys(addr: string): string[] {
  return MARKER_NAMES.map((marker) => markerKey(addr, marker));
}

/** Which marker a stored key is, or null for a value or an option key. */
export function markerOf(key: string): Marker | null {
  return MARKER_NAMES.find((marker) => key.endsWith(`__${marker}`)) ?? null;
}

/** The address a marker key belongs to; any other key is returned as is. */
export function baseKey(key: string): string {
  const marker = markerOf(key);
  return marker ? key.slice(0, -(marker.length + 2)) : key;
}

/** Whether the integration derives this key from another (a template's
 * watch list), so it is no part of what the user set. */
export function isDerivedKey(key: string): boolean {
  return markerOf(key) === "watched";
}

/** The source the integration reads for a slot (`read_source` in
 * custom_components/aivi/sourcing.py, pinned by tests/fixtures.test.ts):
 * template > bands > attribute > entity, where an empty marker, or bands
 * the integration cannot use, count as absent.
 * Null when the slot has no source and its literal is the value. Unlike
 * `slotMode`, a just-switched, still empty mode is not a source here. */
export type ReadSource =
  | { kind: "template"; template: string; watched: string[] }
  | { kind: "bands"; bands: BandsBinding }
  | { kind: "attribute"; entity: string; attribute: string }
  | { kind: "entity"; entity: string };

export function readSource(
  scope: Bindings,
  addr: string,
  bare: SlotBare = "literal",
): ReadSource | null {
  const template = asString(scope[markerKey(addr, "template")]);
  if (template)
    return {
      kind: "template",
      template,
      watched: asStringArray(scope[markerKey(addr, "watched")]),
    };
  const bands = parseBands(scope[markerKey(addr, "bands")]);
  if (bands) return { kind: "bands", bands };
  let entity = asString(scope[markerKey(addr, "entity")]);
  if (!entity && bare === "entity") entity = asString(scope[addr]);
  if (!entity) return null;
  const attribute = asString(scope[markerKey(addr, "attribute")]);
  return attribute ? { kind: "attribute", entity, attribute } : { kind: "entity", entity };
}

/** Whether the slot holds a usable value as the editor sees it: a
 * template with text in template mode, an entity and an attribute in
 * attribute mode, else an entity or a literal. A mode switched to but
 * not filled in yet holds nothing, whatever the slot held before. */
export function hasValue(scope: Bindings, addr: string): boolean {
  const templateKey = markerKey(addr, "template");
  if (Object.hasOwn(scope, templateKey)) return !!scope[templateKey];
  const bandsKey = markerKey(addr, "bands");
  if (Object.hasOwn(scope, bandsKey)) return parseBands(scope[bandsKey]) !== null;
  const entity = scope[markerKey(addr, "entity")] ?? scope[addr];
  const attributeKey = markerKey(addr, "attribute");
  if (Object.hasOwn(scope, attributeKey)) return !!(entity && scope[attributeKey]);
  return !!entity;
}

/** What the un-suffixed key means for this slot. `entity` is the
 * reading of the four fields whose bare key holds an entity id and that
 * have no literal at all. */
export type SlotBare = "literal" | "entity";

/** One sourceable value, as the backend describes it in template
 * metadata. */
export interface SlotMeta {
  kind: string;
  bare: SlotBare;
  sources: string[];
  options?: string[];
}

/** The active mode: which marker is present wins, template first, and a
 * bare entity id counts as entity mode for an entity-bare slot. */
export function slotMode(scope: Bindings, addr: string, bare: SlotBare = "literal"): SlotMode {
  if (Object.hasOwn(scope, markerKey(addr, "template"))) return "template";
  if (Object.hasOwn(scope, markerKey(addr, "bands"))) return "bands";
  if (Object.hasOwn(scope, markerKey(addr, "attribute"))) return "attribute";
  if (Object.hasOwn(scope, markerKey(addr, "entity"))) return "entity";
  return bare === "entity" ? "entity" : "literal";
}

/**
 * Move the keys of a source out of the bindings and into the session
 * memory under `name`, and bring back what `next` held when it was last
 * left. Returns whether anything came back. Shared by every source menu
 * (a slot's, a trend's points).
 */
export function swapSource(
  scope: Bindings,
  addr: string,
  leaving: { name: string; keys: readonly string[] },
  next: string,
): boolean {
  const kept: Bindings = {};
  for (const key of leaving.keys) {
    if (Object.hasOwn(scope, key)) kept[key] = scope[key];
    delete scope[key];
  }
  remember(scope, `source:${addr}:${leaving.name}`, kept);
  const back = recall(scope, `source:${addr}:${next}`) as Bindings | undefined;
  if (!back) return false;
  Object.assign(scope, back);
  return Object.keys(back).length > 0;
}

/**
 * Switch a slot's mode. Nothing the user entered is lost by it:
 *
 * - The literal is never cleared: it is the fallback the runtime uses
 *   whenever the source can't resolve, so switching to a template must
 *   not throw away the swatch the user picked.
 * - The source being left is taken out of the bindings (it must not be
 *   stored or pushed) and remembered for the session; the source being
 *   entered comes back as it was left, or with its marker written empty
 *   so the switch sticks while the user fills it in. A template with
 *   nothing to come back starts from what the slot showed: its entity's
 *   state or attribute, or its fixed value.
 * - Entity and Attribute read the same entity, so the picked entity
 *   moves with the switch between them; a remembered attribute comes back
 *   only for the entity it was picked on.
 *
 * An entity-bare slot has no literal: its bare key holds the
 * entity id, so a template takes its place. Bands with nothing to come
 * back start from `seed`; a template from bands is the same bands as
 * Jinja.
 */
export function setSlotMode(
  scope: Bindings,
  addr: string,
  next: SlotMode,
  bare: SlotBare = "literal",
  seed?: () => BandsBinding,
): void {
  const current = slotMode(scope, addr, bare);
  if (current === next) return;
  const idKey = entityKey(addr, bare);
  const usesEntity = (mode: SlotMode): boolean => mode === "entity" || mode === "attribute";
  const entity = usesEntity(current) ? scope[idKey] : undefined;
  const start = templateSeed(scope, addr, current, asString(entity));
  swapSource(
    scope,
    addr,
    {
      name: current,
      keys: [...markerKeys(addr), ...(bare === "entity" ? [addr] : [])],
    },
    next,
  );
  if (usesEntity(next)) {
    // The entity in use a moment ago wins over the one this source
    // remembers; coming from a template, the other entity source's does.
    const remembered = scope[idKey];
    const other = recall(scope, `source:${addr}:${next === "entity" ? "attribute" : "entity"}`) as
      | Bindings
      | undefined;
    const id = entity || remembered || other?.[idKey];
    if (id) scope[idKey] = id;
    else if (bare !== "entity") scope[idKey] ??= "";
    if (next === "attribute") {
      const attributeKey = markerKey(addr, "attribute");
      const attribute = scope[attributeKey];
      scope[attributeKey] = id && id === remembered ? (attribute ?? "") : "";
    }
  } else if (next === "template") scope[markerKey(addr, "template")] ??= start;
  else if (next === "bands" && seed) scope[markerKey(addr, "bands")] ??= seed();
}

/** The template a slot starts from when it switches to one with none
 * remembered: what it showed until now, so the field stays filled. Its
 * bands, its entity's state or attribute, or its fixed value; empty when
 * nothing was set. */
function templateSeed(
  scope: Bindings,
  addr: string,
  current: SlotMode,
  entity: string | null,
): string {
  const bands = current === "bands" ? parseBands(scope[markerKey(addr, "bands")]) : null;
  if (bands) return bandsTemplate(bands);
  if (entity) {
    const attribute =
      current === "attribute" ? asString(scope[markerKey(addr, "attribute")]) : null;
    return attribute
      ? `{{ state_attr('${entity}', '${attribute}') }}`
      : `{{ states('${entity}') }}`;
  }
  if (current !== "literal") return "";
  const value = scope[addr];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Where a slot's entity id lives: the explicit marker, or the bare key
 * for an entity-bare slot. */
export function entityKey(addr: string, bare: SlotBare = "literal"): string {
  return bare === "entity" ? addr : markerKey(addr, "entity");
}

/** True when the slot currently takes its value from live state, so the
 * literal control should present itself as the fallback. */
export function isSourced(scope: Bindings, addr: string, bare: SlotBare = "literal"): boolean {
  return slotMode(scope, addr, bare) !== "literal";
}

/** Drop the empty markers a half-finished mode switch leaves behind. Runs
 * on the way out, not while typing, because mode stickiness needs the
 * empty marker present in the working copy. Recurses into nested scopes
 * (segment lists, per-row option maps). In a row's options a stored ""
 * state word is a value (the word hidden), so it survives. */
export function pruneSlots(scope: Bindings, rowOptions = false): Bindings {
  const out: Bindings = {};
  for (const [key, value] of Object.entries(scope)) {
    if (value == null) continue;
    if (markerOf(key) === "bands") {
      // Kept whole, and only when the integration can use them.
      const bands = parseBands(value);
      if (bands) out[key] = bands;
      continue;
    }
    if (value === "") {
      if (rowOptions && key.startsWith(STATE_TEXT_OPTION)) out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      // Length first: `every` is vacuously true for an empty array, so
      // checking the item shape first would keep `[]` as a "list of
      // scopes" instead of dropping it.
      if (!value.length) continue;
      if (isScopeList(value)) {
        out[key] = value.map((item) => pruneSlots(item));
        continue;
      }
      out[key] = value;
      continue;
    }
    if (typeof value === "object") {
      const nested: ScopeMap = {};
      for (const [id, raw] of Object.entries(value)) {
        if (typeof raw !== "object" || raw === null) continue;
        const cleaned = pruneSlots(raw, true);
        if (Object.keys(cleaned).length) nested[id] = cleaned;
      }
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function isScopeList(value: readonly unknown[]): value is Bindings[] {
  return value.every((item) => typeof item === "object" && item !== null);
}

/** A segment's weight mode: the scalar scheme at `source`, whose bare
 * key holds the entity id, except that a segment with none of the keys
 * takes its literal `value`. An empty marker keeps a just-switched mode,
 * as for a slot. */
export function segmentMode(s: SegmentBinding): SlotMode {
  if (s.source__template !== undefined) return "template";
  if (s.source__attribute !== undefined) return "attribute";
  if (s.source !== undefined) return "entity";
  return "literal";
}

export function segmentTemplate(s: SegmentBinding): string | undefined {
  return s.source__template;
}

export function segmentAttribute(s: SegmentBinding): string | undefined {
  return s.source__attribute;
}

export function segmentWatched(s: SegmentBinding): string[] {
  return s.source__watched ?? [];
}

/** Switch a segment's weight source. The literal `value` stays: it is
 * the fallback weight, required in every mode. `entity` is the entity
 * the entity and attribute modes start from. */
export function setSegmentMode(seg: SegmentBinding, next: string, entity: string): void {
  delete seg.source;
  delete seg.source__attribute;
  delete seg.source__template;
  delete seg.source__watched;
  if (next === "entity") seg.source = entity;
  else if (next === "attribute") {
    seg.source = entity;
    seg.source__attribute = "";
  } else if (next === "template") seg.source__template = "";
}

/** Keep the (possibly empty) attribute marker, so the switch stays on
 * Attribute while a new entity's attribute is picked. */
export function setSegmentAttribute(seg: SegmentBinding, attribute: string): void {
  seg.source__attribute = attribute;
}

export function setSegmentTemplate(seg: SegmentBinding, text: string, watched: string[]): void {
  seg.source__template = text;
  if (watched.length) seg.source__watched = watched;
  else delete seg.source__watched;
}
