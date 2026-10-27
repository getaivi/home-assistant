// The Gauge widget's preview at both sizes, against the app's Gauge
// template: what each size shows for a
// full payload, a partial and an empty one, and which fields each region
// leads to.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX } from "../src/const";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

/** The docs' example payload. */
const FULL: WidgetContent = {
  template: "gauge",
  value: 21.5,
  min_value: 0,
  max_value: 40,
  unit: "°C",
  label: "Living room",
  icon: { name: "thermometer.medium" },
};

/** The payload with nothing but the reading and its range. */
const BARE: WidgetContent = { template: "gauge", value: 7, min_value: 0, max_value: 40 };
/** The payload without its label. */
const UNNAMED: WidgetContent = { ...BARE, value: 21.5, unit: "°C" };

const draw = (content: WidgetContent, size: PreviewSize = "small"): HTMLElement =>
  $(previewWidget("gauge", "Thermostat", content, size), ".pv-canvas");

/** A style declaration's number of px (NaN when it is not set). */
const px = (el: Element, prop: string): number =>
  Number(new RegExp(`(?:^|;)${prop}:([\\d.]+)px`).exec(css(el))?.[1] ?? NaN);

/** The fields each painted region leads to, by region. */
function regionFields(el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", "gauge", id)?.fields ?? []];
    }),
  );
}

/** Lay text out for the ruler the renderer measures with (happy-dom lays
 * nothing out): every character 0.56 of its font size wide. */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const size = parseFloat(this.style.fontSize) || 0;
    const width = (this.textContent ?? "").length * size * 0.56;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FIELDS = {
  label: ["label"],
  dial: ["value", "unit", "min_value", "max_value", "ring", "icon"],
};

describe("gauge preview: small", () => {
  it("puts the name line over a 96 pt dial", () => {
    const el = draw(FULL);
    expect([...el.children].map((c) => c.className)).toEqual([
      "pv-gauge-head",
      "pv-grow pv-gauge-area",
    ]);
    expect(text($(el, ".pv-gauge-head > .pv-name"))).toBe("Living room");
    const dial = $(el, ".pv-gauge-area > .pv-gauge-dial");
    expect(px(dial, "width")).toBe(96);
    expect(px(dial, "height")).toBe(96);
    // Shifted down by half the strip the arc's mouth leaves empty:
    // (48 - 44.5 / sqrt(2) - 3.5) / 2.
    expect(css(dial)).toContain("transform:translateY(6.52px)");
  });

  it("stacks the glyph, the reading and the bounds inside the ring", () => {
    const el = draw(FULL);
    const stack = $(el, ".pv-gauge-dial > .pv-gauge-stack");
    expect([...stack.children].map((c) => c.className)).toEqual([
      "pv-gauge-icon",
      "pv-hero",
      "pv-gauge-bounds",
    ]);
    // The glyph is 11 % of the diameter but 11 pt at least, the bounds
    // 8 % but 10 pt at least.
    expect(px($(stack, ".pv-gauge-icon"), "font-size")).toBe(11);
    expect(css($(stack, ".pv-gauge-icon"))).toContain("font-weight:600");
    expect(px($(stack, ".pv-gauge-bounds"), "font-size")).toBe(10);
    expect(text($(stack, ".pv-gauge-bounds"))).toBe("0 – 40");
    // The leading copy of the unit is the invisible counterweight.
    expect(text($(stack, ".pv-hero"))).toBe("°C21.5°C");
  });

  it("sets the hero at 26 % of the dial in a frame 60 % of it wide", () => {
    const hero = $(draw(BARE), ".pv-hero");
    expect(text(hero)).toBe("7");
    expect(px(hero, "font-size")).toBe(24.96);
    expect(px(hero, "width")).toBe(57.6);
    // 24 pt and up is Regular (heroWeight).
    expect(css(hero)).toContain("font-weight:400");
  });

  it("shrinks a reading that overflows its frame, to 0.6 at most, then truncates", () => {
    const fits = $(draw(BARE), ".pv-hero");
    expect(css(fits)).not.toContain("overflow");
    const long = $(draw({ ...FULL, value: 123456789.5, unit: " kWh" }), ".pv-hero");
    expect(px(long, "font-size")).toBeCloseTo(24.96 * 0.6, 1);
    // At the floor the hero keeps its ellipsis.
    expect(css(long)).not.toContain("overflow:visible");
    const some = $(draw(FULL), ".pv-hero");
    expect(px(some, "font-size")).toBeLessThan(24.96);
    expect(px(some, "font-size")).toBeGreaterThan(24.96 * 0.6);
    expect(css(some)).toContain("overflow:visible");
  });

  it("shrinks a long name to 0.8 of its size at most", () => {
    expect(css($(draw(FULL), ".pv-name"))).toBe("");
    const name = $(draw({ ...FULL, label: "Upstairs master bedroom thermostat" }), ".pv-name");
    expect(px(name, "font-size")).toBe(12);
  });

  it("falls back to the widget's name without a label", () => {
    expect(text($(draw(UNNAMED), ".pv-name"))).toBe("Thermostat");
  });

  it("maps each region to its fields", () => {
    expect(regionFields(draw(FULL))).toEqual(FIELDS);
    expect(regionFields(draw({ template: "gauge" }))).toEqual(FIELDS);
  });
});

