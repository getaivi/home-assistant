// The bar section of a progress editor, mode-first: a bar style radiogroup
// (Solid | Segmented, plus Layered on activity surfaces) with only the
// active mode's settings below it. Solid owns bar_color; the segments modes
// own a direct-manipulation bar rendered with the preview's own helpers
// (segments-bar.ts), so the editor bar and the preview never disagree.
//
// The mode is UI state (bar-mode.ts), derived from the stored shape until
// the user picks one, never stored. Switching is non-destructive within a
// session (phases survive a detour through Solid); preview and save only
// see the active mode's data.
//
// The bar is three layers:
// - Paint: capsules from the shared helpers plus an editor-only color hint.
//   Capsules are buttons (aria-pressed) but never handle pointers.
// - Hit: one invisible overlay (.seghit) owns every pointer event; its
//   drag logic is seam-drag.ts.
// - Adornment: seam handles, selection ring and labels, pointer-events: none.
//   The handles are the keyboard surface (role="slider", roving tabindex):
//   Left/Right nudge 1% (Shift 5%), Home/End jump to the range ends,
//   Up/Down rove between handles, Escape cancels a pointer drag. Moves are
//   announced via a polite live region.
//
// Every number the section shows or speaks (capsule names, announcements,
// the slider's value, a literal phase's Size) is a share of the bar as it
// renders. With a sourced phase those shares come from the preview, which
// lags an edit by a debounce and a round trip, so after an edit the editor
// works from what it just stored until a preview newer than the edit
// answers (segment-shares.ts). A sourced phase's Fallback field is the one
// stored figure, and is named as such; its source controls are
// segment-source.ts.
//
// An action that rebuilds part of the section puts the focus on the
// nearest control that survives it (_focusNext), never on the page.
//
// The user manipulates thresholds (cumulative %); the binding stores
// normalized weights (segments.ts), which the backend re-normalizes and
// quantizes to 1024ths, so what reads 60/25/15 saves as 60/25/15.
// Labels render below the bar, as the device's labels row does, and only on
// activity surfaces: widgets never render segment labels on-device.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { AiviEditor } from "./aivi-editor";
import { BAR_COLOR_KEY, barModes } from "./bar-mode";
import { sources } from "./const";
import { define } from "./define";
import { t } from "./i18n";
import { SeamDrag } from "./seam-drag";
import { type BarMetrics, barMetrics, seamLeftCss } from "./seam-geometry";
import { SegmentShares } from "./segment-shares";
import { sourceBody, sourceFeedback, sourceName } from "./segment-source";
import { segmented } from "./segmented";
import {
  bestSplitIndex,
  boundariesOf,
  boundaryRange,
  carriedFractions,
  fractionsOf,
  isSeed,
  isSourced,
  MIN_FRACTION,
  moveBoundary,
  nextColor,
  parsePercent,
  pct,
  percentages,
  removeSegment,
  seedSegments,
  setSize,
  sizeText,
  splitSegment,
} from "./segments";
import {
  type BarSegmentGeometry,
  barGeometry,
  capsuleStyle,
  fillStyle,
  labelsRow,
  layeredRadius,
} from "./segments-bar";
import { asSegments, asString, type SegmentBinding } from "./types/bindings";
import type { BarMode } from "./types/editor";
import type { FieldMeta } from "./types/meta";
import { enumLabel, labelFor } from "./util";
import { segmentMode, setSegmentMode } from "./value-source";

const BAR_HEIGHT = 28;
const SPLIT_GAP = 6;

export class AiviSegmentsEditor extends LitElement {
  static override properties = {
    editor: { attribute: false },
    field: { attribute: false },
    _sel: { state: true },
    _focusB: { state: true },
    _announce: { state: true },
  };
  declare editor: AiviEditor;
  declare field: FieldMeta;
  /** Selected segment (inline editor target); -1 = none. */
  declare private _sel: number;
  /** Roving tab stop among the boundary handles. */
  declare private _focusB: number;
  declare private _announce: string;

