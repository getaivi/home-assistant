// The full-screen bind/edit route: a sticky top bar (Back, Save and what
// Save is waiting for), the form column, and a sticky side column with
// the live preview. Save is disabled until nothing blocks it, and the
// bar's chip counts every blocker; leaving with unsaved changes asks
// first; while a save is in flight the form and Back are inert. Identity (slug, name, template)
// always comes from the remote widget or activity: the editor binds, it
// never creates.
//
// Structural resets (activity template switch, an applied suggestion)
// bump `_gen`, which re-keys the whole editor body so freshly-suggested
// values reach inputs whose content is otherwise user-owned.

import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { feederConflict } from "./aivi-feeder-warning";
import type { AiviFieldRow } from "./aivi-field-row";
import type { AiviPanel } from "./aivi-panel";
import "./aivi-template-workspace";
import type { AiviTemplateWorkspace } from "./aivi-template-workspace";
import { deriveBarMode, pruneForBarMode } from "./bar-mode";
import { boundElsewhere, boundEntityIds, isBlank } from "./bound-entities";
import type { EditorSnapshot } from "./code-editor/contract";
import type { AiviCodeEditor } from "./code-editor/element";
import { define } from "./define";
import { editorBar } from "./editor-bar";
import { editorForm, setupCard } from "./editor-form";
import { LeaveGuard } from "./editor-leave";
import { PreviewLoop } from "./editor-preview";
import { FormSpotlight } from "./editor-spotlight";
import { isBound, oversize } from "./editor-validation";
import { t } from "./i18n";
import { icon } from "./icons";
import { isFirstBind } from "./onboarding";
import type { PreviewAs } from "./preview-as";
import {
  type Blocker,
  blockers,
  checkForm,
  chipLabel,
  chipTitle,
  type FormCheck,
  needs,
} from "./save-blockers";
import { findTemplateSlot, slotNames, slotSpec } from "./template-slots";
import type { Bindings } from "./types/bindings";
import type { ContentSize } from "./types/content";
import type { BarMode, EditorState } from "./types/editor";
import type { HassLike } from "./types/hass";
import type { FieldMeta, TemplateMeta } from "./types/meta";
import { errMsg, labelFor } from "./util";
import { pruneSlots } from "./value-source";

export class AiviEditor extends LitElement {
  static override properties = {
    panel: { attribute: false },
    workspace: { attribute: false },
    previewOpen: { state: true },
    _gen: { state: true },
    _aiOpen: { state: true },
    _saveError: { state: true },
  };
  declare panel: AiviPanel;
  /** The address of the template workspace in view (template-slots.ts),
   * or null for the form. The form stays mounted, hidden, under it: its
   * folds, its scroll and its inline boxes are as they were on Back. */
  declare workspace: string | null;
  /** Narrow mode only: whether the bottom mini-preview sheet is expanded.
   * The toggle and pane are always in the DOM (CSS collapses the pane), so
   * toggling never rebuilds the form or preview: focus and scroll survive. */
  declare previewOpen: boolean;
  declare private _gen: number;
  /** Whether the Suggest panel (the AI feature) is open. */
  declare private _aiOpen: boolean;
  /** The last save's failure, with the form state it refers to: it
   * stays by the Save button until the form is edited or saved again. */
  declare private _saveError: { text: string; snapshot: string } | null;

  private readonly _leave = new LeaveGuard(this);
  private readonly _preview = new PreviewLoop(this);
  private readonly _spotlight = new FormSpotlight(this);
  /** Each template box's text, selection and undo history as it last
   * left a view, by address: the inline box and the workspace go on from
   * it, so a field keeps one history across them. */
  private readonly _histories = new Map<string, EditorSnapshot>();
  /** The address whose inline box takes the workspace's history back
   * (and, with `focus`, the focus) once the form shows again. */
  private _back: { address: string; focus: boolean } | null = null;
  /** Whether the next Back focuses the box; false when something else
   * takes the focus (a preview region, the needs chip). */
  private _backFocus = true;

