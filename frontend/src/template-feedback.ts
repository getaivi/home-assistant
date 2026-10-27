// What a template box says under it, from the last aivi/preview: the value
// it renders to and its kind, where and why it fails, the entity ids it
// names that Home Assistant does not have (with the closest ones it has),
// and what Home Assistant re-renders it on. Pure rendering over the
// preview's feedback; the box (source-editor.ts) places it.

import { html, nothing, type TemplateResult } from "lit";
import { type TranslationKey, t, tOpt, tPlural } from "./i18n";
import { note } from "./notice";
import type { FieldFeedback, TemplateListens } from "./types/content";

/** Entities listed by id in "Updates on" before the rest are counted. */
export const LISTED_ENTITIES = 6;

/** The kind of value, in words: "number", "list of 24 numbers, 0.11 to
 * 0.25". */
export function kindText(fb: FieldFeedback): string {
  switch (fb.kind) {
    case "number":
      return t("field.kind-number");
    case "bool":
      return t("field.kind-bool");
    case "nothing":
      return t("field.kind-nothing");
    case "list": {
      const count = fb.items ?? 0;
      if (!fb.range) return tPlural("field.kind-list", count);
      const [min, max] = fb.range;
      const range = min === max ? String(min) : t("field.kind-range", { min, max });
      return `${tPlural("field.kind-numbers", count)}, ${range}`;
    }
    default:
      return t("field.kind-text");
  }
}

/** Where an error is: "Line 2, column 6", "Line 2", or the plain
 * heading when Home Assistant names no place. */
export function errorWhere(fb: FieldFeedback): string {
  if (fb.line === undefined) return t("field.template-error");
  if (fb.column === undefined) return t("field.error-at-line", { line: fb.line });
  return t("field.error-at", { line: fb.line, column: fb.column });
}

/** A Jinja token with the spaces inside it unbreakable, so a wrapping
 * line never splits it. */
function token(open: string, inner: string, close: string): string {
  return [open, inner, close].join(" ");
}

/** The words a reason fills in. Jinja's own tokens are put together
 * here, so no translation has to spell braces. */
function reasonParams(fb: FieldFeedback): Record<string, string> {
  const p = fb.params ?? {};
  const tag = p["tag"] ?? "";
  switch (fb.reason) {
    case "unclosed":
      return { output: token("{{", "…", "}}"), statement: token("{%", "…", "%}") };
    case "unclosed_block":
      return { tag: token("{%", tag, "%}"), end: token("{%", `end${tag}`, "%}") };
    case "stray_end":
      return { tag: token("{%", tag, "%}") };
    case "no_default":
      return { ...p, example: `${p["function"] ?? "float"}(0)` };
    case "type":
      return { example: "| float(0)" };
    default:
      return p;
  }
}

/** The error in plain words, or null for a message the panel does not
 * word (the raw message is shown either way). */
export function errorPlain(fb: FieldFeedback): string | null {
  if (!fb.reason) return null;
  const key = `field.error-${fb.reason}`;
  // A reason newer than this bundle keeps the raw message alone.
  return tOpt(key) ? t(key as TranslationKey, reasonParams(fb)) : null;
}

/** `text` with every whole occurrence of entity id `from` replaced by
 * `to` (not inside a longer id). */
export function replaceEntity(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "g"), to);
}

/** The error block: where, why in plain words, what the caller adds
 * (the fallback in use), and Home Assistant's own message: behind
 * Details when the plain words say it, else in their place. */
function errorNote(fb: FieldFeedback, extra: string | undefined): TemplateResult {
  const plain = errorPlain(fb);
  const raw = fb.error ?? "";
  return note(
    "error",
    html`<span class="k">${errorWhere(fb)}</span>${plain ?? html`<code>${raw}</code>`}${
      extra ? html` ${extra}` : nothing
    }${
      plain
        ? html`<details class="tdetails"><summary>${t("field.error-details")}</summary><code class="traw">${raw}</code></details>`
        : nothing
    }`,
    { role: "status" },
  );
}

