// The template code editor: the underlines from the preview's feedback
// (marks.ts), the Jinja highlighting (language.ts), the editor chunk itself
// (editor.ts, which CodeMirror lets happy-dom run without layout), the
// loader and <aivi-code-editor>, which is a plain textarea until the chunk
// is in and stays one when it cannot load.

import { type Completion, CompletionContext, completionStatus } from "@codemirror/autocomplete";
import { undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodeEditorHandle,
  CodeEditorOptions,
  MountCodeEditor,
  TemplateMark,
} from "../src/code-editor/contract";
import {
  completionSource,
  mountCodeEditor,
  optionIcon,
  pairInsert,
} from "../src/code-editor/editor";
import "../src/code-editor/element";
import type { AiviCodeEditor } from "../src/code-editor/element";
import { JINJA_FUNCTIONS, JINJA_TESTS } from "../src/code-editor/jinja-catalog";
import { type CompletionEnv, complete } from "../src/code-editor/jinja-complete";
import { jinja } from "../src/code-editor/language";
import { editorUrl, loadCodeEditor, setEditorLoader } from "../src/code-editor/loader";
import { templateMarks } from "../src/code-editor/marks";
import { OPTION_ICONS } from "../src/code-editor/option-icons";
import type { FieldFeedback } from "../src/types/content";
import { makeHass, STATES, tick, until } from "./harness";

afterEach(() => {
  setEditorLoader(null);
  document.body.innerHTML = "";
});

describe("the underlines", () => {
  const error = (line: number, column?: number): FieldFeedback =>
    column === undefined
      ? { status: "error", error: "x", line }
      : { status: "error", error: "x", line, column };
  const spans = (text: string, fb: FieldFeedback | undefined): string[] =>
    templateMarks(text, fb).map((m) => `${m.severity}:${text.slice(m.from, m.to)}`);

  it("marks nothing without feedback, for an empty box or a runtime error", () => {
    expect(templateMarks("{{ x }}", undefined)).toEqual([]);
    expect(templateMarks("", error(1, 1))).toEqual([]);
    expect(templateMarks("{{ x | float }}", { status: "error", error: "ValueError" })).toEqual([]);
    expect(templateMarks("{{ 1 }}", { status: "ok", value: "1" })).toEqual([]);
  });

  it("marks the word or closing tag at an error's line and column", () => {
    const text = "{% set t = 1 %}\n{{ t | round(1) | nope }}";
    expect(templateMarks(text, error(2, 19))).toEqual([{ from: 34, to: 38, severity: "error" }]);
    expect(spans(text, error(2, 19))).toEqual(["error:nope"]);
    expect(spans(text, error(2, 24))).toEqual(["error:}}"]);
    expect(spans("{{ 1 + }}", error(1, 6))).toEqual(["error:+"]);
    // An unclosed block's opening tag, up to its name.
    expect(spans("x\n  {%- if t > 0 %}\nyes", error(2, 3))).toEqual(["error:{%- if"]);
  });

  it("marks the last character written when the error is past the line's end", () => {
    expect(spans("{{ states('a'\n", error(1, 40))).toEqual(["error:'"]);
    expect(spans("{% if x %}\n  \n", error(2))).toEqual(["error:}"]);
    expect(spans("   ", error(1))).toEqual([]);
  });

  it("marks the whole line, without its indent, when only the line is known", () => {
    expect(spans("{% if x %}\n  {{ t | round(1) }\n{% endif %}", error(2))).toEqual([
      "error:{{ t | round(1) }",
    ]);
    // A line past the end is the last one.
    expect(spans("{{ x }", error(9))).toEqual(["error:{{ x }"]);
  });

  it("marks every whole occurrence of an entity id Home Assistant does not have", () => {
    const text =
      "{{ states('sensor.livingroom_temp') }} {{ states('sensor.livingroom_temp_2') }} sensor.livingroom_temp";
    const fb: FieldFeedback = {
      status: "ok",
      value: "",
      unknown: [{ id: "sensor.livingroom_temp", suggestions: ["sensor.living_temp"] }],
    };
    expect(spans(text, fb)).toEqual([
      "warning:sensor.livingroom_temp",
      "warning:sensor.livingroom_temp",
    ]);
    // An error and an unknown id together, in text order.
    const both: FieldFeedback = { ...error(1, 4), unknown: fb.unknown ?? [] };
    expect(spans("{{ sensor.livingroom_temp |}}", both).map((s) => s.split(":")[0])).toEqual([
      "error",
      "warning",
    ]);
  });
});

