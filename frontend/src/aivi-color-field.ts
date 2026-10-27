// The color control: one row tall. A button shows the picked color and
// its name; pressing it opens a popover with the named palette, a reset to
// the default and, where Aivi takes hex, a color picker.
//
// Keyboard/ARIA: the button owns a dialog popover (aria-haspopup +
// aria-expanded). Opening moves focus to what is picked inside it (the
// palette's arrows rove, aivi-swatches.ts); Escape or a pick closes it and
// returns focus to the button. A press outside, or focus moving out of
// the field, closes it without moving focus, so one popover is open at a
// time.
//
// A color that is not one (text stored by hand, a half-typed hex) is
// marked on the button itself, popover open or not.

import { html, LitElement, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { colorHex } from "./const";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import { note } from "./notice";
import { focusLeft, watchOutsidePress } from "./popover";
import { enumLabel } from "./util";

/** `#RRGGBB`, the one form Aivi stores: no alpha, no shorthand. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** What the hex box takes for it: the `#` is optional, and three digits
 * are the six they stand for. */
const HEX_TYPED = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

let nextId = 0;

/** The host carries class="cfield". */
export class AiviColorField extends LitElement {
  static override properties = {
    colors: { attribute: false },
    value: { attribute: false },
    label: { attribute: false },
    hex: { attribute: false },
    clearable: { attribute: false },
    emptyLabel: { attribute: false },
    onChange: { attribute: false },
    _open: { state: true },
    _draft: { state: true },
  };
  declare colors: string[];
  declare value: string | null;
  /** What the color is for; names the button and the popover. */
  declare label: string;
  /** Whether a `#RRGGBB` color is accepted beside the palette. */
  declare hex: boolean;
  /** Whether the color can be reset to nothing picked. */
  declare clearable: boolean;
  /** What "nothing picked" is called; "Default" unless said. */
  declare emptyLabel: string | null;
  declare onChange: (c: string | null) => void;
  declare private _open: boolean;
  /** The hex box's text while it is being typed in: the user is still
   * typing, so what is stored (uppercased, expanded, or a palette name)
   * never rewrites it under the caret. */
  declare private _draft: string | null;

  private readonly _id = `cf${nextId++}`;
  private _unwatch: (() => void) | null = null;

  constructor() {
    super();
    this.colors = [];
    this.value = null;
    this.label = "";
    this.hex = false;
    this.clearable = true;
    this.emptyLabel = null;
    this.onChange = () => {};
    this._open = false;
    this._draft = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("focusout", this._onFocusOut);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("focusout", this._onFocusOut);
    this._unwatch?.();
    this._unwatch = null;
  }

  /** Tabbing out of the popover leaves the field: it closes. */
  private _onFocusOut = (e: FocusEvent): void => {
    if (focusLeft(e, this)) this._close(false);
  };

  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this._open) return;
    e.stopPropagation();
    this._close(true);
  };

  private _toggle(): void {
    if (this._open) {
      this._close(true);
      return;
    }
    this._open = true;
    this._unwatch = watchOutsidePress(this, () => this._close(false));
    void this.updateComplete.then(() => this._focusPicked());
  }

  /** Focus goes to what is picked, so Enter confirms it instead of
   * changing it: the picked dot, the picker of a custom color (the hex
   * box when that text is not a color, so it can be fixed), Default when
   * nothing is picked, else the palette. */
  private _focusPicked(): void {
    const pop = this.querySelector<HTMLElement>(".cfpop");
    if (!pop) return;
    const find = (sel: string): HTMLElement | null => pop.querySelector<HTMLElement>(sel);
    const custom = this._custom
      ? find(HEX_COLOR.test(this._custom) ? ".cfhex input[type=color]" : ".hexin")
      : null;
    (
      find(".sw.sel") ??
      custom ??
      find(".cfnone.on") ??
      find('.sw[tabindex="0"]') ??
      find("button")
    )?.focus();
  }

  private _close(refocus: boolean): void {
    if (!this._open) return;
    this._open = false;
    this._draft = null;
    this._unwatch?.();
    this._unwatch = null;
    if (refocus)
      void this.updateComplete.then(() => {
        this.querySelector<HTMLElement>(".cfbtn")?.focus();
      });
  }

  private _set(value: string | null): void {
    this.value = value;
    this.onChange(value);
  }

  private _pick(value: string | null): void {
    this._set(value);
    this._close(true);
  }

  /** What typed text is as a color: a palette name as the palette
   * writes it, a hex code in the stored form, else the text itself
   * (which the field then marks as not a color). */
  private _read(typed: string): string {
    const name = typed.toLowerCase();
    if (this.colors.includes(name)) return name;
    const digits = HEX_TYPED.exec(typed)?.[1];
    if (!digits) return typed;
    const six = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
    return `#${six.toUpperCase()}`;
  }

  /** The stored value when it is not a palette name: a hex color, or
   * text that is not a color at all (shown so it can be fixed). */
  private get _custom(): string {
    const value = this.value ?? "";
    return this.colors.includes(value) ? "" : value;
  }

  /** Whether a field that takes hex holds text that is not a color. */
  private get _bad(): boolean {
    const custom = this._custom;
    return this.hex && !!custom && !HEX_COLOR.test(custom);
  }

  private _name(): string {
    const value = this.value;
    if (!value) return this.emptyLabel ?? t("common.default");
    if (this.colors.includes(value)) return enumLabel("color", value);
    return HEX_COLOR.test(value) ? value.toUpperCase() : value;
  }

  private _paint(): string | null {
    const value = this.value;
    if (!value) return null;
    return colorHex(value) ?? (HEX_COLOR.test(value) ? value : null);
  }

  override render(): unknown {
    const paint = this._paint();
    const name = this._name();
    const bad = this._bad;
    const noteId = `${this._id}-note`;
    return html`<button
        type="button" class=${`cfbtn${bad ? " bad" : ""}`}
        aria-haspopup="dialog"
        aria-expanded=${this._open ? "true" : "false"}
        aria-label=${t("color-field.pick", { label: this.label, color: name })}
        aria-describedby=${bad && !this._open ? noteId : nothing}
        @click=${() => this._toggle()}
        @keydown=${this._onKeydown}
      ><span
          class=${`cfdot${paint ? "" : " empty"}`} aria-hidden="true"
          style=${paint ? `background:${paint}` : ""}
        ></span><span class="cfname">${name}</span><span class="tri" aria-hidden="true">${icon("chevron-right")}</span></button>${
          this._open
            ? this._popover(bad, noteId)
            : bad
              ? note("error", t("color-field.invalid"), { id: noteId })
              : nothing
        }`;
  }

  private _popover(bad: boolean, noteId: string): unknown {
    const custom = this._custom;
    // tabindex -1: a press on the popover's own padding keeps focus in
    // the field instead of dropping it on the page.
    return html`<div
      class="cfpop" role="dialog" aria-label=${this.label} tabindex="-1"
      @keydown=${this._onKeydown}
    >${
      this.clearable
        ? html`<button
            type="button" class=${`cfnone${this.value ? "" : " on"}`}
            aria-pressed=${this.value ? "false" : "true"}
            @click=${() => this._pick(null)}
          ><span class="cfdot empty" aria-hidden="true"></span>${this.emptyLabel ?? t("common.default")}</button>`
        : nothing
    }<aivi-swatches
        class="swatches" role="group" aria-label=${this.label}
        .colors=${this.colors}
        .value=${custom ? null : this.value}
        .onChange=${(c: string | null) => {
          // A second press on the picked dot clears it, where clearing
          // is allowed; otherwise the pick stands.
          if (c || this.clearable) this._pick(c);
          else this._close(true);
        }}
      ></aivi-swatches>${
        this.hex
          ? html`<div class="cfhex"><input
              type="color"
              aria-label=${t("color-field.picker-aria", { label: this.label })}
              .value=${live(HEX_COLOR.test(custom) ? custom.toLowerCase() : (this._paint() ?? "#888888").toLowerCase())}
              @input=${(e: Event) => {
                this._draft = null;
                this._set((e.target as HTMLInputElement).value.toUpperCase());
              }}
            /><input
              type="text" class=${`hexin${bad ? " bad" : ""}`}
              aria-label=${t("color-field.hex-aria", { label: this.label })}
              aria-invalid=${bad ? "true" : "false"}
              aria-describedby=${bad ? noteId : nothing}
              .value=${live(this._draft ?? custom)} placeholder="#RRGGBB"
              spellcheck="false" maxlength="7"
              @input=${(e: Event) => {
                const raw = (e.target as HTMLInputElement).value;
                this._draft = raw;
                const typed = raw.trim();
                // Emptied where a color is required: wait for the next one.
                if (typed || this.clearable) this._set(typed ? this._read(typed) : null);
              }}
              @change=${() => {
                // Done typing: the box shows what was stored.
                this._draft = null;
              }}
            /></div>${
              bad ? note("error", t("color-field.invalid"), { id: noteId, role: "alert" }) : nothing
            }`
          : nothing
      }</div>`;
  }
}

define("aivi-color-field", AiviColorField);
