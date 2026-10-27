// The live preview: a widget-shaped card resolving real state via
// aivi/preview, plus the collapsed "what will be pushed" JSON and the
// what's-missing line. The host carries class="pcard".
//
// The preview DOM (an imperative tree from preview-render.ts) is memoized
// on payload identity, so validation-driven re-renders never rebuild it.
//
// The canvas is also an index into the form:
//
// - Paint is the renderers' tree plus a `data-slot-on` attribute written in
//   updated(); the outline is CSS on the existing region, not an overlay,
//   so nothing here measures geometry (the canvas's `transform: scale()`
//   doesn't matter).
// - Hit is one delegated click on the stage: `closest('[data-slot]')`
//   resolves the region and hands its id to the editor. Each region is
//   also a button for the keyboard (tabindex, role and a label written
//   beside the paint attribute; Enter/Space press it), which changes
//   nothing about how the mock looks.
//
// Pressing a region scrolls to and flashes the fields that paint it; it
// never filters the form. Filtering would re-parent form rows, which makes
// Lit recycle inputs across unrelated fields.
//
// Every region keeps a rectangle even when empty (preview-render's
// `ghost`), so the canvas covers the whole template.
//
// A widget is drawn at one of two sizes, Small or Medium, picked with the
// switch in the title row. The choice is kept per template on the panel
// (a session, not a setting); until one is made, a template opens at the
// size that shows what it configures.

import { html, LitElement, nothing } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { bandRange } from "./bands";
import { colorHex } from "./const";
import { define } from "./define";
import { t, tSplit } from "./i18n";
import { icon } from "./icons";
import { fieldName } from "./layout";
import { note } from "./notice";
import { previewActivity } from "./preview/activity";
import { bandReadings, bandsByEntity, type PreviewAs } from "./preview-as";
import { defaultPreviewSize, type PreviewSize, previewWidget } from "./preview-render";
import { segmented } from "./segmented";
import { slotById, slotsForField } from "./slots";
import type { Waiting, WidgetContent } from "./types/content";
import type { EditorState } from "./types/editor";
import type { HassLike } from "./types/hass";
import { labelFor } from "./util";
import { waitingLine } from "./waiting";

/** What the skeleton is drawn from: content with nothing in it. One
 * object, so the memoized tree is built once. */
const SKELETON: WidgetContent = {};

export class AiviPreviewPane extends LitElement {
  static override properties = {
    editorState: { attribute: false },
    rev: { attribute: false },
    missing: { attribute: false },
    blocked: { attribute: false },
    hot: { attribute: false },
    hass: { attribute: false },
  };
  declare editorState: EditorState;
  /** Bumped by the editor whenever a new preview payload lands. */
  declare rev: number;
  /** Comma-joined list of unmet requirements, empty when saveable. */
  declare missing: string;
  /** Comma-joined required fields whose template hard-errors (they block
   * Save), empty when none. */
  declare blocked: string;
  /** Slots to outline: the regions the focused (or just-pressed) field
   * paints. A field can feed several (activity `progress` is the island
   * ring and the banner bar). */
  declare hot: string[];
  /** For "Preview as": the readings colors follow, and their units. */
  declare hass: HassLike | undefined;

  /** Set by the editor: draw the widget as if an entity read a value in
   * one of its bands, or (undefined) as it is. */
  onPreviewAs: (as: PreviewAs | undefined) => void = () => {};

  /** Set by the editor; called with the slot id under the pointer, or
   * null for a press that landed on no region, and whether the press
   * came from the keyboard. */
  onSlotPress: (id: string | null, keyboard?: boolean) => void = () => {};

  /** The choices of a pane mounted outside a panel; in the app they live
   * on the panel, which outlives the editor. */
  private _ownSizes = new Map<string, PreviewSize>();

  private get _sizes(): Map<string, PreviewSize> {
    return this.closest<AiviEditor>("aivi-editor")?.panel?.previewSizes ?? this._ownSizes;
  }

