// <aivi-code-editor>: the box every template is written in. It shows a
// plain textarea at once and swaps in the code editor when its chunk has
// loaded (loader.ts), keeping the text, the focus and the caret; when the
// chunk cannot load it stays the textarea. Either way the caller gets the
// same contract: `value` in, `onInput` on every edit, `onBlur` on leaving.
// Light DOM, so the note under the box (aria-describedby) is in the same
// tree as the box.

import { html, LitElement, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { define } from "../define";
import { t, tOpt } from "../i18n";
import type { HassLike } from "../types/hass";
import type {
  CodeEditorHandle,
  EditorCommand,
  EditorSnapshot,
  FindResult,
  MountCodeEditor,
  TemplateMark,
  TextRange,
} from "./contract";
import { JINJA_FUNCTIONS, JINJA_TESTS } from "./jinja-catalog";
import { type CompletionEnv, complete } from "./jinja-complete";
import { loadCodeEditor } from "./loader";

const PLACEHOLDER = "{{ states('sensor.example') }}";

/** Home Assistant's one-key shortcuts ("a" for Assist, "e" and "d" for
 * the entity and device search) listen on the window and skip text boxes
 * and its own code editor, by tag name; this editor is neither, so a
 * typed character stops at the box. Keys with a modifier (Cmd+K) still
 * reach Home Assistant, as they do from its own editor. */
function keepTyping(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length === 1) event.stopPropagation();
}

/** Whether the browser sizes a textarea to its text itself. */
function sizesItself(): boolean {
  return typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content") === true;
}

/** Grows the fallback textarea with its text where the browser cannot
 * (`field-sizing`); its CSS min and max heights bound it either way. */
export function fitTemplateBox(box: HTMLTextAreaElement): void {
  if (sizesItself()) return;
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
}

/** Marks are rebuilt on every render of the caller: compare them by value. */
const marksChanged = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);

export class AiviCodeEditor extends LitElement {
  static override properties = {
    value: { attribute: false },
    label: { attribute: false },
    describedby: { attribute: false },
    hass: { attribute: false },
    marks: { attribute: false, hasChanged: marksChanged },
    lines: { attribute: false },
    keepCaret: { attribute: false },
    from: { attribute: false },
    workspace: { attribute: false },
    wrap: { attribute: false },
    onWrap: { attribute: false },
    onCaret: { attribute: false },
    onPoint: { attribute: false },
    onFind: { attribute: false },
    onInput: { attribute: false },
    onBlur: { attribute: false },
    _mode: { state: true },
  };
  declare value: string;
  declare label: string;
  /** Id of the note under the box, if any. */
  declare describedby: string | null;
  declare hass: HassLike | null;
  /** Where to underline (marks.ts). */
  declare marks: readonly TemplateMark[];
  /** Number the lines (the template workspace; read when it is built). */
  declare lines: boolean;
  /** Keep the caret drawn while the box has no focus (read when built). */
  declare keepCaret: boolean;
  /** Another box's text, selection and history to go on from (read when
   * built). */
  declare from: EditorSnapshot | null;
  /** The template workspace's editor (contract.ts; read when built). */
  declare workspace: boolean;
  /** Wrap long lines. */
  declare wrap: boolean;
  declare onWrap: (on: boolean) => void;
  declare onCaret: (line: number, column: number) => void;
  /** The pointer rests on offset `pos`, or the caret was moved there
   * (contract.ts); null when it left. */
  declare onPoint: (pos: number | null, caret: boolean) => void;
  declare onFind: (selected: string) => void;
  declare onInput: (text: string) => void;
  declare onBlur: () => void;
  /** "plain" until the code editor is in; it stays so when it can't be. */
  declare private _mode: "plain" | "code";

  private _mount: MountCodeEditor | null = null;
  private _handle: CodeEditorHandle | null = null;
  /** The text the editor holds, so only a change from elsewhere is
   * handed to it. */
  private _doc = "";
  /** What completion reads: the states now, the catalog and its hints. */
  private readonly _env: CompletionEnv = {
    states: () => this.hass?.states ?? {},
    functions: JINJA_FUNCTIONS,
    tests: JINJA_TESTS,
    hint: (name) =>
      tOpt(name.startsWith("is ") ? `code.test-${name.slice(3)}` : `code.fn-${name}`) ?? "",
  };

  constructor() {
    super();
    this.value = "";
    this.label = "";
    this.describedby = null;
    this.hass = null;
    this.marks = [];
    this.lines = false;
    this.keepCaret = false;
    this.from = null;
    this.workspace = false;
    this.wrap = true;
    this.onWrap = () => {};
    this.onCaret = () => {};
    this.onPoint = () => {};
    this.onFind = () => {};
    this.onInput = () => {};
    this.onBlur = () => {};
    this._mode = "plain";
    this.addEventListener("keydown", keepTyping);
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._mount) {
      this.requestUpdate();
      return;
    }
    loadCodeEditor().then(
      (mount) => {
        this._mount = mount;
        if (this.isConnected) this._switch();
      },
      () => {
        // Stays the textarea.
      },
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._handle?.destroy();
    this._handle = null;
  }

  /** Focus the box, the caret at `at` (the end when absent). */
  focusAt(at?: number): void {
    if (this._handle) {
      this._handle.focus(at);
      return;
    }
    if (this._mode === "code") {
      // Swapping in: the editor is built on the next update.
      void this.updateComplete.then(() => this._handle?.focus(at));
      return;
    }
    const box = this.querySelector("textarea");
    if (!box) return;
    box.focus();
    const pos = Math.min(at ?? box.value.length, box.value.length);
    box.setSelectionRange(pos, pos);
  }

