// The icon control: a text input that takes any SF Symbol name, with a
// picker under it that searches Apple's own index by name and keyword,
// narrows by category, and says which iOS version a symbol needs. The
// index is loaded on the first open (sf-symbols.ts).
//
// What is stored is what the search found: text that names a symbol once
// read the way the search reads it ("Bolt fill") is stored as that symbol
// ("bolt.fill"). Text naming no symbol is kept as typed, with a note,
// since the index can be older than the phone.
//
// ARIA: the APG editable combobox, like the entity picker: DOM focus stays
// in the input, aria-activedescendant names the highlighted option. Tab
// moves on into the popup: the category chips are toggle buttons, and the
// list is a tab stop that takes the same keys as the input. The popup
// closes when focus leaves the field, on a press outside, on a pick and
// on Escape; the last two hand focus back to the input.
// The host carries class="iconfield".

import { html, LitElement, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { define } from "./define";
import { t, tOpt } from "./i18n";
import { focusLeft, placePopup, watchOutsidePress } from "./popover";
import { loadSymbols, type SfIndex, type SfSymbol, searchSymbols, symbolNamed } from "./sf-symbols";
import { clamp, inNarrowPanel } from "./util";

let nextId = 0;

/** How far PageUp and PageDown move the highlight. */
const PAGE = 8;

export class AiviIconField extends LitElement {
  static override properties = {
    value: { attribute: false },
    label: { attribute: false },
    placeholder: { attribute: false },
    onChange: { attribute: false },
    _open: { state: true },
    _query: { state: true },
    _hi: { state: true },
    _category: { state: true },
    _index: { state: true },
    _failed: { state: true },
  };
  declare value: string | null;
  declare label: string | null;
  declare placeholder: string | null;
  declare onChange: (name: string | null) => void;
  declare private _open: boolean;
  declare private _query: string;
  declare private _hi: number;
  /** The picked category's index, or -1 for all. */
  declare private _category: number;
  declare private _index: SfIndex | null;
  declare private _failed: boolean;

  private readonly _id = `icf${nextId++}`;

  constructor() {
    super();
    this.value = null;
    this.label = null;
    this.placeholder = null;
    this.onChange = () => {};
    this._open = false;
    this._query = "";
    this._hi = -1;
    this._category = -1;
    this._index = null;
    this._failed = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private _unwatch: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this._unwatch = watchOutsidePress(this, () => this._close(false));
    this.addEventListener("focusout", this._onFocusOut);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unwatch?.();
    this._unwatch = null;
    this.removeEventListener("focusout", this._onFocusOut);
  }

  /** Focus moving between the input, the chips and the list stays in the
   * field; moving anywhere else closes the popup. */
  private _onFocusOut = (e: FocusEvent): void => {
    if (focusLeft(e, this)) this._close(false);
  };

  private get _input(): HTMLInputElement | null {
    return this.querySelector("input");
  }

  /** The input text follows `value` once per change, never while typing. */
  private _seeded: string | null | undefined = undefined;
  /** Whether the text was typed here, as opposed to stored before: only
   * typed text is rewritten to the symbol it names. */
  private _typed = false;
  /** Set while the field hands focus back to its own input, which must
   * not open the popup again. */
  private _handingBack = false;

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (this.value !== this._seeded) {
      this._seeded = this.value;
      const input = this._input;
      if (input) input.value = this.value ?? "";
    }
    // The index arrived after the typing began: what was typed meanwhile
    // is read against it now.
    if (changed.has("_index") && this._index && this._typed) this._store(this._input?.value ?? "");
    // Placed when it opens and when the list arrives, never while the
    // list shrinks under the typing.
    if (this._open && (changed.has("_open") || changed.has("_index"))) {
      const pop = this.querySelector<HTMLElement>(".icpop");
      const input = this._input;
      if (pop && input) placePopup(pop, input);
    }
    if (this._open && this._hi >= 0)
      this.querySelector(`#${this._id}-opt-${this._hi}`)?.scrollIntoView?.({
        block: "nearest",
      });
  }

  private _matches(): SfSymbol[] {
    return this._index ? searchSymbols(this._index, this._query, this._category) : [];
  }

  /** A load that failed is tried again each time the popup opens (not on
   * every keystroke while it stays open). */
  private _openPop(q: string): void {
    const opening = !this._open;
    this._query = q;
    this._open = true;
    this._hi = -1;
    if (this._index || (this._failed && !opening)) return;
    this._failed = false;
    loadSymbols().then(
      (index) => {
        this._index = index;
      },
      () => {
        this._failed = true;
      },
    );
  }

  /** Closes the popup and shows what is stored, which is the symbol's
   * own name where the typed text named one. `refocus` hands focus back
   * to the input (a pick, Escape) without opening the popup again. */
  private _close(refocus: boolean): void {
    if (!this._open) return;
    this._open = false;
    const input = this._input;
    if (!input) return;
    input.value = this.value ?? "";
    if (!refocus) return;
    this._handingBack = true;
    input.focus();
    this._handingBack = false;
  }

  private _set(name: string | null): void {
    if (name === this.value) return;
    this.value = name;
    this._seeded = this.value;
    this.onChange(this.value);
  }

  /** Stores typed text: the symbol it names, else the text itself. */
  private _store(text: string): void {
    const named = this._index ? symbolNamed(this._index, text) : null;
    this._set(named ?? (text.trim() || null));
  }

  private _pick(s: SfSymbol | undefined): void {
    if (!s) return;
    this._typed = false;
    this._set(s.name);
    this._close(true);
  }

  /** Whether the stored name is one the loaded index doesn't list. */
  private _unknown(): boolean {
    const value = this.value;
    return !!value && !!this._index && symbolNamed(this._index, value) !== value;
  }

  override render(): unknown {
    const matches = this._open ? this._matches() : [];
    const hi = this._hi < matches.length ? this._hi : -1;
    const unknown = !this._open && this._unknown();
    return html`<input
        type="text"
        role="combobox"
        aria-expanded=${this._open ? "true" : "false"}
        aria-controls=${`${this._id}-pop`}
        aria-autocomplete="list"
        aria-activedescendant=${this._open && hi >= 0 ? `${this._id}-opt-${hi}` : nothing}
        aria-label=${ifDefined(this.label ?? undefined)}
        aria-describedby=${unknown ? `${this._id}-note` : nothing}
        placeholder=${this.placeholder ?? t("symbols.placeholder")}
        autocomplete="off" spellcheck="false"
        @focus=${() => {
          if (this._handingBack) return;
          this._openPop(this._input?.value ?? "");
          if (inNarrowPanel(this)) this.scrollIntoView({ block: "start" });
        }}
        @click=${() => {
          // A press on the input that already has focus (after a pick or
          // Escape) opens the picker again.
          if (!this._open) this._openPop(this._input?.value ?? "");
        }}
        @input=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          this._typed = true;
          this._store(v);
          this._openPop(v);
        }}
        @keydown=${this._onKeydown}
      />${this._open ? this._popup(matches, hi) : nothing}${
        unknown
          ? html`<div class="fhint" id=${`${this._id}-note`}>${t("symbols.unknown")}</div>`
          : nothing
      }`;
  }

  private _popup(matches: SfSymbol[], hi: number): unknown {
    const index = this._index;
    const cats = index?.categories ?? [];
    return html`<div class="icpop" id=${`${this._id}-pop`} @keydown=${this._onKeydown}><div class="iccats" role="group" aria-label=${t("symbols.categories")}><button
          type="button" class=${`fchip${this._category < 0 ? " on" : ""}`}
          aria-pressed=${this._category < 0 ? "true" : "false"}
          @mousedown=${(e: Event) => e.preventDefault()}
          @click=${() => {
            this._category = -1;
            this._hi = -1;
          }}
        >${t("symbols.cat-all")}</button>${cats.map(
          (key, i) =>
            html`<button
              type="button" class=${`fchip${this._category === i ? " on" : ""}`}
              aria-pressed=${this._category === i ? "true" : "false"}
              @mousedown=${(e: Event) => e.preventDefault()}
              @click=${() => {
                this._category = this._category === i ? -1 : i;
                this._hi = -1;
              }}
            >${tOpt(`symbols.cat-${key}`) ?? key}</button>`,
        )}</div>${
          !index
            ? html`<div class="icnote" role="status">${
                this._failed ? t("symbols.failed") : t("symbols.loading")
              }</div>`
            : matches.length
              ? html`<div
              class="iclist" role="listbox" aria-label=${t("symbols.list")}
              tabindex="0"
              aria-activedescendant=${hi >= 0 ? `${this._id}-opt-${hi}` : nothing}
              @focus=${() => {
                // Tabbed into: the keys act on an option from the start.
                if (this._hi < 0) this._hi = 0;
              }}
            >${matches.map(
              (s, i) =>
                html`<div
                  class=${`icopt${i === hi ? " hi" : ""}`}
                  id=${`${this._id}-opt-${i}`}
                  role="option"
                  aria-selected=${s.name === this.value ? "true" : "false"}
                  @mousedown=${(e: MouseEvent) => {
                    e.preventDefault();
                    this._pick(s);
                  }}
                  @mousemove=${() => {
                    this._hi = i;
                  }}
                ><span class="icname">${s.name}</span>${
                  s.terms.length
                    ? html`<span class="icterms">${s.terms.slice(0, 3).join(", ")}</span>`
                    : nothing
                }<span class="icios">${t("symbols.ios", { version: s.ios })}</span></div>`,
            )}</div>`
              : html`<div class="icnote" role="status">${t("symbols.no-matches")}</div>`
        }<div class="ichelp">${t("symbols.help")}</div></div>`;
  }

  /** The keys of the input, and of the popup once focus is inside it. */
  private _onKeydown = (e: KeyboardEvent): void => {
    if (!this._open && (e.key === "ArrowDown" || e.key === "Enter")) {
      if (e.key === "ArrowDown") e.preventDefault();
      this._openPop(this._input?.value ?? "");
      return;
    }
    if (!this._open) return;
    if (e.key === "Escape") {
      this._close(true);
      return;
    }
    // Tab is never trapped: it moves on into the chips and the list, and
    // leaving the field closes the popup (_onFocusOut). On a chip the
    // other keys are the button's own (Enter and Space press it).
    if (e.target instanceof Element && e.target.closest(".iccats")) return;
    const matches = this._matches();
    const last = matches.length - 1;
    const move = (to: number): void => {
      e.preventDefault();
      this._hi = last < 0 ? -1 : clamp(to, 0, last);
    };
    if (e.key === "ArrowDown") move(this._hi + 1);
    else if (e.key === "ArrowUp") move(this._hi - 1);
    else if (e.key === "PageDown") move(this._hi + PAGE);
    else if (e.key === "PageUp") move(this._hi - PAGE);
    else if (e.key === "Enter") {
      // Enter with nothing highlighted keeps what was typed: any name
      // is accepted, the index is only there to help.
      if (this._hi >= 0) {
        e.preventDefault();
        this._pick(matches[this._hi]);
      } else this._close(true);
    }
  };
}

define("aivi-icon-field", AiviIconField);