  /** The size the open template's widget is drawn at. */
  get size(): PreviewSize {
    return (
      this._sizes.get(this.editorState.template) ?? defaultPreviewSize(this.editorState.template)
    );
  }

  private _setSize(size: PreviewSize): void {
    this._sizes.set(this.editorState.template, size);
    this.requestUpdate();
  }

  private _node: HTMLElement | null = null;
  private _nodeFor: unknown = null;
  private _nodeMeta = "";

  constructor() {
    super();
    this.rev = 0;
    this.missing = "";
    this.blocked = "";
    this.hot = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Runs after every update because the memoized tree survives
   * re-renders: Lit does not own the attribute, so it is synced here. */
  protected override updated(): void {
    for (const el of this._node?.querySelectorAll<HTMLElement>("[data-slot]") ?? []) {
      const id = el.dataset["slot"];
      if (id && this.hot.includes(id)) el.setAttribute("data-slot-on", "");
      else el.removeAttribute("data-slot-on");
      if (!id || el.hasAttribute("role")) continue;
      // A region is a button that leads to its settings: reachable and
      // named for the keyboard and a screen reader. A region inside
      // another (the budget ring in its total line) stays pointer-only:
      // buttons don't nest, and the outer one leads to the same card.
      if (el.parentElement?.closest("[data-slot]")) continue;
      const slot = slotById(this.editorState.kind, this.editorState.template, id);
      const field = slot?.fields[0];
      if (!field) continue;
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", t("preview.region-label", { region: labelFor(field) }));
    }
  }

  private _onStageKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const target = ev.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-slot][role=button]")) return;
    ev.preventDefault(); // Space would scroll the page
    this.onSlotPress(this._pressed(target.dataset["slot"] ?? null), true);
  }

  private _onStageClick(ev: Event): void {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const region = target.closest<HTMLElement>("[data-slot]");
    this.onSlotPress(this._pressed(region?.dataset["slot"] ?? null));
  }

  /** The region a press leads to: while the content waits on a field,
   * the one that field paints, wherever the press landed. */
  private _pressed(id: string | null): string | null {
    const field = this._waiting()?.field;
    if (!field) return id;
    const { kind, template } = this.editorState;
    return slotsForField(kind, template, field)[0]?.id ?? id;
  }

  private _label(key: string): string {
    return fieldName(key, this.editorState.template, this.editorState.kind);
  }

  /** What the content waits on, the field's name in bold. */
  private _waitingLine(): unknown {
    const waiting = this._waiting();
    if (!waiting) return nothing;
    return note("warn", waitingLine(waiting, this.editorState.template, this.editorState.kind));
  }

  override render(): unknown {
    const [before, after] = tSplit("preview.missing", "fields");
    const [bBefore, bAfter] = tSplit("editor.template-error-blocks", "fields");
    // The missing/blocked lines are polite live regions (they change only
    // when the set of unmet requirements does); the preview card is
    // not live, since it re-renders on every preview
    // round-trip and would spam a reader.
    return html`<div class="phead"><h3>${t("preview.title")}</h3>${
      this.editorState.kind === "widget"
        ? segmented(
            [
              { id: "small", label: t("preview.size-small") },
              { id: "medium", label: t("preview.size-medium") },
            ],
            this.size,
            (id) => this._setSize(id === "medium" ? "medium" : "small"),
            t("preview.size-label"),
          )
        : nothing
    }</div>${this._body()}${this._previewAs()}${this._payload()}<div class="missing" role="status">${
      this.missing ? html`${before}<b>${this.missing}</b>${after}` : this._waitingLine()
    }</div><div class="missing blocked" role="status">${
      this.blocked ? html`${bBefore}<b>${this.blocked}</b>${bAfter}` : nothing
    }</div>`;
  }

  private _body(): unknown {
    const editorState = this.editorState;
    if (editorState.preview === undefined) {
      this._node = null;
      return html`<div class="pv-empty">${t("preview.resolving")}</div>`;
    }
    // Nothing resolvable yet (required fields unbound, or offline): draw
    // the widget's skeleton, every region a labeled placeholder, so the
    // preview can lead to the fields from the first moment.
    const content = editorState.preview ?? SKELETON;
    const size = this.size;
    const meta = `${editorState.kind}|${editorState.template}|${editorState.name}|${size}`;
    if (!this._node || this._nodeFor !== content || this._nodeMeta !== meta) {
      this._node =
        editorState.kind === "activity"
          ? previewActivity(
              editorState.template,
              editorState.name || t("common.live-activity"),
              content,
            )
          : previewWidget(editorState.template, editorState.name, content, size);
      this._nodeFor = content;
      this._nodeMeta = meta;
    }
    const waiting = this._waiting()?.field;
    return html`<div class=${`pv-stage${editorState.preview ? "" : " is-skeleton"}`} @click=${(ev: Event) => this._onStageClick(ev)} @keydown=${(ev: KeyboardEvent) => this._onStageKeydown(ev)}><div class="fhint pv-hint">${
      editorState.preview
        ? t("preview.press-hint")
        : waiting
          ? t("preview.waiting-hint", { field: this._label(waiting) })
          : t("preview.skeleton-hint")
    }</div>${this._node}</div>`;
  }

  /** What the content waits on: a field that is filled in but has
   * nothing to read. Not while something is still to be set, which the
   * missing line says. */
  private _waiting(): Waiting | null {
    const editorState = this.editorState;
    if (editorState.preview !== null || this.missing) return null;
    return editorState.waiting ?? null;
  }

  /** One chip per band of each reading colors follow by value, and Now:
   * pressed, the widget is drawn as if the entity read a value inside
   * that band. */
  private _previewAs(): unknown {
    const editorState = this.editorState;
    const states = this.hass?.states ?? {};
    const sets = bandsByEntity(editorState.bindings ?? {});
    if (!sets.length) return nothing;
    const as = editorState.previewAs;
    const chip = (label: unknown, on: boolean, next: PreviewAs | undefined, dot?: string) =>
      html`<button type="button" class=${`fchip${on ? " on" : ""}`} aria-pressed=${on ? "true" : "false"}
        @click=${() => this.onPreviewAs(next)}
      >${dot ? html`<span class="pvasdot" style=${`background:${colorHex(dot) ?? "#888"}`}></span>` : nothing}${label}</button>`;
    return html`<div class="pvas" role="group" aria-label=${t("preview.as")}><span class="k">${t("preview.as")}</span>${sets.map(
      (bands) => {
        const e = states[bands.entity];
        const unit = e?.attributes["unit_of_measurement"];
        const readings = bandReadings(bands, e);
        const live = as?.entity !== bands.entity || as.band >= readings.length;
        return html`<div class="fchips">${
          sets.length > 1
            ? html`<span class="pvasname">${e?.attributes.friendly_name || bands.entity}</span>`
            : nothing
        }${chip(t("preview.as-now"), live, undefined)}${bands.values.map((color, band) =>
          chip(
            bandRange(bands, band, typeof unit === "string" ? unit : ""),
            !live && as?.band === band,
            { entity: bands.entity, band },
            bands.mixed ? undefined : color,
          ),
        )}</div>`;
      },
    )}</div>`;
  }

  private _payload(): unknown {
    const preview = this.editorState.preview;
    if (preview == null) return nothing;
    // A disclosure that looks like one: a chevron, a row to press, and the
    // kit's hover and focus.
    return html`<details class="payload"><summary><span class="tri" aria-hidden="true">${icon("chevron-right")}</span><span>${t("preview.payload-title")}</span></summary><pre>${JSON.stringify(preview, null, 2)}</pre></details>`;
  }
}

define("aivi-preview-pane", AiviPreviewPane);
