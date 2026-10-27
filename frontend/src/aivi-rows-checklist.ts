// Row fields (list rows, battery devices, switchboard tiles): the picked
// rows as one ordered list, with an entity picker under it to add more.
// The stored list is the row order on the widget. Reordering is
// pointer-draggable via the grip and keyboard-accessible (Alt+Arrow);
// every move is announced through a polite live region. Each row's header
// opens its options (stored under `<key>__options` keyed by entity id)
// and shows how many are set. The host carries class="checks".

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import type { AiviEditor } from "./aivi-editor";
import { define } from "./define";
import { isTileField, rowsMax } from "./editor-validation";
import { FoldState, fold, option } from "./form-kit";
import { type TranslationKey, t } from "./i18n";
import { icon } from "./icons";
import { note } from "./notice";
import { dropIndex, indicatorOffset, indicatorSlot, isDrag, moveItem } from "./reorder";
import {
  autoWord,
  budgetText,
  forwardablePicture,
  GRADIENT_NONE,
  IMAGE_ALT_MAX,
  IMAGE_FROM_ENTITY,
  IMAGE_URL_MAX,
  plainNumber,
  pressKey,
  rowProblems,
  tileKind,
  wordOption,
} from "./switchboard";
import {
  asRowOptionsMap,
  asStringArray,
  type RowOptions,
  type RowOptionsMap,
} from "./types/bindings";
import type { EntityOption } from "./types/hass";
import type { EntityFilter, FieldMeta } from "./types/meta";
import { markerKey } from "./value-source";

/** The row option a battery's charging sensor is stored under: the
 * `charging` slot in entity mode. */
const CHARGING_SENSOR = markerKey("charging", "entity");

/** A row's controls, in document order: where focus can return to after
 * the row moves. Disabled ones count, so an index means the same control
 * before and after. */
const ROW_CONTROLS = "button, input, select, textarea";

/** A drag's geometry, captured once at the press: rows never move during
 * a drag (the lifted row only translates), so no per-move layout reads.
 * `mids` are viewport midpoints for `dropIndex`, `edges` top/bottom
 * relative to the strip for the origin placeholder and insertion line. */
interface DragGeometry {
  startY: number;
  mids: number[];
  edges: { top: number; bottom: number }[];
}

class AiviRowsChecklist extends LitElement {
  static override properties = {
    editor: { attribute: false },
    field: { attribute: false },
    _focus: { state: true },
    _dragTo: { state: true },
    _dragY: { state: true },
    _announce: { state: true },
  };
  declare editor: AiviEditor;
  declare field: FieldMeta;
  /** The roving tab stop among the grips; -1 = the first row. */
  declare private _focus: number;
  /** The row a live drag currently targets; -1 = no drag. */
  declare private _dragTo: number;
  /** Pointer travel since the drag started; drives the lifted row's
   * translateY. */
  declare private _dragY: number;
  /** The last reorder, spoken through the polite live region. */
  declare private _announce: string;

  /** Rows whose per-row options disclosure is open (by entity id). */
  private _open = new Set<string>();
  /** The folds inside the open rows (`<entity id>:<fold>`). */
  private _folds = new FoldState();
  /** Tiles whose second line is set to Custom. The stored text alone
   * cannot show that while it is still empty. */
  private _customSubtitle = new Set<string>();
  /** What a switch put aside so switching back restores it: the charging
   * sensor under "No charging bolt", a hidden state word, a picture's
   * description while there is no picture (`<entity id>\n<option>`).
   * Kept here, never stored: the binding holds only what applies. */
  private _parked = new Map<string, string>();
  /** A press on a grip that has not traveled far enough to be a drag
   * yet (`isDrag`): the row it is on, and the geometry at the press. */
  private _press: { from: number; geom: DragGeometry } | null = null;
  /** The dragged row's index while a grip drag is live; -1 otherwise. */
  private _dragFrom = -1;
  private _dragGeom: DragGeometry | null = null;

  constructor() {
    super();
    this._focus = -1;
    this._dragTo = -1;
    this._dragY = 0;
    this._announce = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._endPress();
  }

  private get _order(): string[] {
    return asStringArray(this.editor.editorState.bindings[this.field.key]);
  }

  private get _optionsKey(): string {
    return `${this.field.key}__options`;
  }

  private _optionsOf(id: string): RowOptions {
    return asRowOptionsMap(this.editor.editorState.bindings[this._optionsKey])[id] ?? {};
  }

  private _name(id: string): string {
    return this.editor.panel.hass.states[id]?.attributes.friendly_name || id;
  }