  constructor() {
    super();
    this.workspace = null;
    this.previewOpen = false;
    this._gen = 0;
    this._aiOpen = false;
    this._saveError = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this._onKeydown);
    // The chat sidebar stays as the user left it across editors: a
    // conversation tool, not a popup to reopen each time.
    this._aiOpen = this.panel.suggestOpen;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._onKeydown);
  }

  protected override firstUpdated(): void {
    this._leave.rebase();
    this.schedulePreview(0);
    void this._startFromDefaults();
  }

  /** A new binding starts from what Home Assistant already knows (its
   * currency, a price sensor, the Energy dashboard), unless the user has
   * typed something meanwhile. With an integration older than
   * this bundle, which lacks the command, the form starts empty. */
  private async _startFromDefaults(): Promise<void> {
    const editorState = this.editorState;
    if (editorState.subentryId !== null || Object.keys(editorState.bindings).length) return;
    let bindings: Bindings;
    try {
      ({ bindings } = await this.panel.api.defaults(editorState.template, editorState.kind));
    } catch {
      return;
    }
    if (
      this.panel.editorState !== editorState ||
      Object.keys(editorState.bindings).length ||
      !Object.keys(bindings).length
    )
      return;
    editorState.bindings = bindings;
    this.applySuggestion();
    // Defaults are where a new binding starts, not a change made here.
    this._leave.rebase();
  }

  /** The editor only renders while the panel holds editor state. */
  get editorState(): EditorState {
    const editorState = this.panel.editorState;
    if (!editorState) throw new Error("editor rendered without editor state");
    return editorState;
  }

  templateMeta(): TemplateMeta | null {
    const editorState = this.editorState;
    const meta = this.panel.meta;
    const pool = editorState.kind === "activity" ? meta.activity_templates : meta.templates;
    return pool?.[editorState.template] ?? null;
  }

  /** The template's segments field (the progress-bar section), if any. */
  segmentsField(): FieldMeta | null {
    const template = this.templateMeta();
    return template?.fields.find((f) => f.kind === "segments") ?? null;
  }

  /** The active bar mode: the user's explicit in-session choice, else the
   * mode derived from the stored bindings (so programmatic changes such as
   * an applied suggestion change it too). */
  barMode(): BarMode {
    const editorState = this.editorState;
    const field = this.segmentsField();
    if (!field) return "solid";
    return editorState.barMode ?? deriveBarMode(editorState.bindings, field.key, editorState.kind);
  }

  /** The bindings as the active bar mode would push them: what preview
   * and save consume. */
  effectiveBindings(): Bindings {
    const field = this.segmentsField();
    if (!field) return this.editorState.bindings;
    return pruneForBarMode(this.editorState.bindings, field.key, this.barMode());
  }

  /** Bindings without UI-state leftovers: the inactive bar mode's data,
   * empty source markers left by a half-finished mode switch, and empty
   * strings/arrays/maps. Used for saving and as the "current state" sent
   * with a refine ask. */
  prunedBindings(): Bindings {
    return pruneSlots(this.effectiveBindings());
  }

  /** Whether the form shows nothing yet: no entity bound and no template
   * written anywhere. */
  isBlank(): boolean {
    return isBlank(this.prunedBindings(), this.panel.hass.states);
  }

  /** The entities bound to the form's other fields: a row list leaves
   * them out of its picker. */
  boundElsewhere(key: string): Set<string> {
    return boundElsewhere(
      this.effectiveBindings(),
      key,
      this.editorState.active,
      this.panel.hass.states,
    );
  }

  /** Every entity id currently referenced by the editor's bindings (as
   * the active bar mode would push them: a dormant phase's source is not
   * a bound entity). */
  boundEntityIds(): string[] {
    return boundEntityIds(
      this.effectiveBindings(),
      this.editorState.active,
      this.panel.hass.states,
    );
  }

  isBound(field: FieldMeta): boolean {
    return isBound(field, this.editorState.bindings);
  }

  /** Content over Aivi's 4 KiB cap, as the last preview measured it:
   * it would never be sent. */
  tooBig(): ContentSize | null {
    return oversize(this.editorState.size);
  }

  /** Every verdict on the form as it stands; null for a template this
   * bundle does not know. */
  private _check(): FormCheck | null {
    const template = this.templateMeta();
    return template ? checkForm(template, this.editorState, this.panel.meta.colors) : null;
  }

  private _blockers(): Blocker[] {
    const template = this.templateMeta();
    const check = this._check();
    return template && check ? blockers(template, check) : [];
  }

  /** Re-derives the Save button, badges, and the what's-missing line.
   * Every field row re-renders too: a row's required badge can depend on
   * bindings a child component wrote, and tap_url's suggestions depend on
   * other rows. Focus-safe: text inputs bind value as an attribute and the
   * combobox owns its input text (the snapshot focus checks assert it). */
  updateValidation(): void {
    this.requestUpdate();
    for (const row of this.querySelectorAll<AiviFieldRow>("aivi-field-row")) row.requestUpdate();
  }

  schedulePreview(delay = 250): void {
    this._preview.schedule(delay);
  }

  hassChanged(prev: HassLike, next: HassLike): void {
    this._preview.hassChanged(prev, next);
  }

  /** A template box was typed in: its next error waits for a pause. */
  templateEdited(): void {
    this._preview.edited();
  }

  /** A template box lost focus: an error held back shows now. */
  settleFeedback(): void {
    this._preview.settle();
  }

  /** The template text `key`'s shown feedback was computed for. */
  previewedTemplate(key: string): string | undefined {
    return this._preview.previewedTemplate(key);
  }

  /** How many previews have been requested so far. */
  get previewRequested(): number {
    return this._preview.requested;
  }

  /** The number of the newest preview that has answered. */
  get previewLanded(): number {
    return this._preview.landed;
  }

  /** Open the workspace of the template box at `address` (Expand). */
  openTemplate(address: string): void {
    this.panel.openTemplate(address);
  }

  /** Back from the workspace to the form. With `focus`, the box the
   * workspace was for takes the focus (else the caller moves it). */
  closeTemplate(focus = true): void {
    this._backFocus = focus;
    this.panel.closeTemplate();
  }

  /** The text, selection and history the box at `address` last left a
   * view with, for the next one to go on from. */
  historyOf(address: string): EditorSnapshot | null {
    return this._histories.get(address) ?? null;
  }

  private _inlineEditor(address: string): AiviCodeEditor | null {
    return this.querySelector<AiviCodeEditor>(
      `.edpage .tbox[data-address="${address}"] aivi-code-editor`,
    );
  }

  private _workspaceEl(): AiviTemplateWorkspace | null {
    return this.querySelector<AiviTemplateWorkspace>("aivi-template-workspace");
  }

  /** Between the form and a workspace, the field's history goes along:
   * taken from the view being left while it is still there. */
  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has("workspace")) return;
    const before = changed.get("workspace") as string | null | undefined;
    const keep = (address: string, editor: AiviCodeEditor | null | undefined): void => {
      const snapshot = editor?.snapshot();
      if (snapshot) this._histories.set(address, snapshot);
    };
    if (before) {
      keep(before, this._workspaceEl()?.codeEditor());
      this._back = { address: before, focus: this._backFocus };
      this._backFocus = true;
    }
    if (this.workspace) keep(this.workspace, this._inlineEditor(this.workspace));
  }

  protected override updated(): void {
    const back = this._back;
    if (!back || this.workspace === back.address) return;
    this._back = null;
    const inline = this._inlineEditor(back.address);
    const history = this._histories.get(back.address);
    if (inline && history) inline.adopt(history);
    if (!back.focus || this.workspace) return;
    if (inline) {
      inline.focusKeep();
      inline.scrollIntoView({ block: "center" });
      return;
    }
    // A box the form does not show (a phase not selected): its row.
    const key = back.address.split(/\.|__/)[0] ?? back.address;
    this._spotlight.jumpTo([`.field[data-key="${key}"]`]);
  }

  isDirty(): boolean {
    return this._leave.dirty;
  }

  /** Leave the editor: at once when nothing would be lost, else after
   * the leave dialog. Back, browser back and a route change all come
   * here; a route change passes where it was going. */
  requestLeave(to: string | null = null): void {
    this._leave.request(to);
  }

  /** A suggestion landed in editorState.bindings (or its undo restored them):
   * rebuild the form around it. The bar mode goes back to following the
   * data: the mode is derived from the new bindings. */
  applySuggestion(): void {
    this.editorState.barMode = undefined;
    this._spotlight.clear();
    this._gen++;
    this.schedulePreview(0);
    // The Suggest panel sits outside the re-keyed form.
    this.querySelector<LitElement>("aivi-suggest-box")?.requestUpdate();
  }

  private _setAiOpen(open: boolean): void {
    this._aiOpen = open;
    this.panel.suggestOpen = open;
    if (open)
      void this.updateComplete.then(() => {
        this.querySelector<HTMLElement>(".aiside textarea")?.focus();
      });
  }

  /** Escape inside the chat sidebar closes it (docked, it ignores presses
   * elsewhere: the form is meant to be used beside it). */
  private _onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this._aiOpen || this._leave.asking) return;
    const inside = e
      .composedPath()
      .some((node) => node instanceof Element && node.matches(".aiside"));
    if (!inside) return;
    this._setAiOpen(false);
    this.querySelector<HTMLElement>(".aibtn")?.focus();
  };

  /** Save in the bar in view: the form's, or the workspace's. */
  private _saveButton(): HTMLElement | null {
    return this.querySelector<HTMLElement>(this.workspace ? ".wshead .savebtn" : ".edbar .savebtn");
  }

  private _focusSave(): void {
    void this.updateComplete.then(() => this._saveButton()?.focus());
  }

  private async _save(): Promise<void> {
    const editorState = this.editorState;
    if (editorState.saving || this._blockers().length) return;
    // Decided against the pre-save config: does this save take the
    // account's bound count 0 -> 1?
    const first = isFirstBind(
      this.panel.accounts.find((a) => a.entry_id === editorState.entryId),
      editorState.subentryId,
    );
    editorState.saving = true;
    this._saveError = null;
    this.requestUpdate();
    // The form goes inert for the save: focus waits on Save, not in a
    // field that can no longer hold it.
    this._saveButton()?.focus();
    const bindings = this.prunedBindings();
    const snapshot = this._leave.snapshot();
    let saved: { subentry_id: string };
    try {
      saved = await this.panel.api.save({
        entry_id: editorState.entryId,
        subentry_id: editorState.subentryId ?? undefined,
        slug: editorState.slug,
        name: editorState.name,
        template: editorState.template,
        bindings,
        kind: editorState.kind,
        active: editorState.kind === "activity" ? (editorState.active ?? undefined) : undefined,
        stale_after: editorState.kind === "widget" ? editorState.staleAfter : undefined,
        throttle: editorState.kind === "activity" ? editorState.throttle : undefined,
      });
    } catch (err) {
      editorState.saving = false;
      const text = t("editor.save-failed", { error: errMsg(err) });
      // The toast is gone in three seconds; the line by Save stays until
      // the form changes or is saved again.
      this._saveError = { text, snapshot };
      this.panel.toast(text);
      if (this.panel.editorState === editorState) this._focusSave();
      return;
    }
    const name = editorState.name;
    editorState.saving = false;
    // The editor stays open on what was saved: a first save is now that
    // binding, and the form as saved is what a later change differs from.
    editorState.subentryId = saved.subentry_id;
    if (this.panel.editorState === editorState) {
      // A saved conversation continues when this widget is opened again.
      this.panel.keepChat();
      this._leave.rebase();
      this.requestUpdate();
      this._focusSave();
    }
    try {
      await this.panel.refresh();
    } catch {
      // The save went through; the hub shows what it last read until
      // the next refresh.
    }
    this.panel.toast(t("editor.saved-toast", { name }));
    // The very first binding also gets the hub's banner, there when the
    // hub is back: a milestone stays until dismissed.
    if (first) this.panel.celebrateFirstBind(name);
  }

  override render(): unknown {
    const editorState = this.panel.editorState;
    if (!editorState) return nothing;
    const template = this.templateMeta();
    const check = this._check();
    const waiting = template && check ? blockers(template, check) : [];
    const chip = check ? chipLabel(check, waiting.length) : "";
    // A failed save's line is about the form as it was saved: an edit
    // since then removes it.
    const saveError =
      this._saveError && !editorState.saving && this._saveError.snapshot === this._leave.snapshot()
        ? this._saveError.text
        : "";
    const bar = editorBar({
      editorState,
      aiOpen: this._aiOpen,
      waiting: waiting.length,
      chipLabel: chip,
      chipTitle: check ? chipTitle(check, this.panel.hass, this.editorState.template) : "",
      saveError,
      onBack: () => this.requestLeave(),
      onSuggest: () => this._setAiOpen(!this._aiOpen),
      onJump: () => this._spotlight.jumpTo(this._blockers().map((b) => b.row)),
      onSave: () => void this._save(),
    });
    if (!template || !check)
      return html`${bar}${this._leave.dialog()}${this.panel.errorCard(
        new Error(t("editor.unknown-template", { template: editorState.template })),
      )}`;

    const slot = this.workspace
      ? findTemplateSlot(template, editorState.bindings, this.workspace)
      : null;
    const workspace = slot
      ? (() => {
          const spec = slotSpec(this, slot);
          const names = slotNames(slot, editorState.bindings);
          return html`<aivi-template-workspace
            .editor=${this}
            .spec=${spec}
            .heading=${t("field.template-aria", { field: names.label })}
            .context=${names.parent ? `${editorState.name} · ${names.parent}` : editorState.name}
            .preview=${this._previewPane(editorState, check, "aivi-ws-preview")}
            .bar=${{
              waiting: waiting.length,
              chipLabel: chip,
              chipTitle: chipTitle(check, this.panel.hass, this.editorState.template),
              saving: editorState.saving,
              saveError,
              onSave: () => void this._save(),
              onJump: () => {
                this.closeTemplate(false);
                void this.updateComplete.then(() =>
                  this._spotlight.jumpTo(this._blockers().map((b) => b.row)),
                );
              },
            }}
            .onBack=${() => this.closeTemplate()}
          ></aivi-template-workspace>`;
        })()
      : nothing;

    // The sidebar sits beside the keyed grid, not inside it: a form rebuild
    // (a suggestion landing) must not recreate the conversation's DOM. The
    // form stays mounted under a workspace, hidden.
    return html`${this._leave.dialog()}<div class="sr-only" role="alert">${this._preview.sizeAlert}</div>${workspace}<div class="edpage" ?hidden=${!!slot}>${bar}${feederConflict(this.panel, editorState.kind, editorState.slug)}<div class=${`edwrap${this._aiOpen ? " ai" : ""}`} ?inert=${editorState.saving}>${keyed(
      this._gen,
      html`<div class="editor" @focusin=${(ev: FocusEvent) => this._spotlight.followFocus(ev)}><div class="formcol">${
        editorState.kind === "activity" ? setupCard(this, editorState) : nothing
      }${editorForm(this, template, check)}</div>${
        slot ? nothing : this._side(editorState, check, chip)
      }</div>`,
    )}${this._aiSide()}</div></div>`;
  }

  /** The live preview card; `id` tells the form's from the
   * workspace's. A press on a region in the workspace's goes back to the
   * form, to the fields that paint it. */
  private _previewPane(editorState: EditorState, check: FormCheck, id: string): TemplateResult {
    return html`<aivi-preview-pane
      class="pcard"
      id=${id}
      .editorState=${editorState}
      .rev=${this._preview.rev}
      .missing=${needs(check, editorState.template).join(", ")}
      .blocked=${check.errored.map((f) => labelFor(f.key)).join(", ")}
      .hot=${this._spotlight.hot}
      .hass=${this.panel.hass}
      .onPreviewAs=${(as: PreviewAs | undefined) => {
        this.editorState.previewAs = as;
        this.schedulePreview(0);
        this.requestUpdate();
      }}
      .onSlotPress=${(slotId: string | null, keyboard = false) => {
        if (!this.workspace) {
          this._spotlight.pressSlot(slotId, keyboard);
          return;
        }
        if (!slotId) return;
        this.closeTemplate(false);
        void this.updateComplete.then(() => this._spotlight.pressSlot(slotId, true));
      }}
    ></aivi-preview-pane>`;
  }

  /** The side column: the live preview and what went to Aivi and came
   * back lately. In narrow mode it is a sheet behind its toggle, which
   * repeats the bar's chip. */
  private _side(editorState: EditorState, check: FormCheck, chip: string): TemplateResult {
    return html`<div class=${`side${this.previewOpen ? " open" : ""}`}><button
          class="pvtoggle"
          aria-expanded=${this.previewOpen ? "true" : "false"}
          aria-controls="aivi-side-body"
          @click=${() => {
            this.previewOpen = !this.previewOpen;
          }}
        ><span class="dot on"></span>${t("preview.title")}${
          chip ? html`<span class="n">${chip}</span>` : nothing
        }<span class="grow"></span><span class="tri" aria-hidden="true">${icon("chevron-right")}</span></button><div class="sidebody" id="aivi-side-body">${this._previewPane(
          editorState,
          check,
          "aivi-preview-pane",
        )}<aivi-recent-activity
          class="pcard recent"
          .panel=${this.panel}
          .entryId=${editorState.entryId}
          .kind=${editorState.kind}
          .slug=${editorState.slug}
        ></aivi-recent-activity></div></div>`;
  }

  /** The chat sidebar: docked at the trailing edge of the editor, so the
   * form and the preview stay in use while a conversation goes on. */
  private _aiSide(): unknown {
    if (!this._aiOpen) return nothing;
    return html`<aside class="aiside" id="aivi-ai-panel" aria-labelledby="aivi-ai-title"><div class="aihead"><h3 id="aivi-ai-title">${
      this.panel.suggestState === "ready" ? t("suggest.title") : t("suggest.title-off")
    }</h3><button
            type="button" class="iconbtn dclose" aria-label=${t("common.close")}
            @click=${() => {
              this._setAiOpen(false);
              this.querySelector<HTMLElement>(".aibtn")?.focus();
            }}
          >${icon("close")}</button></div><aivi-suggest-box class="suggest" .editor=${this}></aivi-suggest-box></aside>`;
  }
}

define("aivi-editor", AiviEditor);
