// The single-pick palette: color fields, and the per-stop picker in the
// ramp editor (aivi-color-ramp.ts).
//
// Keyboard/ARIA: toggle buttons (aria-pressed), not a radiogroup (a second
// activation clears the pick), with a roving tabindex (arrows/Home/End move
// focus; Space/Enter toggle natively). No live region: screen readers
// already announce the aria-pressed flip on the focused button.

import { html, LitElement } from "lit";
import { colorHex } from "./const";
import { define } from "./define";
import { enumLabel } from "./util";

/** Roving-tabindex arrow navigation over the palette's buttons. */
function paletteKeydown(e: KeyboardEvent, setFocus: (i: number) => void): void {
  const group = e.currentTarget as HTMLElement;
  const buttons = [...group.querySelectorAll("button")];
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  if (at < 0) return;
  let next: number | null = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = at >= buttons.length - 1 ? 0 : at + 1;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
    next = at <= 0 ? buttons.length - 1 : at - 1;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = buttons.length - 1;
  if (next === null) return;
  e.preventDefault();
  setFocus(next);
  buttons[next]?.focus();
}

/** Single-pick palette row; the host carries class="swatches". */
export class AiviSwatches extends LitElement {
  static override properties = {
    colors: { attribute: false },
    value: { attribute: false },
    onChange: { attribute: false },
    _focus: { state: true },
  };
  declare colors: string[];
  declare value: string | null;
  declare onChange: (c: string | null) => void;
  /** The roving tab stop; -1 = follow the selection (or the first dot). */
  declare private _focus: number;

  constructor() {
    super();
    this.colors = [];
    this.value = null;
    this.onChange = () => {};
    this._focus = -1;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this._onKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._onKeydown);
  }

  private _onKeydown = (e: KeyboardEvent): void => {
    paletteKeydown(e, (i) => {
      this._focus = i;
    });
  };

  private _tabStop(): number {
    if (this._focus >= 0 && this._focus < this.colors.length) return this._focus;
    const sel = this.value === null ? -1 : this.colors.indexOf(this.value);
    return Math.max(sel, 0);
  }

  override render(): unknown {
    const stop = this._tabStop();
    return html`${this.colors.map(
      (c, i) =>
        html`<button
          type="button"
          class=${`sw${this.value === c ? " sel" : ""}`}
          style=${`background:${colorHex(c) ?? "#888"}`}
          title=${enumLabel("color", c)}
          aria-label=${enumLabel("color", c)}
          aria-pressed=${this.value === c ? "true" : "false"}
          tabindex=${i === stop ? "0" : "-1"}
          @click=${() => this._pick(c, i)}
        ></button>`,
    )}`;
  }

  private _pick(c: string, i: number): void {
    const next = this.value === c ? null : c;
    this.value = next;
    this._focus = i;
    this.onChange(next);
  }
}

define("aivi-swatches", AiviSwatches);
