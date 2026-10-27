// The panel's two notice shapes, one per scope, each with a severity:
// - a note: an inline line, a mark and its words in the severity's ink,
//   under the form row (or the card, or the preview) it is about;
// - a banner: a boxed message for a whole page or section, tinted in the
//   severity's hue, with an optional action at its trailing edge.
// Severity picks the mark and the --aivi-<hue>-* tokens (styles/base.ts),
// never a color of its own.

import { html, nothing, type TemplateResult } from "lit";
import { type IconName, icon } from "./icons";

export type Severity = "ok" | "warn" | "error";

const MARK: Record<Severity, IconName> = {
  ok: "check",
  warn: "alert-outline",
  error: "alert-circle-outline",
};

interface NoticeOptions {
  /** Ties the notice to a control (aria-describedby). */
  id?: string | typeof nothing | undefined;
  /** "status" announces it politely, "alert" at once; none stays quiet. */
  role?: "status" | "alert" | undefined;
  /** Further classes, for placement. */
  cls?: string | undefined;
}

function classes(base: string, severity: Severity, cls: string | undefined): string {
  return cls ? `${base} ${severity} ${cls}` : `${base} ${severity}`;
}

/** The inline note under a form row (and a card's or the preview's
 * waiting line): the mark, then the words. */
export function note(severity: Severity, body: unknown, opts: NoticeOptions = {}): TemplateResult {
  return html`<div class=${classes("tnote", severity, opts.cls)} id=${opts.id ?? nothing}
    role=${opts.role ?? nothing}>${icon(MARK[severity])}<div class="tnbody">${body}</div></div>`;
}

/** A page or section message: boxed, the mark, the words, then the
 * action (a button) when there is one. */
export function banner(
  severity: Severity,
  body: unknown,
  opts: NoticeOptions & { action?: unknown } = {},
): TemplateResult {
  return html`<div class=${classes("banner", severity, opts.cls)} id=${opts.id ?? nothing}
    role=${opts.role ?? nothing}>${icon(MARK[severity])}<div class="grow">${body}</div>${
      opts.action ?? nothing
    }</div>`;
}
