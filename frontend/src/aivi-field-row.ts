// One editor form field, as a row: the label at the leading edge, the
// control in the middle, and the field's source menu at the trailing edge
// of the form kit. A field whose control needs the full
// width (a list of rows, the bar editor) is a block: label line, then the
// control. Inside an inline group a field is "mini": a small label over a
// short control. The host carries class="field".
//
// The row lays the field out; its control comes from field-source.ts (a
// value read from an entity) or field-controls.ts (a value set here), and
// what dresses the value from field-style.ts.
//
// Focus discipline: text input mutates bindings in place
// and only refreshes preview/validation; structural DOM swaps happen only
// on discrete choices, which the `keyed` directive scopes to a change of
// source (the attribute menu alone re-keys on its entity, so the picker
// the entity was picked in keeps focus). Switching sources goes through
// value-source.ts, which remembers what each source held for the session.
// Text inputs bind their value as an *attribute* (initial content
// only), so in-place re-renders never touch what the user is typing.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { fieldHint } from "./const";
import { define } from "./define";
import { isBound } from "./editor-validation";
import { plainBody } from "./field-controls";
import { sourcedBody } from "./field-source";
import { iconRows, invertToggle, styleFold } from "./field-style";
import { FoldState } from "./form-kit";
import { t, tOpt } from "./i18n";
import { icon } from "./icons";
import { fieldNeeds } from "./layout";
import { type SlotSurface, surfaceLabel, surfacesForField } from "./slots";
import type { Bindings } from "./types/bindings";
import type { FieldMeta } from "./types/meta";
import { urlSuggestions } from "./url-suggestions";
import { labelFor } from "./util";
import { markerKey, slotMode } from "./value-source";

/** Kinds whose control needs the form's full width. */
const BLOCK_KINDS = new Set(["rows", "segments", "colors", "points"]);

export class AiviFieldRow extends LitElement {
  static override properties = {
    editor: { attribute: false },
    field: { attribute: false },
    label: { attribute: false },
    mini: { attribute: false },
  };
  declare editor: AiviEditor;
  declare field: FieldMeta;
  /** The label the row shows: shorter than the field's own inside a
   * titled group ("Value" under "Left column"). Controls keep the full
   * label as their accessible name. */
  declare label: string | null;
  /** Inside an inline group: a small label over a short control. */
  declare mini: boolean;

  /** The row's folds; a default is decided once per mounted row. */
  readonly folds = new FoldState();
  /** The source menu of the field itself, set while its body is built
   * and placed at the trailing edge of the row: the one position a
   * source control has, whatever the field. */
  headControl: unknown = nothing;

