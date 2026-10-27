// How pushes go out, as the last field of the editor's behavior group: a
// widget's staleness threshold, an activity's throttle. Presets only,
// plus a stored value that is not one.

import { html, nothing, type TemplateResult } from "lit";
import { t } from "./i18n";
import type { EditorState } from "./types/editor";
import { durationLabel } from "./util";

/** Staleness presets, in seconds (Aivi takes 60 s to 7 days); 0 is
 * "never" (the widget's setting cleared). */
const STALE_PRESETS = [0, 900, 1800, 3600, 7200, 21600, 43200, 86400, 172800, 604800];
/** Activity throttle presets, in seconds; 0 sends every change. */
const THROTTLE_PRESETS = [0, 15, 30, 60, 120, 300, 600];
/** The integration's default throttle (const.DEFAULT_THROTTLE_SECONDS). */
export const DEFAULT_THROTTLE = 60;

/** The field; `onChange` runs after a pick was stored in `editorState`. */
export function deliveryField(editorState: EditorState, onChange: () => void): TemplateResult {
  const widget = editorState.kind === "widget";
  const presets = widget ? STALE_PRESETS : THROTTLE_PRESETS;
  const value = widget ? editorState.staleAfter : (editorState.throttle ?? DEFAULT_THROTTLE);
  const values = [...presets];
  if (value !== undefined && !values.includes(value)) values.push(value);
  values.sort((a, b) => a - b);
  const label = widget ? t("delivery.stale-label") : t("delivery.throttle-label");
  const option = (v: number): TemplateResult =>
    html`<option value=${String(v)} ?selected=${v === value}>${
      v === 0 ? (widget ? t("delivery.stale-never") : t("delivery.throttle-off")) : durationLabel(v)
    }</option>`;
  return html`<div class="fgroup"><div class="field delivery"><div class="flab"><span class="flabel">${label}</span></div><div class="fsrc"></div><div class="fmain"><select
        aria-label=${label}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLSelectElement).value;
          const next = raw === "" ? undefined : Number(raw);
          if (widget) editorState.staleAfter = next;
          else editorState.throttle = next;
          onChange();
        }}
      >${
        widget
          ? html`<option value="" ?selected=${value === undefined}>${t("delivery.stale-keep")}</option>`
          : nothing
      }${values.map(option)}</select><div class="fhint">${
        widget ? t("delivery.stale-hint") : t("delivery.throttle-hint")
      }</div></div></div></div>`;
}
