// A gradient: Automatic (a light follows its own color), None, or Custom,
// two or three color stops with a strip showing the result.
//
// The value is the stored option text, unchanged from when it was typed
// by hand: empty for automatic, `none` for off, else comma-separated stops
// (palette names or #RRGGBB). The mode is derived from it, so nothing new
// is stored.

import { html, LitElement, nothing } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { colorHex } from "./const";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import { note } from "./notice";
import { segmented } from "./segmented";
import { recall, remember } from "./session-memory";
import { GRADIENT_NONE, parseGradient } from "./switchboard";

type Mode = "auto" | "none" | "custom";

/** What Custom starts from when nothing was picked before. */
const SEED = "#FFD27A, #FF8A4C";

/** The host carries class="gfield". */
export class AiviGradientField extends LitElement {
  static override properties = {
    colors: { attribute: false },
    value: { attribute: false },
    auto: { attribute: false },
    label: { attribute: false },
    onChange: { attribute: false },
  };
  declare colors: string[];
  declare value: string | null;
  /** Whether an automatic gradient exists (the entity is a light);
   * without one, nothing picked already means no gradient. */
  declare auto: boolean;
  declare label: string;
  declare onChange: (raw: string | null) => void;

  /** Where the last custom stops are remembered: with the editor's
   * working copy (value-source.ts, session memory), so they outlive this
   * element (collapsing a row unmounts it) and are never stored. On its
   * own, outside an editor, the element remembers. */
  private get _memory(): object {
    const editor = this.closest("aivi-editor") as AiviEditor | null;
    return editor?.panel?.editorState?.bindings ?? this;
  }

  /** The last custom stops, so a detour through another mode keeps them.
   * Filed under the label, which names the tile. */
  private get _lastCustom(): string | null {
    const stops = recall(this._memory, `gradient:${this.label}`);
    return typeof stops === "string" ? stops : null;
  }

  private set _lastCustom(stops: string | null) {
    remember(this._memory, `gradient:${this.label}`, stops);
  }

  constructor() {
    super();
    this.colors = [];
    this.value = null;
    this.auto = false;
    this.label = "";
    this.onChange = () => {};
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private get _raw(): string {
    return (this.value ?? "").trim();
  }

  private get _mode(): Mode {
    const raw = this._raw;
    if (!raw) return this.auto ? "auto" : "none";
    return raw.toLowerCase() === GRADIENT_NONE ? "none" : "custom";
  }

  private _stops(): string[] {
    return this._raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private _set(raw: string | null): void {
    this.value = raw;
    this.onChange(raw);
    this.requestUpdate();
  }

  private _setMode(mode: Mode): void {
    if (this._mode === "custom") this._lastCustom = this._raw;
    if (mode === "custom") this._set(this._lastCustom ?? SEED);
    else if (mode === "none") this._set(this.auto ? GRADIENT_NONE : null);
    else this._set(null);
  }

  private _setStops(stops: string[]): void {
    this._set(stops.join(", "));
  }

  /** Adding the last stop takes the Add button away, and removing one
   * takes the remove buttons away: when the control that was pressed is
   * gone, focus goes to the stop it acted on instead of the page. */
  private _keepFocus(stop: number): void {
    void this.updateComplete.then(() => {
      const root = this.getRootNode() as Document | ShadowRoot;
      const active = root.activeElement;
      if (active && active !== this && this.contains(active)) return;
      const stops = this.querySelectorAll<HTMLElement>(".gstop");
      stops[Math.min(stop, stops.length - 1)]?.querySelector<HTMLElement>(".cfbtn")?.focus();
    });
  }

  override render(): unknown {
    const mode = this._mode;
    const modes: { id: Mode; label: string }[] = [
      ...(this.auto ? [{ id: "auto" as const, label: t("gradient.auto") }] : []),
      { id: "none", label: t("gradient.none") },
      { id: "custom", label: t("gradient.custom") },
    ];
    return html`${segmented(modes, mode, (next) => this._setMode(next as Mode), this.label)}${
      mode === "custom"
        ? this._custom()
        : html`<div class="fhint">${
            mode === "auto" ? t("gradient.auto-hint") : t("gradient.none-hint")
          }</div>`
    }`;
  }

  private _custom(): unknown {
    const stops = this._stops();
    const parsed = parseGradient(this._raw, this.colors);
    return html`<div class="gstops">${stops.map(
      (stop, i) =>
        html`<div class="gstop"><aivi-color-field
              class="cfield"
              .colors=${this.colors}
              .value=${stop}
              .hex=${true}
              .clearable=${false}
              .label=${t("gradient.stop-aria", { n: i + 1 })}
              .onChange=${(c: string | null) => {
                // A stop is never empty: clearing its hex keeps the stop.
                // The stored text separates stops with commas, so one
                // typed into a stop would split it in two: it is dropped.
                const stop = c?.replaceAll(",", "").trim();
                if (stop) this._setStops(stops.map((s, j) => (j === i ? stop : s)));
              }}
            ></aivi-color-field>${
              stops.length > 2
                ? html`<button
                  type="button" class="mv rm"
                  title=${t("common.remove")}
                  aria-label=${t("gradient.remove-aria", { n: i + 1 })}
                  @click=${() => {
                    this._setStops(stops.filter((_, j) => j !== i));
                    this._keepFocus(i);
                  }}
                >${icon("close")}</button>`
                : nothing
            }</div>`,
    )}${
      stops.length < 3
        ? html`<button
            type="button" class="btn quiet small"
            @click=${() => {
              this._setStops([...stops, stops[stops.length - 1] ?? "orange"]);
              this._keepFocus(stops.length);
            }}
          >${t("gradient.add")}</button>`
        : nothing
    }</div>${
      !parsed.problem && parsed.stops.length >= 2
        ? html`<div class="gradsw" aria-hidden="true" style=${`background:linear-gradient(90deg, ${parsed.stops
            .map((stop) => colorHex(stop) ?? stop)
            .join(", ")})`}></div>`
        : nothing
    }${
      parsed.problem && parsed.problem !== "switchboard.gradient-color"
        ? // A stop that is not a color is marked on its own field: one
          // alert per problem, so only the count is reported here.
          note("error", t(parsed.problem), { role: "alert" })
        : nothing
    }`;
  }
}

define("aivi-gradient-field", AiviGradientField);
