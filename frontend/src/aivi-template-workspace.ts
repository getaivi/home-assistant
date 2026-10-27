// <aivi-template-workspace>: one template box as a page of its own (its
// address is in the URL, router.ts), as wide as the panel lets it be. A
// header (Back, what is being edited, Insert, the docs, Save) over three
// zones: the Insert rail (aivi-insert-list.ts), the editor, and the
// output, which holds the live widget preview and what the template
// gives. How the zones share the width is workspace-layout.ts's; on a
// phone the output is a one-line strip, a key row sits above the
// keyboard and Insert is a sheet over the lower half.
//
// The workspace edits the field itself: every edit is the form's, so
// Back keeps it and Save saves the widget. Escape closes the innermost
// thing open (the completion list, the find bar, the Insert search's
// text, an Insert rail over the editor), and with nothing open goes Back.
// Light DOM, inside the panel's shadow root, so the panel's styles reach
// it.

import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import "./aivi-insert-list";
import type { AiviInsertList, InsertPick } from "./aivi-insert-list";
import { isExpandShortcut } from "./aivi-template-box";
import type { FindResult } from "./code-editor/contract";
import type { AiviCodeEditor } from "./code-editor/element";
import { templateMarks } from "./code-editor/marks";
import { define } from "./define";
import { entityAt, entityCard, entityNear } from "./entity-card";
import { t } from "./i18n";
import { icon } from "./icons";
import { previewActivity } from "./preview/activity";
import { clipped } from "./preview/fit";
import { previewWidget } from "./preview-render";
import { loadSymbols, type SfIndex } from "./sf-symbols";
import { type TemplateSpec, templateBelow } from "./source-editor";
import { errorPlain, errorWhere, kindText } from "./template-feedback";
import { type ResultHint, resultHints, type TextEdit } from "./template-hints";
import { entityInsert, keyTitle, TEMPLATE_KEYS, withCaret } from "./template-inserts";
import { recipeInsert, recipeTitle } from "./template-recipes";
import type { WidgetContent } from "./types/content";
import { inNarrowPanel } from "./util";
import {
  railRemembered,
  rememberRail,
  type WorkspaceLayout,
  workspaceLayout,
} from "./workspace-layout";

/** Home Assistant's guide to templates. */
export const TEMPLATE_HELP = "https://www.home-assistant.io/docs/configuration/templating/";

/** Whether a key press toggles Insert: Ctrl+I, or Cmd+I on a Mac. */
export function isInsertShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i";
}

/** Whether the panel runs on a Mac, for the keys the hints name. */
function onMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Save and what it waits for, as the editor's bar has them. */
export interface WorkspaceBar {
  waiting: number;
  chipLabel: string;
  chipTitle: string;
  saving: boolean;
  saveError: string;
  onSave: () => void;
  /** Go to the first field Save waits for (in the form). */
  onJump: () => void;
}

/** The entity card in view: whose, where in the editor zone (px from its
 * left, and from its top, or with `above` from its bottom), and whether
 * the caret put it there (else the pointer). */
interface EntityCardAt {
  id: string;
  left: number;
  top: number;
  above: boolean;
  caret: boolean;
}

/** How long the pointer or the caret rests on an id before its card
 * shows, and how long the card stays once the pointer leaves. */
const CARD_DELAY = 350;
const CARD_LINGER = 200;
/** The card's width, to keep it inside the editor zone. */
const CARD_WIDTH = 320;

const WRAP_KEY = "aivi-template-wrap";

function wrapRemembered(): boolean {
  try {
    return sessionStorage.getItem(WRAP_KEY) === "on";
  } catch {
    return false;
  }
}

