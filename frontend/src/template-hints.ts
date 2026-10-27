// The template workspace's hints under a result: a few precise things the
// last preview shows about it, each with a one-press fix where the fix is
// mechanical. They read only what the integration said (the value, its
// kind and status, the field's limit), what the widget preview drew and,
// for an icon, Apple's symbol list:
//
//   limit        longer than the field takes on the wire: the rest is cut
//   kind         a value the field cannot use (text for a number); the
//                field's fallback shows instead
//   symbol       an icon name Apple's symbol list does not have; fix: the
//                closest name it has, where the template spells it out
//   unavailable  the entity it reads is unavailable or unknown, and the
//                widget would say so; fix: words when it has no value
//   none         it renders None: what it reads has no value
//   decimals     clearly too many decimals (four, or three past 10); fix:
//                round it to three significant digits
//   clipped      the widget at its size cuts the text off (often for one
//                of the reasons above, so it comes after them)
//
// At most two show, in that order. Pure functions over the text.

import { t, tPlural } from "./i18n";
import { closestSymbol, type SfIndex, symbolNamed } from "./sf-symbols";
import { twoStates } from "./template-recipes";
import type { FieldFeedback } from "./types/content";
import type { HassLike } from "./types/hass";

/** Hints shown at most under one result. */
export const MAX_HINTS = 2;

/** A change to the template: `insert` in place of `from`..`to`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface ResultHint {
  id: "limit" | "clipped" | "kind" | "unavailable" | "none" | "decimals" | "symbol";
  text: string;
  fix?: { label: string; edit: TextEdit };
}

/** The one `{{ … }}` of a template, if it has exactly one: where it
 * starts and ends, and the expression in it. */
export function soleOutput(text: string): { start: number; end: number; inner: string } | null {
  const outputs = [...text.matchAll(/\{\{-?([\s\S]*?)-?\}\}/g)];
  const only = outputs.length === 1 ? outputs[0] : undefined;
  if (!only) return null;
  return { start: only.index, end: only.index + only[0].length, inner: (only[1] ?? "").trim() };
}

/** `expr` safe to put a filter or an `if` after: a chain of names,
 * calls and filters stays as it is, anything else goes in brackets. */
function operand(expr: string): string {
  return /^[\w.]+(?:\([^()]*\))?(?:\s*\|\s*\w+(?:\([^()]*\))?)*$/.test(expr) ? expr : `(${expr})`;
}

/** `text`'s one output with its expression rewritten by `make`. */
function rewrite(text: string, make: (inner: string) => string): TextEdit | null {
  const out = soleOutput(text);
  if (!out) return null;
  return { from: out.start, to: out.end, insert: `{{ ${make(out.inner)} }}` };
}

/** The entities a template names that Home Assistant has. */
function named(text: string, hass: HassLike): string[] {
  return [...new Set(text.match(/\b[a-z_]+\.[a-z0-9_]+\b/g) ?? [])].filter((id) => hass.states[id]);
}

function name(hass: HassLike, id: string): string {
  const friendly = hass.states[id]?.attributes.friendly_name;
  return typeof friendly === "string" && friendly ? friendly : id;
}

