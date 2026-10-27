// Jinja highlighting for Home Assistant templates: a small stream
// tokenizer. Text outside the tags stays plain (it is what the template
// prints); inside {{ }}, {% %} and {# #} it marks the delimiters,
// keywords, constants, strings, numbers, functions, filters (the name
// after a |), properties (after a .) and operators. Smaller than a full
// Jinja grammar, and it has no line statements (a # in plain text is
// text, as Home Assistant reads it).

import { StreamLanguage, type StringStream } from "@codemirror/language";

interface JinjaState {
  /** The close of the open tag, or null in plain text. */
  close: "}}" | "%}" | "#}" | null;
  /** The quote of a string still open at a line's end. */
  quote: string | null;
  /** The previous token was a | (a filter name follows) or a . (a
   * property follows). */
  after: "|" | "." | null;
}

const KEYWORDS = new Set([
  "if",
  "elif",
  "else",
  "endif",
  "for",
  "endfor",
  "in",
  "not",
  "and",
  "or",
  "is",
  "set",
  "endset",
  "macro",
  "endmacro",
  "call",
  "endcall",
  "filter",
  "endfilter",
  "with",
  "endwith",
  "import",
  "from",
  "as",
  "break",
  "continue",
  "do",
  "namespace",
  "loop",
]);

const CONSTANTS = new Set(["true", "false", "none", "True", "False", "None"]);

/** The rest of a string, up to its closing quote or the line's end. */
function stringRest(stream: StringStream, state: JinjaState): string {
  const quote = state.quote ?? "";
  for (let ch = stream.next(); ch !== undefined; ch = stream.next()) {
    if (ch === "\\") stream.next();
    else if (ch === quote) {
      state.quote = null;
      break;
    }
  }
  return "string";
}

function inTag(stream: StringStream, state: JinjaState): string | null {
  if (stream.eatSpace()) return null;
  const after = state.after;
  state.after = null;
  if (state.close && stream.match(new RegExp(`^-?${state.close === "}}" ? "\\}\\}" : "%\\}"}`))) {
    state.close = null;
    return "meta";
  }
  const ch = stream.peek();
  if (ch === "'" || ch === '"') {
    stream.next();
    state.quote = ch;
    return stringRest(stream, state);
  }
  if (stream.match(/^\d+(\.\d+)?/)) return "number";
  const word = stream.match(/^[A-Za-z_]\w*/);
  if (word) {
    const name = typeof word === "boolean" ? "" : (word[0] ?? "");
    if (after === "|") return "variableName.function";
    if (after === ".") return "propertyName";
    if (KEYWORDS.has(name)) return "keyword";
    if (CONSTANTS.has(name)) return "atom";
    if (stream.match(/^\s*\(/, false)) return "variableName.function";
    return "variableName";
  }
  if (stream.eat("|")) {
    state.after = "|";
    return "operator";
  }
  if (stream.eat(".")) {
    state.after = ".";
    return "punctuation";
  }
  if (stream.match(/^[-+*/%=<>!~]+/)) return "operator";
  stream.next();
  return "punctuation";
}

export const jinja = StreamLanguage.define<JinjaState>({
  name: "jinja",
  startState: () => ({ close: null, quote: null, after: null }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.close === "#}") {
      if (stream.skipTo("#}")) {
        stream.pos += 2;
        state.close = null;
      } else stream.skipToEnd();
      return "comment";
    }
    if (state.quote) return stringRest(stream, state);
    if (state.close) return inTag(stream, state);
    if (stream.match("{#")) {
      state.close = "#}";
      return "comment";
    }
    if (stream.match(/^\{\{-?/)) {
      state.close = "}}";
      return "meta";
    }
    if (stream.match(/^\{%-?/)) {
      state.close = "%}";
      return "meta";
    }
    // Plain text, up to the next tag.
    stream.next();
    while (!stream.eol() && stream.peek() !== "{") stream.next();
    return null;
  },
  languageData: { commentTokens: { block: { open: "{#", close: "#}" } } },
});
