// What the panel and the code editor chunk (aivi-code-editor-<hash>.js) agree
// on. Types only: the panel loads the chunk at run time (loader.ts), so
// nothing here may hold code either side would have to bundle.

import type { JinjaCompletions } from "./jinja-complete";

/** Where the caret is, or what is selected: offsets into the text. */
export interface TextRange {
  from: number;
  to: number;
}

/** A stretch of the template to underline: an error, or an entity id
 * Home Assistant does not have. Offsets into the text. */
export interface TemplateMark {
  from: number;
  to: number;
  severity: "error" | "warning";
}

/** An editor's text with its selection and undo history, handed from
 * one editor to the next (the inline box and the template workspace), so a
 * field keeps one history wherever it is edited. `state` is the
 * editor's own; only the chunk reads it. */
export interface EditorSnapshot {
  readonly doc: string;
  readonly state: unknown;
}

export interface CodeEditorOptions {
  /** The element the editor is built inside. */
  parent: HTMLElement;
  /** The document or shadow root the editor lives in: its styles are
   * mounted there. */
  root: Document | ShadowRoot;
  doc: string;
  label: string;
  /** Id of the note under the box (aria-describedby), if any. */
  describedby: string | null;
  placeholder: string;
  marks: readonly TemplateMark[];
  /** What the completion list offers at `pos` (jinja-complete.ts, run
   * in the panel: the catalog stays out of the chunk). */
  complete: (text: string, pos: number, explicit: boolean) => JinjaCompletions | null;
  /** Translations of the editor's own words, keyed by its English. */
  phrases: Record<string, string>;
  /** Number the lines (the template workspace), so an error's line can be
   * found. */
  lineNumbers: boolean;
  /** Keep the caret and the selection drawn, dimmed, while the editor
   * has no focus (the template workspace: an insert goes there). */
  keepCaret: boolean;
  /** Start from this editor's text, selection and history (when it
   * holds `doc`). */
  from: EditorSnapshot | null;
  /** The template workspace's editor: Tab indents (Ctrl+M, or
   * Shift+Alt+M on a Mac, lets it move the focus instead), Mod+F finds,
   * Mod+/ comments lines out, Alt+Up and Alt+Down move them, and Alt+Z
   * turns line wrapping on and off. The inline box keeps Tab for the
   * form. */
  workspace: boolean;
  /** Wrap long lines (read when built; `setWrap` changes it). */
  wrap: boolean;
  /** Wrapping was turned on or off from the keyboard (Alt+Z). */
  onWrap: (on: boolean) => void;
  /** The caret moved: its line and column, from 1. */
  onCaret: (line: number, column: number) => void;
  /** The pointer rests over offset `pos` of the text (null: it left the
   * text), or the caret was moved there without typing (`caret`). */
  onPoint: (pos: number | null, caret: boolean) => void;
  /** Mod+F was pressed: open the find bar, with the selected text (on
   * one line) to look for, or "". */
  onFind: (selected: string) => void;
  /** The user changed the text. */
  onChange: (text: string) => void;
  onBlur: () => void;
}

export interface CodeEditorHandle {
  /** Replace the text (a change made elsewhere: a suggested fix). Never
   * reported back through onChange. */
  setDoc(text: string): void;
  setMarks(marks: readonly TemplateMark[]): void;
  setLabel(label: string, describedby: string | null): void;
  /** Focus the editor, the caret at `at` (the end when absent). */
  focus(at?: number): void;
  /** The selection, kept while the editor has no focus. */
  selection(): TextRange;
  /** Put `text` in place of `range`, as the user typing it (reported
   * through onChange, undone with one undo), and focus the editor with
   * the caret `caret` characters into `text` (with `head`, what lies
   * from `caret` to `head` selected). Nothing opens by itself. */
  replace(range: TextRange, text: string, caret: number, head?: number): void;
  /** Where offset `pos` is drawn, in the window's coordinates; null
   * when it is not in view. */
  coordsAt(pos: number): { left: number; top: number; bottom: number } | null;
  /** The text, selection and history, for another editor to go on from. */
  snapshot(): EditorSnapshot;
  /** Go on from another editor's text, selection and history. Never
   * reported back through onChange. */
  restore(from: EditorSnapshot): void;
  setWrap(on: boolean): void;
  /** What a phone's key row asks for: undo, or the caret a character
   * left or right. */
  run(command: EditorCommand): void;
  /** Mark every match of `query` and select the next one (`dir` 1), the
   * previous one (-1) or the first from the selection (0); "" clears. */
  find(query: string, dir: -1 | 0 | 1): FindResult;
  destroy(): void;
}

export type EditorCommand = "undo" | "left" | "right";

/** Which match is selected (from 1; 0 for none) of how many. */
export interface FindResult {
  current: number;
  total: number;
}

export type MountCodeEditor = (opts: CodeEditorOptions) => CodeEditorHandle;
