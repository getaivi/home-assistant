// The Prices widget's preview, matched to the app's Prices template: the
// current period's price as the hero, its level word under it, and a
// window of level-colored bars from the current period on. Small stacks
// them over a 12-period strip; Medium sets the text column beside 24
// periods.

import { COLOR_HEX } from "../const";
import { h } from "../dom";
import { t } from "../i18n";
import { pricesPreviewStyles } from "../styles/preview/prices";
import type { PreviewPriceEntry, WidgetContent } from "../types/content";
import { fittedSize, fittedTextSize, textWidth } from "./fit";
import { clamp01, fmt01, ghost, heroWeight } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

type PriceLevel = "low" | "medium" | "high";

/** The band colors: the palette's green, yellow and red, whatever the
 * widget's accent. */
const LEVEL_COLOR: Record<PriceLevel, string> = {
  low: COLOR_HEX.green,
  medium: COLOR_HEX.yellow,
  high: COLOR_HEX.red,
};

/** The canvas's content width at Small: 158 pt less the 16 pt margins. */
const SMALL_WIDTH = 126;
/** What the text column gets at Medium: the `HStack` offers its least
 * flexible child an equal share of the 306 pt row less the 16 pt gap,
 * and the chart takes what the column leaves. */
const MEDIUM_LEAD_WIDTH = 145;

/** The period the device highlights: the last one started by now;
 * before the first period, the first. */
export function currentPriceIndex(entries: PreviewPriceEntry[], now = Date.now()): number {
  let index = 0;
  entries.forEach((entry, i) => {
    if (entry.start && Date.parse(entry.start) <= now) index = i;
  });
  return index;
}

function priceRange(entries: PreviewPriceEntry[]): { lo: number; span: number } {
  const prices = entries.map((e) => e.price ?? 0);
  const lo = Math.min(...prices);
  return { lo, span: Math.max(...prices) - lo };
}

/** A period's band: its own level, else terciles of the posted range,
 * the boundaries belonging to low and high. A flat range reads as
 * medium. */
export function priceLevel(entries: PreviewPriceEntry[], index: number): PriceLevel {
  const entry = entries[index];
  if (!entry) return "medium";
  if (entry.level === "low" || entry.level === "medium" || entry.level === "high")
    return entry.level;
  const { lo, span } = priceRange(entries);
  if (!(span > 0)) return "medium";
  const price = entry.price ?? 0;
  if (price <= lo + span / 3) return "low";
  if (price >= lo + (span * 2) / 3) return "high";
  return "medium";
}

/** The name line: it shrinks to 80 % before it truncates. */
function nameLine(name: string, available: number): HTMLElement {
  const size = fittedTextSize(name, 15, 500, available, 0.8);
  return h(
    "div",
    { class: "pv-name pv-prices-name", style: `font-size:${size}px;font-weight:500` },
    name,
  );
}

/** The hero: the current price to at most one decimal, then a space and
 * the unit at half size on the baseline (not raised: a word-length unit
 * would read as a superscript). Number and unit are one text, so they
 * shrink together, to 60 % before the line truncates
 * (`minimumScaleFactor`); the weight stays the nominal size's. */
function hero(
  price: number,
  unit: string | undefined,
  size: number,
  available: number,
): HTMLElement {
  const weight = heroWeight(size);
  const number = fmt01(price);
  const suffix = unit ? ` ${unit}` : "";
  const fitted = fittedSize(
    (px) => {
      const width = textWidth(number, px, weight);
      if (width === null) return null;
      return width + (suffix ? (textWidth(suffix, px * 0.5, 400) ?? 0) : 0);
    },
    size,
    available,
    0.6,
  );
  const el = h(
    "div",
    {
      class: "pv-hero pv-prices-hero",
      "data-slot": "hero",
      style: `font-size:${fitted}px;font-weight:${weight}`,
    },
    number,
  );
  if (suffix) el.append(h("span", { style: "font-size:.5em;font-weight:400" }, suffix));
  return el;
}

