// The gauge ring's color editor. The host carries class="ramp".
//
// - An explicit Solid | Ramp mode, derived from the stored shape and never
//   stored (the bar-mode.ts contract): one color is pushed as the solid
//   key, two or more as the gradient key. Switching to Solid remembers the
//   ramp for the session. Where the ring takes it, a third mode, By value:
//   one color by the band its reading falls in, drawn by the form
//   (aivi-bands-field) and stored as the ring's bands.
// - Presets, including the built-in cyan → green → orange an unset ring
//   renders.
// - An ordered stop list: each row moves with ▲▼ or Alt+Arrow, removes
//   itself, and picks its own color; duplicates are allowed. Reordering is
//   buttons and keys rather than drag because the list caps at four.
// - Each stop is labeled with where it lands in the gauge's units (the
//   device spreads stops evenly; see ramp.ts).

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { colorHex } from "./const";
import { define } from "./define";
import { i18nLocale, t } from "./i18n";
import { icon } from "./icons";
import {
  addStop,
  deriveRampMode,
  effectiveStops,
  formatStopValue,
  presetFor,
  presetLabel,
  pruneForRampMode,
  RAMP_MAX,
  RAMP_PRESETS,
  type RampMode,
  removeStop,
  reverseStops,
  setStop,
  stopFraction,
  stopValue,
  storedStops,
} from "./ramp";
import { moveItem } from "./reorder";
import { segmented } from "./segmented";
import { enumLabel } from "./util";

export class AiviColorRamp extends LitElement {
  static override properties = {
    colors: { attribute: false },
    value: { attribute: false },
    maxStops: { attribute: false },
    label: { attribute: false },
    rangeMin: { attribute: false },
    rangeMax: { attribute: false },
    unit: { attribute: false },
    byValue: { attribute: false },
    onByValue: { attribute: false },
    byValueOn: { attribute: false },
    onChange: { attribute: false },
    _mode: { state: true },
    _open: { state: true },
    _announce: { state: true },
  };
  declare colors: string[];
  declare value: string[];
  declare maxStops: number;
  /** Accessible name for the whole control (the field's label). */
  declare label: string | null;
  /** The gauge's range, for the per-stop value labels (0..1 when unset). */
  declare rangeMin: number;
  declare rangeMax: number;
  /** The gauge's unit, when it is a plain literal. Absent when it is
   * templated or entity-sourced, since a stop label must not invent one. */
  declare unit: string | null;
  declare onChange: (stops: string[] | null) => void;
  /** The one color by value, drawn by the form while it is chosen
   * (aivi-bands-field); null where the ring takes no bands. */
  declare byValue: unknown;
  /** Whether the ring's one color follows a reading by value; undefined
   * where it cannot. Chosen or left with `onByValue`. */
  declare onByValue: ((on: boolean) => void) | null;
  declare byValueOn: boolean;

  /** The user's explicit mode for this session; undefined = follow the
   * data, so a programmatic change (an applied suggestion, its undo) is
   * reflected. */
  declare private _mode: RampMode | undefined;
  /** Which stop's palette is expanded; -1 for none. */
  declare private _open: number;
  declare private _announce: string;

  /** The multi-stop ramp as it was when Solid was chosen, restored on
   * switching back. Session memory only. */
  private _remembered: string[] = [];