/** A value the field could not use, in words for its kind. */
function kindHint(kind: string, value: string, text: string, hass: HassLike): ResultHint {
  switch (kind) {
    case "number":
    case "money": {
      const hint: ResultHint = { id: "kind", text: t("workspace.hint-kind-number", { value }) };
      const unit = /,\s*with_unit\s*=\s*True/g;
      if (unit.test(text) && /^-?[\d.,]+\s*\S+$/.test(value)) {
        const insert = text.replace(unit, "");
        hint.fix = { label: t("workspace.fix-unit"), edit: { from: 0, to: text.length, insert } };
      }
      return hint;
    }
    case "bool": {
      const hint: ResultHint = { id: "kind", text: t("workspace.hint-kind-bool", { value }) };
      const out = soleOutput(text);
      const id = out && /^states\(['"]([a-z_]+\.[a-z0-9_]+)['"]\)$/.exec(out.inner)?.[1];
      const entity = id ? hass.states[id] : undefined;
      const two = id && entity ? twoStates(id, entity) : null;
      if (out && id && two)
        hint.fix = {
          label: t("workspace.fix-is-state", { state: two.on }),
          edit: { from: out.start, to: out.end, insert: `{{ is_state('${id}', '${two.on}') }}` },
        };
      return hint;
    }
    case "color":
    case "action_color":
      return { id: "kind", text: t("workspace.hint-kind-color", { value }) };
    case "timestamp":
      return { id: "kind", text: t("workspace.hint-kind-time", { value }) };
    default:
      return { id: "kind", text: t("workspace.hint-kind-other", { value }) };
  }
}

/** An icon name the symbol list does not have, and, where the template
 * spells it out once in quotes, the closest name it has in its place. The
 * list can be older than the device, so it is a hint, never a block. */
function symbolHint(value: string, text: string, symbols: SfIndex): ResultHint | null {
  if (!value || symbolNamed(symbols, value) === value) return null;
  const hint: ResultHint = { id: "symbol", text: t("workspace.hint-symbol", { value }) };
  const closest = closestSymbol(symbols, value);
  const quoted = [...text.matchAll(/(['"])(.*?)\1/g)].filter((m) => m[2] === value);
  const only = quoted.length === 1 ? quoted[0] : undefined;
  if (closest && only)
    hint.fix = {
      label: t("workspace.fix-symbol", { name: closest }),
      edit: { from: only.index + 1, to: only.index + 1 + value.length, insert: closest },
    };
  return hint;
}

/** The hints for a template's last result. `clipped` names the widget
 * size that cuts the value off, if one does; `symbols`, for an icon, is
 * Apple's symbol list once it has loaded. */
export function resultHints(opts: {
  feedback: FieldFeedback | undefined;
  text: string;
  /** The slot's kind (values.py's SlotKind), "points" or "segment". */
  kind: string;
  hass: HassLike;
  clipped: string | null;
  symbols?: SfIndex | null;
}): ResultHint[] {
  const fb = opts.feedback;
  if (!fb || !opts.text || fb.status === "error") return [];
  const { text, kind, hass } = opts;
  const value = (fb.value ?? "").trim();
  const hints: ResultHint[] = [];
  if (fb.limit !== undefined && value.length > fb.limit)
    hints.push({ id: "limit", text: t("workspace.hint-limit", { limit: fb.limit }) });
  if (fb.status === "fallback" && value) hints.push(kindHint(kind, value, text, hass));
  const symbol =
    kind === "icon" && fb.status === "ok" && opts.symbols
      ? symbolHint(value, text, opts.symbols)
      : null;
  if (symbol) hints.push(symbol);
  const isText = kind === "text";
  const lower = value.toLowerCase();
  if (isText && (lower === "unavailable" || lower === "unknown")) {
    const id = named(text, hass).find((e) => hass.states[e]?.state === lower);
    if (id) {
      const words = t("sheet.word-no-data");
      const hint: ResultHint = {
        id: "unavailable",
        text: t("workspace.hint-unavailable", { name: name(hass, id), state: lower }),
      };
      const quoted = `'${words.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
      const edit = text.includes("has_value(")
        ? null
        : rewrite(text, (inner) => `${operand(inner)} if has_value('${id}') else ${quoted}`);
      if (edit) hint.fix = { label: t("workspace.fix-unavailable", { words }), edit };
      hints.push(hint);
    }
  }
  if (value === "None") hints.push({ id: "none", text: t("workspace.hint-none") });
  // A reading with many decimals, in a number or in text, where the one
  // output can be rounded (and nothing is rounded yet).
  // Clearly too many decimals: four, or three on a reading of 10 or more.
  // Rounded to three significant digits (0.15149 to 0.151, 7.1333 to
  // 7.13, 21.456 to 21.5), which keeps what a reading means.
  const reading = fb.kind === "number" || isText ? /(\d+)\.(\d{3,})/.exec(value) : null;
  const whole = reading?.[1] ?? "";
  const decimals = reading?.[2];
  const integer = whole.replace(/^0+/, "").length;
  const many = !!decimals && (decimals.length >= 4 || integer >= 2);
  const places = Math.max(1, 3 - integer);
  const edit =
    many && !/\bround\(/.test(text)
      ? rewrite(text, (x) => `${operand(x)} | round(${places})`)
      : null;
  if (decimals && edit)
    hints.push({
      id: "decimals",
      text: tPlural("workspace.hint-decimals", decimals.length),
      fix: { label: t("workspace.fix-round"), edit },
    });
  if (opts.clipped)
    hints.push({ id: "clipped", text: t("workspace.hint-clipped", { size: opts.clipped }) });
  return hints.slice(0, MAX_HINTS);
}