/** The level word in its band's color, 2 pt under the hero. */
function levelLine(level: PriceLevel): HTMLElement {
  return h(
    "div",
    { class: "pv-state pv-prices-state", style: `color:${LEVEL_COLOR[level]}` },
    t(`preview.price-${level}`),
  );
}

/** The bars: a window of periods from the current one on, backfilled
 * with earlier ones when the tail is short. Capsules share the
 * width 2 pt apart, each in its level's color, the price scaled into the
 * top 85 % of the height over the posted range (a flat range draws
 * mid-height bars), never under 3 pt. The current period is at full
 * strength with a 5 pt dot 4 pt under it; the past is dimmed to 28 %,
 * what is ahead to 50 %. */
function priceBars(entries: PreviewPriceEntry[], current: number, window: number): HTMLElement {
  const size = Math.min(window, entries.length);
  const start = Math.max(0, Math.min(current, entries.length - size));
  const { lo, span } = priceRange(entries);
  const shown = entries.slice(start, start + size);
  return h(
    "div",
    { class: "pv-prices-chart", "data-slot": "chart" },
    h(
      "div",
      { class: "pv-prices-bars" },
      shown.map((entry, i) => {
        const index = start + i;
        const norm = span > 0 ? clamp01(((entry.price ?? 0) - lo) / span) : 0.5;
        return h("i", {
          style:
            `height:${Math.round((0.15 + 0.85 * norm) * 1000) / 10}%;` +
            `background:${LEVEL_COLOR[priceLevel(entries, index)]};opacity:${index === current ? 1 : index < current ? 0.28 : 0.5}`,
        });
      }),
    ),
    h(
      "div",
      { class: "pv-prices-dots" },
      shown.map((_, i) =>
        h(
          "i",
          null,
          start + i === current
            ? h("b", { style: `background:${LEVEL_COLOR[priceLevel(entries, current)]}` })
            : null,
        ),
      ),
    ),
  );
}

/** No periods yet: the device never draws this (a push carries at least
 * one), so the name and the placeholder that leads to the price field. */
function empty(name: string, available: number): HTMLElement[] {
  return [nameLine(name, available), ghost("hero", "entries", "is-dark")];
}

const renders: TemplateRenderer = {
  /** Small: name, the price (30), its level, then the 34 pt strip of the
   * next 12 periods at the bottom, at least 8 pt under the level word. */
  small(name: string, content: WidgetContent) {
    const entries = content.entries ?? [];
    if (!entries.length) return empty(name, SMALL_WIDTH);
    const current = currentPriceIndex(entries);
    return [
      nameLine(name, SMALL_WIDTH),
      hero(entries[current]?.price ?? 0, content.unit, 30, SMALL_WIDTH),
      levelLine(priceLevel(entries, current)),
      h("div", { class: "pv-grow pv-prices-gap" }),
      priceBars(entries, current, 12),
    ];
  },

  /** Medium: the name at the top and the price (40) with its level at the
   * bottom of a text column, 16 pt from 24 periods of bars inset 10 pt
   * top and bottom. */
  medium(name: string, content: WidgetContent) {
    const entries = content.entries ?? [];
    if (!entries.length) return empty(name, MEDIUM_LEAD_WIDTH * 2 + 16);
    const current = currentPriceIndex(entries);
    return [
      h(
        "div",
        { class: "pv-split pv-prices-split" },
        h(
          "div",
          { class: "pv-lead" },
          nameLine(name, MEDIUM_LEAD_WIDTH),
          h("div", { class: "pv-grow" }),
          hero(entries[current]?.price ?? 0, content.unit, 40, MEDIUM_LEAD_WIDTH),
          levelLine(priceLevel(entries, current)),
        ),
        priceBars(entries, current, 24),
      ),
    ];
  },
};

/** The prices template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const prices: WidgetTemplate = {
  ...renders,
  styles: pricesPreviewStyles,
  // The level colors paint the bars; the small family draws no chip.
  slots: [
    { id: "hero", fields: ["entries", "scale", "unit"] },
    { id: "chart", fields: ["entries"] },
    { id: "global", fields: ["icon", "accent", "tap_url"], global: true },
  ],
  layout: [{ id: "prices", fields: ["entries", "scale", "unit"] }],
};
