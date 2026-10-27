// What goes in at the template workspace's caret besides the recipes
// (template-recipes.ts): an entity from the Insert list as states('…') or
// state_attr('…', '…'), and the keys of the phone's key row, each kept
// apart from the text around it. Pure functions over the text, so the
// tests drive them without an editor.

import { placeAt } from "./code-editor/jinja-complete";
import type { TranslationKey } from "./i18n";

/** The caret's place in a key. */
const CARET = "$";

/** What to put in for `text` with a `$` caret mark: the text without
 * the mark, and where the caret lands in it. */
export function withCaret(text: string): { text: string; caret: number } {
  const at = text.indexOf(CARET);
  return at < 0
    ? { text, caret: text.length }
    : { text: text.slice(0, at) + text.slice(at + 1), caret: at };
}

/** Whether `pos` in `doc` is inside a {{ }} or {% %}. */
export function inTag(doc: string, pos: number): boolean {
  return placeAt(doc, pos).tag !== null;
}

const WORD = /\w/;

/** `insert` as it goes in over `from`..`to` of `doc`, so it does not run
 * into its neighbors: a space against a word character on either side,
 * and a new line after a block tag ({% … %}) that ends the line. The
 * caret moves along. */
export function fitInsert(
  doc: string,
  from: number,
  to: number,
  insert: { text: string; caret: number },
): { text: string; caret: number } {
  const lineBefore = doc.slice(doc.lastIndexOf("\n", from - 1) + 1, from);
  const lineAfter = doc.slice(to).split("\n", 1)[0] ?? "";
  let lead = "";
  if (/%\}[ \t]*$/.test(lineBefore) && !lineAfter.trim()) lead = "\n";
  else if (WORD.test(doc.charAt(from - 1))) lead = " ";
  const trail = WORD.test(doc.charAt(to)) ? " " : "";
  return { text: lead + insert.text + trail, caret: lead.length + insert.caret };
}

/** Functions whose first argument is an entity id. */
const TAKES_ENTITY =
  /\b(?:states|is_state|state_attr|is_state_attr|has_value|state_translated|expand|area_name|device_attr|device_id)\(\s*(['"]?)$/;

/** An entity from the Insert list, as it goes in over `from`..`to`:
 * its state, or its attribute, wrapped in {{ }} unless the caret is in
 * a tag, apart from the text around it. Where the caret is the first
 * argument of a function that takes an entity (states(|) or
 * states('|')), the state's id alone, quoted unless the quotes are
 * there. The caret lands after it. */
export function entityInsert(
  entityId: string,
  attribute: string | null,
  doc: string,
  from: number,
  to: number = from,
): { text: string; caret: number } {
  const place = placeAt(doc, from);
  const arg = place.tag ? TAKES_ENTITY.exec(doc.slice(place.start, from)) : null;
  if (arg && attribute === null && from === to) {
    const text = arg[1] ? entityId : `'${entityId}'`;
    return { text, caret: text.length };
  }
  const call =
    attribute === null ? `states('${entityId}')` : `state_attr('${entityId}', '${attribute}')`;
  const text = place.tag ? call : `{{ ${call} }}`;
  return fitInsert(doc, from, to, { text, caret: text.length });
}

/** A key of the phone's key row: what it shows, its accessible name in
 * the catalog (`sheet.key-<id>`), and what it types. */
export interface TemplateKey {
  id: string;
  label: string;
  text: string;
}

/** What the iOS keyboard hides two layers deep, and the quote it curls
 * (brackets and the dot are a layer up, or on the letters). */
export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  { id: "output", label: "{{ }}", text: "{{ $ }}" },
  { id: "statement", label: "{% %}", text: "{% $ %}" },
  { id: "pipe", label: "|", text: "| " },
  { id: "quote", label: "'", text: "'" },
];

export function keyTitle(key: TemplateKey): TranslationKey {
  return `sheet.key-${key.id}` as TranslationKey;
}