  private _store(order: string[]): void {
    const b = this.editor.editorState.bindings;
    if (order.length) b[this.field.key] = [...order];
    else delete b[this.field.key];
    // Options never outlive their row: deselecting drops the entry, so the
    // saved binding carries no orphans.
    const map = asRowOptionsMap(b[this._optionsKey]);
    const kept: RowOptionsMap = {};
    for (const id of order) if (map[id]) kept[id] = map[id];
    if (Object.keys(kept).length) b[this._optionsKey] = kept;
    else delete b[this._optionsKey];
    this.editor.schedulePreview();
    this.editor.updateValidation();
    this.requestUpdate();
  }

  /** Set an option that has validation, so the editor's Save gate follows
   * the stored value. */
  private _setChecked(id: string, option: string, value: string | null): void {
    this._setOption(id, option, value);
    this.editor.updateValidation();
  }

  private _setOption(id: string, option: string, value: string | null): void {
    const b = this.editor.editorState.bindings;
    const map = asRowOptionsMap(b[this._optionsKey]);
    const options = { ...(map[id] ?? {}) };
    const clean = value?.trim();
    if (clean) options[option] = clean;
    else delete options[option];
    if (Object.keys(options).length) map[id] = options;
    else delete map[id];
    if (Object.keys(map).length) b[this._optionsKey] = map;
    else delete b[this._optionsKey];
    this.editor.schedulePreview();
    this.requestUpdate();
  }

  /** Set a state word: text (trimmed; empty means the default word), ""
   * to hide it, or null for the default. Unlike other options, "" is
   * kept: it is the hidden word. */
  private _setWord(id: string, option: string, value: string | null): void {
    const b = this.editor.editorState.bindings;
    const map = asRowOptionsMap(b[this._optionsKey]);
    const options = { ...(map[id] ?? {}) };
    const clean = value === "" ? "" : value?.trim() || null;
    if (clean === null) delete options[option];
    else options[option] = clean;
    if (Object.keys(options).length) map[id] = options;
    else delete map[id];
    if (Object.keys(map).length) b[this._optionsKey] = map;
    else delete b[this._optionsKey];
    this.editor.schedulePreview();
    this.requestUpdate();
  }

  /** Put `option` aside (see `_parked`) and take it out of the binding. */
  private _park(id: string, option: string): void {
    const stored = this._optionsOf(id)[option];
    if (!stored) return;
    this._parked.set(`${id}\n${option}`, stored);
    this._setOption(id, option, null);
  }

  /** Store what `_park` put aside again, unless something newer is. */
  private _unpark(id: string, option: string): void {
    const key = `${id}\n${option}`;
    const parked = this._parked.get(key);
    if (parked === undefined) return;
    this._parked.delete(key);
    if (!this._optionsOf(id)[option]) this._setOption(id, option, parked);
  }

  /** After the list re-renders, focus what `find` returns. A row that
   * moves is re-inserted and a removed one is gone, and either way the
   * browser drops focus to the page unless it is put somewhere. */
  private _focusAfterUpdate(find: () => HTMLElement | null | undefined): void {
    void this.updateComplete.then(() => find()?.focus());
  }

  /** Move a row. Focus follows it, onto the control that moved it
   * (`origin`: a move button, or whatever held focus for Alt+Arrow), or
   * its grip where that control is now disabled (Move up, in first
   * place). */
  private _move(from: number, to: number, origin: HTMLElement | null = null): void {
    const order = this._order;
    if (to < 0 || to >= order.length || from === to) return;
    const id = order[from];
    const row = this._rows()[from];
    const control =
      row && origin ? [...row.querySelectorAll<HTMLElement>(ROW_CONTROLS)].indexOf(origin) : -1;
    this._focus = to;
    this._announce = t("checklist.moved", {
      name: id ? this._name(id) : "",
      position: to + 1,
      count: order.length,
    });
    this._store(moveItem(order, from, to));
    this._focusAfterUpdate(() => {
      const moved = this._rows()[to];
      const same = moved?.querySelectorAll<HTMLButtonElement>(ROW_CONTROLS)[control];
      return same && !same.disabled ? same : moved?.querySelector<HTMLElement>(".grip");
    });
  }

  /** The picker's input, when the picker is offered. */
  private _picker(): HTMLElement | null {
    return this.querySelector<HTMLElement>("aivi-entity-combobox.rowadd input");
  }

  /** Add a row. When that was the last one the list takes (the cap, or
   * nothing left to pick), the picker is replaced by the reason: focus
   * goes to the row just added rather than dropping to the page. */
  private _add(id: string): void {
    const order = this._order;
    if (order.length >= rowsMax(this.field)) return;
    this._store([...order, id]);
    this._focusAfterUpdate(() => {
      if (this._picker()) return null;
      const rows = this._rows();
      this._focus = rows.length - 1;
      return rows.at(-1)?.querySelector<HTMLElement>(".grip");
    });
  }

