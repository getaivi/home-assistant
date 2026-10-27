// The Budget widget's preview, matched to the app's Budget template.

import { COLOR_HEX, colorHex, SYSTEM_BLUE, WP } from "../const";
import { type HChild, h } from "../dom";
import { i18nLocale, t } from "../i18n";
import { budgetPreviewStyles } from "../styles/preview/budget";
import type { IconSpec, PreviewBudgetEntry, WidgetContent } from "../types/content";
import { clipped, fitToBox } from "./fit";
import {
  clamp01,
  ghost,
  glyphFor,
  heroStyle,
  iconColorHex,
  ringChip,
  slot,
  valueText,
} from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** The app scales a hero down to 60 % of its size before it truncates
 * (`minimumScaleFactor`), the name to 80 %. */
const HERO_FLOOR = 0.6;
const NAME_SIZE = 15;
const NAME_FLOOR = 0.8;

/** A budget line's figures, as the app computes them: the headline is
 * the remainder in remaining mode and what was spent otherwise (always,
 * without a budget); the ring drains (remaining) or fills (spent) and
 * needs a budget above 0; a remainder below 0 is red, which spent mode
 * never shows. */
export function budgetLine(
  entry: PreviewBudgetEntry,
  display: string | undefined,
): {
  amount: number;
  fill: number | null;
  red: boolean;
} {
  const spent = Number(entry.spent ?? 0);
  const parsed = entry.budget != null ? Number(entry.budget) : NaN;
  const remaining = display !== "spent";
  if (Number.isNaN(parsed)) return { amount: spent, fill: null, red: false };
  const share = spent / parsed;
  return {
    amount: remaining ? parsed - spent : spent,
    fill: parsed > 0 ? clamp01(remaining ? 1 - share : share) : null,
    red: remaining && spent > parsed,
  };
}

/** An amount as the app writes it: with the currency's own fraction
 * digits, or, when `whole`, with the narrow symbol and none (the
 * "of $1,500" line and the small legend). Halves round to even, as the
 * device's format styles do. A code that is no currency reads as a plain
 * number. */
export function budgetAmount(amount: number, currency: string | undefined, whole = false): string {
  const options: Intl.NumberFormatOptions & { roundingMode: string } = {
    style: "currency",
    currency: currency ?? "USD",
    roundingMode: "halfEven",
    ...(whole
      ? { currencyDisplay: "narrowSymbol", maximumFractionDigits: 0, minimumFractionDigits: 0 }
      : {}),
  };
  try {
    return amount.toLocaleString(i18nLocale(), options);
  } catch {
    return amount.toLocaleString(i18nLocale());
  }
}

/** The meta line's reflow (a `ViewThatFits` in the app): the budget and
 * the subtitle together when both fit, else the subtitle alone, else the
 * budget alone, truncated. */
function reflowMeta(meta: HTMLElement): void {
  meta.removeAttribute("data-fit");
  if (!meta.clientWidth || meta.children.length < 3) return;
  const parts = Array.from(meta.children);
  if (!parts.some(clipped)) return;
  meta.setAttribute("data-fit", "subtitle");
  if (parts.some(clipped)) meta.setAttribute("data-fit", "budget");
}

/** Fits a total block to the width it was laid out at: the name and the
 * hero scale down, the meta line drops what does not fit. */
export function fitBudgetTotal(block: HTMLElement[], heroSize: number): void {
  for (const part of block) {
    if (part.matches(".pv-budget-name")) fitToBox(part, NAME_SIZE, NAME_FLOOR);
    const hero = part.querySelector<HTMLElement>(".pv-budget-hero");
    if (hero) fitToBox(hero, heroSize, HERO_FLOOR);
    if (part.matches(".pv-budget-meta")) reflowMeta(part);
  }
}

/** The widget's tint: the accent, else the color of the total's icon
 * (its own, else the widget's), else the app's accent. */
function tintOf(content: WidgetContent, accent: string): string {
  if (colorHex(content.accent)) return accent;
  return iconColorHex(content.total?.icon ?? content.icon) ?? SYSTEM_BLUE;
}

/** A line's color: its own, else its icon's, else the tint. */
function lineColor(entry: PreviewBudgetEntry, tint: string): string {
  return colorHex(entry.color) ?? iconColorHex(entry.icon) ?? tint;
}

/** A line's mark: the ring around the glyph (36 % of the size) when the
 * line has a budget, else its icon in a plain chip (the glyph at half the
 * size on the color at 16 %), else nothing. */
function mark(
  fill: number | null,
  color: string,
  size: number,
  icon: IconSpec | undefined,
): HTMLElement | null {
  if (fill !== null) return ringChip(fill, color, size, icon ? glyphFor(icon) : null);
  if (!icon) return null;
  return h(
    "div",
    {
      class: "pv-chip",
      style:
        `width:${size}px;height:${size}px;font-size:${size * 0.5}px;` +
        `background:color-mix(in srgb, ${color} 16%, transparent);color:${color}`,
    },
    glyphFor(icon),
  );
}

/** The total block both families open with: the name, 8 pt of space,
 * the 29 pt ring 8 pt from the hero amount, and the meta line 8 pt under
 * it. The block refits whenever its width changes. */
