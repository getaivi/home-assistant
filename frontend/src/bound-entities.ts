// Which entities a form's bindings name, as pure functions of the
// bindings and Home Assistant's states. The editor passes the bindings as
// the active bar mode would push them: a dormant phase's source is not a
// bound entity.

import { asSegments, asStringArray, type Bindings } from "./types/bindings";
import type { HassLike } from "./types/hass";
import { isDerivedKey, markerOf, segmentWatched } from "./value-source";

type States = HassLike["states"];

/** Every entity id a preview of the bindings reads: any string in them
 * (at any depth) naming a known entity, the template watch lists
 * included, plus an activity's lifecycle entity. */
export function readEntityIds(bindings: Bindings, active: string | null, states: States): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (Object.hasOwn(states, value)) out.add(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  walk(bindings);
  if (active) out.add(active);
  return [...out];
}

/** Whether the bindings show nothing yet: no entity bound and no
 * template written anywhere (the integration reads "a first setup" the
 * same way). Defaults a new form carries (a chart's span) do not count. */
export function isBlank(bindings: Bindings, states: States): boolean {
  const bound = (value: unknown): boolean =>
    typeof value === "string"
      ? value in states
      : typeof value === "object" && value !== null && Object.values(value).some(bound);
  return !Object.entries(bindings).some(
    ([key, value]) => markerOf(key) === "template" || bound(value),
  );
}

/** The entities bound to fields other than `key`: a row list leaves
 * them out of its picker (the grid meter is not a generation source;
 * the Spent sensor is not a category). Only direct entity bindings
 * count, not the entities a template happens to read. */
export function boundElsewhere(
  bindings: Bindings,
  key: string,
  active: string | null,
  states: States,
): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(bindings)) {
    if (k === key || k.startsWith(`${key}__`) || isDerivedKey(k)) continue;
    if (typeof v === "string" && v.includes(".") && states[v]) out.add(v);
    else if (Array.isArray(v) && !k.endsWith("__options"))
      for (const id of asStringArray(v)) if (states[id]) out.add(id);
  }
  if (active) out.add(active);
  return out;
}

/** Every entity id the bindings reference, once each. */
export function boundEntityIds(
  bindings: Bindings,
  active: string | null,
  states: States,
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(bindings)) {
    if (isDerivedKey(k) && Array.isArray(v)) out.push(...asStringArray(v));
    else if (Array.isArray(v)) {
      out.push(...asStringArray(v).filter((x) => states[x]));
      // Segment lists: per-segment weight sources (entity + watched).
      for (const seg of asSegments(v)) {
        if (seg.source && states[seg.source]) out.push(seg.source);
        for (const id of segmentWatched(seg)) if (states[id]) out.push(id);
      }
    } else if (typeof v === "string" && v.includes(".") && states[v]) out.push(v);
  }
  if (active) out.push(active);
  return [...new Set(out)];
}