/** The result line: the value in full and its kind. */
function resultLine(fb: FieldFeedback, extra: string | undefined): TemplateResult {
  const kind = kindText(fb);
  const value = fb.value ?? "";
  return html`<div class="tres"><span class="k">${t("field.result")}</span>${
    value.trim() ? html`<code class="tval">${value}</code>` : nothing
  }<span class="tkind">${extra ? `${kind}, ${extra}` : kind}</span></div>`;
}

/** Ids Home Assistant does not have, each with "did you mean" buttons
 * that put the suggestion in the template. */
function unknownNote(
  fb: FieldFeedback,
  onFix: (from: string, to: string) => void,
): TemplateResult | typeof nothing {
  const unknown = fb.unknown ?? [];
  if (!unknown.length) return nothing;
  return note(
    "warn",
    unknown.map(
      (u) =>
        html`<div>${t("field.unknown-entity", { id: u.id })}${
          u.suggestions.length
            ? html` ${t("field.did-you-mean")} ${u.suggestions.map(
                (s) =>
                  html`<button type="button" class="tfix" aria-label=${t("field.use-entity", { id: s })}
                  @click=${() => onFix(u.id, s)}>${s}</button>`,
              )}`
            : nothing
        }</div>`,
    ),
    { cls: "tunknown" },
  );
}

/** Whether `text` is an entity id as Home Assistant spells one
 * (`valid_entity_id`): lowercase words joined by one dot, no leading,
 * trailing or doubled underscores. */
export function isEntityId(text: string): boolean {
  return /^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$/.test(text);
}

/** "Updates on": the entities (the first few by id), whole domains, any
 * state change, the start of every minute, and Home Assistant's rate
 * limit. A template with no listener at all never updates on its own,
 * which reads as a warning. */
export function listensLine(l: TemplateListens): TemplateResult | typeof nothing {
  const parts: unknown[] = [];
  // Home Assistant listens to whatever text states('…') was given, so a
  // half typed states('living') would read as an entity: only ids are
  // listed.
  const entities = l.entities.filter(isEntityId);
  const listed = entities.slice(0, LISTED_ENTITIES);
  for (const id of listed) parts.push(html`<span class="chip">${id}</span>`);
  const more = entities.length - listed.length;
  if (more > 0) parts.push(html`<span class="none">${tPlural("field.updates-more", more)}</span>`);
  for (const domain of l.domains)
    parts.push(html`<span class="chip">${t("field.updates-domain", { domain })}</span>`);
  if (l.all) parts.push(html`<span class="chip">${t("field.updates-all")}</span>`);
  if (l.time) parts.push(html`<span class="chip">${t("field.updates-time")}</span>`);
  // Only text that is no id yet: nothing to say until it is one.
  if (!parts.length && entities.length < l.entities.length) return nothing;
  if (!parts.length) return note("warn", t("field.updates-never"), { cls: "never" });
  const limit =
    l.rate_limit !== undefined
      ? html`<span class="none">${tPlural("field.updates-limit", l.rate_limit)}</span>`
      : nothing;
  return html`<div class="tchips"><span class="none">${t("field.updates-on")}</span>${parts}${limit}</div>`;
}

/** Everything under a template box, for the feedback it was given. */
export function templateFeedback(opts: {
  feedback: FieldFeedback | undefined;
  /** The feedback was computed for older text: shown, but dimmed. */
  stale: boolean;
  id: string;
  /** Warnings the caller words (a fallback in use), under the result. */
  note: unknown;
  resultExtra?: string | undefined;
  errorExtra?: string | undefined;
  onFix: (from: string, to: string) => void;
}): TemplateResult {
  const fb = opts.feedback;
  const body = !fb
    ? opts.note
    : fb.status === "error"
      ? html`${errorNote(fb, opts.errorExtra)}${unknownNote(fb, opts.onFix)}`
      : html`${fb.kind ? resultLine(fb, opts.resultExtra) : nothing}${opts.note}${unknownNote(
          fb,
          opts.onFix,
        )}${fb.listens ? listensLine(fb.listens) : nothing}`;
  return html`<div class=${opts.stale ? "tfb stale" : "tfb"} id=${opts.id}>${body}</div>`;
}