  /** Re-keys the inline editor after non-typing mutations; typing never
   * bumps it, so re-renders never clobber what the user is typing. */
  private _gen = 0;

  private readonly _shares = new SegmentShares(this);

  /** Picks the element to focus once the pending render has rebuilt the
   * part of the section the focus was in. */
  private _focusNext: (() => HTMLElement | null | undefined) | null = null;

  /** The fill color the phases were seeded from, in which editing
   * session; while they are still that seed they follow the fill color. */
  private _seed: { editorState: object; color: string | null } | null = null;

  constructor() {
    super();
    this._sel = -1;
    this._focusB = 0;
    this._announce = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  get list(): SegmentBinding[] {
    return asSegments(this.editor.editorState.bindings[this.field.key]);
  }

  private get _max(): number {
    return this.field.max ?? 4;
  }

  private _colors(): string[] {
    return this.field.colors ?? this.editor.panel.meta.colors;
  }

  private _mode(): BarMode {
    return this.editor.barMode();
  }

  private _layered(): boolean {
    return this._mode() === "layered";
  }

  private _name(s: SegmentBinding | undefined, i: number): string {
    return s?.label || t("segments.phase", { index: i + 1 });
  }

  protected override updated(): void {
    const pick = this._focusNext;
    if (!pick) return;
    this._focusNext = null;
    pick()?.focus();
  }

  /** Whole percentages of the phases' shares as the bar shows them. */
  sharePercents(): number[] {
    return this._pcts(this.list);
  }

  /** Whole percentages of the shown shares, summing to 100. */
  private _pcts(list: SegmentBinding[]): number[] {
    return percentages(this._shares.of(list));
  }

  /** Whether the focus is inside this section's element matching `sel`. */
  private _focusIn(sel: string): boolean {
    const active = (this.getRootNode() as Document | ShadowRoot).activeElement;
    return !!active && this.contains(active) && !!active.closest(sel);
  }

  private _capsule(i: number): HTMLElement | undefined {
    return this.querySelectorAll<HTMLElement>(".segcap")[i];
  }

  private _commit(next: SegmentBinding[]): void {
    const b = this.editor.editorState.bindings;
    this._shares.follow(next);
    if (next.length) b[this.field.key] = next;
    else {
      // No phases means Solid: the mode goes back to following the data.
      delete b[this.field.key];
      delete b[`${this.field.key}__display`];
      this.editor.editorState.barMode = undefined;
      this._sel = -1;
    }
    this.editor.schedulePreview();
    this.requestUpdate();
  }

  /** Typing path: updates one segment without re-keying. */
  patch(i: number, up: (s: SegmentBinding) => void): void {
    const next = this.list.map((s) => ({ ...s }));
    const target = next[i];
    if (!target) return;
    up(target);
    this._commit(next);
  }

  private _modeLabel(mode: BarMode): string {
    return t(
      mode === "solid"
        ? "bar.mode-solid"
        : mode === "segmented"
          ? "bar.mode-segmented"
          : "bar.mode-layered",
    );
  }

  /** Non-destructive: the inactive mode's bindings stay for the session
   * and are pruned by preview/save. Entering a segments mode with nothing
   * stored seeds two phases from the current fill color; seeded phases
   * nobody has touched are seeded again when that color has changed
   * since, so they never pin the color of the first visit. */
  private _setMode(next: BarMode): void {
    const editorState = this.editor.editorState;
    editorState.barMode = next;
    if (next !== "solid") {
      const color = asString(editorState.bindings[BAR_COLOR_KEY]);
      const list = this.list;
      const seed = this._seed?.editorState === editorState ? this._seed : null;
      const untouched = !!seed && seed.color !== color && isSeed(list, seed.color);
      if (!list.length || untouched) {
        editorState.bindings[this.field.key] = seedSegments(color);
        this._seed = { editorState, color };
        this._shares.drop();
        this._sel = 0;
      }
    }
    this._gen++;
    this._announce = t("bar.mode-announced", { mode: this._modeLabel(next) });
    this.editor.schedulePreview();
    this.requestUpdate();
  }

  /** The "+" keeps the focus while it stays; the press that reaches the
   * cap removes it, and the focus goes to the phase it added. */
  private _add(): void {
    const list = this.list;
    const at = bestSplitIndex(list);
    if (at < 0) return;
    this._split(at, list.length + 1 >= this._max);
  }

  /** Whether a phase is too thin to halve (under twice the minimum
   * share); splitting one announces that instead of doing nothing. */
  private _tooThin(list: SegmentBinding[], i: number): boolean {
    return (fractionsOf(list)[i] ?? 0) < 2 * MIN_FRACTION;
  }

  private _split(i: number, focusNew = true): void {
    const list = this.list;
    if (this._tooThin(list, i)) {
      this._announce = t("segments.split-too-thin", {
        name: this._name(list[i], i),
      });
      return;
    }
    const next = splitSegment(list, i, nextColor(list, this._colors()), this._max);
    if (next.length === list.length) return;
    this._sel = i + 1;
    this._gen++;
    // The inline editor (and with it Split) is rebuilt for the new phase.
    if (focusNew) this._focusNext = () => this._capsule(i + 1);
    this._shares.hold(next, fractionsOf(next));
    this._announce = t("segments.added", {
      name: this._name(next[i + 1], i + 1),
      count: next.length,
      max: this._max,
    });
    this._commit(next);
  }

  private _remove(i: number): void {
    const list = this.list;
    const gone = this._name(list[i], i);
    const j = i > 0 ? i - 1 : i + 1;
    const neighbor = list.length > 1 ? this._name(list[j], j) : "";
    this._sel = -1;
    this._gen++;
    this._announce = neighbor
      ? t("segments.removed", { name: gone, neighbor })
      : t("segments.removed-last", { name: gone });
    const next = removeSegment(list, i);
    // Remove goes away with the inline editor: the focus moves to the phase
    // that absorbed the space, or to the bar style once none is left.
    this._focusNext = () =>
      next.length
        ? this._capsule(Math.max(0, i - 1))
        : this.querySelector<HTMLElement>(".barmode [role=radio][tabindex='0']");
    this._shares.hold(next, fractionsOf(next));
    this._commit(next);
  }

  private _select(i: number): void {
    this._sel = this._sel === i ? -1 : i;
    this._gen++;
  }

  private _handles(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>(".seghandle")];
  }