  constructor() {
    super();
    this.label = null;
    this.mini = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  get bindings(): Bindings {
    return this.editor.editorState.bindings;
  }

  protected override willUpdate(): void {
    this.classList.toggle("block", BLOCK_KINDS.has(this.field.kind ?? ""));
    this.classList.toggle("mini", this.mini);
  }

  override render(): unknown {
    const field = this.field;
    const label =
      this.label ??
      labelFor(field.key, this.editor?.editorState.template, this.editor?.editorState.kind);
    const idle = this._idle(field);
    this.headControl = nothing;
    const main = field.source ? sourcedBody(this, field) : plainBody(this, field, idle);
    if (this.mini) return html`<span class="k">${label}</span>${main}`;
    // A field that has its value needs no introduction: its hint
    // moves to the label's tooltip (an idle field keeps
    // showing what it waits for), and a control that only adjusts a value
    // (the sign flip) is shown once there is a value to adjust.
    const set = this.editor.isBound(field);
    const extras = field.source
      ? html`${field.invert && (set || this.bindings[`${field.key}__invert`] === true) ? invertToggle(this, field) : nothing}${
          field.color || field.formatter ? styleFold(this, field) : nothing
        }`
      : field.key === "tap_url"
        ? this._urlSuggestions(field)
        : nothing;
    const inTemplate =
      slotMode(this.bindings, field.key, field.source ? "entity" : "literal") === "template";
    const own = fieldHint(
      field.key,
      this.editor.editorState.template,
      inTemplate,
      this.editor.editorState.kind,
    );
    const hint = idle ? (tOpt(`field-idle.${field.key}`) ?? own) : own;
    const hintEl = hint
      ? html`<div class=${set && !idle ? "fhint settled" : "fhint"}>${hint}</div>`
      : nothing;
    const block = BLOCK_KINDS.has(field.kind ?? "");
    // A block's hint introduces its control; a row's hint sits under it.
    // The menu follows the control in the DOM, as it does on screen, so
    // the tab order reads control, source, then what unfolds below.
    return html`<div class="flab"><span class="flabel" title=${set && !idle && hint ? hint : nothing}>${label}</span>${
      field.required ? this._badge() : nothing
    }${this._placement()}</div>${
      block ? hintEl : nothing
    }<div class="fmain">${main}${block ? nothing : hintEl}</div><div class="fsrc">${this.headControl}</div>${
      extras === nothing ? nothing : html`<div class="fmain r2 wide">${extras}</div>`
    }${field.kind === "icon" ? iconRows(this, field) : nothing}`;
  }

  private _badge(): TemplateResult {
    const key = this.field.key;
    // A template that fails is set, but not done: the mark says so
    // where the check would be.
    if (
      this.bindings[markerKey(key, "template")] &&
      this.editor.editorState.fieldFeedback?.[key]?.status === "error"
    )
      return html`<span class="freq err" title=${t("field.badge-error")} aria-label=${t("field.badge-error")} role="img">${icon("alert-outline")}</span>`;
    const done = this.editor.isBound(this.field);
    // Filled in, but nothing to read right now: the content waits on it,
    // until a preview resolves.
    if (done && this.editor.editorState.waiting?.field === key)
      return html`<span class="freq warn" title=${t("field.badge-waiting")} aria-label=${t("field.badge-waiting")} role="img">${icon("alert-outline")}</span>`;
    return html`<span class=${`freq${done ? " done" : ""}`}>${done ? icon("check") : t("common.required")}</span>`;
  }

  /** Notes that this field also paints on a surface other than the
   * section it is filed under (e.g. activity `progress` also drives the
   * Dynamic Island ring): a small tag on the label, not a second hint. */
  private _placement(): unknown {
    const editorState = this.editor.editorState;
    const surfaces = surfacesForField(editorState.kind, editorState.template, this.field.key);
    if (surfaces.length < 2) return nothing;
    return html`<span class="ftag">${t("field.also-on", {
      surface: surfaceLabel(surfaces[surfaces.length - 1] as SlotSurface),
    })}</span>`;
  }

  /** Whether the field is a choice still waiting for what it chooses
   * between (layout.ts `fieldNeeds`): each needed set has nothing set. */
  private _idle(field: FieldMeta): boolean {
    const editorState = this.editor.editorState;
    const fields = this.editor.templateMeta()?.fields ?? [];
    return fieldNeeds(editorState.kind, editorState.template, field.key).some(
      (set) =>
        !set.some((key) => {
          const other = fields.find((f) => f.key === key);
          return !!other && isBound(other, editorState.bindings);
        }),
    );
  }

  /** Refreshed on every updateValidation pass; the input is
   * attribute-bound, so the re-render never disturbs typed text. */
  private _urlSuggestions(field: FieldMeta): TemplateResult {
    return urlSuggestions(this.editor.panel.hass, this.editor.boundEntityIds(), (url) => {
      const input = this.querySelector<HTMLInputElement>('input[type="text"]');
      if (input) input.value = url;
      this.bindings[field.key] = url;
      this.editor.schedulePreview();
      this.editor.updateValidation();
    });
  }
}

define("aivi-field-row", AiviFieldRow);
