// <aivi-template-box>: a template's box in the form, what the last
// preview said under it, and Expand, which opens the template workspace
// (aivi-template-workspace.ts), the box's own page at its address
// (router.ts). Both hold the field's text, and the field keeps one undo
// history across them (aivi-editor.ts hands it over). Light DOM, inside
// the panel's shadow root, so the panel's styles reach it.

import { html, LitElement, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import "./code-editor/element";
import type { TemplateMark } from "./code-editor/contract";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import type { HassLike } from "./types/hass";

/** Whether a key press is the shortcut that expands a box (and, in the
 * workspace, goes back): Ctrl+Shift+E, or Cmd+Shift+E on a Mac. */
export function isExpandShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e";
}

export class AiviTemplateBox extends LitElement {
  static override properties = {
    value: { attribute: false },
    address: { attribute: false },
    label: { attribute: false },
    hass: { attribute: false },
    editor: { attribute: false },
    marks: { attribute: false },
    describedby: { attribute: false },
    noteId: { attribute: false },
    below: { attribute: false },
    onInput: { attribute: false },
    onBlur: { attribute: false },
  };
  declare value: string;
  /** The box's address (template-slots.ts): where Expand goes. */
  declare address: string;
  /** The field's name. */
  declare label: string;
  declare hass: HassLike;
  /** The editor the box is in. */
  declare editor: AiviEditor | null;
  declare marks: readonly TemplateMark[];
  /** Id of the note under the box, if any. */
  declare describedby: string | null;
  declare noteId: string;
  /** What shows under the box, given the id it carries. */
  declare below: (id: string) => TemplateResult;
  declare onInput: (text: string) => void;
  declare onBlur: () => void;

  constructor() {
    super();
    this.value = "";
    this.address = "";
    this.label = "";
    this.editor = null;
    this.marks = [];
    this.describedby = null;
    this.noteId = "";
    this.below = () => html``;
    this.onInput = () => {};
    this.onBlur = () => {};
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Open the box's template workspace. */
  expand(): void {
    this.editor?.openTemplate(this.address);
  }

  protected override render(): unknown {
    const label = t("field.template-aria", { field: this.label });
    return html`<div class="tbox" data-address=${this.address} @keydown=${(e: KeyboardEvent) => {
      if (!isExpandShortcut(e)) return;
      e.preventDefault();
      this.expand();
    }}><aivi-code-editor
        .value=${this.value}
        .label=${label}
        .describedby=${this.describedby}
        .hass=${this.hass}
        .marks=${this.marks}
        .from=${this.editor?.historyOf(this.address) ?? null}
        .onInput=${this.onInput}
        .onBlur=${this.onBlur}
      ></aivi-code-editor><button
        type="button" class="texpand"
        aria-label=${t("sheet.expand-label", { field: this.label })} title=${t("sheet.expand")}
        aria-keyshortcuts="Control+Shift+E Meta+Shift+E"
        @click=${() => this.expand()}
      >${icon("arrow-expand")}</button></div>${this.below(this.noteId)}`;
  }
}

define("aivi-template-box", AiviTemplateBox);

declare global {
  interface HTMLElementTagNameMap {
    "aivi-template-box": AiviTemplateBox;
  }
}
