// The Trend widget's preview at both sizes (preview/trend.ts), against the
// app's Trend template: the reading, its state, the sparkline's geometry,
// the partial and empty states, and where a press on each region leads.

import { describe, expect, it } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE } from "../src/const";
import { normalizedPoints, sparkline } from "../src/preview/trend";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import { trendPreviewStyles } from "../src/styles/preview/trend";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

// The docs' example payload.
const DOCS: WidgetContent = {
  value: 21.4,
  unit: "°",
  points: [18.2, 18.9, 19.6, 20.8, 21.6, 21.2, 20.9, 21.4],
  state: { value: "Rising" },
  icon: { name: "thermometer.medium", primary_color: "orange" },
};

const SIZES: PreviewSize[] = ["small", "medium"];

function regionFields(el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", "trend", id)?.fields ?? []];
    }),
  );
}

/** The clip polygon's corners, as written. */
function corners(area: HTMLElement): string[] {
  return /polygon\((.*?)\);background/.exec(css(area))?.[1]?.split(",") ?? [];
}

describe("trend: the scale", () => {
  it("runs between the smallest and the largest of the points and the reading", () => {
    expect(normalizedPoints({ points: [0, 5, 10] })).toEqual([0, 0.5, 1]);
    // The reading widens the range the points alone would give.
    expect(normalizedPoints({ value: 20, points: [0, 5, 10] })).toEqual([0, 0.25, 0.5]);
    expect(normalizedPoints({ value: -10, points: [0, 10] })).toEqual([0.5, 1]);
  });

  it("is fixed by a bound that is set, and clamps what falls outside", () => {
    expect(normalizedPoints({ value: 5, points: [0, 10], min_value: 0, max_value: 20 })).toEqual([
      0, 0.5,
    ]);
    expect(normalizedPoints({ points: [-5, 5, 15], min_value: 0, max_value: 10 })).toEqual([
      0, 0.5, 1,
    ]);
    // One bound set: the other still comes from the data.
    expect(normalizedPoints({ points: [5, 10], min_value: 0 })).toEqual([0.5, 1]);
  });

  it("centers a flat series, and has nothing for none", () => {
    expect(normalizedPoints({ value: 5, points: [5, 5, 5] })).toEqual([0.5, 0.5, 0.5]);
    expect(normalizedPoints({ points: [1, 2], min_value: 4, max_value: 4 })).toEqual([0.5, 0.5]);
    expect(normalizedPoints({ value: 3 })).toEqual([]);
  });
});

