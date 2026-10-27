// The editor's form state as the aivi/save payload stores it: field key
// to value, plus `key__suffix` markers, with nested scopes for segments
// and per-row options. Values are heterogeneous; the `as*` helpers narrow
// them at the point of use.

import type { BandsBinding } from "../bands";

/** The row options a tile's state words are stored under. `""` is a
 * value there (the word hidden), not an unset option. */
export const STATE_TEXT_OPTION = "state_text_";

export type SegmentBinding = {
  /** The stored literal weight. For a sourced segment this is the
   * fallback weight, used whenever the source can't resolve to a finite
   * positive number: the segment degrades, it is never dropped. */
  value: number;
  fill_color?: string;
  label?: string;
  track_color?: string;
  track_fill?: string;
  /** Sourced weight: the scalar entity / `__attribute` / `__template`
   * (+ `__watched`) marker scheme, scoped under the `source` key. Markers
   * may be empty strings mid-edit; empties are pruned at save time. */
  source?: string;
  source__attribute?: string;
  source__template?: string;
  source__watched?: string[];
};

/** Per-row options for one entity of a rows field (label/icon/color…). */
export type RowOptions = Record<string, string>;

/** entity_id -> its per-row options (`<rows-key>__options` bindings). */
export type RowOptionsMap = Record<string, RowOptions>;

/** A stored binding value. Nested scopes use the same marker scheme as
 * the top level: a list of them (segments) or a map of them by entity id
 * (per-row options). */
type BindingValue = string | number | boolean | string[] | Bindings[] | ScopeMap | BandsBinding;

/**
 * Field key -> bound value, plus `key__suffix` markers (template, watched,
 * attribute, color, formatter, display, …). Values are heterogeneous;
 * narrow with the helpers below at the point of use.
 */
export interface Bindings {
  [key: string]: BindingValue | undefined;
}

export interface ScopeMap {
  [id: string]: Bindings;
}

export function asString(v: BindingValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

export function asNumber(v: BindingValue | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function asStringArray(v: BindingValue | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((x): x is string => typeof x === "string");
}

export function asRowOptionsMap(v: BindingValue | undefined): RowOptionsMap {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: RowOptionsMap = {};
  for (const [id, raw] of Object.entries(v)) {
    if (typeof raw !== "object" || raw === null) continue;
    const options: RowOptions = {};
    for (const [key, value] of Object.entries(raw))
      if (typeof value === "string" && (value || key.startsWith(STATE_TEXT_OPTION)))
        options[key] = value;
    if (Object.keys(options).length) out[id] = options;
  }
  return out;
}

export function asSegments(v: BindingValue | undefined): SegmentBinding[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter((x): x is SegmentBinding => typeof x === "object" && x !== null);
}
