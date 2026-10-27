// What holds the editor's Save button, as pure functions of the template
// metadata, the bindings and the last preview. The editor renders the
// verdicts; nothing here touches the DOM.

import type { TranslationKey } from "./i18n";
import { imageUrlProblem, rowProblems } from "./switchboard";
import { asRowOptionsMap, asString, asStringArray, type Bindings } from "./types/bindings";
import type { ContentSize, FieldFeedback } from "./types/content";
import type { FieldMeta, TemplateMeta } from "./types/meta";
import { hasValue, markerKey } from "./value-source";

/** Aivi's cap on a rows field (list rows, battery devices, switchboard
 * tiles), unless the metadata says otherwise. */
export const ROWS_MAX = 8;

/** Aivi's cap on `tap_url`, measured on the normalized URL. */
export const TAP_URL_MAX = 256;

export function rowsMax(field: FieldMeta): number {
  return field.max ?? ROWS_MAX;
}

export function isBound(field: FieldMeta, b: Bindings): boolean {
  if (field.kind === "rows") {
    const v = b[field.key];
    return Array.isArray(v) && v.length > 0;
  }
  return hasValue(b, field.key);
}

export function missingFields(template: TemplateMeta, b: Bindings): FieldMeta[] {
  return template.fields.filter((f) => f.required && !isBound(f, b));
}

/** The fields of which one must be bound (an energy widget needs a
 * node), when none is; else none. */
export function missingOneOf(template: TemplateMeta, b: Bindings): FieldMeta[] {
  const group = template.fields.filter((f) => template.requires_any?.includes(f.key));
  return group.some((f) => isBound(f, b)) ? [] : group;
}

/** Required fields whose template currently hard-errors: they can never
 * push a valid value, so they block Save. Warnings (renders-to-nothing,
 * watches-nothing) never do. */
export function erroredFields(
  template: TemplateMeta,
  b: Bindings,
  feedback: Record<string, FieldFeedback> | undefined,
): FieldMeta[] {
  if (!feedback) return [];
  return template.fields.filter(
    (f) => f.required && !!b[markerKey(f.key, "template")] && feedback[f.key]?.status === "error",
  );
}

/** Whether a rows field's rows are switchboard tiles (the only rows that
 * take a gradient), whose marks are checked before the push. */
export function isTileField(field: FieldMeta): boolean {
  return !!field.row_options?.includes("gradient");
}

/** The rows (entity ids, in form order) holding an option the push would
 * drop: a tile's bad picture URL, malformed gradient or color, or a
 * budget that is not an amount above 0. */
export function problemRows(template: TemplateMeta, b: Bindings, colors: string[]): string[] {
  const rows: string[] = [];
  for (const field of template.fields) {
    if (field.kind !== "rows") continue;
    const map = asRowOptionsMap(b[`${field.key}__options`]);
    for (const id of asStringArray(b[field.key]))
      if (Object.keys(rowProblems(map[id] ?? {}, colors, isTileField(field))).length) rows.push(id);
  }
  return rows;
}

/** Content over Aivi's cap, as the last preview measured it. */
export function oversize(size: ContentSize | undefined): ContentSize | null {
  return size && size.bytes > size.limit ? size : null;
}

/** Fields whose stored value is a URL the wire checks. */
export function isUrlField(field: FieldMeta): boolean {
  return field.key === "tap_url" || field.slots?.[""]?.kind === "url";
}

/** Why Aivi would refuse `value` as a tap URL (any absolute URL, of any
 * scheme, so `homeassistant://` deep links qualify), or null. */
export function urlProblem(value: string): TranslationKey | null {
  const text = value.trim();
  if (!text) return null;
  if (!URL.canParse(text)) return "field.url-invalid";
  if (new URL(text).href.length > TAP_URL_MAX) return "field.url-long";
  return null;
}

/** Why Aivi would refuse `value` in this URL field: a picture's URL is
 * checked as a picture's, any other as a tap URL. */
export function fieldUrlProblem(field: FieldMeta, value: string): TranslationKey | null {
  if (!field.picture) return urlProblem(value);
  const text = value.trim();
  return text ? imageUrlProblem(text) : null;
}

/** URL fields whose literal (or, when sourced, fallback) the push would
 * drop. A sourced value is checked on the way out instead. */
export function badUrlFields(template: TemplateMeta, b: Bindings): FieldMeta[] {
  return template.fields.filter(
    (f) => isUrlField(f) && fieldUrlProblem(f, asString(b[f.key]) ?? "") !== null,
  );
}