  /** Speaks the two phases around boundary `i` in the shares the bar
   * shows, the numbers their capsules are named with. */
  private _announceBoundary(next: SegmentBinding[], i: number): void {
    const pcts = this._pcts(next);
    this._announce = t("segments.boundary-at", {
      left: this._name(next[i], i),
      leftPct: pcts[i] ?? 0,
      right: this._name(next[i + 1], i + 1),
      rightPct: pcts[i + 1] ?? 0,
    });
  }

  /** Boundary `i` moved to `threshold` within the shown shares `shown`,
   * which the bar keeps showing (moved) until the preview catches up. */
  private _moveTo(i: number, threshold: number, shown: number[]): void {
    const next = moveBoundary(this.list, i, threshold, shown);
    this._shares.hold(next, carriedFractions(next, shown));
    this._gen++;
    this._commit(next);
    this._announceBoundary(next, i);
  }

  private _nudge(i: number, threshold: number): void {
    this._moveTo(i, threshold, this._shares.of(this.list));
  }

  /** Segment `i` sized to `size`: a share of the bar as shown, or for a
   * sourced segment its stored fallback weight. */
  private _resize(i: number, size: number): void {
    const list = this.list;
    const shown = this._shares.of(list);
    const next = setSize(list, i, size, shown);
    this._shares.hold(next, carriedFractions(next, shown));
    this._commit(next);
  }

  /** The size the Size field stands for: the shown share, or a sourced
   * segment's stored fallback. */
  private _size(list: SegmentBinding[], i: number): number {
    const s = list[i];
    const fracs = s && isSourced(s) ? fractionsOf(list) : this._shares.of(list);
    return fracs[i] ?? 0;
  }