describe("gauge preview: medium", () => {
  it("puts the full-height dial beside the label", () => {
    const el = draw(FULL, "medium");
    expect(el.classList.contains("is-medium")).toBe(true);
    expect(el.children).toHaveLength(1);
    const row = $(el, ".pv-gauge-row");
    expect([...row.children].map((c) => c.className)).toEqual(["pv-gauge-area", "pv-gauge-label"]);
    const dial = $(row, ".pv-gauge-area > .pv-gauge-dial");
    expect(px(dial, "width")).toBe(126);
    expect(css(dial)).toContain("transform:translateY(8.71px)");
    // The label is title3 (20 pt), not the 15 pt name line.
    const label = $(row, ".pv-gauge-label");
    expect(text(label)).toBe("Living room");
    expect(px(label, "font-size")).toBe(20);
    expect(el.querySelector(".pv-name")).toBeNull();
    expect(el.querySelector(".wfit")).toBeNull();
  });

  it("sizes the dial's type from its diameter", () => {
    const stack = $(draw({ ...BARE, icon: "thermometer" }, "medium"), ".pv-gauge-stack");
    expect(px($(stack, ".pv-gauge-icon"), "font-size")).toBe(13.86);
    expect(px($(stack, ".pv-hero"), "font-size")).toBe(32.76);
    expect(px($(stack, ".pv-hero"), "width")).toBe(75.6);
    // Under 34 pt the hero is still Regular.
    expect(css($(stack, ".pv-hero"))).toContain("font-weight:400");
    expect(px($(stack, ".pv-gauge-bounds"), "font-size")).toBe(10.08);
    expect(text($(stack, ".pv-gauge-bounds"))).toBe("0 – 40");
  });

  it("shrinks a label two lines cannot hold, to 0.6 at most", () => {
    const size = (label: string): number =>
      px($(draw({ ...FULL, label }, "medium"), ".pv-gauge-label"), "font-size");
    expect(size("Living room")).toBe(20);
    expect(size("Living room temperature")).toBe(20);
    expect(size("Upstairs master bedroom thermostat reading right now")).toBe(12);
    // One word wider than the column shrinks until it fits a line.
    expect(size("Extraordinarilylongword")).toBeLessThan(20);
  });

  it("falls back to the widget's name without a label", () => {
    expect(text($(draw(UNNAMED, "medium"), ".pv-gauge-label"))).toBe("Thermostat");
  });

  it("maps each region to its fields", () => {
    expect(regionFields(draw(FULL, "medium"))).toEqual(FIELDS);
    expect(regionFields(draw({ template: "gauge" }, "medium"))).toEqual(FIELDS);
  });
});