describe("highlighting", () => {
  const classes = tagHighlighter([
    { tag: tags.meta, class: "meta" },
    { tag: tags.keyword, class: "keyword" },
    { tag: tags.atom, class: "atom" },
    { tag: tags.number, class: "number" },
    { tag: tags.string, class: "string" },
    { tag: tags.comment, class: "comment" },
    { tag: tags.function(tags.variableName), class: "function" },
    { tag: tags.propertyName, class: "property" },
    { tag: tags.variableName, class: "variable" },
    { tag: tags.operator, class: "operator" },
    { tag: tags.punctuation, class: "punctuation" },
  ]);

  function highlighted(doc: string): string[] {
    const state = EditorState.create({ doc, extensions: [jinja] });
    const tree = ensureSyntaxTree(state, doc.length, 5000);
    const out: string[] = [];
    if (tree)
      highlightTree(tree, classes, (from, to, cls) => out.push(`${cls}:${doc.slice(from, to)}`));
    return out;
  }

  it("marks the parts of an expression and leaves the text around it plain", () => {
    expect(highlighted("It is {{ states('sensor.x') | round(1) }} °C")).toEqual([
      "meta:{{",
      "function:states",
      "punctuation:(",
      "string:'sensor.x'",
      "punctuation:)",
      "operator:|",
      "function:round",
      "punctuation:(",
      "number:1",
      "punctuation:)",
      "meta:}}",
    ]);
  });

  it("marks statements, constants, properties, comments and strings over lines", () => {
    const out = highlighted(
      "{%- if x.state == 'on' and not none -%}\n{# a note\nstill #}{{ \"two\nlines\" ~ y }}",
    );
    expect(out).toEqual([
      "meta:{%-",
      "keyword:if",
      "variable:x",
      "punctuation:.",
      "property:state",
      "operator:==",
      "string:'on'",
      "keyword:and",
      "keyword:not",
      "atom:none",
      "meta:-%}",
      "comment:{# a note",
      "comment:still #}",
      "meta:{{",
      'string:"two',
      'string:lines"',
      "operator:~",
      "variable:y",
      "meta:}}",
    ]);
    // A # in plain text is text, and so is an unclosed comment's end.
    expect(highlighted("Item #1")).toEqual([]);
    expect(highlighted("{# open")).toEqual(["comment:{# open"]);
    expect(highlighted("{{ 'esc\\'aped' }}")).toContain("string:'esc\\'aped'");
  });
});

/** Completion over the harness's states, with stand-in hints. */
const ENV: CompletionEnv = {
  states: () => STATES,
  functions: JINJA_FUNCTIONS,
  tests: JINJA_TESTS,
  hint: (name) => `hint ${name}`,
};
const completeHere = (text: string, pos: number, explicit: boolean) =>
  complete(text, pos, explicit, ENV);