  /** Focus the box where its caret already is. */
  focusKeep(): void {
    this.focusAt(this.selection().to);
  }

  /** A key of the phone's key row, or the find bar. The textarea has
   * none of them but the caret keys. */
  run(command: EditorCommand): void {
    if (this._handle) {
      this._handle.run(command);
      return;
    }
    const box = this.querySelector("textarea");
    if (!box || (command !== "left" && command !== "right")) return;
    const at = Math.max(0, box.selectionStart + (command === "left" ? -1 : 1));
    box.focus();
    box.setSelectionRange(at, at);
  }

  /** Look for `query` (handle.find); nothing is found in the textarea. */
  find(query: string, dir: -1 | 0 | 1): FindResult {
    return this._handle?.find(query, dir) ?? { current: 0, total: 0 };
  }

  /** The caret or the selection, kept while the box has no focus (a
   * key row or the entity browser was pressed). */
  selection(): TextRange {
    if (this._handle) return this._handle.selection();
    const box = this.querySelector("textarea");
    if (!box) return { from: this.value.length, to: this.value.length };
    return { from: box.selectionStart, to: box.selectionEnd };
  }

  /** Put `text` in place of `range` as typing would: reported through
   * onInput, the box focused with the caret `caret` characters into it.
   * Nothing opens by itself. */
  replace(range: TextRange, text: string, caret: number, head: number = caret): void {
    if (this._handle) {
      this._handle.replace(range, text, caret, head);
      return;
    }
    const from = Math.min(range.from, this.value.length);
    const to = Math.min(Math.max(range.to, from), this.value.length);
    const next = this.value.slice(0, from) + text + this.value.slice(to);
    this.value = next;
    this.onInput(next);
    const box = this.querySelector("textarea");
    if (!box) return;
    box.value = next;
    fitTemplateBox(box);
    box.focus();
    const at = (n: number): number => from + Math.min(n, text.length);
    box.setSelectionRange(Math.min(at(caret), at(head)), Math.max(at(caret), at(head)));
  }

  /** Where offset `pos` is drawn (the code editor's; null in the
   * textarea, which cannot say). */
  coordsAt(pos: number): { left: number; top: number; bottom: number } | null {
    return this._handle?.coordsAt(pos) ?? null;
  }

  /** The text, selection and undo history, for another box to go on
   * from; null while the box is a textarea. */
  snapshot(): EditorSnapshot | null {
    return this._handle?.snapshot() ?? null;
  }

  /** Go on from another box's text, selection and undo history. */
  adopt(from: EditorSnapshot): void {
    if (!this._handle) return;
    this._handle.restore(from);
    this._doc = from.doc;
  }

  /** Swap the textarea for the editor, the focus and caret moving along. */
  private _switch(): void {
    const box = this.querySelector("textarea");
    const root = this.getRootNode() as Document | ShadowRoot;
    const focused = box !== null && root.activeElement === box;
    const caret = box?.selectionStart ?? this.value.length;
    this._mode = "code";
    void this.updateComplete.then(() => {
      if (focused) this._handle?.focus(caret);
    });
  }

  protected override updated(changed: PropertyValues): void {
    if (this._mode !== "code") {
      const box = this.querySelector("textarea");
      if (box) fitTemplateBox(box);
      return;
    }
    if (!this._mount || !this.isConnected) return;
    if (!this._handle) {
      const parent = this.querySelector<HTMLElement>(".tcode");
      if (!parent) return;
      this._doc = this.value;
      this._handle = this._mount({
        parent,
        root: this.getRootNode() as Document | ShadowRoot,
        doc: this.value,
        label: this.label,
        describedby: this.describedby,
        placeholder: PLACEHOLDER,
        marks: this.marks,
        complete: (text, pos, explicit) => complete(text, pos, explicit, this._env),
        phrases: { Completions: t("code.completions") },
        lineNumbers: this.lines,
        keepCaret: this.keepCaret,
        from: this.from,
        workspace: this.workspace,
        wrap: this.wrap,
        onWrap: (on) => this.onWrap(on),
        onCaret: (line, column) => this.onCaret(line, column),
        onPoint: (pos, caret) => this.onPoint(pos, caret),
        onFind: (selected) => this.onFind(selected),
        onChange: (text) => {
          this._doc = text;
          this.value = text;
          this.onInput(text);
        },
        onBlur: () => this.onBlur(),
      });
      return;
    }
    if (this.value !== this._doc) {
      this._doc = this.value;
      this._handle.setDoc(this.value);
    }
    if (changed.has("marks")) this._handle.setMarks(this.marks);
    if (changed.has("wrap")) this._handle.setWrap(this.wrap);
    if (changed.has("label") || changed.has("describedby"))
      this._handle.setLabel(this.label, this.describedby);
  }

  protected override render(): unknown {
    if (this._mode === "code") return html`<div class="tcode"></div>`;
    return html`<textarea
      class="tmpl"
      placeholder=${PLACEHOLDER}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      aria-label=${this.label}
      aria-describedby=${this.describedby ?? nothing}
      aria-invalid=${this.marks.some((m) => m.severity === "error") ? "true" : nothing}
      .value=${live(this.value)}
      @input=${(e: Event) => {
        const box = e.target as HTMLTextAreaElement;
        fitTemplateBox(box);
        this.value = box.value;
        this.onInput(box.value);
      }}
      @blur=${() => this.onBlur()}
    ></textarea>`;
  }
}

define("aivi-code-editor", AiviCodeEditor);

declare global {
  interface HTMLElementTagNameMap {
    "aivi-code-editor": AiviCodeEditor;
  }
}