describe("trend: the sparkline", () => {
  it("draws nothing for fewer than two points", () => {
    expect(sparkline({ value: 1 }, "#fff")).toBeNull();
    expect(sparkline({ value: 1, points: [] }, "#fff")).toBeNull();
    expect(sparkline({ value: 1, points: [1] }, "#fff")).toBeNull();
  });

  it("spreads the points across the box, 3 pt in from every edge", () => {
    const spark = sparkline({ points: [0, 10, 5] }, "#123456")!;
    const [area, line] = [...spark.children] as HTMLElement[];
    expect([...spark.children].map((c) => c.className)).toEqual(["pv-trend-area", "pv-trend-line"]);
    // The area follows the line, then drops to the box's bottom edge
    // under the last point and under the first.
    expect(corners(area!)).toEqual([
      "calc(0.00%+3.00px)calc(100.00%+-3.00px)",
      "calc(50.00%+0.00px)calc(0.00%+3.00px)",
      "calc(100.00%+-3.00px)calc(50.00%+0.00px)",
      "calc(100.00%+-3.00px)100%",
      "calc(0.00%+3.00px)100%",
    ]);
    // 28 % of the color at the top of the box, 2 % at the bottom.
    expect(css(area!)).toContain(
      "background:linear-gradient(color-mix(insrgb,#12345628%,transparent),color-mix(insrgb,#1234562%,transparent))",
    );
    // The line lives in the inset box (the stylesheet insets it), so its
    // points are plain shares of it; the stroke keeps its 2 pt.
    const path = $(line!, "svg path");
    expect(path.getAttribute("d")).toBe("M0.00 100.00 L50.00 0.00 L100.00 50.00");
    expect(path.getAttribute("stroke")).toBe("#123456");
    expect(path.getAttribute("stroke-width")).toBe("2");
    expect(path.getAttribute("stroke-linecap")).toBe("round");
    expect(path.getAttribute("stroke-linejoin")).toBe("round");
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    const svg = $(line!, "svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    // The dot is a round cap on the last point, 2.4 × the line across,
    // wherever the box ends up.
    const dot = $(line!, "svg path.pv-trend-dot");
    expect(dot.getAttribute("d")).toBe("M100.00 50.00h0");
    expect(dot.getAttribute("stroke")).toBe("#123456");
    expect(dot.getAttribute("stroke-width")).toBe("4.8");
    expect(dot.getAttribute("stroke-linecap")).toBe("round");
    expect(dot.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("draws a flat series as a line across the middle", () => {
    const spark = sparkline({ value: 7, points: [7, 7] }, "#fff")!;
    expect($(spark, "svg path").getAttribute("d")).toBe("M0.00 50.00 L100.00 50.00");
    expect($(spark, ".pv-trend-dot").getAttribute("d")).toBe("M100.00 50.00h0");
  });

  it("is styled as the app draws it", () => {
    const sheet = trendPreviewStyles.cssText;
    expect(sheet).toMatch(/\.pv-canvas \.pv-trend-line \{ position: absolute; inset: 3px; \}/);
    expect(sheet).toMatch(/\.pv-canvas \.pv-trend-area \{ position: absolute; inset: 0; \}/);
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-trend-line svg \{ display: block; overflow: visible; \}/,
    );
    // Small: a band of 56 pt at most at half strength, 4 pt under the text.
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-trend \.pv-trend-chart \{[^}]*margin-top: 4px;[^}]*align-items: flex-end/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-trend \.pv-trend-spark \{[^}]*max-height: 56px; opacity: \.5/,
    );
    // Medium: full strength and height, 6 pt in from top and bottom; the
    // text column takes half of what the 16 pt gap leaves at most.
    expect(sheet).toMatch(/\.pv-canvas \.pv-split\.pv-trend \.pv-trend-chart \{ margin: 6px 0;/);
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-split\.pv-trend \.pv-trend-spark \{ max-height: none; opacity: 1; \}/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-split\.pv-trend \.pv-lead \{[^}]*max-width: calc\(\(100% - 16px\) \/ 2\)/,
    );
  });
});

describe("trend: small", () => {
  it("stacks the name, the reading, its state and the sparkline band", () => {
    const el = previewWidget("trend", "Living room", DOCS, "small");
    const root = $(el, ".pv-canvas.is-small > .pv-trend");
    expect(root.classList.contains("pv-split")).toBe(false);
    expect([...root.children].map((c) => c.className)).toEqual([
      "pv-name",
      "pv-hero",
      "pv-state",
      "pv-trend-chart",
    ]);
    expect(text($(root, ".pv-name"))).toBe("Living room");
    const hero = $(root, '[data-slot="hero"]');
    expect(text(hero)).toBe("21.4°");
    // 34 pt, so Light; the unit at half size, Regular, raised 0.28 of the
    // hero's size.
    expect(css(hero)).toContain("font-size:34px;font-weight:300");
    expect(css($(hero, "span"))).toContain("font-size:0.5em;font-weight:400;vertical-align:.56em");
    const caption = $(root, '[data-slot="caption"]');
    expect(text(caption)).toBe("Rising");
    // No color of its own: the accent, here the icon's.
    expect(css(caption)).toContain(`color:${COLOR_HEX.orange}`);
    const chart = $(root, '[data-slot="chart"]');
    expect([...chart.children].map((c) => c.className)).toEqual(["pv-trend-spark"]);
    expect($(chart, "svg path").getAttribute("stroke")).toBe(COLOR_HEX.orange);
    expect($(chart, "svg path").getAttribute("d")?.split("L")).toHaveLength(8);
    // No chip at this size.
    expect($$(el, ".pv-chip, .pv-icon")).toHaveLength(0);
  });
});

describe("trend: medium", () => {
  it("sets the name over the reading in a column beside the sparkline", () => {
    const el = previewWidget("trend", "Living room", DOCS, "medium");
    const root = $(el, ".pv-canvas.is-medium > .pv-split.pv-trend");
    const [lead, chart] = [...root.children] as HTMLElement[];
    expect([...lead!.children].map((c) => c.className)).toEqual([
      "pv-name",
      "pv-grow",
      "pv-hero",
      "pv-state",
    ]);
    expect(text($(lead!, ".pv-name"))).toBe("Living room");
    const hero = $(lead!, '[data-slot="hero"]');
    expect(text(hero)).toBe("21.4°");
    expect(css(hero)).toContain("font-size:40px;font-weight:300");
    expect(css($(hero, "span"))).toContain("vertical-align:.56em");
    expect(text($(lead!, '[data-slot="caption"]'))).toBe("Rising");
    expect(chart!.matches('.pv-trend-chart[data-slot="chart"]')).toBe(true);
    expect($(chart!, "svg path").getAttribute("d")?.split("L")).toHaveLength(8);
    expect($$(el, ".pv-chip, .pv-icon")).toHaveLength(0);
  });
});

describe.each(SIZES)("trend: %s", (size) => {
  it("leads each region to its fields", () => {
    const fields = {
      hero: ["value", "unit"],
      caption: ["state"],
      chart: ["points", "min_value", "max_value", "color", "accent"],
    };
    expect(regionFields(previewWidget("trend", "T", DOCS, size))).toEqual(fields);
    // The placeholders lead to the same fields, one region each.
    const none = previewWidget("trend", "T", {}, size);
    expect(regionFields(none)).toEqual(fields);
    expect($$(none, "[data-slot]")).toHaveLength(3);
  });

  it("takes its colors from the state, the line color and the accent", () => {
    const el = previewWidget(
      "trend",
      "T",
      {
        value: 3,
        points: [1, 2],
        state: { value: "Low", text_color: "red" },
        color: "green",
        accent: "purple",
      },
      size,
    );
    expect(css($(el, '[data-slot="caption"]'))).toContain(`color:${COLOR_HEX.red}`);
    expect($(el, "svg path").getAttribute("stroke")).toBe(COLOR_HEX.green);
    expect($(el, ".pv-trend-dot").getAttribute("stroke")).toBe(COLOR_HEX.green);
    // Neither set: both fall back to the accent, then to the app's.
    const accented = previewWidget(
      "trend",
      "T",
      { value: 3, points: [1, 2], state: { value: "Low" }, accent: "purple" },
      size,
    );
    expect(css($(accented, '[data-slot="caption"]'))).toContain(`color:${COLOR_HEX.purple}`);
    expect($(accented, "svg path").getAttribute("stroke")).toBe(COLOR_HEX.purple);
    const plain = previewWidget(
      "trend",
      "T",
      { value: 3, points: [1, 2], state: { value: "Low" } },
      size,
    );
    expect(css($(plain, '[data-slot="caption"]'))).toContain(`color:${SYSTEM_BLUE}`);
    expect($(plain, "svg path").getAttribute("stroke")).toBe(SYSTEM_BLUE);
  });

  it("writes the reading with one decimal at most, and no unit when none is set", () => {
    const el = previewWidget("trend", "T", { value: 640.26, points: [1, 2] }, size);
    const hero = $(el, '[data-slot="hero"]');
    expect(text(hero)).toBe("640.3");
    expect($$(hero, "span")).toHaveLength(0);
    expect(
      text($(previewWidget("trend", "T", { value: 21, unit: " ppm" }, size), '[data-slot="hero"]')),
    ).toBe("21 ppm");
  });

  it("keeps a placeholder for each part that is not set", () => {
    const ghosts = (content: WidgetContent): (string | undefined)[] =>
      $$(previewWidget("trend", "T", content, size), "[data-ghost]").map((g) => g.dataset["slot"]);
    expect(ghosts({})).toEqual(["hero", "caption", "chart"]);
    expect(ghosts({ value: 21.4 })).toEqual(["caption", "chart"]);
    expect(ghosts({ value: 21.4, state: { value: "Rising" } })).toEqual(["chart"]);
    // One point is no line yet.
    expect(ghosts({ value: 21.4, state: { value: "Rising" }, points: [21.4] })).toEqual(["chart"]);
    expect(ghosts({ points: [1, 2] })).toEqual(["hero", "caption"]);
    expect(ghosts(DOCS)).toEqual([]);
    // The name is drawn whatever else is missing, and the chart's
    // placeholder stands where the chart would.
    const none = previewWidget("trend", "Indoor", {}, size);
    expect(text($(none, ".pv-name"))).toBe("Indoor");
    expect(
      $(none, '.pv-trend-chart > [data-ghost][data-slot="chart"]').classList.contains(
        "pv-trend-spark",
      ),
    ).toBe(true);
    expect($$(none, "svg")).toHaveLength(0);
  });
});
