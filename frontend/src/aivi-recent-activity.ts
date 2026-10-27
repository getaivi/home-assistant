// "Log" in the editor: what Home Assistant last sent to Aivi
// for this binding, what the devices sent back for it, and what became of
// each, live from the panel's aivi/inputs/subscribe subscription. It is
// live output like the preview, so it sits under it in the side column.
// It lists the latest few; when there are more it ends with a link to the
// Log page, narrowed to this binding.

import { html, LitElement, nothing } from "lit";
import { activityFor, activityRow } from "./activity-rows";
import { subjectKey } from "./aivi-activity-log";
import type { AiviEditor } from "./aivi-editor";
import type { AiviPanel } from "./aivi-panel";
import { define } from "./define";
import { t } from "./i18n";

/** How many rows the card lists, newest first. */
export const RECENT_SHOWN = 5;

class AiviRecentActivity extends LitElement {
  static override properties = {
    panel: { attribute: false },
    entryId: { attribute: false },
    kind: { attribute: false },
    slug: { attribute: false },
  };
  declare panel: AiviPanel;
  declare entryId: string;
  declare kind: string;
  declare slug: string;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** The Log page, its "For" on this binding. Leaving goes through the
   * editor, so unsaved changes are asked about first. */
  private _openLog(): void {
    if (this.panel.editorState?.saving) return; // leaving waits for the save
    this.panel.logPreset = { entryId: this.entryId, subject: subjectKey(this.kind, this.slug) };
    const editor = this.closest<AiviEditor>("aivi-editor");
    if (editor) editor.requestLeave("/log");
    else this.panel.openLog();
  }

  override render(): unknown {
    const items = activityFor(this.panel, this.entryId, this.kind, this.slug);
    // A log, not a setting: it sits with the live preview, as a compact
    // list (what happened, then when and what became of it).
    return html`<div class="phead"><h3>${t("recent.title")}</h3></div><div class="fhint">${t("recent.hint")}</div>${
      items.length
        ? html`<ul class="alist recentlist">${items
            .slice(0, RECENT_SHOWN)
            .map((item) =>
              activityRow(this.panel, item, { where: false, account: false, dateful: false }),
            )}</ul>${
            items.length > RECENT_SHOWN
              ? html`<div class="recentfoot"><button
                  type="button"
                  class="evlink"
                  @click=${() => this._openLog()}
                >${t("log.open")}</button></div>`
              : nothing
          }`
        : html`<div class="pempty">${t("recent.empty")}</div>`
    }`;
  }
}

define("aivi-recent-activity", AiviRecentActivity);