describe("the editor chunk", () => {
  function mount(over: Partial<CodeEditorOptions> = {}): {
    handle: CodeEditorHandle;
    view: EditorView;
    parent: HTMLElement;
    changes: string[];
    blurs: number[];
  } {
    const parent = document.createElement("div");
    document.body.append(parent);
    const changes: string[] = [];
    const blurs: number[] = [];
    const handle = mountCodeEditor({
      parent,
      root: document,
      doc: "{{ states('sensor.living_temp') }}",
      label: "State template",
      describedby: "state-tnote",
      placeholder: "{{ states('sensor.example') }}",
      marks: [],
      complete: completeHere,
      phrases: { Completions: "Suggestions" },
      lineNumbers: false,
      keepCaret: false,
      from: null,
      workspace: false,
      wrap: true,
      onWrap: () => {},
      onCaret: () => {},
      onPoint: () => {},
      onFind: () => {},
      onChange: (text) => changes.push(text),
      onBlur: () => blurs.push(1),
      ...over,
    });
    const view = EditorView.findFromDOM(parent.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("no editor");
    return { handle, view, parent, changes, blurs };
  }

  const content = (parent: HTMLElement): HTMLElement =>
    parent.querySelector(".cm-content") as HTMLElement;

  it("labels its text box, turns off autocorrect and describes it by the note", () => {
    const { parent, handle } = mount();
    const box = content(parent);
    expect(box.getAttribute("role")).toBe("textbox");
    expect(box.getAttribute("aria-multiline")).toBe("true");
    expect(box.getAttribute("aria-label")).toBe("State template");
    expect(box.getAttribute("aria-describedby")).toBe("state-tnote");
    expect(box.getAttribute("autocapitalize")).toBe("off");
    expect(box.getAttribute("autocorrect")).toBe("off");
    expect(box.getAttribute("spellcheck")).toBe("false");
    handle.setLabel("Accent template", null);
    expect(box.getAttribute("aria-label")).toBe("Accent template");
    expect(box.hasAttribute("aria-describedby")).toBe(false);
    handle.destroy();
    expect(parent.querySelector(".cm-editor")).toBeNull();
  });

  it("reports the user's edits, never the text it is given", () => {
    const { view, handle, changes } = mount();
    view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" });
    expect(changes).toEqual(["x{{ states('sensor.living_temp') }}"]);
    handle.setDoc("{{ 1 }}");
    handle.setDoc("{{ 1 }}");
    expect(view.state.doc.toString()).toBe("{{ 1 }}");
    expect(changes).toHaveLength(1);
  });

  it("tells the caller when the box loses focus", () => {
    const { view, blurs } = mount();
    view.contentDOM.dispatchEvent(new FocusEvent("blur"));
    expect(blurs).toEqual([1]);
  });

  it("underlines errors and unknown ids, and marks the box invalid on an error", () => {
    const { parent, handle, view } = mount({ marks: [{ from: 11, to: 29, severity: "warning" }] });
    expect(parent.querySelector(".cm-aivi-warning")?.textContent).toBe("sensor.living_temp");
    expect(content(parent).hasAttribute("aria-invalid")).toBe(false);
    const error: TemplateMark[] = [{ from: 3, to: 9, severity: "error" }];
    handle.setMarks(error);
    expect(parent.querySelector(".cm-aivi-error")?.textContent).toBe("states");
    expect(parent.querySelector(".cm-aivi-warning")).toBeNull();
    expect(content(parent).getAttribute("aria-invalid")).toBe("true");
    // Edits before the next answer carry the underline along.
    view.dispatch({ changes: { from: 0, insert: "  " } });
    expect(parent.querySelector(".cm-aivi-error")?.textContent).toBe("states");
    // A mark past the end (the text changed since) is dropped.
    handle.setMarks([{ from: 3, to: 999, severity: "error" }]);
    expect(parent.querySelector(".cm-aivi-error")).toBeNull();
  });

  it("does not take Tab, so focus moves on; undo and redo work", () => {
    const { view } = mount({ doc: "" });
    const press = (key: string, init: KeyboardEventInit = {}): boolean =>
      runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...init }), "editor");
    expect(press("Tab")).toBe(false);
    expect(press("Tab", { shiftKey: true })).toBe(false);
    view.dispatch({ changes: { from: 0, insert: "{{ 1 }}" }, userEvent: "input.type" });
    expect(press("z", { ctrlKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(press("y", { ctrlKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("{{ 1 }}");
  });

  it("finds: marks every match, steps through them both ways, and clears", () => {
    const { view, handle } = mount({
      doc: "{{ states('a') }} and {{ STATES('b') }}",
      workspace: true,
    });
    view.dispatch({ selection: { anchor: 0 } });
    expect(handle.find("states", 0)).toEqual({ current: 1, total: 2 });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "states",
    );
    expect(view.dom.querySelectorAll(".cm-aivi-match").length).toBe(2);
    expect(handle.find("states", 1)).toEqual({ current: 2, total: 2 });
    // Round the end, and back round the start.
    expect(handle.find("states", 1)).toEqual({ current: 1, total: 2 });
    expect(handle.find("states", -1)).toEqual({ current: 2, total: 2 });
    expect(handle.find("nope", 0)).toEqual({ current: 0, total: 0 });
    expect(handle.find("", 0)).toEqual({ current: 0, total: 0 });
    expect(view.dom.querySelectorAll(".cm-aivi-match").length).toBe(0);
    // The inline box finds nothing.
    expect(mount({ doc: "states" }).handle.find("states", 0)).toEqual({ current: 0, total: 0 });
  });

  it("wraps lines or not, and runs the phone's keys", () => {
    const { view, handle } = mount({ doc: "ab", wrap: false });
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    handle.setWrap(true);
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    view.dispatch({ selection: { anchor: 1 } });
    handle.run("right");
    expect(view.state.selection.main.head).toBe(2);
    handle.run("left");
    expect(view.state.selection.main.head).toBe(1);
    view.dispatch({ changes: { from: 2, insert: "c" }, userEvent: "input.type" });
    handle.run("undo");
    expect(view.state.doc.toString()).toBe("ab");
  });

  it("focuses with the caret where asked, at the end by default", () => {
    const { view, handle } = mount({ doc: "{{ 1 }}" });
    handle.focus(3);
    expect(view.state.selection.main.head).toBe(3);
    handle.focus();
    expect(view.state.selection.main.head).toBe(7);
    handle.focus(99);
    expect(view.state.selection.main.head).toBe(7);
  });

  it("puts text in at the caret as typing would, the caret where asked", () => {
    const { view, handle, changes } = mount({ doc: "a  b" });
    // Set while the editor has no focus (a key or the entity browser has
    // it): the selection is the editor's state, not the page's.
    view.dispatch({ selection: { anchor: 2 } });
    expect(handle.selection()).toEqual({ from: 2, to: 2 });
    handle.replace({ from: 2, to: 2 }, "{{  }}", 3);
    expect(view.state.doc.toString()).toBe("a {{  }} b");
    expect(view.state.selection.main.head).toBe(5);
    expect(changes).toEqual(["a {{  }} b"]);
    // Over a selection, and past the end it lands at the end.
    expect(handle.selection()).toEqual({ from: 5, to: 5 });
    handle.replace({ from: 0, to: 1 }, "x", 1);
    expect(view.state.doc.toString()).toBe("x {{  }} b");
    handle.replace({ from: 99, to: 99 }, "!", 1);
    expect(view.state.doc.toString()).toBe("x {{  }} b!");
    // One undo takes an insert back.
    expect(
      runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: true }), "editor"),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe("x {{  }} b");
    // With a head, what lies between is selected: a recipe's limit, to
    // type over.
    view.contentDOM.blur();
    handle.replace({ from: 0, to: 0 }, "> 20 ", 2, 4);
    expect(view.state.selection.main).toMatchObject({ from: 2, to: 4 });
    expect(() => handle.coordsAt(99)).not.toThrow();
  });

  it("says where the caret was moved to, and that typing moved it", () => {
    const points: [number | null, boolean][] = [];
    const { view } = mount({
      doc: "{{ states('light.porch') }}",
      onPoint: (p, c) => points.push([p, c]),
    });
    view.focus();
    view.dispatch({ selection: { anchor: 14 } });
    view.dispatch({ changes: { from: 14, insert: "x" }, selection: { anchor: 15 } });
    // A selection is no place to rest on.
    view.contentDOM.blur();
    view.dispatch({ selection: { anchor: 3, head: 9 } });
    expect(points).toEqual([
      [14, true],
      [null, true],
      [null, true],
    ]);
    // The pointer leaving the text says so.
    view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    expect(points.at(-1)).toEqual([null, false]);
  });

  it("opens no list by itself on an insert, the caret left in the quotes to fill", async () => {
    const { view, handle } = mount({ doc: "" });
    handle.replace({ from: 0, to: 0 }, "{{ states('') }}", 11);
    expect(view.state.selection.main.head).toBe(11);
    await tick();
    expect(completionStatus(view.state)).toBeNull();
  });

  it("keeps the caret drawn while blurred only where asked (the template workspace)", () => {
    expect(mount().parent.querySelector(".cm-editor.cm-aivi-keep")).toBeNull();
    const { parent } = mount({ keepCaret: true });
    const box = parent.querySelector(".cm-editor") as HTMLElement;
    expect(box.classList.contains("cm-aivi-keep")).toBe(true);
    expect(box.classList.contains("cm-focused")).toBe(false);
    // The editor draws its own caret, so it can show without the focus.
    expect(parent.querySelector(".cm-cursorLayer")).not.toBeNull();
  });

  it("hands its text, selection and undo history to another editor and back", () => {
    const first = mount({ doc: "" });
    const typed = (view: EditorView, text: string): void => {
      const at = view.state.selection.main.head;
      view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
        userEvent: "input.type",
      });
    };
    const undo = (view: EditorView): boolean =>
      runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: true }), "editor");
    typed(first.view, "{{ 1 }}");
    const snap = first.handle.snapshot();
    expect(snap.doc).toBe("{{ 1 }}");
    // The other editor goes on from it: the caret where it was, and one
    // undo takes the first editor's typing back.
    const second = mount({ doc: "{{ 1 }}", from: snap, lineNumbers: true });
    expect(second.view.state.selection.main.head).toBe(7);
    second.view.dispatch({ selection: { anchor: 7 } });
    second.view.dispatch({ changes: { from: 7, insert: " x" }, userEvent: "input.paste" });
    // Back in the first: both edits undo there, one at a time.
    first.handle.restore(second.handle.snapshot());
    expect(first.view.state.doc.toString()).toBe("{{ 1 }} x");
    expect(first.changes).toEqual(["{{ 1 }}"]);
    expect(undo(first.view)).toBe(true);
    expect(first.view.state.doc.toString()).toBe("{{ 1 }}");
    expect(undo(first.view)).toBe(true);
    expect(first.view.state.doc.toString()).toBe("");
    // A snapshot of other text, or one that cannot be read, starts afresh.
    const stale = mount({ doc: "other", from: snap });
    expect(stale.view.state.doc.toString()).toBe("other");
    expect(undoDepth(stale.view.state)).toBe(0);
    first.handle.restore({ doc: "new", state: { broken: true } });
    expect(first.view.state.doc.toString()).toBe("new");
    expect(undoDepth(first.view.state)).toBe(0);
  });

  it("numbers the lines only when asked", () => {
    expect(mount().parent.querySelector(".cm-lineNumbers")).toBeNull();
    expect(mount({ lineNumbers: true }).parent.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("draws the panel's glyph for each kind of option, and none for others", () => {
    for (const kind of Object.keys(OPTION_ICONS)) {
      const svg = optionIcon(kind) as SVGElement;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("class")).toBe("cm-aivi-icon");
      expect(svg.querySelector("path")?.getAttribute("d")).toBe(
        OPTION_ICONS[kind as keyof typeof OPTION_ICONS],
      );
    }
    expect(optionIcon("keyword")).toBeNull();
    expect(optionIcon(undefined)).toBeNull();
  });

  it("pads {{ }} and opens {% %} and {# #} as they are typed", () => {
    // The space typed between {{ }} is the user's; the one after {% is not.
    expect(pairInsert("{{", "}}", " ")).toEqual({
      insert: "  ",
      caret: 1,
      back: 1,
      fwd: 1,
      lead: false,
      tail: 3,
    });
    expect(pairInsert("a{", "}", "%")).toEqual({
      insert: "%  %",
      caret: 2,
      back: 2,
      fwd: 2,
      lead: true,
      tail: 3,
    });
    expect(pairInsert("a{", "}", "#")?.insert).toBe("#  #");
    expect(pairInsert("{{", "}}", "x")).toBeNull();
    expect(pairInsert("{ ", "}}", " ")).toBeNull();
    expect(pairInsert("a", "", "%")).toBeNull();
  });

  describe("typing key by key", () => {
    /** Types `keys` as the browser's input would reach the editor: each
     * character offered to the input handlers (closeBrackets, the Jinja
     * pairs), else put in as typed. */
    function type(view: EditorView, keys: string): void {
      for (const key of keys) {
        const { from, to } = view.state.selection.main;
        const typed = () =>
          view.state.update({
            changes: { from, to, insert: key },
            selection: { anchor: from + key.length },
            userEvent: "input.type",
          });
        const handlers = view.state.facet(EditorView.inputHandler);
        if (!handlers.some((handler) => handler(view, from, to, key, typed)))
          view.dispatch(typed());
      }
    }
    const press = (view: EditorView, key: string, init: KeyboardEventInit = {}): boolean =>
      runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...init }), "editor");
    /** The text with the caret as |. */
    const shown = (view: EditorView): string => {
      const doc = view.state.doc.toString();
      const at = view.state.selection.main.head;
      return `${doc.slice(0, at)}|${doc.slice(at)}`;
    };

    it.each([
      "{{ 1 }}",
      "{{1}}",
      "{{ 1}}",
      "{% if x %}",
      "{%if x%}",
      "{%  if x %}",
      "{# a note #}",
      "{{ states('sensor.living_temp') | float(0) }}",
      "{{ [1, 2] | max }}",
      '{{ "it\'s" }}',
      "{% if is_state('light.porch', 'on') %}On{% else %}Off{% endif %}",
      "{% set t = states('sensor.living_temp') | float(0) %}{{ (t * 1.8 + 32) | round(1) }}",
    ])("gives exactly what was typed: %s", (template) => {
      const { view } = mount({ doc: "" });
      type(view, template);
      expect(view.state.doc.toString()).toBe(template);
      expect(view.state.selection.main.head).toBe(template.length);
    });

    it("gives exactly what was typed over several lines", () => {
      const { view } = mount({ doc: "" });
      const lines = ["{% if x %}", "  {{ 1 }}", "{% endif %}"];
      for (const [i, line] of lines.entries()) {
        if (i) view.dispatch(view.state.replaceSelection("\n"));
        type(view, line);
      }
      expect(view.state.doc.toString()).toBe(lines.join("\n"));
    });

    it("closes what it opens, and the caret goes in between", () => {
      const { view } = mount({ doc: "" });
      type(view, "{{ ");
      expect(shown(view)).toBe("{{ | }}");
      const percent = mount({ doc: "" }).view;
      type(percent, "{%");
      expect(shown(percent)).toBe("{% | %}");
      const hash = mount({ doc: "" }).view;
      type(hash, "{#");
      expect(shown(hash)).toBe("{# | #}");
      const call = mount({ doc: "" }).view;
      type(call, "states('");
      expect(shown(call)).toBe("states('|')");
    });

    it("steps over a closer only where it put one in", () => {
      // Typed into the middle of text it did not write, } goes in.
      const { view } = mount({ doc: "{{ 1 }}" });
      view.dispatch({ selection: { anchor: 4 } });
      type(view, "}");
      expect(view.state.doc.toString()).toBe("{{ 1} }}");
      // Moving to another line forgets the closers it put in.
      const moved = mount({ doc: "\n" }).view;
      type(moved, "{{ 1");
      moved.dispatch({ selection: { anchor: moved.state.doc.length } });
      moved.dispatch({ selection: { anchor: 4 } });
      type(moved, "}");
      expect(moved.state.doc.toString()).toBe("{{ 1} }}\n");
    });

    it("takes a pairing back with one Backspace right after it", () => {
      const { view } = mount({ doc: "" });
      type(view, "{{ ");
      expect(press(view, "Backspace")).toBe(true);
      expect(shown(view)).toBe("{{|}}");
      expect(press(view, "Backspace")).toBe(true);
      expect(shown(view)).toBe("{|}");
      expect(press(view, "Backspace")).toBe(true);
      expect(shown(view)).toBe("|");
      type(view, "{%");
      press(view, "Backspace");
      expect(shown(view)).toBe("{|}");
      type(view, "#");
      press(view, "Backspace");
      expect(shown(view)).toBe("{|}");
      // Brackets and quotes too (closeBrackets).
      const call = mount({ doc: "" }).view;
      type(call, "states('");
      press(call, "Backspace");
      expect(shown(call)).toBe("states(|)");
      press(call, "Backspace");
      expect(shown(call)).toBe("states|");
      // Once something is typed, Backspace deletes one character.
      const typed = mount({ doc: "" }).view;
      type(typed, "{{ 1");
      press(typed, "Backspace");
      press(typed, "Backspace");
      expect(shown(typed)).toBe("{{| }}");
    });

    it("undoes a pairing and the typing after it", () => {
      const { view } = mount({ doc: "" });
      type(view, "{% if x %}");
      expect(press(view, "z", { ctrlKey: true })).toBe(true);
      expect(view.state.doc.toString()).toBe("");
    });
  });

  describe("completion", () => {
    const source = completionSource(completeHere);

    function query(doc: string, explicit = false) {
      const state = EditorState.create({ doc });
      return source(new CompletionContext(state, doc.length, explicit));
    }

    it("answers in CodeMirror's terms", () => {
      expect(query("text")).toBeNull();
      const entities = query("{{ states('sensor.liv");
      expect(entities).toMatchObject({ from: 11, filter: false });
      expect(entities?.validFor).toBeUndefined();
      expect(entities?.options[0]).toEqual({
        label: "sensor.living_temp",
        type: "entity",
        detail: "Living room temperature",
      });
      const fns = query("{{ sta");
      expect(fns).toMatchObject({ from: 3, filter: true });
      expect(fns?.validFor).toEqual(/^\w*$/);
      expect(fns?.options.find((o) => o.label === "now")).toMatchObject({
        detail: "()",
        info: "hint now",
      });
    });

    it("puts in a call with the caret inside, opening the entity list again", () => {
      const { view } = mount({ doc: "{{ sta }}" });
      const option = query("{{ sta", true)?.options.find((o) => o.label === "states") as Completion;
      const apply = option.apply as (
        v: EditorView,
        c: Completion,
        from: number,
        to: number,
      ) => void;
      apply(view, option, 3, 6);
      expect(view.state.doc.toString()).toBe("{{ states('') }}");
      expect(view.state.selection.main.head).toBe(11);
      const now = query("{{ n", true)?.options.find((o) => o.label === "now") as Completion;
      (now.apply as typeof apply)(view, now, 3, 13);
      expect(view.state.doc.toString()).toBe("{{ now() }}");
      expect(view.state.selection.main.head).toBe(8);
      // A plain entity id goes in as its label.
      expect(query("{{ states('sensor.liv")?.options[0]?.apply).toBeUndefined();
    });
  });
});

