// A color by value (bands.ts): which entity's reading it follows, the
// bands as a ruler drawn to the reading's span, one row per band with its
// limit and its color, where the reading is now, and the same bands as a
// template for anything the bands cannot say.
//
// A limit is typed: the row keeps what is typed, and stores it once it is
// a number between its neighbours' limits; leaving the box shows what is
// stored. A band's color is the form's color control. The host carries
// class="bands".

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import {
  type BandsBinding,
  bandOf,
  bandRange,
  formatLimit,
  knownRange,
  MAX_BANDS,
  readingOf,
  rulerRange,
  withUnit,
} from "./bands";
import { colorHex } from "./const";
import { define } from "./define";
import { t, tSplit } from "./i18n";
import { icon } from "./icons";
import { note } from "./notice";
import type { EntityOption, HassLike } from "./types/hass";
import { enumLabel } from "./util";

let nextId = 0;

/** The colors a band added at the top takes, the first one unused. */
const NEXT_COLORS = ["green", "blue", "purple", "yellow", "red", "orange"];

export class AiviBandsField extends LitElement {
  static override properties = {
    bands: { attribute: false },
    colors: { attribute: false },
    hass: { attribute: false },
    options: { attribute: false },
    label: { attribute: false },
    lockHint: { attribute: false },
    span: { attribute: false },
    onChange: { attribute: false },
    onTemplate: { attribute: false },
    _draft: { state: true },
  };
  declare bands: BandsBinding;
  declare colors: string[];
  declare hass: HassLike;
  /** The entities whose state reads as a number. */
  declare options: EntityOption[];
  /** What the color is for, naming the controls. */
  declare label: string;
  /** Whether to say that color alone does not reach every surface. */
  declare lockHint: boolean;
  /** The span the field draws its reading on, where it has one (a
   * gauge's dial). */
  declare span: [number, number] | null;
  declare onChange: (bands: BandsBinding) => void;
  /** Write the bands out as a template instead; null where the value
   * takes no template. */
  declare onTemplate: (() => void) | null;
  /** The limit being typed, by index, while it is typed. */
  declare private _draft: { index: number; text: string } | null;

