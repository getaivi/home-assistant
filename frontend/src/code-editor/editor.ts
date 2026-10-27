// The code editor chunk: built on its own into aivi-code-editor-<hash>.js
// (frontend/vite.editor.config.ts) and loaded by the panel the first time
// a template box shows (loader.ts). CodeMirror with Jinja highlighting,
// completion of entities, attributes and functions (jinja-complete.ts),
// undo history, bracket closing and underlines where the template fails.
//
// In the form's inline box Tab is not taken: it accepts a completion
// while the list is open and otherwise moves focus on, as in any form
// field. The template workspace's editor is a code editor: Tab indents,
// and Ctrl+M (Shift+Alt+M on a Mac) lets it move the focus instead, as
// CodeMirror recommends; it finds (find.ts), comments lines out, moves
// them, and wraps them or not.

import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completionKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  cursorCharLeft,
  cursorCharRight,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  standardKeymap,
  toggleComment,
  toggleTabFocusMode,
  undo,
} from "@codemirror/commands";
import {
  Annotation,
  type ChangeDesc,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import type {
  CodeEditorHandle,
  CodeEditorOptions,
  EditorCommand,
  EditorSnapshot,
  TemplateMark,
} from "./contract";
import { find, findStep } from "./find";
import type { JinjaCompletions, JinjaOption, OptionKind } from "./jinja-complete";
import { jinja } from "./language";
import { OPTION_ICONS } from "./option-icons";
import { editorTheme } from "./theme";

/** Options the completion list shows at once. */
const SHOWN_OPTIONS = 8;

/** Marks a change made from outside (setDoc), never reported back. */
const external = Annotation.define<boolean>();

const setMarks = StateEffect.define<readonly TemplateMark[]>();

const markClass = {
  error: Decoration.mark({ class: "cm-aivi-error" }),
  warning: Decoration.mark({ class: "cm-aivi-warning" }),
};

function decorations(marks: readonly TemplateMark[], length: number): DecorationSet {
  const ranges = marks
    .filter((m) => m.from < m.to && m.to <= length)
    .map((m) => markClass[m.severity].range(m.from, m.to));
  return Decoration.set(ranges, true);
}

/** The underlines: replaced by each answer, carried along by edits made
 * before the next one. */
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarks)) return decorations(effect.value, tr.newDoc.length);
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** A Jinja option as CodeMirror shows and applies it. */
function toCompletion(option: JinjaOption): Completion {
  const completion: Completion = { label: option.label, type: option.type };
  if (option.detail) completion.detail = option.detail;
  if (option.info) completion.info = option.info;
  if (option.boost) completion.boost = option.boost;
  const text = option.apply;
  if (text !== undefined || option.reopen) {
    completion.apply = (view, _c, from, to) => {
      const insert = text ?? option.label;
      const caret = from + (option.caret ?? insert.length);
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(caret),
        userEvent: "input.complete",
      });
      if (option.reopen) startCompletion(view);
    };
  }
  return completion;
}

const SVG = "http://www.w3.org/2000/svg";

function isKind(type: string | undefined): type is OptionKind {
  return type !== undefined && Object.hasOwn(OPTION_ICONS, type);
}

/** The icon before an option: the panel's glyph for its kind (an
 * entity, an attribute, a function…), or nothing for a kind without
 * one. Decorative: the label says what the option is. */
