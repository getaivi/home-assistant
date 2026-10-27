// The editor's sticky top bar: Back, what is being edited, Suggest, and
// Save with what it is still waiting for. It stays in view, so Save and
// its blockers are reachable from anywhere in the form; Suggest (the AI
// feature) lives here too, so nothing of it sits in the form.

import { html, nothing, type TemplateResult } from "lit";
import { templateInfo } from "./const";
import { t } from "./i18n";
import { icon } from "./icons";
import type { EditorState } from "./types/editor";

interface BarOptions {
  editorState: EditorState;
  /** Whether the Suggest sidebar is open. */
  aiOpen: boolean;
  /** How many things Save is waiting for, and the chip that says so. */
  waiting: number;
  chipLabel: string;
  chipTitle: string;
  /** The last save's failure, while it still applies; else empty. */
  saveError: string;
  onBack: () => void;
  onSuggest: () => void;
  onJump: () => void;
  onSave: () => void;
}

export function editorBar(o: BarOptions): TemplateResult {
  const editorState = o.editorState;
  const info = templateInfo(editorState.template);
  const trailing = html`<button
        type="button" class=${`btn quiet small aibtn${o.aiOpen ? " on" : ""}`}
        aria-pressed=${o.aiOpen ? "true" : "false"}
        aria-controls=${o.aiOpen ? "aivi-ai-panel" : nothing}
        @click=${o.onSuggest}
      >${icon("creation")}<span>${t("suggest.open")}</span></button>${
        o.waiting
          ? html`<button
            type="button" class="btn ghost needchip"
            title=${o.chipTitle}
            @click=${o.onJump}
          >${icon("alert-outline")}<span>${o.chipLabel}</span></button>`
          : nothing
      }<button
        class="btn primary savebtn" ?disabled=${o.waiting > 0}
        aria-disabled=${editorState.saving ? "true" : nothing}
        aria-describedby=${o.saveError ? "aivi-save-error" : nothing}
        @click=${o.onSave}
      >${editorState.saving ? t("common.saving") : t("common.save")}</button>`;
  // While saving, Save and Back are aria-disabled rather than disabled
  // (a disabled button drops the focus it holds) and ignore presses.
  return html`<div class="edbar"><div class="topbar"><button class="backbtn iconbtn" aria-label=${t("common.back")} title=${t("common.back")} aria-disabled=${editorState.saving ? "true" : nothing} @click=${o.onBack}>${icon("arrow-left")}</button><div class="edname"><div class="title">${editorState.name}</div><div class="subtitle">${t(editorState.kind === "activity" ? "editor.activity-chip" : "editor.widget-chip")} · ${info.label} · <span class="slug" title=${t("editor.slug-hint")}>${editorState.slug}</span></div></div><div class="grow"></div>${trailing}</div><div class="saveerr" id="aivi-save-error" role="alert">${o.saveError || nothing}</div></div>`;
}