  constructor() {
    super();
    this.bands = { entity: "", limits: [], values: [] };
    this.colors = [];
    this.options = [];
    this.label = "";
    this.lockHint = false;
    this.span = null;
    this.onChange = () => {};
    this.onTemplate = null;
    this._draft = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private get _unit(): string {
    const unit = this.hass.states[this.bands.entity]?.attributes["unit_of_measurement"];
    return typeof unit === "string" ? unit : "";
  }

  private _set(patch: Partial<BandsBinding>): void {
    this.bands = { ...this.bands, ...patch };
    this.onChange(this.bands);
  }

  /** A typed limit, stored when it is a number between its neighbours. */
  private _type(index: number, text: string): void {
    this._draft = { index, text };
    const n = readingOf(text.replace(",", "."));
    const limits = this.bands.limits;
    const below = limits[index - 1] ?? -Infinity;
    const above = limits[index + 1] ?? Infinity;
    if (n === null || n <= below || n >= above) return;
    this._set({ limits: limits.map((limit, i) => (i === index ? n : limit)) });
  }

  private _add(): void {
    const { limits, values } = this.bands;
    const last = limits[limits.length - 1] ?? 0;
    const step = last - (limits[limits.length - 2] ?? last - 10) || 10;
    const color = NEXT_COLORS.find((c) => !values.includes(c)) ?? "gray";
    this._set({ limits: [...limits, last + step], values: [...values, color] });
  }

  /** Remove band `i`: its color, and the limit below it (the first band
   * gives up the limit above). */
  private _remove(i: number): void {
    const { limits, values } = this.bands;
    const limit = i === 0 ? 0 : i - 1;
    this._draft = null;
    this._set({
      limits: limits.filter((_, j) => j !== limit),
      values: values.filter((_, j) => j !== i),
    });
  }

  private readonly _id = `bf${nextId++}`;

  override render(): unknown {
    const bands = this.bands;
    const entity = this.hass.states[bands.entity];
    const reading = readingOf(entity?.state);
    const name = entity?.attributes.friendly_name || bands.entity;
    const count = bands.values.length;
    return html`<div class="ctl"><span class="k">${t("bands.follows")}</span><aivi-entity-combobox
        class="cbx"
        .options=${this.options}
        .label=${t("bands.follows-aria", { field: this.label })}
        .placeholder=${t("bands.follows-placeholder")}
        .value=${bands.entity || null}
        .onSelect=${(id: string | null) => {
          if (id) this._set({ entity: id });
        }}
      ></aivi-entity-combobox></div>${this._ruler(reading)}<div class="fhint bnow" role="status">${
        !bands.entity
          ? nothing
          : reading === null
            ? t("bands.now-none", { name })
            : t("bands.now", {
                reading: withUnit(reading, this._unit),
                color: enumLabel("color", bands.values[bandOf(bands, reading)] ?? ""),
              })
      }</div><div class="blist" role="group" aria-label=${t("bands.list", { field: this.label })}>${bands.values.map(
        (color, i) => this._row(color, i, count),
      )}</div><div class="rfoot">${
        count < MAX_BANDS
          ? html`<button type="button" class="btn quiet small" @click=${() => this._add()}>${t("bands.add")}</button>`
          : html`<span class="fhint">${t("bands.full", { max: MAX_BANDS })}</span>`
      }${
        this.onTemplate
          ? html`<span class="rgrow"></span><button type="button" class="btn ghost small btpl" @click=${() => this.onTemplate?.()}>${t(
              "bands.as-template",
            )}</button>`
          : nothing
      }</div>${this.lockHint ? html`<div class="fhint">${t("bands.lock-hint")}</div>` : nothing}`;
  }

  /** The bands drawn to the reading's span: each band's color over its
   * stretch, its limits named under it, and where the reading is now. */
  private _ruler(reading: number | null): TemplateResult {
    const bands = this.bands;
    const entity = this.hass.states[bands.entity];
    const [min, max] = rulerRange(bands, entity, reading, this.span);
    // The ends are named only where the span is the reading's own (a
    // percentage's 0 and 100, a gauge's dial), not room drawn around the
    // limits.
    const ends = this.span !== null || knownRange(entity) !== null;
    const at = (n: number): number => ((n - min) / (max - min)) * 100;
    const edges = [min, ...bands.limits, max];
    const stops = bands.values
      .map((color, i) => {
        const paint = colorHex(color) ?? "#888";
        return `${paint} ${at(edges[i] ?? min)}% ${at(edges[i + 1] ?? max)}%`;
      })
      .join(",");
    const tick = (n: number, cls = ""): TemplateResult =>
      html`<span class=${`btick${cls}`} style=${`left:${at(n)}%`}>${formatLimit(n)}</span>`;
    return html`<div class="bruler" aria-hidden="true"><span class="bbar" style=${`background:linear-gradient(90deg,${stops})`}></span>${
      reading === null
        ? nothing
        : html`<span class="bnowmark" style=${`left:${at(reading)}%`}></span>`
    }<div class="bticks">${ends ? tick(min, " end") : nothing}${bands.limits.map((n) => tick(n))}${ends ? tick(max, " end") : nothing}</div></div>`;
  }

  private _row(color: string, i: number, count: number): TemplateResult {
    const bands = this.bands;
    const unit = this._unit;
    const range = bandRange(bands, i, unit);
    const limit = bands.limits[i];
    const draft = this._draft?.index === i ? this._draft.text : null;
    const typed = draft === null ? null : readingOf(draft.replace(",", "."));
    const bad =
      draft !== null &&
      (typed === null ||
        typed <= (bands.limits[i - 1] ?? -Infinity) ||
        typed >= (bands.limits[i + 1] ?? Infinity));
    const noteId = `${this._id}-${i}-note`;
    // The words around the limit typed here ("Below", "20 % to") come
    // from the same catalog entry as the range said elsewhere.
    const [before, after] =
      limit === undefined
        ? [range, ""]
        : i === 0
          ? tSplit("bands.below", "limit")
          : tSplit("bands.between", "limit");
    const from = i === 0 || limit === undefined ? "" : withUnit(bands.limits[i - 1] ?? 0, unit);
    return html`<div class="brow">${
      limit === undefined
        ? html`<span class="brange">${range}</span>`
        : html`<span class="bpre">${before.replace("{from}", from)}</span><span class="blim"><input
            type="text" inputmode="decimal" spellcheck="false"
            class=${bad ? "blimit bad" : "blimit"}
            aria-label=${t("bands.limit-aria", { range })}
            aria-invalid=${bad ? "true" : "false"}
            aria-describedby=${bad ? noteId : nothing}
            .value=${live(draft ?? formatLimit(limit))}
            @input=${(e: Event) => this._type(i, (e.target as HTMLInputElement).value)}
            @change=${() => {
              this._draft = null;
            }}
          />${unit ? html`<span class="bunit">${unit}</span>` : nothing}${after}</span>`
    }<aivi-color-field
        class="cfield"
        .colors=${this.colors}
        .label=${t("bands.color-aria", { range })}
        .value=${color}
        .clearable=${false}
        .onChange=${(c: string | null) => {
          if (c) this._set({ values: bands.values.map((v, j) => (j === i ? c : v)) });
        }}
      ></aivi-color-field>${
        count > 2
          ? html`<button
              type="button" class="rdel"
              aria-label=${t("bands.remove", { range })} title=${t("common.remove")}
              @click=${() => this._remove(i)}
            >${icon("close")}</button>`
          : nothing
      }${bad ? note("error", t("bands.order"), { id: noteId }) : nothing}</div>`;
  }
}

define("aivi-bands-field", AiviBandsField);
