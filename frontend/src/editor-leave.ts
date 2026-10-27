// Unsaved changes in the editor: what the form held when it opened (or
// was last saved), whether it differs now, and the question asked before
// they are lost. Back, browser back, a route change and closing the tab
// all come here.

import { html, type ReactiveController, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { DEFAULT_THROTTLE } from "./delivery";
import { t } from "./i18n";
import { canonical } from "./util";
import { isDerivedKey } from "./value-source";

export class LeaveGuard implements ReactiveController {
  private readonly _host: AiviEditor;
  /** What the form held when it opened (or was last saved): the state
   * "unsaved changes" is measured against. */
  private _baseline = "";
  private _asking = false;
  /** Where a held-back navigation was going (a route path), for Discard
   * to continue to; null when the leave was asked from the bar. */
  private _to: string | null = null;

  constructor(host: AiviEditor) {
    this._host = host;
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener("beforeunload", this._onBeforeUnload);
  }

  hostDisconnected(): void {
    window.removeEventListener("beforeunload", this._onBeforeUnload);
  }

  /** The leave question is a native modal dialog following its state. */
  hostUpdated(): void {
    const dialog = this._host.querySelector<HTMLDialogElement>("dialog.leavedlg");
    if (dialog) syncDialog(dialog, this._asking);
  }

  /** Whether the dialog is asking to confirm leaving with unsaved
   * changes. */
  get asking(): boolean {
    return this._asking;
  }

  /** Everything a save would store, in a comparable form. Template watch
   * lists are derived, so they don't count as a change. */
  snapshot(): string {
    const editorState = this._host.editorState;
    const bindings = Object.fromEntries(
      Object.entries(this._host.prunedBindings()).filter(([key]) => !isDerivedKey(key)),
    );
    return canonical({
      bindings,
      active: editorState.active ?? null,
      stale: editorState.staleAfter ?? null,
      // An unset throttle is the default the select shows: picking the
      // shown value back is not a change.
      throttle: editorState.throttle ?? DEFAULT_THROTTLE,
    });
  }

  /** The form as it stands is what "unsaved changes" is measured
   * against from here on. */
  rebase(): void {
    this._baseline = this.snapshot();
  }

  get dirty(): boolean {
    const host = this._host;
    return (
      !!host.panel.editorState && host.templateMeta() !== null && this.snapshot() !== this._baseline
    );
  }

  /** Leave the editor: at once when nothing would be lost, else after a
   * second, explicit press in the leave dialog (the panel's rule for
   * anything destructive). A route change passes where it was going
   * (`to`, a route path), so that Discard continues there. A request
   * during a save is ignored. */
  request(to: string | null): void {
    const host = this._host;
    if (host.panel.editorState?.saving) return;
    if (!this.dirty) {
      host.panel.closeEditor(to);
      return;
    }
    this._to = to;
    this._ask(true);
    void host.updateComplete.then(() => {
      host.querySelector<HTMLElement>(".leavedlg .keep")?.focus();
    });
  }

  /** A modal question in the middle of the screen, Keep editing the
   * focused, safe answer. Escape keeps editing. */
  dialog(): TemplateResult {
    return html`<dialog
      class="dlg leavedlg"
      aria-labelledby="aivi-leave-title"
      @cancel=${(e: Event) => {
        e.preventDefault();
        this._keep();
      }}
      @close=${() => this._keep()}
    ><h3 id="aivi-leave-title">${t("editor.leave-title")}</h3><p>${t("editor.leave-body", { name: this._host.editorState.name })}</p><div class="dactions"><button
          type="button" class="btn quiet keep"
          @click=${() => this._keep()}
        >${t("editor.leave-keep")}</button><button
          type="button" class="btn danger discard"
          @click=${() => this._host.panel.closeEditor(this._to)}
        >${t("editor.leave-discard")}</button></div></dialog>`;
  }

  /** The question answered "keep": the navigation it held back is
   * forgotten. (The closing dialog hands focus back by itself.) */
  private _keep(): void {
    this._ask(false);
    this._to = null;
    this._host.panel.logPreset = null;
  }

  private _ask(asking: boolean): void {
    if (asking === this._asking) return;
    this._asking = asking;
    this._host.requestUpdate();
  }

  private _onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.dirty) e.preventDefault();
  };
}

/** Open or close a native modal dialog to match `open`. Older test DOMs
 * lack the dialog methods; the attribute is the fallback. */
function syncDialog(dialog: HTMLDialogElement, open: boolean): void {
  if (open === dialog.open) return;
  if (open) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  } else if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}