describe("gauge preview: the ring", () => {
  const svg = (content: WidgetContent, size: PreviewSize = "small"): string =>
    $(draw(content, size), ".pv-gauge-dial svg").innerHTML;
  /** The value dot's center. */
  const dot = (content: WidgetContent, size: PreviewSize = "small"): [number, number] => {
    const m = /<circle cx="([\d.]+)" cy="([\d.]+)" r="5.5" fill="#000"/.exec(svg(content, size));
    return [Number(m?.[1]), Number(m?.[2])];
  };

  it("draws the track at 25 % under the swept part, a 7 pt stroke", () => {
    const html = svg(FULL);
    expect(html).toContain('<g opacity="0.25">');
    expect(html).toContain('stroke-width="7"');
    const [track, value] = html.split("</g>");
    // 21.5 of 0–40 sweeps a little over half of the segments.
    const paths = (part: string | undefined): number => (part?.match(/<path/g) ?? []).length;
    expect(paths(value) / paths(track)).toBeCloseTo(21.5 / 40, 1);
  });

  it("opens the 90° mouth at the bottom and rides the dot on the centerline", () => {
    // Low end: 135° round from 3 o'clock, at the ring radius (96 - 7) / 2.
    const r = 44.5,
      at = (deg: number): [number, number] => [
        48 + r * Math.cos((deg * Math.PI) / 180),
        48 + r * Math.sin((deg * Math.PI) / 180),
      ];
    const close = (a: [number, number], b: [number, number]): void => {
      expect(a[0]).toBeCloseTo(b[0], 1);
      expect(a[1]).toBeCloseTo(b[1], 1);
    };
    close(dot({ ...FULL, value: 0 }), at(135));
    close(dot({ ...FULL, value: 20 }), at(270));
    close(dot({ ...FULL, value: 40 }), at(45));
    // Out-of-range readings clamp to the ends.
    close(dot({ ...FULL, value: -5 }), at(135));
    close(dot({ ...FULL, value: 99 }), at(45));
    // Medium: the same dial at 126 pt.
    const [x, y] = dot({ ...FULL, value: 20 }, "medium");
    expect(x).toBeCloseTo(63, 1);
    expect(y).toBeCloseTo(3.5, 1);
  });

  it("fills the dot with the system background under a 2 pt primary stroke", () => {
    expect(svg(FULL)).toContain('r="5.5" fill="#000" stroke="#fff" stroke-width="2"');
  });

  it("runs the built-in sweep cyan to orange without a color", () => {
    const html = svg(FULL);
    // The caps carry the gradient's end colors.
    expect(html).toContain('fill="rgb(60,211,254)"');
    expect(html).toContain("rgb(255,146,48)");
  });

  it("paints a solid ring one color", () => {
    const html = svg({ ...FULL, color: "red" });
    const strokes = new Set([...html.matchAll(/<path[^>]* stroke="([^"]+)"/g)].map((m) => m[1]));
    expect([...strokes]).toEqual([COLOR_HEX.red]);
  });

  it("runs gradient stops along the arc, and a solid color outranks them", () => {
    const html = svg({ ...FULL, gradient: ["blue", "red"] });
    const strokes = new Set([...html.matchAll(/<path[^>]* stroke="([^"]+)"/g)].map((m) => m[1]));
    expect(strokes.size).toBeGreaterThan(10);
    expect(html).not.toContain("rgb(60,211,254)");
    const both = svg({ ...FULL, gradient: ["blue", "red"], color: "green" });
    expect(both).toContain(`stroke="${COLOR_HEX.green}"`);
    expect(both).not.toContain("rgb(");
  });

  it("rests at the low end for a degenerate range", () => {
    const flat = { ...FULL, min_value: 5, max_value: 5 };
    expect(dot(flat)).toEqual(dot({ ...FULL, value: 0 }));
    expect(text($(draw(flat), ".pv-gauge-bounds"))).toBe("5 – 5");
  });
});

describe("gauge preview: partial and empty", () => {
  for (const size of ["small", "medium"] as const) {
    it(`${size}: nothing bound draws the name, an idle dial and the default bounds`, () => {
      const el = draw({ template: "gauge" }, size);
      expect(el.outerHTML).not.toContain("NaN");
      expect(text($(el, size === "small" ? ".pv-name" : ".pv-gauge-label"))).toBe("Thermostat");
      expect(text($(el, ".pv-hero"))).toBe("…");
      expect(text($(el, ".pv-gauge-bounds"))).toBe("0 – 1");
      // No icon leaves no gap: the reading and the bounds alone.
      expect(el.querySelector(".pv-gauge-icon")).toBeNull();
      expect($(el, ".pv-gauge-stack").children).toHaveLength(2);
      expect(el.querySelector("[data-ghost]")).toBeNull();
    });

    it(`${size}: a value alone reads against 0–1, with no unit`, () => {
      const el = draw({ template: "gauge", value: 0.25 }, size);
      expect(text($(el, ".pv-hero"))).toBe("0.3");
      expect($$(el, ".pv-hero span")).toHaveLength(0);
    });

    it(`${size}: the glyph is secondary whatever the icon's color`, () => {
      const el = draw({ ...FULL, icon: { name: "thermometer", primary_color: "purple" } }, size);
      expect(css($(el, ".pv-gauge-icon"))).toContain("color:rgba(235,235,245,.6)");
      expect(el.outerHTML).not.toContain(COLOR_HEX.purple);
    });

    it(`${size}: a word unit is neither raised nor counterweighted`, () => {
      const hero = $(draw({ ...FULL, unit: " ppm" }, size), ".pv-hero");
      expect(text(hero)).toBe("21.5 ppm");
      expect($$(hero, "span")).toHaveLength(1);
      expect(css($(hero, "span"))).not.toContain("vertical-align");
    });

    it(`${size}: a percent is raised and counterweighted like a degree`, () => {
      const hero = $(draw({ ...FULL, unit: "%" }, size), ".pv-hero");
      expect(text(hero)).toBe("%21.5%");
      const [weight, unit] = $$(hero, "span");
      expect(css(weight!)).toContain("visibility:hidden");
      expect(css(unit!)).toContain("vertical-align:");
    });
  }
});
