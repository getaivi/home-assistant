// The List widget's preview, matched to the app's List template: the
// name line over up to four rows that share the height, hairlines between
// them. Medium rows read icon, label, value; Small rows have no room for
// the label and read icon, value.

import { WP } from "../const";
import { type HChild, h } from "../dom";
import { listPreviewStyles } from "../styles/preview/list";
import type { PreviewRow, WidgetContent } from "../types/content";
import { ghost, glyphFor, iconColorHex, nameLabel, valueColor, valueText } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** Both system families cut the list at four rows. */
const VISIBLE = 4;

/** The name line with the "+N" hint for the rows that did not fit: the
 * name, a spacer, and the hint as a meta line. */
function header(name: string, total: number, shown: number): HTMLElement {
  return h(
    "div",
    { class: "pv-list-head" },
    nameLabel(name),
    total > shown ? h("span", { class: "pv-meta" }, `+${total - shown}`) : null,
  );
}

/** A row's symbol in its 20 pt slot, in the icon's own color or the
 * secondary label color. A row without an icon has no slot at all: it
 * starts at the leading edge. */
function rowIcon(row: PreviewRow): HTMLElement | null {
  if (!row.icon) return null;
  return h(
    "span",
    { class: "pv-list-icon", style: `color:${iconColorHex(row.icon) ?? WP.secondary}` },
    glyphFor(row.icon),
  );
}

/** A row's trailing value, in its own `text_color` or primary (the
 * app's list has no hero color to fall back on). */
function rowValue(row: PreviewRow): HTMLElement | null {
  const value = valueText(row.value);
  if (!value) return null;
  return h(
    "span",
    { class: "pv-list-value", style: `color:${valueColor(row.value) || WP.primary}` },
    value,
  );
}

/** The medium row: icon, label, a spacer, value. The label is always
 * drawn, the value only when the row has one. */
function labeledRow(row: PreviewRow): HTMLElement {
  const icon = rowIcon(row),
    value = rowValue(row);
  return h(
    "div",
    { class: `pv-list-row${icon ? " has-icon" : ""}${value ? " has-value" : ""}` },
    icon,
    h("span", { class: "pv-list-label" }, row.label || ""),
    value,
  );
}

/** The small row: icon and value; the label stands in only for a row
 * that carries no value. */
function compactRow(row: PreviewRow): HTMLElement {
  const icon = rowIcon(row),
    value = rowValue(row);
  return h(
    "div",
    { class: `pv-list-row${icon ? " has-icon" : ""}${value ? " has-value" : ""}` },
    icon,
    value ?? h("span", { class: "pv-list-label" }, row.label || ""),
  );
}

function render(name: string, content: WidgetContent, family: "small" | "medium"): HChild[] {
  const rows = content.rows ?? [];
  const shown = rows.slice(0, VISIBLE);
  const draw = family === "small" ? compactRow : labeledRow;
  return [
    header(name, rows.length, shown.length),
    // The device draws the name alone over an empty widget; the preview
    // keeps the rows' region as a placeholder so it can still be pressed.
    shown.length
      ? h("div", { class: `pv-list-rows is-${family}`, "data-slot": "rows" }, shown.map(draw))
      : ghost("rows", "rows", "is-grow"),
  ];
}

const renders: TemplateRenderer = {
  small: (name, content) => render(name, content, "small"),
  medium: (name, content) => render(name, content, "medium"),
};

/** The list template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const list: WidgetTemplate = {
  ...renders,
  styles: listPreviewStyles,
  slots: [
    { id: "rows", fields: ["rows"] },
    { id: "global", fields: ["icon", "accent", "tap_url"], global: true },
  ],
  layout: ["rows"],
};
