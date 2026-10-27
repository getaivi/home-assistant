// A searchable entity picker. The host carries class="cbx"; the popup is
// internal reactive state, and the input's text is user-owned (set
// imperatively on pick/clear, never clobbered by re-renders).
//
// ARIA: the APG editable-combobox pattern with aria-activedescendant:
// DOM focus stays in the input. The no-matches message renders as a status
// line, not inside a listbox (a listbox may only own options).

import { html, LitElement, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import { placePopup, watchOutsidePress } from "./popover";
import type { EntityOption } from "./types/hass";
import { clamp, inNarrowPanel } from "./util";

let nextId = 0;

/** How many options the popup renders: a household has hundreds of
 * entities, and past this the user narrows by typing (the popup shows
 * the count). */
const SHOWN = 60;

/** Every option matching what was typed: each word must be in the name
 * or the id, in any order ("door front" finds "Front door"). Shared with
 * the template editor's entity browser. */
export function matchEntities(options: readonly EntityOption[], q: string): EntityOption[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const hay = `${o.name} ${o.id}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** How far PageUp and PageDown move the highlight. */
const PAGE = 8;

export class AiviEntityCombobox extends LitElement {
  static override properties = {
    options: { attribute: false },
    value: { attribute: false },
    placeholder: { attribute: false },
    label: { attribute: false },
    describedby: { attribute: false },
    picker: { attribute: false },
    onSelect: { attribute: false },
    _open: { state: true },
    _query: { state: true },
    _hi: { state: true },
    _text: { state: true },
  };
  declare options: EntityOption[];
  declare value: string | null;
  declare placeholder: string | null;
  declare label: string | null;
  /** Id of an external note describing the input (aria-describedby). */
  declare describedby: string | null;
  /** Adds to a list instead of holding a value: a pick is handed over,
   * the text clears and the popup stays open for the next one. */
  declare picker: boolean;
  declare onSelect: (id: string | null) => void;
  declare private _open: boolean;
  declare private _query: string;
  declare private _hi: number;
  declare private _text: string;

  /** Unique per instance: the listbox id aria-controls points at and the
   * prefix of each option's id (for aria-activedescendant). */
  private readonly _id = `cbx${nextId++}`;

  constructor() {
    super();
    this.options = [];
    this.value = null;
    this.placeholder = null;
    this.label = null;
    this.describedby = null;
    this.picker = false;
    this.onSelect = () => {};
    this._open = false;
    this._query = "";
    this._hi = -1;
    this._text = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private get _input(): HTMLInputElement | null {
    return this.querySelector("input");
  }

  private _unwatch: (() => void) | null = null;

  // A press outside closes the popup; one inside (an option, the popup's
  // scrollbar) never does, which is what keeps a `picker` open for the
  // next pick (popover.ts has the shadow-root detail).
  override connectedCallback(): void {
    super.connectedCallback();
    this._unwatch = watchOutsidePress(this, () => {
      this._open = false;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unwatch?.();
    this._unwatch = null;
  }

  /** The `value` the input text was last written from. Distinct from
   * `value` itself so a re-seed happens exactly once per change, and
   * never while the user is typing (typing doesn't move `value`). */
  private _seeded: string | null | undefined = undefined;

  /**
   * Re-seed the input text on a `value` change. Lit may recycle an
   * instance across two fields, so seeding once would show the old
   * field's text; typing leaves `value` alone, so this never clobbers an
   * edit in progress.
   */
  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("_open") && this._open) {
      // Placed once per opening, so the popup doesn't jump while the
      // list shrinks under the typing.
      const pop = this.querySelector<HTMLElement>(".cbx-pop");
      const input = this._input;
      if (pop && input) placePopup(pop, input);
    }
    if (changed.has("_hi") || changed.has("_open")) this._revealHighlight();
    if (this.value === this._seeded) return;
    this._seeded = this.value;
    this._showValue();
  }

  /** The input text for the current `value`. */
  private _valueText(): string {
    const selected = this.options.find((o) => o.id === this.value);
    return selected?.name ?? (this.value ? this.value : "");
  }

  private _showValue(): void {
    const input = this._input;
    if (!input) return;
    const text = this._valueText();
    input.value = text;
    this._text = text;
  }

  /** Keeps the arrow-key highlight visible in the scrolling popup. */
  private _revealHighlight(): void {
    if (!this._open || this._hi < 0) return;
    this.querySelector(`#${this._id}-opt-${this._hi}`)?.scrollIntoView?.({
      block: "nearest",
    });
  }

  private _matches(q: string): EntityOption[] {
    return matchEntities(this.options, q);
  }

  /** The options the popup shows: the first matches. */
  private _filtered(q: string): EntityOption[] {
    return this._matches(q).slice(0, SHOWN);
  }

  private _openPop(q: string): void {
    this._query = q;
    this._open = true;
    this._hi = this._filtered(q).length ? 0 : -1;
  }

  /** What a closed popup reopens on: everything while the text is just
   * the picked entity's name, else what the user typed. */
  private _reopenQuery(): string {
    const typed = this._input?.value ?? "";
    return typed === this._valueText() ? "" : typed;
  }

  override render(): unknown {
    const matches = this._open ? this._matches(this._query) : [];
    const filtered = matches.slice(0, SHOWN);
    // The highlight never names an option that isn't there (the options
    // can change under an open popup).
    const hi = this._hi < filtered.length ? this._hi : -1;
    return html`<input
        type="text"
        role="combobox"
        aria-expanded=${this._open ? "true" : "false"}
        aria-controls=${`${this._id}-list`}
        aria-autocomplete="list"
        aria-activedescendant=${this._open && hi >= 0 ? `${this._id}-opt-${hi}` : nothing}
        aria-label=${ifDefined(this.label ?? undefined)}
        aria-describedby=${ifDefined(this.describedby ?? undefined)}
        placeholder=${this.placeholder ?? t("combobox.placeholder")}
        autocomplete="off"
        spellcheck="false"
        @focus=${this._onFocus}
        @click=${this._onClick}
        @blur=${this._onBlur}
        @input=${this._onInput}
        @keydown=${this._onKeydown}
      />${
        this._text
          ? html`<button type="button" class="clear" title=${t("common.clear")} aria-label=${t("common.clear")} @click=${this._clear}>${icon("close")}</button>`
          : nothing
      }${
        this._open
          ? html`<div class="cbx-pop"><div
            id=${`${this._id}-list`}
            role=${filtered.length ? "listbox" : "status"}
            aria-label=${ifDefined(filtered.length ? (this.label ?? this.placeholder ?? t("combobox.placeholder")) : undefined)}
          >${
            filtered.length
              ? filtered.map(
                  (o, i) =>
                    html`<div
                    class=${`opt${i === hi ? " hi" : ""}`}
                    id=${`${this._id}-opt-${i}`}
                    role="option"
                    aria-selected=${o.id === this.value ? "true" : "false"}
                    @mousedown=${(e: MouseEvent) => {
                      e.preventDefault();
                      this._pick(i);
                    }}
                    @mousemove=${() => {
                      this._hi = i;
                    }}
                  ><span>${o.name}</span><span class="eid">${o.id}</span></div>`,
                )
              : html`<div class="none">${t("combobox.no-matches")}</div>`
          }</div>${
            matches.length > filtered.length
              ? html`<div class="more" role="status">${t("combobox.more", {
                  shown: filtered.length,
                  total: matches.length,
                })}</div>`
              : nothing
          }</div>`
          : nothing
      }`;
  }

  /** On narrow, focusing raises the on-screen keyboard: scroll the field
   * to the top of the viewport so the popup (whose height narrow mode
   * bounds in the stylesheet) stays visible above the keyboard. */
  private _onFocus = (): void => {
    this._openPop("");
    if (inNarrowPanel(this)) this.scrollIntoView({ block: "start" });
  };

  /** Leaving the field never strands half-typed text that isn't the
   * value: it goes back to the picked entity, and an emptied field
   * clears the pick. */
  private _onBlur = (): void => {
    this._open = false;
    const typed = this._input?.value ?? "";
    if (!typed.trim() && this.value) {
      this._text = "";
      this.onSelect(null);
      return;
    }
    if (typed !== this._valueText()) this._showValue();
  };

  /** A press on the input that already has focus (after a pick or
   * Escape) opens the list again; the focus a first press brings has
   * opened it already. */
  private _onClick = (): void => {
    if (!this._open) this._openPop(this._reopenQuery());
  };

  private _onInput = (e: Event): void => {
    const v = (e.target as HTMLInputElement).value;
    this._text = v;
    this._openPop(v);
  };

  private _onKeydown = (e: KeyboardEvent): void => {
    if (!this._open && (e.key === "ArrowDown" || e.key === "Enter")) {
      if (e.key === "ArrowDown") e.preventDefault();
      this._openPop(this._reopenQuery());
      return;
    }
    if (!this._open) return;
    // Home and End are left to the text: they move the caret (APG).
    const last = this._filtered(this._query).length - 1;
    const move = (to: number): void => {
      e.preventDefault();
      this._hi = last < 0 ? -1 : clamp(to, 0, last);
    };
    if (e.key === "ArrowDown") move(this._hi + 1);
    else if (e.key === "ArrowUp") move(this._hi - 1);
    else if (e.key === "PageDown") move(this._hi + PAGE);
    else if (e.key === "PageUp") move(this._hi - PAGE);
    else if (e.key === "Enter") {
      e.preventDefault();
      this._pick(this._hi);
    } else if (e.key === "Escape") {
      this._open = false;
    } else if (e.key === "Tab") {
      // Focus is leaving the field: close, but never trap the tab.
      this._open = false;
    }
  };

  private _pick(i: number): void {
    const o = this._filtered(this._query)[i];
    if (!o) return;
    const input = this._input;
    if (this.picker) {
      if (input) input.value = "";
      this._text = "";
      this.onSelect(o.id);
      this._openPop("");
      return;
    }
    if (input) input.value = o.name;
    this._text = o.name;
    this._open = false;
    this.onSelect(o.id);
  }

  private _clear = (): void => {
    const input = this._input;
    if (input) input.value = "";
    this._text = "";
    this.onSelect(null);
    input?.focus();
    this._openPop("");
  };
}

define("aivi-entity-combobox", AiviEntityCombobox);
