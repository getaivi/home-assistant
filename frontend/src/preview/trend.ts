// The Trend widget's preview, matched to the app's Trend template and
// its chart.

import { colorHex } from "../const";
import { type HChild, h } from "../dom";
import { RANGE, READING } from "../form-groups";
import { trendPreviewStyles } from "../styles/preview/trend";
import type { WidgetContent } from "../types/content";
import { fitted } from "./fit";
import {
  clamp01,
  fmt01,
  ghost,
  heroWithUnit,
  nameLabel,
  setSvg,
  valueColor,
  valueText,
} from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** The edge inset of the chart: max(1.2 × the 2 pt line, 3), so the round
 * caps and the end dot stay inside the canvas. */
const INSET = 3;
/** The line's width; the end dot is 2.4 × it across. */
const LINE = 2;

/** The points on the chart's 0...1 scale, oldest first: between the
 * bounds, clamped. A bound left unset is the smallest (largest) of the
 * points and the reading together; a flat range centers the line. */
export function normalizedPoints(content: WidgetContent): number[] {
  const points = content.points ?? [];
  const data = typeof content.value === "number" ? [...points, content.value] : points;
  const lo = content.min_value ?? Math.min(...data);
  const hi = content.max_value ?? Math.max(...data);
  const span = hi - lo;
  return points.map((p) => (span > 0 ? clamp01((p - lo) / span) : 0.5));
}

/** A position along one axis of the chart, `f` of the way across what the
 * insets leave: the chart's box is only known once laid out, so the inset
 * stays in points and the rest is a share of the box. */
function along(f: number): string {
  return `calc(${(f * 100).toFixed(2)}% + ${(INSET - 2 * INSET * f).toFixed(2)}px)`;
}

/** The sparkline in its box: straight segments with round joins and caps,
 * the area under the line down to the box's bottom edge (28 % of the
 * color fading to 2 %, top to bottom of the box) and a dot on the latest
 * point. Fewer than two points draw nothing on the device; null here. */
export function sparkline(content: WidgetContent, color: string): HTMLElement | null {
  const ys = normalizedPoints(content);
  if (ys.length < 2) return null;
  const at = ys.map((y, i): [number, number] => [i / (ys.length - 1), 1 - y]);
  const area = [
    ...at.map(([x, y]) => `${along(x)} ${along(y)}`),
    `${along(1)} 100%`,
    `${along(0)} 100%`,
  ].join(",");
  const spot = ([x, y]: [number, number]): string =>
    `${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`;
  const d = at.map((p, i) => `${i ? "L" : "M"}${spot(p)}`).join(" ");
  // The line is drawn in the inset box, stretched to it; the strokes keep
  // their width however the box stretches. The dot is a round cap on the
  // spot the line ends at, so it cannot sit off the line (a box of its own
  // would be snapped to whole pixels, and out of round).
  const stroke = `stroke="${color}" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"`;
  const line = h("div", { class: "pv-trend-line" });
  setSvg(
    line,
    `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">` +
      `<path d="${d}" ${stroke} stroke-width="${LINE}" stroke-linejoin="round"/>` +
      `<path class="pv-trend-dot" d="M${spot(at[at.length - 1] ?? [1, 0.5])}h0" ${stroke} stroke-width="${LINE * 2.4}"/></svg>`,
  );
  return h(
    "div",
    { class: "pv-trend-spark" },
    h("i", {
      class: "pv-trend-area",
      style:
        `clip-path:polygon(${area});` +
        `background:linear-gradient(color-mix(in srgb, ${color} 28%, transparent), color-mix(in srgb, ${color} 2%, transparent))`,
    }),
    line,
  );
}

/** The reading (one decimal at most) with its unit at half size, raised
 * toward the cap height, shrinking to 60 % before it truncates, and the
 * state line under it in the state's own color, else the accent. */
function reading(content: WidgetContent, accent: string, size: number): HChild[] {
  const value = typeof content.value === "number" ? content.value : null;
  const state = valueText(content.state);
  return [
    value !== null
      ? fitted(heroWithUnit(fmt01(value), content.unit, size, "hero", true), size, 0.6)
      : ghost("hero", "value", "is-dark"),
    state
      ? h(
          "div",
          {
            class: "pv-state",
            "data-slot": "caption",
            style: `color:${valueColor(content.state) || accent}`,
          },
          state,
        )
      : ghost("caption", "state", "is-dark"),
  ];
}

/** The chart region: the sparkline in the line color, else the accent.
 * With no line to draw, the placeholder takes the sparkline's place in
 * it. */
function chart(content: WidgetContent, accent: string): HTMLElement {
  const spark = sparkline(content, colorHex(content.color) ?? accent);
  return spark
    ? h("div", { class: "pv-trend-chart", "data-slot": "chart" }, spark)
    : h("div", { class: "pv-trend-chart" }, ghost("chart", "points", "is-dark pv-trend-spark"));
}

const renders: TemplateRenderer = {
  // Small: the text pinned to the top (name, the reading at 34, the state
  // line), the sparkline a quiet band along the bottom: half strength, 56 pt
  // tall at most, 4 pt under the text. No chip at this size.
  small: (name, content, accent) => [
    h(
      "div",
      { class: "pv-trend" },
      nameLabel(name),
      reading(content, accent, 34),
      chart(content, accent),
    ),
  ],
  // Medium: the name at the top and the reading (40) with its state line
  // at the bottom of a text column, 16 pt from the sparkline, which takes
  // the rest of the width at full strength, 6 pt in from top and bottom.
  medium: (name, content, accent) => [
    h(
      "div",
      { class: "pv-split pv-trend" },
      h(
        "div",
        { class: "pv-lead" },
        nameLabel(name),
        h("div", { class: "pv-grow" }),
        reading(content, accent, 40),
      ),
      chart(content, accent),
    ),
  ],
};

/** The trend template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const trend: WidgetTemplate = {
  ...renders,
  styles: trendPreviewStyles,
  // The small trend draws no chip; the line falls back to the accent.
  slots: [
    { id: "hero", fields: ["value", "unit"] },
    {
      id: "chart",
      fields: ["points", "min_value", "max_value", "color", "accent"],
    },
    { id: "caption", fields: ["state"] },
    { id: "global", fields: ["icon", "tap_url"], global: true },
  ],
  layout: [READING, "points", RANGE, "state"],
};