function rememberWrap(on: boolean): void {
  try {
    sessionStorage.setItem(WRAP_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the choice holds until the panel reloads.
  }
}

export class AiviTemplateWorkspace extends LitElement {
  static override properties = {
    editor: { attribute: false },
    spec: { attribute: false },
    heading: { attribute: false },
    context: { attribute: false },
    preview: { attribute: false },
    bar: { attribute: false },
    onBack: { attribute: false },
    layout: { state: true },
    _rail: { state: true },
    _strip: { state: true },
    _sheet: { state: true },
    _wrap: { state: true },
    _caret: { state: true },
    _find: { state: true },
    _said: { state: true },
    _card: { state: true },
    _clipped: { state: true },
    _symbols: { state: true },
  };
  declare editor: AiviEditor;
  declare spec: TemplateSpec;
  /** "State template". */
  declare heading: string;
  /** What it belongs to: "Front door", "Front door · Value". */
  declare context: string;
  /** The live preview card, as the editor draws it. */
  declare preview: unknown;
  declare bar: WorkspaceBar;
  declare onBack: () => void;
  /** How the zones share the width (workspace-layout.ts). */
  declare layout: WorkspaceLayout;
  /** Whether the Insert rail is open. */
  declare private _rail: boolean;
  /** Whether the output strip is expanded (strip and phone layouts). */
  declare private _strip: boolean;
  /** Whether a phone's Insert sheet is open. */
  declare private _sheet: boolean;
  declare private _wrap: boolean;
  declare private _caret: [number, number];
  /** The find bar, while it is open. */
  declare private _find: ({ query: string } & FindResult) | null;
  /** What the last insert was, for a screen reader. */
  declare private _said: string;
  /** The entity card in view: whose, where (in the editor zone), and
   * whether the caret put it there (else the pointer). */
  declare private _card: EntityCardAt | null;
  /** The widget size that cuts the result off, as the preview drew it. */
  declare private _clipped: string | null;
  /** Apple's symbol list, loaded for an icon's template. */
  declare private _symbols: SfIndex | null;

  private _observer: ResizeObserver | null = null;
  /** The rail was opened by Mod+I for one pick: it closes after it. */
  private _railForOne = false;
  /** The phone's mini widget, built once per preview answer. */
  private _mini: { node: HTMLElement; content: WidgetContent; key: string } | null = null;
  private _onViewport = (): void => this._fitViewport();
  /** The entity card's pending show or hide. */
  private _cardTimer: ReturnType<typeof setTimeout> | undefined;
  /** The pending look at whether the widget cuts the result off. */
  private _clipTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.heading = "";
    this.context = "";
    this.preview = nothing;
    this.onBack = () => {};
    this.layout = "docked";
    this._rail = railRemembered();
    this._strip = false;
    this._sheet = false;
    this._wrap = wrapRemembered();
    this._caret = [1, 1];
    this._find = null;
    this._said = "";
    this._card = null;
    this._clipped = null;
    this._symbols = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this._onKeydown);
    this._observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) this.fit(width);
    });
    this._observer.observe(this);
    this._watchViewport(true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._onKeydown);
    this._observer?.disconnect();
    this._observer = null;
    this._watchViewport(false);
    clearTimeout(this._cardTimer);
    clearTimeout(this._clipTimer);
  }

  protected override willUpdate(changed: PropertyValues): void {
    // The panel's narrow mode decides the phone layout at once; the
    // width the rest (it arrives with the first resize observation).
    const phone = inNarrowPanel(this);
    if (phone && this.layout !== "phone") this._setLayout("phone");
    else if (!phone && this.layout === "phone") this.fit(this.getBoundingClientRect().width);
    if (changed.has("layout") && this.layout === "phone") this._fitViewport();
    // An icon's result is held against Apple's symbol list; a list that
    // does not load leaves the hint out.
    if (changed.has("spec") && this.spec.kind === "icon" && !this._symbols)
      loadSymbols().then(
        (index) => {
          this._symbols = index;
        },
        () => {},
      );
  }

  protected override updated(): void {
    // The preview fits its text once it is laid out: look after that.
    clearTimeout(this._clipTimer);
    this._clipTimer = setTimeout(() => this._measureClip(), 60);
  }

  /** Whether the widget preview cuts the result off: a region showing
   * exactly the result whose text is wider than its box. */
  private _measureClip(): void {
    const spec = this.spec;
    const value = spec.text && !spec.stale ? spec.feedback?.value?.trim() : undefined;
    let size: string | null = null;
    const pane = this.querySelector("aivi-preview-pane");
    if (value && pane) {
      const regions = pane.querySelectorAll<HTMLElement>(".pv-canvas [data-slot]");
      const cut = [...regions].some((el) => el.textContent?.trim() === value && clipped(el));
      const medium = pane.querySelector(".pv-canvas.is-medium") !== null;
      if (cut) size = medium ? t("preview.size-medium") : t("preview.size-small");
    }
    if (size !== this._clipped) this._clipped = size;
  }

  // The entity card.

  /** The pointer rests on offset `pos` (null: it left), or the caret was
   * moved there: the card of the entity id there shows after a moment,
   * and goes when neither is on an id. */
  private _point(pos: number | null, caret: boolean): void {
    if (this.layout === "phone") return;
    const span = pos === null ? null : entityAt(this.spec.text, pos, this.spec.hass);
    const shown = this._card;
    clearTimeout(this._cardTimer);
    if (!span) {
      // The pointer leaving takes its own card; typing or moving the
      // caret off an id takes either.
      if (shown && (caret || !shown.caret))
        this._cardTimer = setTimeout(() => this._hideCard(), caret ? 0 : CARD_LINGER);
      return;
    }
    if (shown?.id === span.id && shown.caret === caret) return;
    this._cardTimer = setTimeout(() => this._showCard(span.id, span.from, caret), CARD_DELAY);
  }

  private _showCard(id: string, from: number, caret: boolean): void {
    const box = this.codeEditor();
    const zone = this.querySelector<HTMLElement>(".wsmain");
    if (!box || !zone) return;
    const rect = zone.getBoundingClientRect();
    // Where the id is drawn; at the zone's top where that cannot be told.
    const at = box.coordsAt(from) ?? { left: rect.left, top: rect.top, bottom: rect.top };
    const left = Math.max(8, Math.min(at.left - rect.left - 12, rect.width - CARD_WIDTH - 8));
    // Under the line, or over it where the zone ends too soon.
    const above = rect.bottom - at.bottom < 240 && at.top - rect.top > 240;
    const top = above ? rect.bottom - at.top + 6 : at.bottom - rect.top + 6;
    this._card = { id, left, top, above, caret };
  }

  private _hideCard(): void {
    clearTimeout(this._cardTimer);
    this._card = null;
  }

  private _cardView(): unknown {
    const card = this._card;
    if (!card) return nothing;
    const style = `left:${card.left}px;${card.above ? "bottom" : "top"}:${card.top}px`;
    return html`<div class="entcardwrap" style=${style}
      @mouseenter=${() => clearTimeout(this._cardTimer)}
      @mouseleave=${() => this._point(null, false)}
    >${entityCard(this.spec.hass, card.id, "aivi-ws-card")}</div>`;
  }

  protected override firstUpdated(): void {
    const width = this.getBoundingClientRect().width;
    if (width) this.fit(width);
    // A rail over the editor never opens by itself.
    if (this.layout !== "docked") this._rail = false;
    this.focusEditor();
  }

  /** The workspace's code editor. */
  codeEditor(): AiviCodeEditor | null {
    return this.querySelector<AiviCodeEditor>("aivi-code-editor.wsed");
  }

  /** Focus the editor where its caret is. */
  focusEditor(): void {
    void this.updateComplete.then(() => this.codeEditor()?.focusKeep());
  }

  /** Lay the zones out for a workspace `width` px wide. */
  fit(width: number): void {
    this._setLayout(workspaceLayout(width, inNarrowPanel(this)));
  }

  private _setLayout(next: WorkspaceLayout): void {
    if (next === this.layout) return;
    const before = this.layout;
    this.layout = next;
    // Into a layout where the rail lies over the editor: it closes; back
    // to a docked one, it is as the user left it.
    if (next === "docked" && before !== "docked") this._rail = railRemembered();
    else if (next !== "docked") this._rail = false;
    if (next === "docked" || next === "overlay") this._strip = false;
  }

  /** On a phone the workspace keeps to the part of the screen the
   * keyboard leaves (iOS lays the page out under it). */
  private _watchViewport(on: boolean): void {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    const method = on ? "addEventListener" : "removeEventListener";
    vv?.[method]("resize", this._onViewport);
    vv?.[method]("scroll", this._onViewport);
  }

  private _fitViewport(): void {
    const vv = window.visualViewport;
    if (this.layout !== "phone" || !vv) {
      this.style.removeProperty("--ws-top");
      this.style.removeProperty("--ws-height");
      return;
    }
    this.style.setProperty("--ws-top", `${vv.offsetTop}px`);
    this.style.setProperty("--ws-height", `${vv.height}px`);
  }

  /** Open or close Insert: the rail, or on a phone the sheet. `focus`
   * moves the focus into it (the keyboard) or back to the editor. */
  toggleInsert(focus: boolean, forOne = false): void {
    if (this.layout === "phone") {
      this._setSheet(!this._sheet);
      return;
    }
    const open = !this._rail;
    this._rail = open;
    this._railForOne = open && forOne;
    if (this.layout === "docked") rememberRail(open);
    if (!focus) return;
    if (open) void this.updateComplete.then(() => this._list()?.focusSearch());
    else this.focusEditor();
  }

  private _setSheet(open: boolean): void {
    this._sheet = open;
    if (open) {
      // The sheet takes the keyboard's place: the editor lets go of the
      // focus (its caret stays drawn), the search takes it when tapped.
      const root = this.getRootNode() as Document | ShadowRoot;
      const active = root.activeElement;
      if (active instanceof HTMLElement && this.contains(active)) active.blur();
    } else this.focusEditor();
  }

  private _list(): AiviInsertList | null {
    return this.querySelector<AiviInsertList>(
      ".wsrail aivi-insert-list, .wssheet aivi-insert-list",
    );
  }

  /** Put a pick in at the editor's caret (or over its selection). The
   * editor takes the focus back; nothing opens by itself. */
  private _insert(pick: InsertPick): void {
    const box = this.codeEditor();
    if (!box) return;
    const range = box.selection();
    const doc = this.spec.text;
    let name: string;
    if (pick.kind === "entity") {
      const { text, caret } = entityInsert(pick.id, pick.attribute, doc, range.from, range.to);
      box.replace(range, text, caret);
      name = pick.attribute ?? pick.id;
    } else {
      const entity = pick.id ? this.spec.hass.states[pick.id] : undefined;
      const put = recipeInsert(pick.recipe, pick.id, entity, doc, range.from, range.to);
      box.replace({ from: put.from, to: put.to }, put.text, put.select[0], put.select[1]);
      name = t(recipeTitle(pick.recipe));
    }
    this._hideCard();
    this._said = t("workspace.inserted", { name });
    if (this.layout === "phone") this._sheet = false;
    // Over the editor, or opened for this one pick: it goes.
    else if (this._rail && (this.layout !== "docked" || this._railForOne)) {
      this._rail = false;
      this._railForOne = false;
    }
  }

  private _onKeydown = (e: KeyboardEvent): void => {
    if (isExpandShortcut(e)) {
      e.preventDefault();
      this.onBack();
      return;
    }
    if (isInsertShortcut(e)) {
      e.preventDefault();
      this.toggleInsert(true, !this._rail);
      return;
    }
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (this._card) {
      this._hideCard();
      return;
    }
    const inRail = e
      .composedPath()
      .some((node) => node instanceof Element && node.matches(".wsrail, .wssheet"));
    if (this._sheet) this._setSheet(false);
    else if (this._rail && (inRail || this.layout !== "docked")) this.toggleInsert(true);
    else if (this._strip && this.layout !== "docked") this._strip = false;
    else this.onBack();
  };

  // The find bar.

  private _openFind(selected: string): void {
    const query = selected || this._find?.query || "";
    const box = this.codeEditor();
    this._find = { query, ...(box?.find(query, 0) ?? { current: 0, total: 0 }) };
    void this.updateComplete.then(() => {
      const input = this.querySelector<HTMLInputElement>(".wsfind input");
      input?.focus();
      input?.select();
    });
  }

  private _findStep(query: string, dir: -1 | 0 | 1): void {
    const result = this.codeEditor()?.find(query, dir) ?? { current: 0, total: 0 };
    this._find = { query, ...result };
  }

  private _closeFind(): void {
    this.codeEditor()?.find("", 0);
    this._find = null;
    this.focusEditor();
  }

  private _findBar(): TemplateResult {
    const find = this._find ?? { query: "", current: 0, total: 0 };
    const count = !find.query
      ? ""
      : find.total
        ? t("workspace.find-count", { current: find.current, total: find.total })
        : t("workspace.find-none");
    return html`<div class="wsfind" role="search"><input
        type="text" autocomplete="off" spellcheck="false"
        aria-label=${t("workspace.find")} placeholder=${t("workspace.find")}
        .value=${find.query}
        @input=${(e: Event) => this._findStep((e.target as HTMLInputElement).value, 0)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this._findStep(find.query, e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            // The bar's own: the workspace does not go back for it.
            e.preventDefault();
            e.stopPropagation();
            this._closeFind();
          }
        }}
      /><span class="wsfcount" role="status">${count}</span><button
        type="button" class="iconbtn" aria-label=${t("workspace.find-previous")} title=${t("workspace.find-previous")}
        @click=${() => this._findStep(find.query, -1)}
      >${icon("arrow-up")}</button><button
        type="button" class="iconbtn" aria-label=${t("workspace.find-next")} title=${t("workspace.find-next")}
        @click=${() => this._findStep(find.query, 1)}
      >${icon("arrow-down")}</button><button
        type="button" class="iconbtn" aria-label=${t("common.close")} title=${t("common.close")}
        @click=${() => this._closeFind()}
      >${icon("close")}</button></div>`;
  }

  // Rendering.

  protected override render(): unknown {
    const layout = this.layout;
    const phone = layout === "phone";
    const strip = layout === "strip" || phone;
    const saving = this.bar.saving;
    return html`<div class=${`ws ${layout}${this._rail && !phone ? " rail" : ""}`}>${this._header(
      phone,
    )}<div class="saveerr" id="aivi-ws-save-error" role="alert">${this.bar.saveError || nothing}</div>${
      strip ? this._stripLine(phone) : nothing
    }<div class="wsbody" ?inert=${saving}>${
      this._rail && !phone
        ? html`<aside class="wsrail" id="aivi-insert-rail" aria-label=${t("sheet.insert")}>${this._insertList()}</aside>`
        : nothing
    }${this._main(phone)}${
      strip
        ? nothing
        : html`<aside class="wsout" aria-label=${t("workspace.output")}>${this._output()}</aside>`
    }${phone && this._sheet ? this._sheetPane() : nothing}</div>${phone ? this._keyRow() : nothing}<div class="sr-only" role="status">${this._said}</div></div>`;
  }

  private _header(phone: boolean): TemplateResult {
    const bar = this.bar;
    // On a phone it opens the sheet in the keyboard's place; elsewhere the
    // rail.
    const open = phone ? this._sheet : this._rail;
    const insert = html`<button
          type="button" class=${`btn quiet wsinsert${open ? " on" : ""}`}
          aria-pressed=${open ? "true" : "false"}
          aria-controls=${open ? (phone ? "aivi-insert-sheet" : "aivi-insert-rail") : nothing}
          aria-keyshortcuts=${phone ? nothing : "Control+I Meta+I"} title=${t("sheet.insert")}
          @mousedown=${(e: Event) => {
            // The editor keeps the focus (and a phone its keyboard) until
            // the sheet takes its place.
            if (phone) e.preventDefault();
          }}
          @click=${() => this.toggleInsert(true)}
        >${phone ? nothing : icon("dock-left")}<span>${t("sheet.insert")}</span></button>`;
    const docs = phone
      ? nothing
      : html`<a class="btn ghost wsdocs" href=${TEMPLATE_HELP} target="_blank" rel="noopener noreferrer" title=${t(
          "workspace.docs",
        )}>${t("workspace.docs")}${icon("open-in-new")}</a>`;
    return html`<div class="topbar wshead"><button
        class="backbtn iconbtn" aria-label=${t("common.back")} title=${t("common.back")}
        aria-keyshortcuts="Escape" aria-disabled=${bar.saving ? "true" : nothing}
        @click=${() => this.onBack()}
      >${icon("arrow-left")}</button><div class="edname"><h2 class="title" id="aivi-ws-title">${this.heading}</h2><div class="subtitle">${this.context}</div></div><div class="grow"></div>${insert}${docs}${
        bar.waiting && !phone
          ? html`<button type="button" class="btn ghost needchip" title=${bar.chipTitle} @click=${bar.onJump}>${icon(
              "alert-outline",
            )}<span>${bar.chipLabel}</span></button>`
          : nothing
      }<button
        class="btn primary savebtn" ?disabled=${bar.waiting > 0}
        aria-disabled=${bar.saving ? "true" : nothing}
        aria-describedby=${bar.saveError ? "aivi-ws-save-error" : nothing}
        @click=${bar.onSave}
      >${bar.saving ? t("common.saving") : t("common.save")}</button></div>`;
  }

  private _insertList(): TemplateResult {
    return html`<aivi-insert-list
      .hass=${this.spec.hass}
      .options=${this.editor.panel.entities()}
      .text=${this.spec.text}
      .kind=${this.spec.kind}
      .near=${entityNear(this.spec.text, this.codeEditor()?.selection().from ?? 0, this.spec.hass)}
      .onPick=${(pick: InsertPick) => this._insert(pick)}
    ></aivi-insert-list>`;
  }

  private _main(phone: boolean): TemplateResult {
    const spec = this.spec;
    const noteId = `${spec.noteId}-ws`;
    const [line, column] = this._caret;
    const tabKeys = onMac() ? "⇧⌥M" : "Ctrl+M";
    return html`<section class="wsmain" aria-labelledby="aivi-ws-title">${
      this._find ? this._findBar() : nothing
    }<aivi-code-editor
        class="wsed"
        .value=${spec.text}
        .label=${t("field.template-aria", { field: spec.label })}
        .describedby=${`${noteId} aivi-ws-keys${this._card?.caret ? " aivi-ws-card" : ""}`}
        .hass=${spec.hass}
        .marks=${spec.stale ? [] : templateMarks(spec.text, spec.feedback)}
        .lines=${!phone}
        .keepCaret=${true}
        .workspace=${true}
        .wrap=${phone || this._wrap}
        .from=${this.editor.historyOf(spec.address)}
        .onWrap=${(on: boolean) => this._setWrap(on)}
        .onCaret=${(l: number, c: number) => {
          this._caret = [l, c];
        }}
        .onPoint=${(pos: number | null, caret: boolean) => this._point(pos, caret)}
        .onFind=${(selected: string) => this._openFind(selected)}
        .onInput=${spec.onInput}
        .onBlur=${() => {
          spec.onBlur();
          if (this._card?.caret) this._hideCard();
        }}
      ></aivi-code-editor>${this._cardView()}${
        phone
          ? html`<span class="sr-only" id="aivi-ws-keys">${t("workspace.tab-hint", { keys: tabKeys })}</span>`
          : html`<div class="wsstatus"><span>${t("workspace.position", { line, column })}</span><span class="grow"></span><span id="aivi-ws-keys">${t(
              "workspace.tab-hint",
              { keys: tabKeys },
            )}</span><button
              type="button" class=${`btn ghost small wswrap${this._wrap ? " on" : ""}`}
              aria-pressed=${this._wrap ? "true" : "false"} aria-keyshortcuts="Alt+Z" title=${t("workspace.wrap")}
              @click=${() => this._setWrap(!this._wrap)}
            >${t("workspace.wrap")}</button></div>`
      }</section>`;
  }

  private _setWrap(on: boolean): void {
    this._wrap = on;
    rememberWrap(on);
  }

  /** The docked output: the live preview, then the result. */
  private _output(): TemplateResult {
    return html`${this.preview}<section class="wsres" aria-label=${t("field.result")}>${this._result()}</section>`;
  }

  /** The result, what the last preview said about it, and the hints on
   * it. A hint that says the field cannot use the value says it in the
   * workspace's words, in place of the form's note (which points at a
   * fallback below it, in the form). */
  private _result(): TemplateResult {
    const spec = this.spec;
    const hints = resultHints({
      feedback: spec.feedback,
      text: spec.text,
      kind: spec.kind,
      hass: spec.hass,
      clipped: this._clipped,
      symbols: this._symbols,
    });
    const below = hints.some((h) => h.id === "kind") ? { ...spec, note: nothing } : spec;
    return html`${this._resultHead()}${templateBelow(below, `${spec.noteId}-ws`)}${this._hints(hints)}`;
  }

  private _hints(hints: readonly ResultHint[]): unknown {
    if (!hints.length) return nothing;
    const stale = this.spec.stale;
    return html`<ul class=${stale ? "wshints stale" : "wshints"} aria-label=${t("workspace.hints")}>${hints.map(
      (hint) =>
        html`<li class="wshint">${icon("lightbulb-on-outline")}<span class="wshtext">${hint.text}</span>${
          hint.fix
            ? html`<button type="button" class="btn quiet small wsfix" ?disabled=${stale}
              @click=${() => {
                if (hint.fix) this._applyFix(hint.fix.edit);
              }}>${hint.fix.label}</button>`
            : nothing
        }</li>`,
    )}</ul>`;
  }

  /** On the folded output's line: that hints wait inside. */
  private _hintMark(): unknown {
    const spec = this.spec;
    const count = resultHints({
      feedback: spec.feedback,
      text: spec.text,
      kind: spec.kind,
      hass: spec.hass,
      clipped: this._clipped,
      symbols: this._symbols,
    }).length;
    return count
      ? html`<span class="wshintmark" title=${t("workspace.hints")}>${icon("lightbulb-on-outline")}<span class="sr-only">${t("workspace.hints")}</span></span>`
      : nothing;
  }

  /** A hint's fix, as one edit the editor can undo. */
  private _applyFix(edit: TextEdit): void {
    const box = this.codeEditor();
    if (!box) return;
    box.replace({ from: edit.from, to: edit.to }, edit.insert, edit.insert.length);
  }

  /** The result's title, where its own line (which carries one) is not
   * there: an error, or nothing yet. */
  private _resultHead(): unknown {
    const fb = this.spec.text ? this.spec.feedback : undefined;
    return fb?.kind && fb.status !== "error"
      ? nothing
      : html`<h3 class="wsresh">${t("field.result")}</h3>`;
  }

  /** The output as one line: the result, or where the template fails;
   * pressed, everything (on a phone, the small widget and the result). */
  private _stripLine(phone: boolean): TemplateResult {
    const spec = this.spec;
    const fb = spec.text ? spec.feedback : undefined;
    const open = this._strip;
    let line: TemplateResult;
    // Open, the result is in full below: the line only names what opens.
    if (open)
      line = html`<span class="k">${t("workspace.strip-open")}</span><span class="wsval"></span>`;
    else if (fb?.status === "error")
      line = html`<span class="wsdot bad"></span><span class="k">${errorWhere(fb)}</span><span class="wsval">${
        errorPlain(fb) ?? fb.error ?? ""
      }</span>`;
    else if (fb?.kind)
      line = html`<span class="wsdot"></span><span class="k">${t("field.result")}</span><span class="wsval mono">${
        fb.value ?? ""
      }</span>${this._hintMark()}<span class="wskind">${kindText(fb)}</span>`;
    else
      line = html`<span class="wsdot idle"></span><span class="k">${t("field.result")}</span><span class="wsval"></span>`;
    return html`<div class=${`wsstrip${open ? " open" : ""}${spec.stale ? " stale" : ""}`}><button
        type="button" class="wsstripbtn" aria-expanded=${open ? "true" : "false"} aria-controls="aivi-ws-strip"
        @click=${() => {
          this._strip = !open;
        }}
      >${line}<span class="tri" aria-hidden="true">${icon("chevron-right")}</span></button><div class="wsstripbody" id="aivi-ws-strip" ?hidden=${!open}>${
        open
          ? phone
            ? html`<div class="wsphone">${this._miniWidget()}<div class="wsres">${this._result()}</div></div>`
            : this._output()
          : nothing
      }</div></div>`;
  }

  /** The widget as the preview draws it, small, so a phone shows the
   * effect of each edit above the keyboard. */
  private _miniWidget(): unknown {
    const state = this.editor.editorState;
    const content = state.preview;
    if (!content) return nothing;
    const key = `${state.kind}|${state.template}|${state.name}`;
    if (this._mini?.content !== content || this._mini.key !== key) {
      const node =
        state.kind === "activity"
          ? previewActivity(state.template, state.name || t("common.live-activity"), content)
          : previewWidget(state.template, state.name, content, "small");
      this._mini = { node, content, key };
    }
    return html`<div class=${`wsmini${state.kind === "activity" ? " wide" : ""}`} aria-hidden="true">${this._mini.node}</div>`;
  }

  /** The keys a phone's keyboard hides, above it; pressing one keeps
   * the keyboard up (the editor keeps the focus). */
  private _keyRow(): TemplateResult {
    const keep = (e: Event): void => e.preventDefault();
    const run = (command: "undo" | "left" | "right"): void => this.codeEditor()?.run(command);
    const put = (text: string): void => {
      const box = this.codeEditor();
      if (!box) return;
      const insert = withCaret(text);
      box.replace(box.selection(), insert.text, insert.caret);
    };
    const key = (label: unknown, name: string, press: () => void, cls = ""): TemplateResult =>
      html`<button type="button" class=${`wskey${cls}`} aria-label=${name} @mousedown=${keep} @click=${press}>${label}</button>`;
    return html`<div class="wskeys" role="group" aria-label=${t("sheet.keys")}><div class="wskeyrow">${key(
      "←",
      t("workspace.key-left"),
      () => run("left"),
    )}${key("→", t("workspace.key-right"), () => run("right"))}${TEMPLATE_KEYS.map((k) =>
      key(k.label, t(keyTitle(k)), () => put(k.text)),
    )}${key(icon("undo"), t("workspace.key-undo"), () => run("undo"))}</div></div>`;
  }

  /** Insert on a phone: a sheet over the lower half, the line being
   * edited still in view above it. */
  private _sheetPane(): TemplateResult {
    return html`<div class="wssheet" id="aivi-insert-sheet" role="dialog" aria-label=${t("sheet.insert")}><div class="wssheethead"><span class="title">${t(
      "sheet.insert",
    )}</span><a class="btn ghost wsdocs" href=${TEMPLATE_HELP} target="_blank" rel="noopener noreferrer">${t(
      "workspace.docs",
    )}${icon("open-in-new")}</a><button
        type="button" class="iconbtn" aria-label=${t("common.close")} title=${t("common.close")}
        @click=${() => this._setSheet(false)}
      >${icon("close")}</button></div>${this._insertList()}</div>`;
  }
}

define("aivi-template-workspace", AiviTemplateWorkspace);

declare global {
  interface HTMLElementTagNameMap {
    "aivi-template-workspace": AiviTemplateWorkspace;
  }
}
