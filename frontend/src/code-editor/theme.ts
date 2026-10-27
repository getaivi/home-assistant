// The editor's look: the panel's tokens (styles/base.ts) for the box,
// the focus ring and the completion list, and Home Assistant's own
// --codemirror-* theme variables for the highlight colors, so templates
// read as they do in Home Assistant's editors. Where a theme defines none
// (the harness), each hue is mixed toward the text color, which keeps it
// readable on light and dark cards alike.

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** A highlight color: Home Assistant's variable, else `hue` toward the
 * text color. */
function ink(variable: string, hue: string, share = 55): string {
  return `var(--codemirror-${variable}, color-mix(in srgb, ${hue} ${share}%, var(--aivi-fg)))`;
}

const highlight = HighlightStyle.define([
  { tag: tags.meta, color: ink("meta", "var(--aivi-accent)", 80), fontWeight: "600" },
  { tag: tags.keyword, color: ink("keyword", "#b46cf5") },
  { tag: tags.atom, color: ink("atom", "#e8913a") },
  { tag: tags.number, color: ink("number", "#e8913a") },
  { tag: tags.string, color: ink("string", "#3fae6a") },
  { tag: tags.comment, color: ink("comment", "var(--aivi-muted)", 100), fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: ink("builtin", "#3b8ff0") },
  { tag: tags.propertyName, color: ink("property", "#d6596f") },
  { tag: tags.variableName, color: ink("variable", "var(--aivi-fg)", 100) },
  { tag: tags.operator, color: ink("operator", "var(--aivi-muted)", 100) },
  { tag: tags.punctuation, color: "var(--aivi-muted)" },
]);

const theme = EditorView.theme({
  "&": {
    color: "inherit",
    background: "var(--aivi-input-bg)",
    border: "1px solid var(--aivi-input-line)",
    borderRadius: "var(--aivi-r-md)",
    lineHeight: "1.45",
    // Three lines to ten, then it scrolls (as the textarea did).
    maxHeight: "calc(10lh + 18px)",
  },
  "&:hover": { borderColor: "color-mix(in srgb, var(--aivi-fg) 28%, transparent)" },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--aivi-accent)",
    boxShadow: "0 0 0 3px var(--aivi-ring)",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, Menlo, monospace",
    lineHeight: "inherit",
    overflow: "auto",
    borderRadius: "inherit",
  },
  ".cm-content": {
    padding: "8px 0",
    minHeight: "calc(3lh + 16px)",
    caretColor: "var(--aivi-fg)",
  },
  ".cm-line": { padding: "0 11px" },
  // Line numbers (the template workspace): quiet, so the text leads.
  ".cm-gutters": {
    background: "transparent",
    color: "var(--aivi-muted)",
    border: "none",
    borderRight: "1px solid var(--aivi-line)",
    borderRadius: "var(--aivi-r-md) 0 0 var(--aivi-r-md)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "28px" },
  ".cm-cursor": { borderLeftColor: "var(--aivi-fg)" },
  // The template workspace draws its own caret and selection, and keeps
  // them, dimmed and still, while the focus is on the entities or the
  // recipes: that is where an insert goes.
  "&.cm-aivi-keep .cm-selectionLayer .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--aivi-accent) 16%, transparent)",
  },
  "&.cm-aivi-keep.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--aivi-accent) 32%, transparent)",
  },
  "&.cm-aivi-keep:not(.cm-focused) > .cm-scroller > .cm-cursorLayer .cm-cursor": {
    display: "block",
    borderLeftWidth: "2px",
    borderLeftColor: "color-mix(in srgb, var(--aivi-fg) 45%, transparent)",
  },
  ".cm-placeholder": { color: "var(--aivi-muted)" },
  ".cm-aivi-error": {
    textDecoration: "underline wavy var(--aivi-danger)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    background: "color-mix(in srgb, var(--aivi-danger) 14%, transparent)",
    borderRadius: "2px",
  },
  ".cm-aivi-warning": {
    textDecoration: "underline wavy var(--aivi-attn)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-tooltip": {
    background: "var(--aivi-card)",
    color: "var(--aivi-fg)",
    border: "1px solid var(--aivi-line)",
    borderRadius: "var(--aivi-r-md)",
    boxShadow: "0 12px 32px -8px rgba(0,0,0,.55)",
    // Not clipped: the hint box sits beside the list, outside it.
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "ui-monospace, Menlo, monospace",
    borderRadius: "inherit",
    fontSize: "var(--aivi-fs-md)",
    maxHeight: "none",
    minWidth: "min(260px, calc(100vw - 48px))",
    maxWidth: "min(560px, calc(100vw - 32px))",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "4px 10px 4px 4px",
    lineHeight: "1.4",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "color-mix(in srgb, var(--aivi-accent) 22%, transparent)",
    color: "inherit",
  },
  ".cm-completionLabel": { color: "var(--aivi-fg)" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-completionDetail": {
    color: "var(--aivi-muted)",
    fontStyle: "normal",
    fontFamily: "var(--paper-font-body1_-_font-family, system-ui, sans-serif)",
    marginLeft: "1em",
  },
  // On the highlighted row the muted ink is too faint: a stronger mix.
  ".cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail": {
    color: "color-mix(in srgb, var(--aivi-fg) 80%, transparent)",
  },
  // The kind's glyph (an entity, an attribute, a function…) before the
  // label, in the muted ink of both themes.
  ".cm-aivi-icon": {
    width: "14px",
    height: "14px",
    flex: "none",
    fill: "var(--aivi-muted)",
    verticalAlign: "-2px",
    margin: "0 7px 0 2px",
  },
  ".cm-tooltip-autocomplete li[aria-selected] .cm-aivi-icon": {
    fill: "color-mix(in srgb, var(--aivi-fg) 80%, transparent)",
  },
  ".cm-tooltip.cm-completionInfo": {
    padding: "6px 10px",
    fontSize: "var(--aivi-fs-sm)",
    lineHeight: "1.4",
    maxWidth: "min(280px, calc(100vw - 32px))",
    fontFamily: "var(--paper-font-body1_-_font-family, system-ui, sans-serif)",
  },
});

export const editorTheme = [theme, syntaxHighlighting(highlight)];