  /** Remove a row. Focus goes to the Remove of the row that took its
   * place (the one before it, at the end), or to the picker when the
   * list is empty. */
  private _remove(id: string): void {
    const order = this._order;
    const at = order.indexOf(id);
    if (at < 0) return;
    this._open.delete(id);
    this._folds.drop(`${id}:`);
    this._customSubtitle.delete(id);
    for (const key of [...this._parked.keys()])
      if (key.startsWith(`${id}\n`)) this._parked.delete(key);
    this._store(order.filter((x) => x !== id));
    this._focusAfterUpdate(() => {
      const rows = this._rows();
      const next = rows[Math.min(at, rows.length - 1)];
      return next ? next.querySelector<HTMLElement>(".rm") : this._picker();
    });
  }

  private _rows(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>(".ordrow")];
  }

  private _onStripKeydown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    const rows = this._rows();
    const row = target.closest<HTMLElement>(".ordrow");
    const at = row ? rows.indexOf(row) : -1;
    if (at < 0) return;
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    // Alt+Arrow moves the focused row, from any control in it except the
    // ones that use the key themselves: a text input's caret, and a
    // select, which Alt+Down opens.
    if (dir && e.altKey && !target.closest("input, select, textarea")) {
      e.preventDefault();
      this._move(at, at + dir, target);
      return;
    }
    // Plain arrows rove focus among the grips (one tab stop per strip).
    if (!target.classList.contains("grip") || e.altKey) return;
    let next: number | null = null;
    if (dir) next = (at + dir + rows.length) % rows.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    if (next === null) return;
    e.preventDefault();
    this._focus = next;
    void this.updateComplete.then(() => {
      this._rows()[next]?.querySelector<HTMLElement>(".grip")?.focus();
    });
  };

  private _onGripDown(e: PointerEvent, i: number): void {
    // Capture keeps move/up events on the grip for the whole drag. (The
    // guard tolerates synthetic MouseEvents in the test harness.)
    if (e.pointerId !== undefined)
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const listTop = this.querySelector(".ordlist")?.getBoundingClientRect().top ?? 0;
    const rects = this._rows().map((row) => row.getBoundingClientRect());
    // Only a press so far: the row lifts once the pointer has traveled
    // (`isDrag`), so a tap or a slipping thumb never reorders.
    this._press = {
      from: i,
      geom: {
        startY: e.clientY,
        mids: rects.map((r) => r.top + r.height / 2),
        edges: rects.map((r) => ({
          top: r.top - listTop,
          bottom: r.bottom - listTop,
        })),
      },
    };
    // Escape cancels the drag from wherever focus is (a grip pressed in
    // Safari never takes it).
    window.addEventListener("keydown", this._onDragKey, true);
  }

  private _onGripMove(e: PointerEvent): void {
    const press = this._press;
    if (!press) return;
    const travel = e.clientY - press.geom.startY;
    if (this._dragFrom < 0) {
      if (!isDrag(travel)) return;
      this._dragFrom = press.from;
      this._dragGeom = press.geom;
    }
    this._dragY = travel;
    this._dragTo = dropIndex(press.geom.mids, press.from, e.clientY);
  }

  /** Forget the press and any drag it became, moving nothing. */
  private _endPress(): void {
    window.removeEventListener("keydown", this._onDragKey, true);
    this._press = null;
    this._dragFrom = -1;
    this._dragGeom = null;
    this._dragY = 0;
    this._dragTo = -1;
  }

  private _onDragKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || this._dragFrom < 0) return;
    // The drag handles this Escape: nothing behind it (a dialog, the
    // editor's leave prompt) should also act on it.
    e.preventDefault();
    e.stopPropagation();
    this._endPress();
  };

  private _onGripUp(e: Event): void {
    const from = this._dragFrom;
    const to = this._dragTo;
    this._endPress();
    if (from < 0) return;
    const grip = e.currentTarget as HTMLElement;
    if (to !== from) this._move(from, to, grip);
  }

  private _tabStop(length: number): number {
    return this._focus >= 0 && this._focus < length ? this._focus : 0;
  }

  private _ordRow(id: string, i: number, count: number): TemplateResult {
    const name = this._name(id);
    const open = this._open.has(id);
    const options = this._optionsOf(id);
    // What is set, as the push sees it: a picture's description with no
    // picture describes nothing.
    const set = Object.keys(options).filter(
      (key) => key !== "image_alt" || hasPicture(options),
    ).length;
    const has = set > 0;
    // An option the push would drop blocks Save, so the row shows it even
    // while its options are closed.
    const bad = Object.keys(this._problems(options)).length > 0;
    // The grabbed row lifts visually but keeps its layout slot, so
    // neighbors never reflow mid-drag.
    const lifted = this._dragFrom === i;
    return html`<div
        class=${`ordrow${lifted ? " draglift" : ""}`} role="listitem"
        data-id=${id}
        style=${lifted ? `transform:translateY(${this._dragY}px) scale(1.02)` : nothing}
      ><div class="ordhead"><button
          type="button" class="grip"
          aria-label=${t("checklist.reorder", { name })}
          title=${t("checklist.reorder-hint")}
          tabindex=${i === this._tabStop(count) ? "0" : "-1"}
          @pointerdown=${(e: PointerEvent) => this._onGripDown(e, i)}
          @pointermove=${(e: PointerEvent) => this._onGripMove(e)}
          @pointerup=${(e: PointerEvent) => this._onGripUp(e)}
          @pointercancel=${() => this._endPress()}
        >${icon("drag-vertical")}</button><span class="i">${String(i + 1)}</span><button
          type="button" class=${`rowtoggle opt${has ? " has" : ""}${bad ? " bad" : ""}`}
          aria-expanded=${open ? "true" : "false"}
          aria-invalid=${bad ? "true" : nothing}
          @click=${() => {
            if (open) this._open.delete(id);
            else this._open.add(id);
            this.requestUpdate();
          }}
        ><span class="tri" aria-hidden="true">${icon("chevron-right")}</span><span class="n">${name}</span> ${
          bad
            ? html`<span class="rsum bad">${t("checklist.fix")}</span>`
            : set
              ? html`<span class="rsum">${t("fold.set", { count: set })}</span>`
              : nothing
        }</button><span class="rowacts"><button
          type="button" class="mv" title=${t("common.move-up")}
          aria-label=${t("checklist.move-up", { name })}
          ?disabled=${i === 0}
          @click=${(e: Event) => this._move(i, i - 1, e.currentTarget as HTMLElement)}
        >${icon("arrow-up")}</button><button
          type="button" class="mv" title=${t("common.move-down")}
          aria-label=${t("checklist.move-down", { name })}
          ?disabled=${i === count - 1}
          @click=${(e: Event) => this._move(i, i + 1, e.currentTarget as HTMLElement)}
        >${icon("arrow-down")}</button><button
          type="button" class="mv rm" title=${t("common.remove")}
          aria-label=${t("checklist.remove", { name })}
          @click=${() => this._remove(id)}
        >${icon("close")}</button></span></div>${
          open ? this._optionsBody(id, name) : nothing
        }</div>`;
  }

  /** Per-row overrides, from the field's metadata (`row_options`): only
   * what the wire contract carries for this template's rows. Text inputs
   * bind their value as an attribute (initial content only) so re-renders
   * never touch what the user is typing. */
  private _optionsBody(id: string, name: string): TemplateResult {
    const supported = this.field.row_options ?? [];
    const options = this._optionsOf(id);
    const meta = this.editor.panel.meta;
    const tile = isTileField(this.field);
    const budgetProblem = this._problems(options)["budget"];
    const text = (
      option: string,
      label: string,
      aria: string,
      placeholder: string,
    ): TemplateResult =>
      html`<div class="ctl"><span class="k">${label}</span><input
          type="text" aria-label=${aria} value=${options[option] ?? ""}
          placeholder=${placeholder} spellcheck="false"
          @input=${(e: Event) => this._setOption(id, option, (e.target as HTMLInputElement).value)}
        /></div>`;
    return html`<div class="rowopts foldbody">${
      // Any row a device presses says what a press does, a Live
      // Activity's buttons as much as a switchboard's tiles.
      tile || this._hexColors
        ? html`<div class="ctl pressline"><span class="k">${t("switchboard.press")}</span><span class="pressdoes">${t(
            pressKey(id, this.field.state_text),
            { name },
          )}</span></div>`
        : nothing
    }${
      supported.includes("label")
        ? text("label", t("field-label.label"), t("checklist.label-aria", { name }), name)
        : nothing
    }${
      supported.includes("unit")
        ? text(
            "unit",
            t("field-label.unit"),
            t("checklist.unit-aria", { name }),
            this._unitOf(id) ?? t("checklist.unit-placeholder"),
          )
        : nothing
    }${
      supported.includes("icon")
        ? option(
            t("field-label.icon"),
            html`<aivi-icon-field
              class="iconfield"
              .value=${options["icon"] ?? null}
              .label=${t("checklist.icon-aria", { name })}
              .placeholder=${t("field.icon-placeholder")}
              .onChange=${(icon: string | null) => this._setOption(id, "icon", icon)}
            ></aivi-icon-field>`,
          )
        : nothing
    }${
      supported.includes("color")
        ? option(
            t("common.color"),
            html`<aivi-color-field
              class="cfield"
              .colors=${meta.colors}
              .value=${options["color"] ?? null}
              .hex=${this._hexColors}
              .label=${t("checklist.color-aria", { name })}
              .onChange=${(c: string | null) => this._setChecked(id, "color", c)}
            ></aivi-color-field>`,
            tile ? t("switchboard.color-hint") : null,
          )
        : nothing
    }${supported.includes("max") ? this._max(id, name, options) : nothing}${
      supported.includes("budget")
        ? html`<div class="ctl"><span class="k">${t("checklist.budget")}</span><input
              type="text" inputmode="decimal" spellcheck="false"
              class=${budgetProblem ? "bad" : ""}
              aria-label=${t("checklist.budget-aria", { name })}
              aria-invalid=${budgetProblem ? "true" : "false"}
              value=${options["budget"] ?? ""}
              placeholder=${t("checklist.budget-placeholder")}
              @input=${(e: Event) =>
                this._setChecked(id, "budget", budgetText((e.target as HTMLInputElement).value))}
            />${budgetProblem ? note("error", t(budgetProblem), { role: "alert" }) : nothing}</div>`
        : nothing
    }${supported.includes("charging") ? this._charging(id, name, options) : nothing}${
      supported.includes("today")
        ? html`<div class="ctl"><span class="k">${t("checklist.today")}</span>${this._entityOption(
            id,
            "today",
            t("checklist.today-aria", { name }),
            { domain: "sensor", device_class: "energy" },
            options["today"] ?? null,
          )}<div class="fhint">${t("checklist.today-hint")}</div></div>`
        : nothing
    }${
      tile ? this._tileMarks(id, name, options) : nothing
    }${this._stateWords(id, name, options)}</div>`;
  }

  /** The unit a stat shows when its row sets none: the entity's own. */
  private _unitOf(id: string): string | null {
    const unit = this.editor.panel.hass.states[id]?.attributes["unit_of_measurement"];
    return typeof unit === "string" && unit ? unit : null;
  }

  /** A stat's gauge ceiling: a number above 0 (anything else holds Save),
   * and a note while the reading is not a number, which then shows as
   * text with no gauge. */
  private _max(id: string, name: string, options: RowOptions): TemplateResult {
    const problem = this._problems(options)["max"];
    const reading = this.editor.panel.hass.states[id]?.state;
    const words = !!options["max"] && !problem && reading !== undefined && !plainNumber(reading);
    return html`<div class="ctl"><span class="k">${t("checklist.max")}</span><input
        type="text" inputmode="decimal" spellcheck="false"
        class=${problem ? "bad" : ""}
        aria-label=${t("checklist.max-aria", { name })}
        aria-invalid=${problem ? "true" : "false"}
        value=${options["max"] ?? ""}
        placeholder=${t("checklist.max-placeholder")}
        @input=${(e: Event) =>
          this._setChecked(id, "max", (e.target as HTMLInputElement).value.replace(",", "."))}
      />${
        problem
          ? note("error", t(problem), { role: "alert" })
          : words
            ? note("warn", t("checklist.max-words", { value: reading ?? "" }), { role: "status" })
            : html`<div class="fhint">${t("checklist.max-hint")}</div>`
      }</div>`;
  }

  /** What the push would drop from one row's options, by option. */
  private _problems(options: RowOptions): Record<string, TranslationKey> {
    return rowProblems(options, this.editor.panel.meta.colors, isTileField(this.field));
  }

  /** What can report a battery row as charging: any binary sensor (the
   * charging ones first), or a sensor that reads as a word ("Charging").
   * Never a measurement (a temperature, a price), nor the row's own
   * battery sensor. The picked sensor stays listed whatever it reads. */
  private _chargingOptions(id: string, picked: string | null): EntityOption[] {
    const states = this.editor.panel.hass.states;
    return this.editor.panel
      .entities({
        domain: ["binary_sensor", "sensor"],
        device_class_first: "battery_charging",
      })
      .filter((o) => {
        if (o.id === id) return false;
        if (o.id === picked || o.id.startsWith("binary_sensor.")) return true;
        const st = states[o.id];
        if (!st) return false;
        const attrs = st.attributes;
        return (
          attrs["unit_of_measurement"] === undefined &&
          attrs["state_class"] === undefined &&
          !(st.state.trim() !== "" && Number.isFinite(Number(st.state)))
        );
      });
  }

  /** An entity picked for one row option (stored under `option`). */
  private _entityOption(
    id: string,
    option: string,
    label: string,
    from: EntityFilter | EntityOption[],
    value: string | null,
    placeholder: string | null = null,
  ): TemplateResult {
    return html`<aivi-entity-combobox
      class="cbx"
      .options=${Array.isArray(from) ? from : this.editor.panel.entities(from)}
      .label=${label}
      .placeholder=${placeholder}
      .value=${value}
      .onSelect=${(picked: string | null) => this._setOption(id, option, picked)}
    ></aivi-entity-combobox>`;
  }

  /** Shown when the last preview could not read the row's charging
   * sensor: the push then shows no bolt. */
  private _chargingNote(id: string): unknown {
    const fb = this.editor.editorState.fieldFeedback?.[`${this.field.key}.${id}.charging`];
    return fb?.status === "fallback"
      ? note("warn", t("checklist.charging-unavailable"), { role: "status" })
      : nothing;
  }

  /** A battery row's charging bolt: a sensor that reports it, nothing set
   * (the device's own charging sensor is filled in on save), or off. */
  private _charging(id: string, name: string, options: RowOptions): TemplateResult {
    const off = options["charging"] === "off";
    return html`<div class="ctl"><span class="k">${t("checklist.charging")}</span>${
      off
        ? nothing
        : this._entityOption(
            id,
            CHARGING_SENSOR,
            t("checklist.charging-aria", { name }),
            this._chargingOptions(id, options[CHARGING_SENSOR] ?? null),
            options[CHARGING_SENSOR] ?? null,
            t("checklist.charging-auto"),
          )
    }${options[CHARGING_SENSOR] ? this._chargingNote(id) : nothing}<label class="chk"><input
          type="checkbox" .checked=${live(off)}
          aria-label=${t("checklist.charging-off-aria", { name })}
          @change=${(e: Event) => {
            // Off and a sensor cannot both be stored (the sensor would
            // win), so the picked sensor is put aside and comes back when
            // the box is unticked.
            if ((e.target as HTMLInputElement).checked) {
              this._park(id, CHARGING_SENSOR);
              this._setOption(id, "charging", "off");
            } else {
              this._setOption(id, "charging", null);
              this._unpark(id, CHARGING_SENSOR);
            }
          }}
        /><span>${t("checklist.charging-off")}</span></label><div class="fhint">${t("checklist.charging-hint")}</div></div>`;
  }

  /** Switchboard tiles take a hex color as well as a palette one
   * (Aivi's action color); nothing else in Aivi does, so the color
   * field offers it only where the field's row color slot allows it. */
  private get _hexColors(): boolean {
    return this.field.row_slots?.["color"]?.kind === "action_color";
  }

  /** One of a row's folds, remembering whether it is open. */
  private _fold(
    id: string,
    key: string,
    title: string,
    summary: string | null,
    initial: boolean,
    body: unknown,
    invalid = false,
  ): TemplateResult {
    const at = `${id}:${key}`;
    return fold({
      title,
      // A closed fold must not hide what blocks Save.
      summary: invalid ? t("checklist.fix") : summary,
      invalid,
      open: this._folds.open(at, () => initial),
      onToggle: (open) => this._folds.set(at, open),
      body,
    });
  }

  /** A switchboard tile's marks: the second line always in view, the
   * gradient and the picture each in a fold whose summary shows what is
   * set. Everything is checked against what Aivi accepts as it changes. */
  private _tileMarks(id: string, name: string, options: RowOptions): TemplateResult {
    const meta = this.editor.panel.meta;
    const isLight = id.startsWith("light.");
    const custom = !!options["subtitle"] || this._customSubtitle.has(id);
    const mode = custom ? "custom" : (options["subtitle_mode"] ?? "area");
    const rawGradient = (options["gradient"] ?? "").trim();
    const gradientSummary = !rawGradient
      ? isLight
        ? t("gradient.auto")
        : null
      : rawGradient.toLowerCase() === GRADIENT_NONE
        ? t("gradient.none")
        : t("gradient.custom");
    const image = options["image"]?.trim() ?? "";
    const problems = this._problems(options);
    const imageProblem = problems["image"] ?? null;
    const picture = this.editor.panel.hass.states[id]?.attributes["entity_picture"];
    const usable = forwardablePicture(picture);
    const optedIn = options["image_source"] === IMAGE_FROM_ENTITY;
    // A URL wins over the entity's picture, and a description needs a
    // picture: what does not apply is put aside (`_parked`), not stored,
    // and comes back when it applies again.
    const settlePicture = (): void => {
      const now = this._optionsOf(id);
      if (now["image"]) this._park(id, "image_source");
      else this._unpark(id, "image_source");
      if (hasPicture(this._optionsOf(id))) this._unpark(id, "image_alt");
      else this._park(id, "image_alt");
    };
    const problemNote = (key: TranslationKey | null): unknown =>
      key ? note("error", t(key), { role: "alert" }) : nothing;
    return html`${option(
      t("switchboard.subtitle"),
      html`<select
          aria-label=${t("switchboard.subtitle-aria", { name })}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            if (value === "custom") {
              // Custom replaces the mode that was picked: left stored, it
              // would still be what the tile shows until text is typed,
              // and what an emptied text falls back to.
              this._customSubtitle.add(id);
              this._setOption(id, "subtitle_mode", null);
              return;
            }
            this._customSubtitle.delete(id);
            this._setOption(id, "subtitle", null);
            this._setOption(id, "subtitle_mode", value === "area" ? null : value);
          }}
        >${(["area", "state", "custom", "none"] as const).map(
          (m) =>
            html`<option value=${m} ?selected=${m === mode}>${t(`switchboard.subtitle-${m}`)}</option>`,
        )}</select>${
          custom
            ? html`<input
            type="text" aria-label=${t("switchboard.subtitle-custom-aria", { name })}
            value=${options["subtitle"] ?? ""} maxlength="128"
            placeholder=${t("switchboard.subtitle-placeholder")}
            @input=${(e: Event) =>
              this._setOption(id, "subtitle", (e.target as HTMLInputElement).value)}
          />`
            : nothing
        }`,
      t("switchboard.subtitle-hint"),
    )}${this._fold(
      id,
      "gradient",
      t("switchboard.gradient"),
      gradientSummary,
      !!rawGradient,
      html`<aivi-gradient-field
          class="gfield"
          .colors=${meta.colors}
          .value=${options["gradient"] ?? null}
          .auto=${isLight}
          .label=${t("switchboard.gradient-aria", { name })}
          .onChange=${(raw: string | null) => this._setChecked(id, "gradient", raw)}
        ></aivi-gradient-field><div class="fhint">${t("switchboard.gradient-hint")}</div>`,
      !!problems["gradient"],
    )}${this._fold(
      id,
      "picture",
      t("switchboard.picture"),
      image ? t("switchboard.picture-custom") : optedIn ? t("switchboard.picture-entity") : null,
      !!image || optedIn,
      html`${option(
        t("switchboard.image"),
        html`<input
            type="text" inputmode="url" class=${imageProblem ? "bad" : ""}
            aria-label=${t("switchboard.image-aria", { name })}
            aria-invalid=${imageProblem ? "true" : "false"}
            value=${image} maxlength=${String(IMAGE_URL_MAX)} spellcheck="false"
            placeholder="https://"
            @input=${(e: Event) => {
              this._setChecked(id, "image", (e.target as HTMLInputElement).value);
              settlePicture();
            }}
          />${problemNote(imageProblem)}`,
        t("switchboard.image-hint"),
      )}${option(
        t("switchboard.image-alt"),
        html`<input
            type="text" aria-label=${t("switchboard.image-alt-aria", { name })}
            value=${options["image_alt"] ?? this._parked.get(`${id}\nimage_alt`) ?? ""}
            maxlength=${String(IMAGE_ALT_MAX)}
            ?disabled=${!hasPicture(options)}
            @input=${(e: Event) =>
              this._setOption(id, "image_alt", (e.target as HTMLInputElement).value)}
          />`,
        t("switchboard.image-alt-hint"),
      )}${
        usable
          ? html`<label class="chk"><input
              type="checkbox" .checked=${live(optedIn)} ?disabled=${!!image}
              @change=${(e: Event) => {
                this._setOption(
                  id,
                  "image_source",
                  (e.target as HTMLInputElement).checked ? IMAGE_FROM_ENTITY : null,
                );
                settlePicture();
              }}
            /><span>${t("switchboard.picture-use")}</span></label>${
              optedIn ? note("warn", t("switchboard.picture-warn")) : nothing
            }`
          : typeof picture === "string" && picture
            ? html`<div class="fhint">${t("switchboard.picture-local")}</div>`
            : nothing
      }`,
      !!imageProblem,
    )}`;
  }

  /** A tile's state words: one line per word its kind takes, showing
   * the word it falls back to (the domain's, else the app's), with a
   * Hide box that stores "" (no word). A hidden word's input is rebuilt
   * (keyed) so it clears; otherwise inputs keep what the user types. */
  private _stateWords(
    id: string,
    name: string,
    options: RowOptions,
  ): TemplateResult | typeof nothing {
    const meta = this.field.state_text;
    if (!meta) return nothing;
    const keys = meta.keys[tileKind(id, meta)];
    const changed = keys.filter((key) => options[wordOption(key)] !== undefined).length;
    return this._fold(
      id,
      "words",
      t("switchboard.words"),
      changed ? t("switchboard.words-changed", { count: changed }) : null,
      changed > 0,
      html`<div class="words">${keys.map((key) => {
        const option = wordOption(key);
        const stored = options[option];
        const hidden = stored === "";
        const state = t(wordKey(key));
        const fallback =
          autoWord(id, key, meta) ?? (key === "idle" ? t("switchboard.word-none") : state);
        return html`<div class="wordrow"><span class="wk">${state}</span>${keyed(
          hidden,
          html`<input
            type="text" maxlength=${String(meta.max)} spellcheck="false"
            aria-label=${t("switchboard.word-aria", { state, name })}
            value=${hidden ? "" : (stored ?? "")} ?disabled=${hidden}
            placeholder=${hidden ? t("switchboard.word-hidden") : fallback}
            @input=${(e: Event) =>
              this._setWord(id, option, (e.target as HTMLInputElement).value || null)}
          />`,
        )}<label class="wordhide"><input
            type="checkbox" .checked=${live(hidden)}
            aria-label=${t("switchboard.word-hide-aria", { state, name })}
            @change=${(e: Event) => {
              // Hiding is not deleting: the typed word is put aside and
              // comes back when the box is unticked.
              const parkedAt = `${id}\n${option}`;
              if ((e.target as HTMLInputElement).checked) {
                const typed = this._optionsOf(id)[option];
                if (typed) this._parked.set(parkedAt, typed);
                this._setWord(id, option, "");
              } else {
                this._setWord(id, option, this._parked.get(parkedAt) ?? null);
                this._parked.delete(parkedAt);
              }
            }}
          /><span>${t("switchboard.word-hide")}</span></label></div>`;
      })}</div><div class="fhint">${t("switchboard.words-hint")}</div>`,
    );
  }

  /** Drag-only visuals, absolutely positioned so they never affect layout
   * and aria-hidden (the accessible path is the live region + grip
   * labels): a placeholder at the lifted row's origin and a line at the
   * drop gap (hidden when the drop would be a no-op). */
  private _dragArtifacts(): TemplateResult | typeof nothing {
    const geom = this._dragGeom;
    if (this._dragFrom < 0 || !geom) return nothing;
    const src = geom.edges[this._dragFrom];
    const line =
      this._dragTo !== this._dragFrom
        ? indicatorOffset(geom.edges, indicatorSlot(this._dragFrom, this._dragTo))
        : null;
    return html`${
      src
        ? html`<div
          class="dragslot" aria-hidden="true"
          style=${`top:${src.top}px;height:${src.bottom - src.top}px`}
        ></div>`
        : nothing
    }${
      line !== null
        ? html`<div
          class="dragline" aria-hidden="true"
          style=${`top:${line}px`}
        ></div>`
        : nothing
    }`;
  }

  override render(): unknown {
    const order = this._order;
    const max = rowsMax(this.field);
    const full = order.length >= max;
    const over = order.length > max;
    // Only what can still be added: a picked entity is already a row, and
    // one bound to another field of this form (the grid meter under
    // Generation, the Spent sensor under Categories) has its place.
    const elsewhere = this.editor.boundElsewhere(this.field.key);
    const fitting = this.editor.panel.entities(this.field.filter);
    const available = fitting.filter((o) => !order.includes(o.id) && !elsewhere.has(o.id));
    // Everything that fits is in use: a picker with nothing in it would
    // still invite a search that can only come up empty.
    const exhausted = !full && fitting.length > 0 && available.length === 0;
    // One line states why there is no picker; over the cap, only that the
    // extra rows are not sent, not "That's all 8" beside "9 of 8".
    const reason = over
      ? note("warn", t("checklist.over", { max }), { role: "status", cls: "rowfull" })
      : full
        ? html`<div class="fhint rowfull">${t("checklist.full", { max })}</div>`
        : exhausted
          ? html`<div class="fhint rowfull">${t("checklist.none-left")}</div>`
          : null;
    return html`<div
        class="ordlist" role="list"
        aria-label=${t("checklist.order-label")}
        style=${order.length ? "" : "display:none"}
        @keydown=${this._onStripKeydown}
      >${repeat(
        order,
        (id) => id,
        (id, i) => this._ordRow(id, i, order.length),
      )}${this._dragArtifacts()}</div><div class="rowfoot">${
        reason
          ? reason
          : html`<aivi-entity-combobox
            class="cbx rowadd"
            .picker=${true}
            .options=${available}
            .label=${t("checklist.add-label")}
            .placeholder=${order.length ? t("checklist.add-more") : t("checklist.add")}
            .value=${null}
            .onSelect=${(id: string | null) => {
              if (id) this._add(id);
            }}
          ></aivi-entity-combobox>`
      }<div class="count" role="status">${t("checklist.count", {
        count: order.length,
        max,
      })}</div></div><span class="sr-only" role="status">${this._announce}</span>`;
  }
}

/** Whether a tile has a picture to describe: a URL, or the entity's own. */
function hasPicture(options: RowOptions): boolean {
  return !!options["image"]?.trim() || options["image_source"] === IMAGE_FROM_ENTITY;
}

/** The catalog key naming a state word (`turning_on` -> `word-turning-on`). */
function wordKey(key: string): TranslationKey {
  return `switchboard.word-${key.replaceAll("_", "-")}` as TranslationKey;
}

define("aivi-rows-checklist", AiviRowsChecklist);