  /** The field was committed (blur or Enter): apply it once more, with
   * zero and negatives clamped to the minimum, then make the field show
   * what was applied and announce it when that is not what was typed. */
  private _sizeChanged(input: HTMLInputElement, i: number): void {
    const typed = parsePercent(input.value);
    if (typed !== null) this._resize(i, typed / 100);
    const list = this.list;
    const applied = this._size(list, i);
    if (typed !== null && Math.abs(typed / 100 - applied) < 5e-4) return;
    input.value = sizeText(applied);
    this._announce = t("segments.size-applied", {
      name: this._name(list[i], i),
      pct: sizeText(applied),
    });
  }

  /** Whether boundary `i` follows a live source (either neighbor is
   * sourced): it renders, but never drags or nudges. */
  private _locked(list: SegmentBinding[], i: number): boolean {
    const left = list[i];
    const right = list[i + 1];
    return (!!left && isSourced(left)) || (!!right && isSourced(right));
  }

  private _onHandleKey(e: KeyboardEvent, i: number): void {
    const list = this.list;
    if (e.key === "Escape") {
      // The handle cancels a pointer drag only while one is in progress;
      // otherwise the key is left to whatever encloses the editor.
      if (this._seams.seam === null) return;
      this._seams.cancel();
      this._announceBoundary(list, i);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Left/Right change the value, so the vertical arrows rove.
      const handles = this._handles();
      const next = (i + (e.key === "ArrowDown" ? 1 : -1) + handles.length) % handles.length;
      this._focusB = next;
      handles[next]?.focus();
      e.preventDefault();
      return;
    }
    // A locked (aria-disabled) boundary only supports roving.
    if (this._locked(list, i)) return;
    const fracs = this._shares.of(list);
    const bounds = boundariesOf(list, fracs);
    const at = bounds[i] ?? 0;
    const [lo, hi] = boundaryRange(list, i, fracs);
    const step = e.shiftKey ? 0.05 : 0.01;
    switch (e.key) {
      case "ArrowRight":
        this._nudge(i, at + step);
        break;
      case "ArrowLeft":
        this._nudge(i, at - step);
        break;
      case "Home":
        this._nudge(i, lo);
        break;
      case "End":
        this._nudge(i, hi);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  /** The bar's measured frame (off .segbar, which hosts all three layers),
   * or null when there is none; the hit layer is inert without one. */
  private _metrics(list: SegmentBinding[]): BarMetrics | null {
    const bar = this.querySelector<HTMLElement>(".segbar");
    if (!bar) return null;
    const rect = bar.getBoundingClientRect();
    const gap = this._layered() ? 0 : SPLIT_GAP;
    return barMetrics(rect.left, rect.width, gap, list.length);
  }

  private readonly _seams = new SeamDrag({
    list: () => this.list,
    fracs: (list) => this._shares.of(list),
    metrics: (list) => this._metrics(list),
    locked: (list, seam) => this._locked(list, seam),
    focusSeam: (seam) => {
      this._focusB = seam;
      this._handles()[seam]?.focus();
    },
    dropSeam: (seam, threshold, fracs) => this._moveTo(seam, threshold, fracs),
    tapCapsule: (capsule) => this._select(capsule),
    requestUpdate: () => this.requestUpdate(),
  });

  override render(): unknown {
    const mode = this._mode();
    return html`${this._modeControl(mode)}${
      mode === "solid" ? this._solid() : this._segments()
    }<span class="sr-only" role="status"
      >${this._announce}</span>`;
  }

  private _modeControl(mode: BarMode): TemplateResult {
    // The field's own label names the bar; the switch is named for
    // assistive tech only.
    return html`<div class="barmode">${segmented(
      barModes(this.editor.editorState.kind).map((m) => ({
        id: m,
        label: this._modeLabel(m),
      })),
      mode,
      (m) => this._setMode(m as BarMode),
      t("bar.mode-label"),
    )}</div><div class="fhint">${t(
      mode === "solid"
        ? "bar.mode-caption-solid"
        : mode === "segmented"
          ? "bar.mode-caption-segmented"
          : "bar.mode-caption-layered",
    )}</div>`;
  }

  private _solid(): TemplateResult {
    const b = this.editor.editorState.bindings;
    return html`<div class="ctl"><span class="k">${labelFor(BAR_COLOR_KEY)}</span><aivi-color-field
        class="cfield"
        .colors=${this._colors()}
        .label=${labelFor(BAR_COLOR_KEY)}
        .value=${asString(b[BAR_COLOR_KEY]) ?? null}
        .onChange=${(c: string | null) => {
          if (c) b[BAR_COLOR_KEY] = c;
          else delete b[BAR_COLOR_KEY];
          this.editor.schedulePreview();
          this.requestUpdate();
        }}
      ></aivi-color-field></div>`;
  }

  private _segments(): unknown {
    const list = this.list;
    if (!list.length) return nothing;
    const sel = this._sel >= 0 && this._sel < list.length ? this._sel : -1;
    return html`${this._bar(list)}${
      sel >= 0 ? keyed(`${sel}:${this._gen}`, this._inline(list, sel)) : nothing
    }`;
  }

  private _bar(list: SegmentBinding[]): TemplateResult {
    const layered = this._layered();
    const gap = layered ? 0 : SPLIT_GAP;
    // Mid-drag the unquantized draft overrides the display fractions.
    const fracs = this._seams.draft ?? this._shares.of(list);
    // The configurator shows the phases, each in its own color from end
    // to end; the live preview shows how far the bar has got. A
    // half-filled phase here would read as two phases.
    const geometry = barGeometry({
      value: 1,
      segments: list.map((s, i) => ({ ...s, value: fracs[i] ?? 0 })),
    });
    const pcts = percentages(fracs);
    const radius = (i: number): string =>
      layered ? layeredRadius(i, list.length, BAR_HEIGHT) : `${BAR_HEIGHT / 2}px`;
    // Capsules are buttons for selection semantics and keyboard activation,
    // but pointer-events: none; taps arrive via the hit overlay.
    const capsule = (s: SegmentBinding, i: number): TemplateResult => {
      const g: BarSegmentGeometry = geometry[i] ?? { frac: 0, fill: 0 };
      const sourced = isSourced(s);
      // Subtle tint only; the inline note carries the message.
      const broken = sourced && sourceFeedback(this, s, i)?.status === "error";
      return html`<button
        type="button"
        class=${
          "segcap" +
          (this._sel === i ? " sel" : "") +
          (sourced ? " src" : "") +
          (broken ? " srcerr" : "")
        }
        style=${capsuleStyle(s, g.frac, BAR_HEIGHT, radius(i))}
        aria-label=${
          sourced
            ? t("segments.segment-live-aria", {
                name: this._name(s, i),
                pct: pcts[i] ?? 0,
                source: sourceName(s),
              })
            : t("segments.segment-aria", {
                name: this._name(s, i),
                pct: pcts[i] ?? 0,
              })
        }
        aria-pressed=${this._sel === i ? "true" : "false"}
        @click=${() => this._select(i)}
      ><i style=${fillStyle(1, s)}></i></button>`;
    };
    // Only activities render labels on-device. The muted theme color
    // stands in for the banner's 60% white, as this bar sits on the panel.
    const labels =
      this.editor.editorState.kind === "activity"
        ? labelsRow(
            { segments: list.map((s, i) => ({ ...s, value: fracs[i] ?? 0 })) },
            layered ? 0 : 2,
            "var(--aivi-muted)",
          )
        : null;
    // Handle i marks the seam between capsules i and i+1, positioned by
    // the same formula the hit layer resolves against.
    const bounds = boundariesOf(list, fracs);
    const stop = Math.min(this._focusB, list.length - 2);
    const lockNote = `${this.field.key}-seglock`;
    let anyLocked = false;
    const handle = (i: number): TemplateResult => {
      const [lo, hi] = boundaryRange(list, i, fracs);
      const at = bounds[i] ?? 0;
      // Next to a sourced segment: follows the source, aria-disabled.
      const locked = this._locked(list, i);
      anyLocked = anyLocked || locked;
      return html`<div
        class=${`seghandle${locked ? " locked" : ""}${this._seams.seam === i ? " dragging" : ""}`}
        role="slider"
        tabindex=${i === stop ? "0" : "-1"}
        style=${`left:${seamLeftCss(at, i, gap, list.length)}`}
        aria-label=${t("segments.boundary-aria", {
          left: this._name(list[i], i),
          right: this._name(list[i + 1], i + 1),
        })}
        aria-disabled=${locked ? "true" : nothing}
        aria-describedby=${locked ? lockNote : nothing}
        title=${locked ? t("segments.boundary-locked") : nothing}
        aria-valuemin=${pct(lo)}
        aria-valuemax=${pct(hi)}
        aria-valuenow=${pct(at)}
        aria-valuetext=${`${pct(at)}%`}
        @keydown=${(e: KeyboardEvent) => this._onHandleKey(e, i)}
      ></div>`;
    };
    const handles = list.slice(0, -1).map((_, i) => handle(i));
    const hit = html`<div
      class="seghit"
      aria-hidden="true"
      @pointerdown=${(e: PointerEvent) => this._seams.down(e)}
      @pointermove=${(e: PointerEvent) => this._seams.move(e)}
      @pointerup=${(e: PointerEvent) => this._seams.up(e)}
      @pointercancel=${() => this._seams.cancel()}
    ></div>`;
    return html`<div class="segbarrow"><div class="segcol"><div
        class="segbar"
        role="group"
        aria-label=${t("segments.bar-label")}
        style=${`gap:${gap}px;height:${BAR_HEIGHT}px`}
      >${list.map(capsule)}${handles}${hit}</div>${labels}</div>${
        list.length < this._max
          ? html`<button
            type="button"
            class="segadd"
            aria-label=${t("segments.add")}
            title=${t("segments.add")}
            @click=${() => this._add()}
          >+</button>`
          : nothing
      }</div>${
        anyLocked
          ? html`<span id=${lockNote} class="sr-only"
          >${t("segments.boundary-locked")}</span>`
          : nothing
      }`;
  }

  private _colorSel(
    value: string | null,
    onChange: (c: string | null) => void,
    label: string,
    noneLabel?: string,
  ): TemplateResult {
    return html`<select
      aria-label=${label}
      @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value || null)}
    >${noneLabel ? html`<option value="">${noneLabel}</option>` : nothing}${this._colors().map(
      (c) => html`<option value=${c} ?selected=${value === c}>${enumLabel("color", c)}</option>`,
    )}</select>`;
  }

  /** Inline editor for the selected segment. The Label input is activity
   * only: widgets never render segment labels. Text inputs bind value as
   * an attribute (initial content only); non-typing mutations re-key the
   * block instead. */
  private _inline(list: SegmentBinding[], i: number): TemplateResult {
    const s = list[i];
    if (!s) return html``;
    const name = this._name(s, i);
    const mode = segmentMode(s);
    const sourced = mode !== "literal";
    // The same whole percent the capsule is named with; a fallback is a
    // share of the stored weights.
    const size = percentages(sourced ? fractionsOf(list) : this._shares.of(list))[i] ?? 0;
    const canSplit = list.length < this._max;
    const thin = this._tooThin(list, i);
    return html`<div class="seginline foldbody"><div class="ctl"><span class="k">${t("common.color")}</span><aivi-color-field
          class="cfield"
          .colors=${this._colors()}
          .label=${t("segments.fill-label")}
          .value=${s.fill_color ?? null}
          .clearable=${false}
          .onChange=${(c: string | null) => {
            // A fill color is required on the wire.
            if (c) this.patch(i, (seg) => (seg.fill_color = c));
          }}
        ></aivi-color-field></div>${
          this.field.sourced_values
            ? html`<div class="ctl"><span class="k">${t("segments.source")}</span>${segmented(
                [{ id: "literal", label: t("source.literal") }, ...sources()],
                mode,
                (next) => this._switchSegSource(i, next),
                t("segments.source-label", { name }),
              )}</div>${sourced ? sourceBody(this, i, s, name, mode) : nothing}`
            : nothing
        }<div class="ctl"><span class="k">${
          sourced ? t("segments.fallback") : t("segments.size")
        }</span><div class="ctlrow"><input
          type="text" class="pct" inputmode="decimal"
          aria-label=${sourced ? t("segments.fallback-label", { name }) : t("segments.size-label")}
          value=${String(size)}
          @input=${(e: Event) => {
            // Typing applies at once but never rewrites the field.
            const n = parsePercent((e.target as HTMLInputElement).value);
            if (n !== null && n > 0) this._resize(i, n / 100);
          }}
          @change=${(e: Event) => this._sizeChanged(e.target as HTMLInputElement, i)}
        /><span class="segbar-note">%</span></div>${
          sourced
            ? html`<div class="fhint">${t("segments.sourced-hint", {
                source: sourceName(s),
              })}</div>`
            : nothing
        }</div>${
          this.editor.editorState.kind === "activity"
            ? html`<div class="ctl"><span class="k">${t("field-label.label")}</span><input
          type="text" class="lbl" spellcheck="false"
          placeholder=${t("segments.label-placeholder")}
          aria-label=${t("segments.label-aria", { name })}
          value=${s.label ?? ""}
          @input=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value.trim();
            this.patch(i, (seg) => {
              if (v) seg.label = v;
              else delete seg.label;
            });
          }}
        /></div>`
            : nothing
        }<div class="ctl"><span class="k">${t("segments.track")}</span><div class="ctlrow">${this._colorSel(
          s.track_color ?? null,
          (c) => {
            this.patch(i, (seg) => {
              if (c) seg.track_color = c;
              else delete seg.track_color;
            });
          },
          t("segments.track-label"),
          t("segments.gray-default"),
        )}<select
          aria-label=${t("segments.track-style-label")}
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            this.patch(i, (seg) => {
              if (v !== "solid") seg.track_fill = v;
              else delete seg.track_fill;
            });
          }}
        >${(this.field.track_fills ?? ["solid", "hatched"]).map(
          (fill) =>
            html`<option value=${fill} ?selected=${(s.track_fill ?? "solid") === fill}>${enumLabel("track-fill", fill)}</option>`,
        )}</select></div></div><div class="segrow">${
          canSplit
            ? html`<button type="button" class="rm"
              aria-label=${t("segments.split-aria", { name })}
              aria-disabled=${thin ? "true" : nothing}
              title=${thin ? t("segments.split-too-thin", { name }) : nothing}
              @click=${() => this._split(i)}
            >${t("segments.split")}</button>`
            : nothing
        }<button type="button" class="rm"
          aria-label=${t("segments.remove-aria", { name })}
          @click=${() => this._remove(i)}
        >${t("common.remove")}</button></div></div>`;
  }

  /** Mirrors the scalar switch: the mode is carried by which marker key is
   * present (even empty); empty markers are pruned at save. The literal
   * `value` stays: it is the fallback weight, required in every mode. */
  private _switchSegSource(i: number, next: string): void {
    const keep = this.list[i]?.source ?? "";
    this._gen++;
    // The switch is rebuilt with the inline editor: when the focus was in
    // it, it goes to the newly checked option, so the arrow keys keep
    // working across the rebuild.
    if (this._focusIn(".seginline .seg"))
      this._focusNext = () =>
        this.querySelector<HTMLElement>(".seginline .seg [role=radio][aria-checked='true']");
    this.patch(i, (seg) => setSegmentMode(seg, next, keep));
  }
}

define("aivi-segments-editor", AiviSegmentsEditor);