export function optionIcon(type: string | undefined): Node | null {
  if (!isKind(type)) return null;
  const path = OPTION_ICONS[type];
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cm-aivi-icon");
  const shape = document.createElementNS(SVG, "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

/** The completion source over jinja-complete.ts's `complete`, which the
 * panel runs. */
export function completionSource(
  complete: (text: string, pos: number, explicit: boolean) => JinjaCompletions | null,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const found = complete(context.state.doc.toString(), context.pos, context.explicit);
    if (!found) return null;
    const result: CompletionResult = {
      from: found.from,
      options: found.options.map(toCompletion),
      filter: found.filter,
    };
    if (found.filter) result.validFor = /^\w*$/;
    return result;
  };
}

/** A pairing typing puts in: `insert` with the caret `caret` into it;
 * `back` and `fwd` are the characters around the caret Backspace takes
 * back at once, `lead` whether the space before the caret is the
 * editor's (not typed), and `tail` the closer after it (" }}", " %}"). */
export interface Pairing {
  insert: string;
  caret: number;
  back: number;
  fwd: number;
  lead: boolean;
  tail: number;
}

/** What typing `text` between `before` and `after` (the two characters
 * on each side) puts in instead: a space between {{ and }} pads both
 * sides, and a % or # right after a { that was closed for it opens a
 * {% %} or a {# #}. Null types it as is. */
export function pairInsert(before: string, after: string, text: string): Pairing | null {
  if (text === " " && before === "{{" && after === "}}")
    return { insert: "  ", caret: 1, back: 1, fwd: 1, lead: false, tail: 3 };
  if ((text === "%" || text === "#") && before.endsWith("{") && after.startsWith("}"))
    return { insert: `${text}  ${text}`, caret: 2, back: 2, fwd: 2, lead: true, tail: 3 };
  return null;
}

/** A closer the editor put in (" }}", " %}", or what is left of one).
 * Typing it steps over it rather than doubling it; typed without the
 * space before it, the space goes. Every other key types as usual. */
interface Tail {
  from: number;
  to: number;
}

/** What the editor put in on its own around the caret: the closers still
 * ahead, and, right after a pairing, its padding (Backspace there takes
 * the pairing back; the first key typed decides the editor's space
 * before the caret: a space keeps it, anything else takes its place). */
interface AutoPairs {
  tails: readonly Tail[];
  pad: { at: number; back: number; fwd: number; lead: boolean } | null;
}

const setPairs = StateEffect.define<AutoPairs>();

/** The closers after `changes`; one typed into is the user's now. */
function mapTails(tails: readonly Tail[], changes: ChangeDesc): Tail[] {
  return tails
    .filter((t) => t.to - t.from < 2 || !changes.touchesRange(t.from + 1, t.to - 1))
    .map((t) => ({ from: changes.mapPos(t.from, 1), to: changes.mapPos(t.to, -1) }))
    .filter((t) => t.from < t.to);
}

const pairsField = StateField.define<AutoPairs>({
  create: () => ({ tails: [], pad: null }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPairs)) return effect.value;
    if (!tr.docChanged && !tr.selection) return value;
    let tails = tr.docChanged ? mapTails(value.tails, tr.changes) : value.tails;
    // As closeBrackets does: only the caret's line keeps them.
    if (tr.selection) {
      const line = tr.state.doc.lineAt(tr.selection.main.head);
      tails = tails.filter((t) => t.from >= line.from && t.to <= line.to);
    }
    return { tails, pad: null };
  },
});

/** Pairs Jinja's tags as they are typed and steps over the closers it
 * put in, so a template typed key by key comes out as typed. Ahead of
 * closeBrackets, which does the same for brackets and quotes. */
const jinjaPairs = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    const { state } = view;
    if (from !== to || state.selection.ranges.length > 1) return false;
    const doc = state.doc;
    const auto = state.field(pairsField);
    if (auto.pad?.lead && auto.pad.at === from) {
      if (text === " ") {
        // The space is there: the padding put in with the pair.
        view.dispatch({ effects: setPairs.of({ tails: auto.tails, pad: null }) });
        return true;
      }
      // Typed without a space ({%if): the padding gives way.
      const changes = state.changes({ from: from - 1, to: from, insert: text });
      view.dispatch({
        changes,
        selection: EditorSelection.cursor(from - 1 + text.length),
        effects: setPairs.of({ tails: mapTails(auto.tails, changes), pad: null }),
        userEvent: "input.type",
      });
      return true;
    }
    const tail = text === " " ? undefined : auto.tails.find((t) => t.from <= from && from < t.to);
    if (tail) {
      const others = auto.tails.filter((t) => t !== tail);
      const next = doc.sliceString(from, from + 1);
      if (next === text) {
        const rest = from + 1 < tail.to ? [{ from: from + 1, to: tail.to }] : [];
        view.dispatch({
          selection: EditorSelection.cursor(from + 1),
          effects: setPairs.of({ tails: [...others, ...rest], pad: null }),
          userEvent: "select",
        });
        return true;
      }
      if (next === " " && /^[}%#]$/.test(text) && doc.sliceString(from + 1, from + 2) === text) {
        // The closer typed without the padding before it: the padding
        // goes, and the caret steps over the closer.
        const changes = state.changes({ from, to: from + 1 });
        const rest = from + 1 < tail.to - 1 ? [{ from: from + 1, to: tail.to - 1 }] : [];
        view.dispatch({
          changes,
          selection: EditorSelection.cursor(from + 1),
          effects: setPairs.of({ tails: [...mapTails(others, changes), ...rest], pad: null }),
          userEvent: "input.type",
        });
        return true;
      }
    }
    const pair = pairInsert(
      doc.sliceString(Math.max(0, from - 2), from),
      doc.sliceString(from, from + 2),
      text,
    );
    if (!pair) return false;
    const changes = state.changes({ from, insert: pair.insert });
    const at = from + pair.caret;
    view.dispatch({
      changes,
      selection: EditorSelection.cursor(at),
      effects: setPairs.of({
        tails: [...mapTails(auto.tails, changes), { from: at, to: at + pair.tail }],
        pad: { at, back: pair.back, fwd: pair.fwd, lead: pair.lead },
      }),
      userEvent: "input.type",
    });
    return true;
  }),
);