describe("loading the chunk", () => {
  it("lives beside the bundle when it is served over HTTP, under its hashed name", () => {
    expect(
      editorUrl("https://ha.local/aivi_panel/aivi-panel.js?v=1.2", "aivi-code-editor-DdMdpSaJ.js"),
    ).toBe("https://ha.local/aivi_panel/aivi-code-editor-DdMdpSaJ.js");
    // Outside a build the name is a placeholder; the panel's query is not carried over.
    expect(editorUrl("http://127.0.0.1:8777/custom_components/aivi/frontend/aivi-panel.js")).toBe(
      "http://127.0.0.1:8777/custom_components/aivi/frontend/aivi-code-editor-dev.js",
    );
    expect(editorUrl("file:///repo/frontend/src/code-editor/loader.ts")).toBeNull();
    expect(editorUrl("not a url")).toBeNull();
    // Here the sources run from disk: there is no chunk to load.
    expect(editorUrl()).toBeNull();
  });

  it("fails where there is no chunk, and tries again on the next box", async () => {
    await expect(loadCodeEditor()).rejects.toThrow("not served here");
    let calls = 0;
    const mount = (() => ({})) as unknown as MountCodeEditor;
    setEditorLoader(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(mount);
    });
    await expect(loadCodeEditor()).rejects.toThrow("offline");
    await expect(loadCodeEditor()).resolves.toBe(mount);
    // Loaded once, kept.
    await expect(loadCodeEditor()).resolves.toBe(mount);
    expect(calls).toBe(2);
  });
});

