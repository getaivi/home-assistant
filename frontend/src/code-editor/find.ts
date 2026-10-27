// Find in the template workspace's editor: every match of the words
// looked for is marked, and a step selects the next or the previous one.
// Matching ignores case. The bar the words are typed in is the
// workspace's (aivi-template-workspace.ts): this chunk only marks and
// selects, which keeps it smaller than CodeMirror's search package (it
// brings replace, regular expressions and go-to-line along, and a
// template is a few dozen lines).

import {
  EditorSelection,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { FindResult } from "./contract";

/** Matches marked at most: past this the count still holds. */
const MARKED = 500;

/** The words looked for; empty while nothing is. */
const setQuery = StateEffect.define<string>();

const queryField = StateField.define<string>({
  create: () => "",
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setQuery)) return effect.value;
    return value;
  },
});

/** Where `query` is in `state`'s text, case ignored. */
export function matchesOf(state: EditorState, query: string): number[] {
  if (!query) return [];
  const doc = state.doc.toString().toLowerCase();
  const needle = query.toLowerCase();
  const found: number[] = [];
  for (let at = doc.indexOf(needle); at >= 0; at = doc.indexOf(needle, at + needle.length))
    found.push(at);
  return found;
}

const matchMark = Decoration.mark({ class: "cm-aivi-match" });

const matchesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    const query = tr.state.field(queryField);
    if (!tr.docChanged && query === tr.startState.field(queryField)) return value;
    return Decoration.set(
      matchesOf(tr.state, query)
        .slice(0, MARKED)
        .map((at) => matchMark.range(at, at + query.length)),
    );
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Look for `query`: mark every match, and select the next one after
 * the selection (`dir` 1), the one before it (-1), or the first from the
 * selection's start (0, while the words are typed), going round the
 * ends. Says which match is selected (from 1; 0 for none) of how many. */
export function findStep(view: EditorView, query: string, dir: -1 | 0 | 1): FindResult {
  const marked = view.state.field(queryField, false);
  // Only the workspace's editor finds.
  if (marked === undefined) return { current: 0, total: 0 };
  if (marked !== query) view.dispatch({ effects: setQuery.of(query) });
  const found = matchesOf(view.state, query);
  if (!found.length) return { current: 0, total: 0 };
  const { from, to } = view.state.selection.main;
  const before = found.filter((at) => at + query.length <= from);
  const next =
    dir === -1
      ? (before[before.length - 1] ?? found[found.length - 1])
      : (found.find((at) => at >= (dir === 1 ? to : from)) ?? found[0]);
  if (next === undefined) return { current: 0, total: found.length };
  const current = found.indexOf(next) + 1;
  // Already selected (the bar opened over a selection): left as it is.
  if (next === from && to === next + query.length) return { current, total: found.length };
  view.dispatch({
    selection: EditorSelection.single(next, next + query.length),
    scrollIntoView: true,
    userEvent: "select.search",
  });
  return { current, total: found.length };
}

export const find: Extension = [queryField, matchesField];