function totalBlock(
  name: string,
  content: WidgetContent,
  accent: string,
  heroSize: number,
): HTMLElement[] {
  const total = content.total ?? {};
  const { amount, fill, red } = budgetLine(total, content.display);
  const color = lineColor(total, tintOf(content, accent));
  const budget =
    total.budget != null && !Number.isNaN(Number(total.budget))
      ? t("preview.budget-of", {
          amount: budgetAmount(Number(total.budget), content.currency, true),
        })
      : null;
  const subtitle = valueText(content.subtitle);
  const row = h(
    "div",
    { class: "pv-budget-total", "data-slot": "total" },
    // A total with neither a budget nor an icon has no mark on the
    // device; here the bare track stays, so its settings can be pressed.
    slot(
      mark(fill, color, 29, total.icon ?? content.icon) ?? ringChip(null, color, 29, null),
      "ring",
    ),
    h(
      "div",
      {
        class: "pv-hero pv-budget-hero",
        style: `${heroStyle(heroSize)}${red ? `;color:${COLOR_HEX.red}` : ""}`,
      },
      budgetAmount(amount, content.currency),
    ),
  );
  const block = [
    h("div", { class: "pv-name pv-budget-name" }, name),
    row,
    budget || subtitle
      ? // The budget and the dot are meta lines (caption 12 medium), the
        // subtitle a caption2 (11), 4 pt apart.
        h(
          "div",
          { class: "pv-meta pv-budget-meta", "data-slot": "meta" },
          budget ? h("span", { class: "pv-budget-of" }, budget) : null,
          budget && subtitle ? [" ", h("span", { class: "pv-budget-dot" }, "·"), " "] : null,
          subtitle ? h("span", { class: "pv-budget-subtitle" }, subtitle) : null,
        )
      : ghost("meta", "budget", "is-dark"),
  ];
  new ResizeObserver(() => fitBudgetTotal(block, heroSize)).observe(row);
  return block;
}

/** A legend entry (small): the label in the category's color (caption
 * 12) over the whole amount in primary (caption 12 medium; an overspent
 * remainder red), 3 pt apart. */
function legendEntry(entry: PreviewBudgetEntry, content: WidgetContent, tint: string): HTMLElement {
  const { amount, red } = budgetLine(entry, content.display);
  return h(
    "div",
    { class: "pv-budget-legend" },
    h(
      "div",
      { class: "pv-budget-label", style: `color:${lineColor(entry, tint)}` },
      entry.label ?? "",
    ),
    h(
      "div",
      { class: "pv-budget-amount", style: `color:${red ? COLOR_HEX.red : WP.primary}` },
      budgetAmount(amount, content.currency, true),
    ),
  );
}

/** A category row (medium): the 24 pt mark 10 pt from the label
 * (footnote 13) over the amount in full (caption 12, secondary; an
 * overspent remainder red). */
function categoryRow(entry: PreviewBudgetEntry, content: WidgetContent, tint: string): HTMLElement {
  const { amount, fill, red } = budgetLine(entry, content.display);
  return h(
    "div",
    { class: "pv-budget-row" },
    mark(fill, lineColor(entry, tint), 24, entry.icon),
    h(
      "div",
      { class: "pv-budget-text" },
      entry.label ? h("div", { class: "pv-budget-label" }, entry.label) : null,
      h(
        "div",
        { class: "pv-budget-amount", style: red ? `color:${COLOR_HEX.red}` : "" },
        budgetAmount(amount, content.currency),
      ),
    ),
  );
}

/** Small: the total block (the hero at 26), then at least 8 pt down to
 * the first two categories as legends side by side at the bottom. */
function small(name: string, content: WidgetContent, accent: string): HChild[] {
  const tint = tintOf(content, accent);
  const categories = (content.categories ?? []).slice(0, 2);
  return [
    ...totalBlock(name, content, accent, 26),
    h("div", { class: "pv-grow pv-budget-gap" }),
    categories.length
      ? h(
          "div",
          { class: "pv-budget-legends", "data-slot": "categories" },
          categories.map((entry) => legendEntry(entry, content, tint)),
        )
      : ghost("categories", "categories", "is-dark"),
  ];
}

/** Medium: the total block (the hero at 28) on the left; the first
 * three categories as rows on the right, as wide as what they say, from
 * the top. */
function medium(name: string, content: WidgetContent, accent: string): HChild[] {
  const tint = tintOf(content, accent);
  const categories = (content.categories ?? []).slice(0, 3);
  return [
    h(
      "div",
      { class: "pv-split pv-budget-split" },
      h("div", { class: "pv-lead pv-budget-lead" }, totalBlock(name, content, accent, 28)),
      categories.length
        ? h(
            "div",
            { class: "pv-budget-rows", "data-slot": "categories" },
            categories.map((entry) => categoryRow(entry, content, tint)),
          )
        : ghost("categories", "categories", "is-dark"),
    ),
  ];
}

const renders: TemplateRenderer = { small, medium };

/** The budget template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const budget: WidgetTemplate = {
  ...renders,
  styles: budgetPreviewStyles,
  // The small budget: the ring and hero amount, the meta line (the
  // budget and the subtitle), and two category legends.
  slots: [
    { id: "total", fields: ["spent", "currency"] },
    { id: "meta", fields: ["budget", "subtitle"] },
    { id: "categories", fields: ["categories"] },
    { id: "ring", fields: ["display", "total_color"] },
    { id: "global", fields: ["icon", "accent", "tap_url"], global: true },
  ],
  layout: [
    { id: "total", fields: ["spent", "budget", "currency", "display"] },
    "subtitle",
    "categories",
  ],
};