  constructor() {
    super();
    this.colors = [];
    this.value = [];
    this.maxStops = RAMP_MAX;
    this.label = null;
    this.rangeMin = 0;
    this.rangeMax = 1;
    this.unit = null;
    this.byValue = nothing;
    this.onByValue = null;
    this.byValueOn = false;
    this.onChange = () => {};
    this._mode = undefined;
    this._open = -1;
    this._announce = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private get _effectiveMode(): RampMode | "bands" {
    if (this.byValueOn) return "bands";
    return this._mode ?? deriveRampMode(this.value);
  }

  /** The stops the range shows and edits: nothing stored is the built-in
   * ramp, as on the dial. */
  private get _effectiveStops(): string[] {
    return effectiveStops(this.value);
  }

  /** Store a range (the built-in one as nothing at all). */
  private _commit(stops: string[]): void {
    const stored = storedStops(stops);
    this.value = stored;
    this.onChange(stored.length ? [...stored] : null);
  }

  private _setMode(next: string): void {
    if (next === this._effectiveMode) return;
    this._open = -1;
    if (next === "bands" || this.byValueOn) {
      this.onByValue?.(next === "bands");
      if (next === "bands") return;
    }
    const mode = next as RampMode;
    this._mode = mode;
    if (mode === "solid") {
      // Remember the range and push only its first color, so preview and
      // save agree with the mode on screen. An untouched ring stays
      // untouched: One color then asks for a color.
      if (this.value.length >= 2) {
        this._remembered = [...this.value];
        this._commit(pruneForRampMode(this.value, "solid"));
      }
    } else if (this._remembered.length) {
      this._commit(this._remembered);
    }
    // Else nothing is written: the one color stays as the range's first
    // stop, and nothing chosen stays nothing chosen.
  }

  private _focusStop(index: number, selector: string): void {
    void this.updateComplete.then(() => {
      const row = this.querySelectorAll<HTMLElement>(".rstop")[index];
      const wanted = row?.querySelector<HTMLButtonElement>(selector);
      // A disabled button (Move up in first place) cannot take focus: the
      // moved stop's color does, so focus stays on the stop that moved.
      (wanted && !wanted.disabled ? wanted : row?.querySelector<HTMLElement>(".rdot"))?.focus();
    });
  }

  private _move(from: number, to: number, focus = ".rdot"): void {
    const before = this._effectiveStops;
    if (to < 0 || to >= before.length) return;
    const stops = moveItem(before, from, to);
    this._announce = t("ramp.moved", {
      color: enumLabel("color", before[from] ?? ""),
      position: to + 1,
      count: stops.length,
    });
    this._open = -1;
    this._mode = "ramp";
    this._commit(stops);
    this._focusStop(to, focus);
  }

  private _onKeydown = (e: KeyboardEvent): void => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".rstop");
    const at = row ? [...this.querySelectorAll<HTMLElement>(".rstop")].indexOf(row) : -1;
    if (e.key === "Escape" && this._open >= 0) {
      e.preventDefault();
      e.stopPropagation();
      this._closePalette(true);
      return;
    }
    if (!e.altKey || at < 0) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    // Focus stays on the control that was used, on the stop that moved.
    const target = e.target as HTMLElement;
    const selector = target.classList.contains("rmv")
      ? target.classList.contains("up")
        ? ".rmv.up"
        : ".rmv.down"
      : target.classList.contains("rdel")
        ? ".rdel"
        : ".rdot";
    this._move(at, at + dir, selector);
  };

  private _openPalette(index: number): void {
    this._open = index;
    void this.updateComplete.then(() => {
      const palette = this.querySelector<HTMLElement>(".rpick");
      (
        palette?.querySelector<HTMLElement>('.sw[aria-pressed="true"]') ??
        palette?.querySelector<HTMLElement>(".sw")
      )?.focus();
    });
  }

  private _closePalette(refocus: boolean): void {
    const index = this._open;
    this._open = -1;
    if (refocus && index >= 0) this._focusStop(index, ".rdot");
  }

  /** A press outside the open palette (and its stop's color) closes it. */
  private _onOutside = (e: Event): void => {
    if (this._open < 0) return;
    const inside = e
      .composedPath()
      .some((n) => n instanceof Element && (n.matches(".rpick") || n.matches(".rdot")));
    if (!inside) this._closePalette(false);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this._onOutside, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this._onOutside, true);
  }

  private _remove(i: number): void {
    const before = this._effectiveStops;
    const stops = removeStop(before, i);
    this._announce = t("ramp.removed", {
      color: enumLabel("color", before[i] ?? ""),
      count: stops.length,
    });
    this._open = -1;
    // One stop left is still a range being built (it paints as one
    // color): the editor stays, with Add a color beside it.
    this._mode = "ramp";
    this._commit(stops);
    this._focusStop(Math.min(i, stops.length - 1), ".rdel");
  }

  private _add(): void {
    const stops = addStop(this._effectiveStops, this.colors);
    this._announce = t("ramp.added", {
      position: stops.length,
      count: stops.length,
    });
    this._mode = "ramp";
    this._commit(stops);
    // The new stop's color is the thing to decide next.
    this._openPalette(stops.length - 1);
  }

  override render(): unknown {
    const mode = this._effectiveMode;
    return html`<div class="ramp-body" @keydown=${this._onKeydown}>${segmented(
      [
        { id: "solid", label: t("ramp.mode-solid") },
        { id: "ramp", label: t("ramp.mode-ramp") },
        ...(this.onByValue ? [{ id: "bands", label: t("source.bands") }] : []),
      ],
      mode,
      (next) => this._setMode(next),
      t("ramp.mode-label"),
    )}${
      mode === "bands"
        ? this.byValue
        : mode === "solid"
          ? this._solid()
          : html`${this._presets()}${this._strip()}${this._stops()}`
    }</div><span
      class="sr-only"
      role="status"
    >${this._announce}</span>`;
  }

  private _solid(): TemplateResult {
    // One color for the whole ring. There is no "default" here: with
    // nothing picked the dial keeps its range, and the hint states that.
    const color = this.value[0] ?? null;
    return html`<div class="rsolid"><aivi-color-field
        class="cfield"
        .colors=${this.colors}
        .label=${this.label}
        .value=${color}
        .clearable=${false}
        .emptyLabel=${t("ramp.solid-pick")}
        .onChange=${(c: string | null) => {
          if (c) this._commit([c]);
        }}
      ></aivi-color-field><div class="fhint">${t(color ? "ramp.solid-hint" : "ramp.solid-empty")}</div></div>`;
  }

  /** Named ramps, rendered as the gradient they actually produce. */
  private _presets(): TemplateResult {
    const active = presetFor(this._effectiveStops);
    const card = (p: (typeof RAMP_PRESETS)[number]): TemplateResult => {
      const on = active?.id === p.id;
      const stops = p.colors.map((c) => colorHex(c) ?? "#888").join(",");
      return html`<button
        type="button"
        class=${`rpreset${on ? " on" : ""}`}
        aria-pressed=${on ? "true" : "false"}
        @click=${() => {
          this._announce = t("ramp.preset-applied", {
            name: presetLabel(p.id),
          });
          this._open = -1;
          this._mode = "ramp";
          this._commit([...p.colors]);
        }}
      ><span class="rpbar" style=${`background:linear-gradient(90deg,${stops})`}></span><span class="rpname">${presetLabel(p.id)}</span></button>`;
    };
    return html`<div class="rpresets" role="group" aria-label=${t("ramp.presets-label")}>${RAMP_PRESETS.map(card)}</div>`;
  }

  /** The ramp as the dial will interpolate it, with a tick under each
   * stop to show the device's even spacing. */
  private _strip(): TemplateResult {
    const stops = this._effectiveStops;
    const bg =
      stops.length === 1
        ? (colorHex(stops[0] as string) ?? "#888")
        : `linear-gradient(90deg,${stops.map((c) => colorHex(c) ?? "#888").join(",")})`;
    return html`<div class="rstrip" aria-hidden="true"><span class="rstripbar" style=${`background:${bg}`}></span>${stops.map(
      (_, i) =>
        html`<span
          class="rtick"
          style=${`left:min(${stopFraction(i, stops.length) * 100}%, calc(100% - 1px))`}
        ></span>`,
    )}</div>`;
  }

  private _stops(): TemplateResult {
    const stops = this._effectiveStops;
    const full = stops.length >= this.maxStops;
    return html`<div class="rlist" role="list">${stops.map((c, i) =>
      this._stopRow(c, i, stops.length),
    )}</div>${
      stops.length < 2 ? html`<div class="fhint">${t("ramp.one-stop")}</div>` : nothing
    }<div class="rfoot">${
      full
        ? html`<span class="fhint rfull">${t("ramp.full", { max: this.maxStops })}</span>`
        : html`<button
            type="button"
            class="btn quiet small radd"
            @click=${() => this._add()}
          >${t("ramp.add")}</button>`
    }<span class="count rcount">${t("ramp.count", {
      count: stops.length,
      max: this.maxStops,
    })}</span><span class="rgrow"></span><button
        type="button"
        class="btn quiet small rrev"
        ?disabled=${stops.length < 2}
        @click=${() => {
          this._announce = t("ramp.reversed");
          this._open = -1;
          this._mode = "ramp";
          this._commit(reverseStops(this._effectiveStops));
        }}
      >${t("ramp.reverse")}</button></div>`;
  }

  private _stopRow(c: string, i: number, count: number): TemplateResult {
    const name = enumLabel("color", c);
    const at = stopValue(i, count, this.rangeMin, this.rangeMax);
    const where =
      at == null
        ? null
        : t("ramp.at-value", {
            value: formatStopValue(at, i18nLocale()) + (this.unit ? ` ${this.unit}` : ""),
          });
    const open = this._open === i;
    return html`<div class="rstop" role="listitem"><span class="rnum">${i + 1}</span><button
        type="button"
        class="rdot"
        style=${`background:${colorHex(c) ?? "#888"}`}
        aria-expanded=${open ? "true" : "false"}
        aria-label=${t("ramp.pick-color", { position: i + 1, color: name })}
        @click=${() => {
          if (open) this._closePalette(false);
          else this._openPalette(i);
        }}
      ></button><span class="rname"><span class="rlabel">${name}</span>${
        where ? html`<span class="rwhere">${where}</span>` : nothing
      }</span><button
        type="button"
        class="rmv up"
        ?disabled=${i === 0}
        aria-label=${t("ramp.move-up", { position: i + 1, color: name })}
        @click=${() => this._move(i, i - 1, ".rmv.up")}
      >${icon("arrow-up")}</button><button
        type="button"
        class="rmv down"
        ?disabled=${i === count - 1}
        aria-label=${t("ramp.move-down", { position: i + 1, color: name })}
        @click=${() => this._move(i, i + 1, ".rmv.down")}
      >${icon("arrow-down")}</button><button
        type="button"
        class="rdel"
        ?disabled=${count < 2}
        aria-label=${t("ramp.remove-stop", { position: i + 1, color: name })}
        @click=${() => this._remove(i)}
      >${icon("close")}</button>${
        open
          ? html`<div class="rpick"><aivi-swatches
            class="swatches"
            .colors=${this.colors}
            .label=${t("ramp.pick-color", { position: i + 1, color: name })}
            .value=${c}
            .onChange=${(next: string | null) => {
              // Pressing the color it already has keeps it.
              if (next) {
                this._announce = t("ramp.picked", {
                  position: i + 1,
                  color: enumLabel("color", next),
                });
                this._mode = "ramp";
                this._commit(setStop(this._effectiveStops, i, next));
              }
              this._closePalette(true);
            }}
          ></aivi-swatches></div>`
          : nothing
      }</div>`;
  }
}

define("aivi-color-ramp", AiviColorRamp);