/** Backspace right after a pairing takes the pairing back: {{ | }} to
 * {{|}}, {% | %} to {|}. */
function unpair(view: EditorView): boolean {
  const { state } = view;
  const { tails, pad } = state.field(pairsField);
  const main = state.selection.main;
  if (!pad || !main.empty || main.head !== pad.at || state.selection.ranges.length > 1)
    return false;
  const changes = state.changes({ from: pad.at - pad.back, to: pad.at + pad.fwd });
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(pad.at - pad.back),
    effects: setPairs.of({
      tails: mapTails(
        tails.filter((t) => t.from !== pad.at),
        changes,
      ),
      pad: null,
    }),
    userEvent: "delete.backward",
  });
  return true;
}

function contentAttributes(label: string, describedby: string | null) {
  const attrs: Record<string, string> = {
    "aria-label": label,
    // In the tab order as a text field is; it also tells checkers the
    // scrolling box around it can be reached by keyboard.
    tabindex: "0",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    translate: "no",
  };
  if (describedby) attrs["aria-describedby"] = describedby;
  return EditorView.contentAttributes.of(attrs);
}

/** What a snapshot carries besides the text and the selection. */
const SNAPSHOT_FIELDS = { history: historyField };

export function mountCodeEditor(opts: CodeEditorOptions): CodeEditorHandle {
  const aria = new Compartment();
  const invalid = new Compartment();
  const wrapping = new Compartment();
  let wrap = opts.wrap;
  const wrapped = (): Extension => (wrap ? EditorView.lineWrapping : []);
  const toggleWrap = (view: EditorView): boolean => {
    wrap = !wrap;
    view.dispatch({ effects: wrapping.reconfigure(wrapped()) });
    opts.onWrap(wrap);
    return true;
  };
  // The workspace's keys, after completion's and the history's.
  const workspaceKeys = opts.workspace
    ? [
        keymap.of([
          indentWithTab,
          { key: "Mod-/", run: toggleComment },
          {
            key: "Mod-f",
            run: (view) => {
              const { from, to } = view.state.selection.main;
              const picked = view.state.sliceDoc(from, to);
              opts.onFind(picked.includes("\n") ? "" : picked);
              return true;
            },
            preventDefault: true,
          },
          { key: "Alt-z", run: toggleWrap, preventDefault: true },
          { key: "Ctrl-m", mac: "Shift-Alt-m", run: toggleTabFocusMode },
          { key: "Alt-ArrowUp", run: moveLineUp },
          { key: "Alt-ArrowDown", run: moveLineDown },
        ]),
        find,
      ]
    : [];
  let label = opts.label;
  let describedby = opts.describedby;
  let marks = opts.marks;
  const invalidAttr = (current: readonly TemplateMark[]) =>
    EditorView.contentAttributes.of(
      current.some((m) => m.severity === "error") ? { "aria-invalid": "true" } : {},
    );
  // Built again for a state handed over from another editor: the
  // history comes with it, this editor's own settings do not.
  const extensions = (): Extension[] => [
    EditorState.phrases.of(opts.phrases),
    history(),
    closeBrackets(),
    pairsField,
    jinjaPairs,
    // Eight options at a time: the list never scrolls on its own (the
    // arrows move through the rest; typing narrows it).
    autocompletion({
      override: [completionSource(opts.complete)],
      // CodeMirror's own icons (an italic x, a square) are a
      // programmer's code; the panel's glyphs say entity, attribute,
      // function.
      icons: false,
      addToOptions: [{ render: (completion) => optionIcon(completion.type), position: 20 }],
      maxRenderedOptions: SHOWN_OPTIONS,
    }),
    // Tab takes a completion while the list is open and otherwise
    // leaves the box; Escape closes the list without reaching the
    // panel's own Escape handlers.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: acceptCompletion },
        { key: "Escape", run: closeCompletion, stopPropagation: true },
        { key: "Backspace", run: unpair },
      ]),
    ),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap]),
    workspaceKeys,
    keymap.of(standardKeymap),
    jinja,
    editorTheme,
    wrapping.of(wrapped()),
    // The caret is drawn by the editor, so it can stay in view, dimmed,
    // while the focus is elsewhere (theme.ts).
    opts.keepCaret
      ? [drawSelection(), EditorView.editorAttributes.of({ class: "cm-aivi-keep" })]
      : [],
    placeholder(opts.placeholder),
    opts.lineNumbers ? lineNumbers() : [],
    aria.of(contentAttributes(label, describedby)),
    invalid.of(invalidAttr(marks)),
    marksField,
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        opts.onCaret(line.number, head - line.from + 1);
        // Moved, not typed: what the caret rests on can be shown.
        const moved = !update.docChanged && update.state.selection.main.empty;
        const focused = update.view.root.activeElement === update.view.contentDOM;
        opts.onPoint(moved && focused ? head : null, true);
      }
      if (!update.docChanged) return;
      if (update.transactions.some((tr) => tr.annotation(external))) return;
      opts.onChange(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      blur: () => {
        opts.onBlur();
      },
      mousemove: (event, view) => {
        opts.onPoint(view.posAtCoords({ x: event.clientX, y: event.clientY }), false);
      },
      mouseleave: () => {
        opts.onPoint(null, false);
      },
    }),
  ];
  const fresh = (doc: string): EditorState => EditorState.create({ doc, extensions: extensions() });
  const resumed = (from: EditorSnapshot): EditorState | null => {
    try {
      return EditorState.fromJSON(from.state, { extensions: extensions() }, SNAPSHOT_FIELDS);
    } catch {
      return null;
    }
  };
  const start = opts.from?.doc === opts.doc ? resumed(opts.from) : null;
  const view = new EditorView({
    state: start ?? fresh(opts.doc),
    parent: opts.parent,
    root: opts.root,
  });
  view.dispatch({ effects: setMarks.of(marks) });

  return {
    setDoc(text) {
      const current = view.state.doc.toString();
      if (text === current) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: text },
        annotations: external.of(true),
      });
    },
    setMarks(next) {
      marks = next;
      view.dispatch({
        effects: [setMarks.of(next), invalid.reconfigure(invalidAttr(next))],
      });
    },
    setLabel(nextLabel, nextDescribedby) {
      label = nextLabel;
      describedby = nextDescribedby;
      view.dispatch({ effects: aria.reconfigure(contentAttributes(label, describedby)) });
    },
    focus(at) {
      view.focus();
      const pos = Math.min(at ?? view.state.doc.length, view.state.doc.length);
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
    },
    selection() {
      const { from, to } = view.state.selection.main;
      return { from, to };
    },
    replace(range, text, caret, head = caret) {
      const length = view.state.doc.length;
      const from = Math.min(range.from, length);
      const to = Math.min(Math.max(range.to, from), length);
      const at = (n: number): number => from + Math.min(n, text.length);
      view.dispatch({
        changes: { from, to, insert: text },
        selection: EditorSelection.single(at(caret), at(head)),
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
    },
    coordsAt(pos) {
      return view.coordsAtPos(Math.min(pos, view.state.doc.length));
    },
    snapshot() {
      return { doc: view.state.doc.toString(), state: view.state.toJSON(SNAPSHOT_FIELDS) };
    },
    restore(from) {
      view.setState(resumed(from) ?? fresh(from.doc));
      view.dispatch({ effects: setMarks.of(marks) });
    },
    setWrap(on) {
      if (on === wrap) return;
      wrap = on;
      view.dispatch({ effects: wrapping.reconfigure(wrapped()) });
    },
    run(command: EditorCommand) {
      const commands = { undo, left: cursorCharLeft, right: cursorCharRight };
      commands[command](view);
      view.focus();
    },
    find(query, dir) {
      return findStep(view, query, dir);
    },
    destroy() {
      view.destroy();
    },
  };
}
