// The editor's live preview: a debounced aivi/preview per edit, of which
// only the latest answer lands. The answer carries more than the picture:
// the content's size and each sourced value's render feedback, which gate
// Save and show under the rows.

import type { LitElement, ReactiveController } from "lit";
import type { AiviEditor } from "./aivi-editor";
import type { AiviFieldRow } from "./aivi-field-row";
import { readEntityIds } from "./bound-entities";
import { previewStates } from "./preview-as";
import { tooBig, tooBigText } from "./save-blockers";
import type { FieldFeedback } from "./types/content";
import type { HassLike } from "./types/hass";
import { baseKey, markerKey, markerOf, slotMode } from "./value-source";

/** How long typing must pause before a template error shows (results
 * show as soon as they land). Leaving the box shows it at once. */
export const ERROR_SETTLE_MS = 1000;

export class PreviewLoop implements ReactiveController {
  private readonly _host: AiviEditor;
  private _timer: number | undefined;
  /** Bumped per preview request, so only the latest answer lands: a slow
   * one must not overwrite the size and feedback that gate Save. */
  private _requested = 0;
  /** The request number of the preview whose answer landed last. */
  private _landed = 0;
  /** The template text each shown feedback was computed for, so rows
   * can tell feedback that predates the user's latest edit (feedback
   * lags a debounce + round-trip behind typing). */
  private _previewed: Record<string, string> = {};
  /** The last answer's feedback and the texts it was computed for. An
   * error in it waits for typing to pause before it is shown. */
  private _latest: Record<string, FieldFeedback> = {};
  private _latestPreviewed: Record<string, string> = {};
  /** Pending while typing has not paused for ERROR_SETTLE_MS. */
  private _settleTimer: number | undefined;
  /** The last publish held an error back. */
  private _holding = false;
  /** Bumped with every answer: the pane redraws on it. */
  rev = 0;
  /** The too-big announcement, set when the content first goes over. */
  sizeAlert = "";

  constructor(host: AiviEditor) {
    this._host = host;
    host.addController(this);
  }

  hostDisconnected(): void {
    clearTimeout(this._timer);
    clearTimeout(this._settleTimer);
  }

  /** A template was typed in: a new error waits until typing pauses. */
  edited(): void {
    clearTimeout(this._settleTimer);
    this._settleTimer = window.setTimeout(() => this.settle(), ERROR_SETTLE_MS);
  }

  /** Typing paused, or the box lost focus: errors held back show now. */
  settle(): void {
    clearTimeout(this._settleTimer);
    this._settleTimer = undefined;
    if (!this._holding) return;
    this._publish();
    this._refresh();
  }

  /** Shows the last answer's feedback. While typing, an error does not
   * replace what is shown: the previous result or error stays (marked
   * out of date) until a result lands or typing pauses, so no error
   * flashes mid-word. */
  private _publish(): void {
    const editorState = this._host.editorState;
    const settled = this._settleTimer === undefined;
    const shown = editorState.fieldFeedback ?? {};
    const next: Record<string, FieldFeedback> = {};
    const previewed: Record<string, string> = { ...this._latestPreviewed };
    this._holding = false;
    for (const [addr, fb] of Object.entries(this._latest)) {
      if (fb.status !== "error" || settled) {
        next[addr] = fb;
        continue;
      }
      this._holding = true;
      const before = shown[addr];
      if (before) next[addr] = before;
      const text = this._previewed[addr];
      if (text === undefined) delete previewed[addr];
      else previewed[addr] = text;
    }
    editorState.fieldFeedback = next;
    this._previewed = previewed;
  }

  schedule(delay: number): void {
    clearTimeout(this._timer);
    this._timer = window.setTimeout(() => {
      this._timer = undefined;
      void this._update();
    }, delay);
  }

  /** Home Assistant pushed new state. Only a change to an entity the
   * bindings read refreshes the preview, and it never postpones one that
   * is already pending: on a busy system a restarting debounce would never
   * fire. */
  hassChanged(prev: HassLike, next: HassLike): void {
    if (prev.states === next.states) return;
    const host = this._host;
    const touched = readEntityIds(
      host.effectiveBindings(),
      host.editorState.active,
      host.panel.hass.states,
    ).some((id) => prev.states[id] !== next.states[id]);
    if (touched && this._timer === undefined) host.schedulePreview();
  }

  previewedTemplate(key: string): string | undefined {
    return this._previewed[key];
  }

  /** How many previews have been requested so far. An edit made now is
   * only reflected by a preview numbered above this. */
  get requested(): number {
    return this._requested;
  }

  /** The number of the newest preview that has answered. A component that
   * computes from the preview compares it with `requested` as it stood at
   * its last edit, to tell an answer that predates the edit. */
  get landed(): number {
    return this._landed;
  }

  private async _update(): Promise<void> {
    const host = this._host;
    const editorState = host.panel.editorState;
    if (!editorState || host.panel.view !== "editor") return;
    const seq = ++this._requested;
    const bindings = host.effectiveBindings();
    const previewed: Record<string, string> = {};
    for (const [k, v] of Object.entries(bindings)) {
      if (markerOf(k) === "template" && typeof v === "string") previewed[baseKey(k)] = v;
      // Sourced segment weights get feedback under `<key>.<i>.source`;
      // record their text under the same key for the staleness check.
      else if (Array.isArray(v))
        (v as unknown[]).forEach((item, i) => {
          if (item === null || typeof item !== "object") return;
          const template = (item as Record<string, unknown>)[markerKey("source", "template")];
          if (typeof template === "string") previewed[`${k}.${i}.source`] = template;
        });
    }
    // Drawn as if an entity read another value: the picture changes, and
    // what the form says about each value stays what it is now.
    const states = previewStates(bindings, host.panel.hass.states, editorState.previewAs);
    try {
      const res = await host.panel.api.preview({
        template: editorState.template,
        bindings,
        kind: editorState.kind,
        ...(states ? { states } : {}),
      });
      if (seq !== this._requested) return;
      editorState.preview = res.content;
      if (!states) this._latest = res.fields ?? {};
      editorState.size = res.size;
      editorState.waiting = res.waiting ?? null;
    } catch {
      if (seq !== this._requested) return;
      editorState.preview = null;
      this._latest = {};
      editorState.size = undefined;
      editorState.waiting = null;
    }
    this._landed = seq;
    this._latestPreviewed = previewed;
    this._publish();
    // Announced once when the content goes over, not on every preview
    // pass: the visible note's byte count changes with each one.
    const over = tooBig(host.editorState);
    if (!over) this.sizeAlert = "";
    else if (!this.sizeAlert) this.sizeAlert = tooBigText(over);
    this._refresh();
  }

  /** Redraws everything that shows the preview's answer. */
  private _refresh(): void {
    const host = this._host;
    const editorState = host.editorState;
    this.rev++;
    host.updateValidation();
    // Rows in template mode display this feedback inline, and required
    // rows mark a field the content waits on; nudge just them (comboboxes
    // and text inputs in other rows stay untouched).
    for (const row of host.querySelectorAll<AiviFieldRow>("aivi-field-row")) {
      if (row.field.required || slotMode(editorState.bindings, row.field.key) === "template")
        row.requestUpdate();
    }
    // Segments editors and row checklists show per-segment and per-row
    // feedback.
    for (const el of host.querySelectorAll<LitElement>("aivi-segments-editor, aivi-rows-checklist"))
      el.requestUpdate();
  }
}
