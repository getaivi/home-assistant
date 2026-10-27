// The controls of a value's source, shared by every place a value can come
// from live state (field rows and segment weights): the attribute picker
// and the Jinja editor with what the preview says about it. Callers own
// where the values are stored; these only render and report edits.

import { html, nothing, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import "./aivi-template-box";
import { templateMarks } from "./code-editor/marks";
import { entityIdsIn } from "./const";
import { t } from "./i18n";
import { replaceEntity, templateFeedback } from "./template-feedback";
import type { FieldFeedback } from "./types/content";
import type { HassLike } from "./types/hass";

/** Attributes not worth sourcing a value from. */
const HIDDEN_ATTRIBUTES = ["friendly_name", "icon"];

/** The entities a template names that exist: an optimistic watch list
 * (the server re-derives the real one on save). */
export function watchedIds(text: string, hass: HassLike): string[] {
  return [...new Set(entityIdsIn(text).filter((id) => hass.states[id]))];
}

/** The attribute picker for an entity, or a hint to pick the entity first.
 * `wrap` is the class of the wrapping element. */
export function attributePicker(opts: {
  hass: HassLike;
  entityId: string | null;
  selected: string | undefined;
  wrap: string;
  onChange: (attribute: string) => void;
}): TemplateResult {
  if (!opts.entityId) {
    const hint = html`<div class="fhint">${t("field.pick-entity-first")}</div>`;
    return opts.wrap ? html`<div class=${opts.wrap}>${hint}</div>` : hint;
  }
  const attrs = opts.hass.states[opts.entityId]?.attributes ?? {};
  const names = Object.keys(attrs).filter((a) => !HIDDEN_ATTRIBUTES.includes(a));
  // A stored attribute the entity doesn't have right now is still the
  // pick: the menu shows it instead of showing nothing chosen.
  if (opts.selected && !names.includes(opts.selected)) names.push(opts.selected);
  if (!names.length) {
    // Instead of an empty menu, a hint says why there is nothing to pick.
    const hint = html`<div class="fhint">${t("field.no-attributes")}</div>`;
    return opts.wrap ? html`<div class=${opts.wrap}>${hint}</div>` : hint;
  }
  return html`<div class=${opts.wrap || nothing}><select
      aria-label=${t("field.choose-attribute")}
      @change=${(e: Event) => opts.onChange((e.target as HTMLSelectElement).value)}
    ><option value="">${t("field.choose-attribute")}</option>${names.map(
      (a) =>
        html`<option value=${a} ?selected=${opts.selected === a}>${a in attrs ? `${a}  (${JSON.stringify(attrs[a]).slice(0, 40)})` : a}</option>`,
    )}</select></div>`;
}

/** Everything a template box is drawn from: its text and where it goes,
 * what the last preview said about it, and the words around it. The
 * form's inline box and the template workspace are both drawn from one
 * (template-slots.ts finds it by the box's address). */
export interface TemplateSpec {
  text: string;
  /** The box's key in the preview's feedback: its address in the URL of
   * its workspace. */
  address: string;
  /** The field's name ("State"), or the value's within it ("Color"). */
  label: string;
  /** The field's hint, in its template wording. */
  hint?: string | undefined;
  /** The slot's kind, "points" or "segment": the recipes that fit. */
  kind: string;
  /** For completion: the entities and their attributes. */
  hass: HassLike;
  /** The editor the box is in (its entities and live preview). */
  editor: AiviEditor;
  /** The shown preview feedback for this template, if any. */
  feedback: FieldFeedback | undefined;
  /** The feedback was computed for other text than the box holds. */
  stale: boolean;
  noteId: string;
  /** Warnings the caller words (a fallback in use), under the result. */
  note?: unknown;
  /** Added to the result's kind (a phase's share of the bar). */
  resultExtra?: string | undefined;
  /** Added to an error (the fallback in use). */
  errorExtra?: string | undefined;
  onInput: (text: string) => void;
  /** The box lost focus: a held-back error can show. */
  onBlur: () => void;
}

/** What the last preview said about a template (template-feedback.ts),
 * under the box that carries `id`. Feedback for older text stays,
 * dimmed, until the next answer. */
export function templateBelow(spec: TemplateSpec, id: string): TemplateResult {
  return templateFeedback({
    feedback: spec.text ? spec.feedback : undefined,
    stale: spec.stale,
    id,
    note: spec.text ? (spec.note ?? nothing) : nothing,
    resultExtra: spec.resultExtra,
    errorExtra: spec.errorExtra,
    onFix: (from, to) => spec.onInput(replaceEntity(spec.text, from, to)),
  });
}

/** Whether anything shows under the box for `spec`. */
export function hasNote(spec: TemplateSpec): boolean {
  return !!spec.text && (!!spec.feedback || (spec.note !== undefined && spec.note !== nothing));
}

/** The Jinja editor (code-editor/element.ts) in the form, with the
 * preview's errors underlined in it, what the last preview said under
 * it, and Expand to its workspace. Its underlines go while the feedback
 * is for older text. */
export function templateEditor(spec: TemplateSpec): TemplateResult {
  return html`<aivi-template-box
      .value=${spec.text}
      .address=${spec.address}
      .label=${spec.label}
      .hass=${spec.hass}
      .editor=${spec.editor}
      .describedby=${hasNote(spec) ? spec.noteId : null}
      .marks=${spec.stale ? [] : templateMarks(spec.text, spec.feedback)}
      .noteId=${spec.noteId}
      .below=${(id: string) => templateBelow(spec, id)}
      .onInput=${spec.onInput}
      .onBlur=${spec.onBlur}
    ></aivi-template-box>`;
}
