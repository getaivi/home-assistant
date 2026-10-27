// The form kit: the primitives every editor form is built from, so a
// setting looks and behaves the same wherever it appears.
//
// - `option`: a small label above its control, for a setting inside a fold
//   or a row.
// - `fold`: the disclosure for optional settings. Its summary line says
//   what is set inside, so a closed fold still shows what it holds.
// - `FoldState`: where a component remembers which folds are open.

import { html, nothing, type TemplateResult } from "lit";
import { icon } from "./icons";

/** A labeled option: the label above the control, then at most one hint. */
export function option(label: string, control: unknown, hint?: string | null): TemplateResult {
  return html`<div class="ctl"><span class="k">${label}</span>${control}${
    hint ? html`<div class="fhint">${hint}</div>` : nothing
  }</div>`;
}

/** Which folds are open, by key. A fold's default is decided once, the
 * first time it renders, so later re-renders never override the user's own
 * toggling. */
export class FoldState {
  private _open = new Map<string, boolean>();

  /** Whether `key` is open; `initial` decides it the first time. */
  open(key: string, initial: () => boolean): boolean {
    let open = this._open.get(key);
    if (open === undefined) {
      open = initial();
      this._open.set(key, open);
    }
    return open;
  }

  set(key: string, open: boolean): void {
    this._open.set(key, open);
  }

  /** Forget every fold under `prefix` (a removed row). */
  drop(prefix: string): void {
    for (const key of this._open.keys()) if (key.startsWith(prefix)) this._open.delete(key);
  }
}

interface FoldOptions {
  title: string;
  /** What is set inside, shown beside the title; empty when nothing is. */
  summary?: string | null;
  /** Something inside holds Save: the summary line is marked, so a
   * closed fold still shows where the problem is. */
  invalid?: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  body: unknown;
}

export function fold(o: FoldOptions): TemplateResult {
  return html`<details
    class=${`style fold${o.invalid ? " bad" : ""}`} ?open=${o.open}
    @toggle=${(e: Event) => o.onToggle((e.currentTarget as HTMLDetailsElement).open)}
  ><summary aria-invalid=${o.invalid ? "true" : nothing}><span class="tri" aria-hidden="true">${icon("chevron-right")}</span><span class="ft">${o.title}</span>${
    o.summary ? html`<span class="fsum">${o.summary}</span>` : nothing
  }</summary><div class="body foldbody">${o.body}</div></details>`;
}
