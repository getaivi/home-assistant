// Leading the eye between the preview and the form: a press on a canvas
// region flashes the fields that paint it, focus in a field outlines its
// regions on the canvas, and the bar's chip jumps to the row Save is
// waiting for. It never filters the form.

import type { ReactiveController } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { slotById, slotsForField } from "./slots";

const FLASH_MS = 1200;
const CONTROLS = "input, select, textarea, button";

export class FormSpotlight implements ReactiveController {
  private readonly _host: AiviEditor;
  private _hot: string[] = [];
  private _flashTimer: number | undefined;

  constructor(host: AiviEditor) {
    this._host = host;
    host.addController(this);
  }

  hostDisconnected(): void {
    clearTimeout(this._flashTimer);
  }

  /** The canvas regions currently outlined: those the focused field paints
   * (possibly several), or the one just pressed. Highlight only. */
  get hot(): string[] {
    return this._hot;
  }

  clear(): void {
    this._setHot([]);
  }

  /** A press on a canvas region: outline it, scroll its first field into
   * view and flash them all. On a phone the preview is a sheet over the
   * form: it closes first, so the field is not scrolled to behind it. A
   * keyboard press moves focus to the field (it is where the user is
   * going); a pointer press leaves focus alone, unless the closing sheet
   * takes the pressed region with it. */
  pressSlot(id: string | null, keyboard: boolean): void {
    const host = this._host;
    this._setHot(id ? [id] : []);
    if (!id) return;
    const slot = slotById(host.editorState.kind, host.editorState.template, id);
    if (!slot) return;
    const sheet = host.panel.narrow && host.previewOpen;
    if (sheet) host.previewOpen = false;
    // Wait one frame for the outline to paint (and the sheet to close)
    // before measuring scroll.
    requestAnimationFrame(() => {
      let first: HTMLElement | null = null;
      for (const key of slot.fields) {
        const row = host.querySelector<HTMLElement>(`.field[data-key="${key}"]`);
        if (!row) continue;
        first ??= row;
        row.classList.remove("flash");
        // Forces a reflow so a repeated press restarts the animation.
        void row.offsetWidth;
        row.classList.add("flash");
      }
      if (keyboard) first?.querySelector<HTMLElement>(CONTROLS)?.focus({ preventScroll: true });
      else if (sheet) host.querySelector<HTMLElement>(".pvtoggle")?.focus({ preventScroll: true });
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      // A timer, not `animationend`: under prefers-reduced-motion the flash
      // has no animation, so the class would never be cleared.
      clearTimeout(this._flashTimer);
      this._flashTimer = window.setTimeout(() => {
        for (const el of host.querySelectorAll(".field.flash")) el.classList.remove("flash");
      }, FLASH_MS);
    });
  }

  /** Follow focus with the canvas highlight; delegated so rows stay unaware
   * of slots. */
  followFocus(ev: FocusEvent): void {
    const host = this._host;
    const target = ev.target;
    const row = target instanceof Element ? target.closest<HTMLElement>(".field[data-key]") : null;
    const key = row?.dataset["key"];
    const next = key
      ? slotsForField(host.editorState.kind, host.editorState.template, key).map((s) => s.id)
      : [];
    if (next.join(" ") !== this._hot.join(" ")) this._setHot(next);
  }

  /** Go to the first of `rows` (selectors, null for a blocker no single
   * row holds) in form order: it lands in view, clear of the sticky bar,
   * with focus in its control. With none, the form's own note about too
   * much content is where to go. */
  jumpTo(rows: (string | null)[]): void {
    const host = this._host;
    const found = rows
      .map((selector) => (selector ? host.querySelector<HTMLElement>(selector) : null))
      .filter((el): el is HTMLElement => el !== null)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const row = found[0] ?? host.querySelector<HTMLElement>(".form .tnote.error");
    if (!row) return;
    // On a phone the open preview sheet would cover the row.
    host.previewOpen = false;
    row.classList.add("flash");
    clearTimeout(this._flashTimer);
    this._flashTimer = window.setTimeout(() => row.classList.remove("flash"), FLASH_MS);
    // Focus first, scroll last: a picker scrolls on focus by itself, and
    // whichever scroll comes last is the one that stays. Not smooth: the
    // picker's list scrolling its option into view would cut it short.
    // The row's scroll-margin-top keeps it clear of the sticky bar.
    row.querySelector<HTMLElement>(CONTROLS)?.focus({ preventScroll: true });
    row.scrollIntoView({ block: "start" });
  }

  private _setHot(hot: string[]): void {
    this._hot = hot;
    this._host.requestUpdate();
  }
}
