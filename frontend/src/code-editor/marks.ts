// Where the template editor underlines, from the preview's feedback: the
// error at its line and column (template_info.py computes them), or the
// whole line when Home Assistant names only the line, and every entity id
// Home Assistant does not have. The words stay under the box
// (template-feedback.ts); the underline only shows the place.

import type { FieldFeedback } from "../types/content";
import type { TemplateMark } from "./contract";

const WORD = /[\w.]/;

/** The span an error at `at` covers: the word, closing tag or opening
 * block tag ({% if, an unclosed block's) there, else the one character;
 * at a line's end, the last character before it. */
function errorSpan(text: string, at: number, lineEnd: number): TemplateMark | null {
  if (at < lineEnd) {
    let to = at + 1;
    const opening = /^\{%[-+]?\s*\w+/.exec(text.slice(at, lineEnd))?.[0];
    if (opening) to = at + opening.length;
    else if (WORD.test(text[at] ?? "")) {
      while (to < lineEnd && WORD.test(text[to] ?? "")) to++;
    } else if (/^[}%#]}/.test(text.slice(at, at + 2))) to = at + 2;
    return { from: at, to, severity: "error" };
  }
  // Nothing at the position (the template ends early): mark the last
  // character written before it.
  let k = Math.min(at, text.length) - 1;
  while (k >= 0 && /\s/.test(text[k] ?? "")) k--;
  return k >= 0 ? { from: k, to: k + 1, severity: "error" } : null;
}

function errorMark(text: string, line: number, column: number | undefined): TemplateMark | null {
  const lines = text.split("\n");
  const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
  let lineStart = 0;
  for (let i = 0; i < index; i++) lineStart += (lines[i] ?? "").length + 1;
  const body = lines[index] ?? "";
  const lineEnd = lineStart + body.length;
  if (column !== undefined) {
    const at = Math.min(lineStart + Math.max(column - 1, 0), lineEnd);
    return errorSpan(text, at, lineEnd);
  }
  const lead = body.length - body.trimStart().length;
  const trail = body.length - body.trimEnd().length;
  if (lead === body.length) return errorSpan(text, lineEnd, lineEnd);
  return { from: lineStart + lead, to: lineEnd - trail, severity: "error" };
}

/** Every whole occurrence of entity id `id` (not inside a longer id). */
function occurrences(text: string, id: string): TemplateMark[] {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: TemplateMark[] = [];
  for (const m of text.matchAll(new RegExp(`(?<![\\w.])${escaped}(?![\\w])`, "g"))) {
    out.push({ from: m.index, to: m.index + id.length, severity: "warning" });
  }
  return out;
}

/** The underlines for `text`, given the feedback computed for it. */
export function templateMarks(text: string, feedback: FieldFeedback | undefined): TemplateMark[] {
  if (!feedback || !text) return [];
  const marks: TemplateMark[] = [];
  if (feedback.status === "error" && feedback.line !== undefined) {
    const mark = errorMark(text, feedback.line, feedback.column);
    if (mark) marks.push(mark);
  }
  for (const unknown of feedback.unknown ?? []) marks.push(...occurrences(text, unknown.id));
  return marks.sort((a, b) => a.from - b.from || a.to - b.to);
}