describe("<aivi-code-editor>", () => {
  interface Spy {
    opts: CodeEditorOptions | null;
    calls: string[];
  }

  /** A stand-in for the chunk that records what the element asks of it. */
  function fakeChunk(): { spy: Spy; mount: MountCodeEditor } {
    const spy: Spy = { opts: null, calls: [] };
    const mount: MountCodeEditor = (opts) => {
      spy.opts = opts;
      opts.parent.append(Object.assign(document.createElement("div"), { className: "fake-cm" }));
      return {
        setDoc: (text) => spy.calls.push(`doc:${text}`),
        setMarks: (marks) => spy.calls.push(`marks:${marks.length}`),
        setLabel: (label, describedby) => spy.calls.push(`label:${label}:${describedby}`),
        focus: (at) => spy.calls.push(`focus:${at}`),
        selection: () => ({ from: 2, to: 4 }),
        replace: (range, text, caret) =>
          spy.calls.push(`replace:${range.from}-${range.to}:${text}:${caret}`),
        coordsAt: (pos) => ({ left: pos, top: 0, bottom: 10 }),
        snapshot: () => ({ doc: "snap", state: null }),
        restore: (from) => spy.calls.push(`restore:${from.doc}`),
        setWrap: (on) => spy.calls.push(`wrap:${on}`),
        run: (command) => spy.calls.push(`run:${command}`),
        find: (query, dir) => {
          spy.calls.push(`find:${query}:${dir}`);
          return { current: query ? 1 : 0, total: query ? 2 : 0 };
        },
        destroy: () => spy.calls.push("destroy"),
      };
    };
    return { spy, mount };
  }

  function place(props: {
    value: string;
    marks?: TemplateMark[];
    describedby?: string | null;
    onInput?: (text: string) => void;
    onBlur?: () => void;
  }): HTMLElement {
    let host = document.querySelector<HTMLElement>("#host");
    if (!host) {
      host = Object.assign(document.createElement("div"), { id: "host" });
      document.body.append(host);
    }
    render(
      html`<aivi-code-editor
        .value=${props.value}
        .label=${"State template"}
        .describedby=${props.describedby ?? null}
        .hass=${makeHass()}
        .marks=${props.marks ?? []}
        .onInput=${props.onInput ?? (() => {})}
        .onBlur=${props.onBlur ?? (() => {})}
      ></aivi-code-editor>`,
      host,
    );
    return host;
  }

  const editor = (host: HTMLElement): AiviCodeEditor =>
    host.querySelector("aivi-code-editor") as AiviCodeEditor;

  it("stays a labeled textarea when the chunk cannot load", async () => {
    const typed: string[] = [];
    let blurred = 0;
    const host = place({
      value: "{{ 1 }}",
      describedby: "n1",
      marks: [{ from: 3, to: 4, severity: "error" }],
      onInput: (text) => typed.push(text),
      onBlur: () => blurred++,
    });
    await editor(host).updateComplete;
    await tick();
    const box = host.querySelector("textarea.tmpl") as HTMLTextAreaElement;
    expect(box.value).toBe("{{ 1 }}");
    expect(box.getAttribute("aria-label")).toBe("State template");
    expect(box.getAttribute("aria-describedby")).toBe("n1");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("autocapitalize")).toBe("off");
    expect(box.getAttribute("spellcheck")).toBe("false");
    box.value = "{{ 2 }}";
    box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new Event("blur"));
    expect(typed).toEqual(["{{ 2 }}"]);
    expect(blurred).toBe(1);
    expect(host.querySelector(".tcode")).toBeNull();
  });

  it("swaps in the editor once loaded, with the text, label, note and underlines", async () => {
    const { spy, mount } = fakeChunk();
    setEditorLoader(() => Promise.resolve(mount));
    const typed: string[] = [];
    const host = place({
      value: "{{ states('sensor.living_temp') }}",
      describedby: "n1",
      marks: [{ from: 3, to: 9, severity: "error" }],
      onInput: (text) => typed.push(text),
    });
    await until(() => host.querySelector(".fake-cm") !== null, "the editor");
    expect(host.querySelector("textarea")).toBeNull();
    const opts = spy.opts as CodeEditorOptions;
    expect(opts.parent.classList.contains("tcode")).toBe(true);
    expect(opts.doc).toBe("{{ states('sensor.living_temp') }}");
    expect(opts.label).toBe("State template");
    expect(opts.describedby).toBe("n1");
    expect(opts.marks).toEqual([{ from: 3, to: 9, severity: "error" }]);
    expect(opts.placeholder).toBe("{{ states('sensor.example') }}");
    expect(opts.phrases).toEqual({ Completions: "Suggestions" });
    // Completion runs in the panel, with the catalog's hints.
    const fns = opts.complete("{{ sta", 6, false);
    expect(fns?.options.find((o) => o.label === "states")?.info).toBe(
      "The state of an entity, as text",
    );
    expect(opts.complete("{{ x is de", 10, false)?.options[0]).toMatchObject({
      label: "defined",
      info: "Whether a value exists",
    });
    expect(opts.complete("{{ states('sensor.liv", 21, false)?.options[0]?.label).toBe(
      "sensor.living_temp",
    );

    // The user's edits reach the caller; a re-render with the same text
    // changes nothing.
    opts.onChange("{{ 2 }}");
    expect(typed).toEqual(["{{ 2 }}"]);
    place({ value: "{{ 2 }}", describedby: "n1", marks: [{ from: 3, to: 9, severity: "error" }] });
    await editor(host).updateComplete;
    expect(spy.calls).toEqual([]);

    // A change from elsewhere (a suggested fix) goes in; so do new marks
    // and a new note.
    place({ value: "{{ 3 }}", describedby: null, marks: [] });
    await editor(host).updateComplete;
    expect(spy.calls).toEqual(["doc:{{ 3 }}", "marks:0", "label:State template:null"]);
  });

  it("hands the caret and inserts to the editor once it is in", async () => {
    const { spy, mount } = fakeChunk();
    setEditorLoader(() => Promise.resolve(mount));
    const host = place({ value: "{{ 1 }}" });
    await until(() => host.querySelector(".fake-cm") !== null, "the editor");
    const el = editor(host);
    expect(el.selection()).toEqual({ from: 2, to: 4 });
    el.replace({ from: 2, to: 4 }, "x", 1);
    el.focusAt(5);
    expect(spy.calls).toEqual(["replace:2-4:x:1", "focus:5"]);
    expect(el.coordsAt(3)).toEqual({ left: 3, top: 0, bottom: 10 });
    expect(spy.opts?.lineNumbers).toBe(false);
    expect(spy.opts?.keepCaret).toBe(false);
    expect(spy.opts?.from).toBeNull();
    // The history goes out and comes in through the editor.
    expect(el.snapshot()).toEqual({ doc: "snap", state: null });
    el.adopt({ doc: "{{ 2 }}", state: null });
    expect(spy.calls.at(-1)).toBe("restore:{{ 2 }}");
  });

  it("has no history to hand over while it is a textarea", async () => {
    const host = place({ value: "{{ 1 }}" });
    const el = editor(host);
    await el.updateComplete;
    expect(el.snapshot()).toBeNull();
    el.adopt({ doc: "x", state: null });
    expect(el.value).toBe("{{ 1 }}");
  });

  it("puts text in at the textarea's caret while the editor is not in", async () => {
    const typed: string[] = [];
    const host = place({ value: "a  b", onInput: (text) => typed.push(text) });
    const el = editor(host);
    await el.updateComplete;
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    box.setSelectionRange(2, 2);
    box.blur();
    expect(el.selection()).toEqual({ from: 2, to: 2 });
    el.replace(el.selection(), "{{  }}", 3);
    expect(box.value).toBe("a {{  }} b");
    expect(typed).toEqual(["a {{  }} b"]);
    expect(box.selectionStart).toBe(5);
    expect(document.activeElement).toBe(box);
    el.focusAt(0);
    expect(box.selectionStart).toBe(0);
  });

  it("moves the focus and caret over from the textarea", async () => {
    const { spy, mount } = fakeChunk();
    let release: (m: MountCodeEditor) => void = () => {};
    setEditorLoader(() => new Promise((resolve) => (release = resolve)));
    const host = place({ value: "{{ 1 }}" });
    await editor(host).updateComplete;
    const box = host.querySelector("textarea") as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(3, 3);
    release(mount);
    await until(() => spy.calls.includes("focus:3"), "the focus moved");
  });

  it("builds the editor again when it is put back in the page", async () => {
    const { spy, mount } = fakeChunk();
    setEditorLoader(() => Promise.resolve(mount));
    const host = place({ value: "{{ 1 }}" });
    await until(() => host.querySelector(".fake-cm") !== null, "the editor");
    const el = editor(host);
    el.remove();
    expect(spy.calls).toEqual(["destroy"]);
    spy.opts = null;
    host.append(el);
    await el.updateComplete;
    expect(spy.opts).not.toBeNull();
  });

  it("swaps nothing in when it left the page before the chunk loaded", async () => {
    const { spy, mount } = fakeChunk();
    let release: (m: MountCodeEditor) => void = () => {};
    setEditorLoader(() => new Promise((resolve) => (release = resolve)));
    const host = place({ value: "{{ 1 }}" });
    const el = editor(host);
    await el.updateComplete;
    el.remove();
    release(mount);
    await tick();
    expect(spy.opts).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("Home Assistant's one-key shortcuts", () => {
  it("never see a character typed in the box, and still see keys with a modifier", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(html`<aivi-code-editor .value=${"{{ }}"}></aivi-code-editor>`, host);
    const box = host.querySelector<AiviCodeEditor>("aivi-code-editor")!;
    await box.updateComplete;
    const seen: string[] = [];
    const listener = (e: KeyboardEvent): void => {
      seen.push(`${e.metaKey ? "meta+" : ""}${e.key}`);
    };
    window.addEventListener("keydown", listener);
    try {
      const inside = box.firstElementChild ?? box;
      for (const key of ["a", "d", "e", " "]) {
        inside.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
      }
      inside.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, composed: true }),
      );
      inside.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
      );
      expect(seen).toEqual(["meta+k", "Escape"]);
    } finally {
      window.removeEventListener("keydown", listener);
      host.remove();
    }
  });
});
