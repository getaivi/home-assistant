// What Save is waiting for: the verdicts of editor-validation.ts gathered
// for one form state, each named and pointed at the form row that fixes
// it, and the words the editor's bar says about them.

import {
  badUrlFields,
  erroredFields,
  missingFields,
  missingOneOf,
  oversize,
  problemRows,
} from "./editor-validation";
import { type TranslationKey, t } from "./i18n";
import type { ContentSize } from "./types/content";
import type { EditorState } from "./types/editor";
import type { HassLike } from "./types/hass";
import type { FieldMeta, TemplateMeta } from "./types/meta";
import { labelFor } from "./util";

/** Every verdict on the form as it stands. */
export interface FormCheck {
  /** A Live Activity without its lifecycle entity. */
  setupIncomplete: boolean;
  missing: FieldMeta[];
  oneOf: FieldMeta[];
  errored: FieldMeta[];
  badUrls: FieldMeta[];
  /** The rows (entity ids) with an option the push would drop: a tile's
   * marks, a category's budget. */
  problemRows: string[];
  /** Content over Aivi's 4 KiB cap, as the last preview measured it: it
   * would never be sent. */
  tooBig: TooBig | null;
}

/** Content over the cap, with the template whose words say what to cut. */
export type TooBig = ContentSize & { template: string };

export function checkForm(
  template: TemplateMeta,
  editorState: EditorState,
  colors: string[],
): FormCheck {
  const bindings = editorState.bindings;
  return {
    setupIncomplete: editorState.kind === "activity" && !editorState.active,
    missing: missingFields(template, bindings),
    oneOf: missingOneOf(template, bindings),
    errored: erroredFields(template, bindings, editorState.fieldFeedback),
    badUrls: badUrlFields(template, bindings),
    problemRows: problemRows(template, bindings, colors),
    tooBig: tooBig(editorState),
  };
}

/** One thing Save is waiting for. */
export interface Blocker {
  kind: "missing" | "template" | "url" | "tiles" | "size";
  label: string;
  /** Selector of the form row that fixes it; null when none does. */
  row: string | null;
}

/** Everything Save is waiting for, one entry per blocker: what to call
 * it and the form row to fix it in (null when no single row holds it).
 * The bar's chip counts these, so a disabled Save always shows why. */
export function blockers(template: TemplateMeta, check: FormCheck): Blocker[] {
  const row = (key: string): string => `.field[data-key="${key}"]`;
  const out: Blocker[] = [];
  if (check.setupIncomplete)
    out.push({ kind: "missing", label: t("editor.active-label"), row: ".setup .field" });
  for (const f of check.missing)
    out.push({ kind: "missing", label: labelFor(f.key, template.slug), row: row(f.key) });
  const firstOf = check.oneOf[0];
  if (firstOf) out.push({ kind: "missing", label: oneOfText(check.oneOf), row: row(firstOf.key) });
  for (const f of check.errored)
    out.push({ kind: "template", label: labelFor(f.key), row: row(f.key) });
  for (const f of check.badUrls) out.push({ kind: "url", label: labelFor(f.key), row: row(f.key) });
  if (check.problemRows.length) {
    // A row option a push would drop (a tile's picture, a budget): the
    // jump goes to the rows field that holds it.
    const rows = template.fields.find((f) => f.kind === "rows");
    out.push({
      kind: "tiles",
      label: rows ? labelFor(rows.key, template.slug) : "",
      row: rows ? row(rows.key) : null,
    });
  }
  if (check.tooBig) out.push({ kind: "size", label: "", row: null });
  return out;
}

function oneOfText(fields: FieldMeta[]): string {
  return t("editor.one-of", { fields: fields.map((f) => labelFor(f.key)).join(", ") });
}

/** What is still to set, by name: the preview's "missing" line and the
 * chip's tooltip list them. */
export function needs(check: FormCheck, template?: string): string[] {
  const out = check.missing.map((f) => labelFor(f.key, template));
  if (check.oneOf.length) out.push(oneOfText(check.oneOf));
  if (check.setupIncomplete) out.push(t("editor.active-label"));
  return out;
}

/** The chip: how many things Save waits for. "To set" while something
 * is missing, "to fix" when all that is left is wrong. */
export function chipLabel(check: FormCheck, count: number): string {
  if (!count) return "";
  return needs(check).length
    ? t("preview.missing-count", { count })
    : t("preview.fix-count", { count });
}

/** The chip's tooltip: each kind of blocker in a sentence. */
export function chipTitle(check: FormCheck, hass: HassLike, template?: string): string {
  const missing = needs(check, template);
  return [
    missing.length ? t("preview.missing", { fields: missing.join(", ") }) : "",
    check.errored.length
      ? t("editor.template-error-blocks", {
          fields: check.errored.map((f) => labelFor(f.key)).join(", "),
        })
      : "",
    check.badUrls.length ? t("editor.fix-fields") : "",
    check.problemRows.length ? problemRowsText(check.problemRows, hass) : "",
    check.tooBig ? tooBigText(check.tooBig) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function problemRowsText(rows: string[], hass: HassLike): string {
  return t("switchboard.fix-options", {
    rows: rows.map((id) => hass.states[id]?.attributes.friendly_name || id).join(", "),
  });
}

/** The last preview's size when it is over Aivi's cap, else null. */
export function tooBig(editorState: EditorState): TooBig | null {
  const over = oversize(editorState.size);
  return over ? { ...over, template: editorState.template } : null;
}

/** Content over the cap in words: how big, and what to cut, which
 * depends on what the template carries. */
export function tooBigText(size: TooBig): string {
  const params = { bytes: size.bytes, limit: size.limit };
  const key: TranslationKey =
    size.template === "showcase"
      ? "showcase.too-big"
      : size.template === "remote"
        ? "remote.too-big"
        : "switchboard.too-big";
  return t(key, params);
}
