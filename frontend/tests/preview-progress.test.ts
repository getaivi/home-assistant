// The Progress widget's preview at both sizes, against the app's Progress
// template: what each family shows for the docs' example payload, the
// partial and empty states, and where each region leads. Payloads are
// built inline against the wire types, after the docs' own example.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, WP } from "../src/const";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import { progressPreviewStyles } from "../src/styles/preview/progress";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

const NOW = "2026-07-27T12:00:00Z";
/** Half an hour ahead: the countdown reads 30:00. */
const END = "2026-07-27T12:30:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

/** The docs' example payload without its timer. */
const STILL: WidgetContent = {
  progress: { style: "simple", value: 0.65, color: "cyan" },
  state: { value: "Washing" },
  icon: { name: "washer.fill", primary_color: "cyan" },
};
/** The docs' example payload, its end date half an hour ahead. */
const DOCS: WidgetContent = { ...STILL, end_date: END };

const SEGMENTED: WidgetContent = {
  state: { value: "Drying" },
  progress: {
    style: "segmented",
    display: "layered",
    value: 0.5,
    segments: [
      { value: 0.25, fill_color: "cyan", label: "Wash" },
      { value: 0.75, fill_color: "blue", track_fill: "hatched" },
    ],
  },
};

function canvas(content: WidgetContent, size: "small" | "medium"): HTMLElement {
  return $(previewWidget("progress", "Washer", content, size), ".pv-canvas");
}

/** The fields each painted region leads to, by region. */
function regionFields(el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", "progress", id)?.fields ?? []];
    }),
  );
}

const classes = (el: HTMLElement): string[] => [...el.children].map((c) => c.className);

describe("progress, small", () => {
  it("stacks chip, name, countdown, state line and the live bar", () => {
    const el = canvas(DOCS, "small");
    expect(classes(el)).toEqual([
      "pv-progress-top",
      "pv-grow",
      "pv-name pv-progress-name",
      "pv-hero pv-progress-hero is-spaced",
      "pv-progress-line",
      "pv-bar pv-progress-bar is-live",
    ]);
    // The chip's glyph is in the tint (here the icon's color).
    const chip = $(el, '.pv-progress-top > .pv-chip[data-slot="icon"]');
    expect(css(chip)).toContain(`color:${COLOR_HEX.cyan}`);
    expect(text($(el, ".pv-name"))).toBe("Washer");
    // The 36 pt hero is Light and the countdown, in primary.
    const hero = $(el, ".pv-hero");
    expect(text(hero)).toBe("30:00");
    expect(css(hero)).toContain("font-size:36px");
    expect(css(hero)).toContain("font-weight:300");
    expect(css(hero)).toContain(`color:${WP.primary}`);
    // The state word in the tint; Small never shows the finish time.
    const line = $(el, ".pv-progress-line");
    expect(text(line)).toBe("Washing");
    expect(css($(line, ".pv-state"))).toContain(`color:${COLOR_HEX.cyan}`);
    expect(line.querySelector(".pv-meta")).toBeNull();
    // The bar 6 pt under the line, at the reported fraction.
    const bar = $(el, ".pv-bar");
    expect(css(bar)).toContain("margin-top:6px");
    expect(css($(bar, "i"))).toContain("width:65%");
    expect(css($(bar, "i"))).toContain(COLOR_HEX.cyan);
    expect(el.querySelector(".pv-progress-ring")).toBeNull();
  });

  it("draws the running bar as the system's 4 pt one, the still bar 6 pt", () => {
    expect(canvas(DOCS, "small").querySelector(".pv-bar.is-live")).not.toBeNull();
    const still = canvas(STILL, "small");
    expect(still.querySelector(".pv-bar.is-live")).toBeNull();
    const sheet = progressPreviewStyles.cssText;
    expect(sheet).toMatch(/\.pv-bar\.is-live \{ height: 4px;/);
    expect(sheet).toMatch(/\.pv-bar\.is-live i \{ min-width: 0;/);
  });

  it("makes the state the hero, with no state line, when no timer runs", () => {
    for (const content of [STILL, { ...STILL, end_date: "2026-07-27T11:00:00Z" }]) {
      const el = canvas(content, "small");
      expect(text($(el, ".pv-hero"))).toBe("Washing");
      expect(el.querySelector(".pv-progress-line")).toBeNull();
      expect(el.querySelector('[data-slot="caption"]')).toBeNull();
    }
  });

  it("falls back to the percent, and keeps only the line's padding for a bare timer", () => {
    const percent = canvas({ progress: { value: 0.074 } }, "small");
    expect(text($(percent, ".pv-hero"))).toBe("7%");
    const timer = canvas({ progress: { value: 0.3 }, end_date: END }, "small");
    expect(text($(timer, ".pv-hero"))).toBe("30:00");
    expect($(timer, ".pv-progress-line").children).toHaveLength(0);
  });

  it("paints hero and state line in the state's color, the bar in its own", () => {
    const el = canvas(
      {
        progress: { value: 0.62 },
        state: { value: "Washing", text_color: "orange" },
        end_date: END,
        accent: "green",
      },
      "small",
    );
    expect(css($(el, ".pv-hero"))).toContain(`color:${COLOR_HEX.orange}`);
    expect(css($(el, ".pv-state"))).toContain(`color:${COLOR_HEX.orange}`);
    // System blue, never the accent.
    expect(css($(el, ".pv-bar i"))).toContain(COLOR_HEX.blue);
  });

  it("shows an empty payload as 0 % over an empty bar, the icon a placeholder", () => {
    const el = canvas({}, "small");
    expect(classes(el)).toEqual([
      "pv-progress-top",
      "pv-grow",
      "pv-name pv-progress-name",
      "pv-hero pv-progress-hero is-spaced",
      "pv-bar pv-progress-bar",
    ]);
    const ghost = $(el, '.pv-progress-top > [data-ghost][data-slot="icon"]');
    expect(ghost.className).toContain("pv-ghost");
    expect(text(ghost)).toBe("Icon");
    expect(text($(el, ".pv-hero"))).toBe("0%");
    expect(css($(el, ".pv-bar i"))).toContain("width:0%");
  });

  it("clamps the value and splits a segmented bar whatever display says", () => {
    expect(text($(canvas({ progress: { value: 1.4 } }, "small"), ".pv-hero"))).toBe("100%");
    expect(text($(canvas({ progress: { value: -1 } }, "small"), ".pv-hero"))).toBe("0%");
    const el = canvas(SEGMENTED, "small");
    const bar = $(el, '[data-slot="bar"]');
    expect(el.lastElementChild).toBe(bar);
    expect(css(bar)).toContain("height:6px");
    expect(css(bar)).toContain("gap:6px");
    expect(css(bar)).toContain("margin-top:6px");
    expect(bar.children).toHaveLength(2);
    expect(text(bar)).toBe("");
  });

  it("leads each region to its fields", () => {
    expect(regionFields(canvas(DOCS, "small"))).toEqual({
      icon: ["icon", "accent"],
      hero: ["state", "end_date"],
      caption: ["state"],
      bar: ["progress", "segments", "bar_color"],
    });
    expect(Object.keys(regionFields(canvas({}, "small"))).sort()).toEqual(["bar", "hero", "icon"]);
  });
});

describe("progress, medium", () => {
  it("puts the reading beside a ring holding the percent", () => {
    const el = canvas(DOCS, "medium");
    expect(el.querySelector(".wfit")).toBeNull();
    expect(classes(el)).toEqual(["pv-progress-split"]);
    expect(classes($(el, ".pv-progress-split"))).toEqual(["pv-progress-col", "pv-progress-ring"]);
    expect(classes($(el, ".pv-progress-col"))).toEqual([
      "pv-progress-top",
      "pv-grow",
      "pv-name pv-progress-name",
      "pv-hero pv-progress-hero",
      "pv-progress-line",
    ]);
    // The 40 pt hero sits flush under the name (no Small gap).
    const hero = $(el, ".pv-hero");
    expect(text(hero)).toBe("30:00");
    expect(css(hero)).toContain("font-size:40px");
    expect(css(hero)).toContain("font-weight:300");
    // The state word, then the finish time in the meta role.
    const line = $(el, ".pv-progress-line");
    expect(classes(line)).toEqual(["pv-state pv-progress-state", "pv-meta pv-progress-meta"]);
    expect(text($(line, ".pv-state"))).toBe("Washing");
    expect(text($(line, ".pv-meta"))).toMatch(/^· done \d{1,2}[:.]30/);
    // No bar: the ring carries the fraction, 5 pt wide from 12 o'clock.
    expect(el.querySelector(".pv-bar")).toBeNull();
    const [track, arc] = $$(el, ".pv-progress-ring circle");
    expect(track?.getAttribute("stroke")).toBe(WP.quaternary);
    expect(track?.getAttribute("r")).toBe("28");
    expect(arc?.getAttribute("stroke")).toBe(COLOR_HEX.cyan);
    expect(arc?.getAttribute("stroke-width")).toBe("5");
    expect(arc?.getAttribute("stroke-linecap")).toBe("round");
    expect(arc?.getAttribute("transform")).toBe("rotate(-90 28 28)");
    const circ = 2 * Math.PI * 28;
    expect(arc?.getAttribute("stroke-dasharray")).toBe(
      `${(circ * 0.65).toFixed(2)} ${circ.toFixed(2)}`,
    );
    expect(text($(el, ".pv-progress-percent"))).toBe("65%");
  });

  it("shows the finish time alone for a bare timer, and no line without one", () => {
    const timer = canvas({ progress: { value: 0.3 }, end_date: END }, "medium");
    expect(classes($(timer, ".pv-progress-line"))).toEqual(["pv-meta pv-progress-meta"]);
    const still = canvas(STILL, "medium");
    expect(text($(still, ".pv-hero"))).toBe("Washing");
    expect(still.querySelector(".pv-progress-line")).toBeNull();
    expect(text($(still, ".pv-progress-percent"))).toBe("65%");
  });

  it("paints the ring's percent like the hero and its arc like the bar", () => {
    const el = canvas(
      {
        progress: { value: 0.62 },
        state: { value: "Washing", text_color: "orange" },
        accent: "green",
        icon: "washer.fill",
      },
      "medium",
    );
    expect(css($(el, ".pv-progress-percent"))).toContain(`color:${COLOR_HEX.orange}`);
    expect($(el, ".pv-progress-arc").getAttribute("stroke")).toBe(COLOR_HEX.blue);
    expect(css($(el, ".pv-chip"))).toContain(`color:${COLOR_HEX.green}`);
  });

  it("shows an empty payload as 0 % beside a ring with a dot at the top", () => {
    const el = canvas({}, "medium");
    expect($(el, '.pv-progress-top > [data-ghost][data-slot="icon"]').className).toContain(
      "pv-ghost",
    );
    expect(text($(el, ".pv-hero"))).toBe("0%");
    expect(text($(el, ".pv-progress-percent"))).toBe("0%");
    const circ = 2 * Math.PI * 28;
    expect($(el, ".pv-progress-arc").getAttribute("stroke-dasharray")).toBe(
      `${(circ * 0.001).toFixed(2)} ${circ.toFixed(2)}`,
    );
  });

  it("keeps a segmented bar a bar, 8 pt under the reading", () => {
    const el = canvas({ ...SEGMENTED, end_date: END }, "medium");
    expect(el.querySelector(".pv-progress-ring")).toBeNull();
    expect(classes(el).slice(0, 5)).toEqual([
      "pv-progress-top",
      "pv-grow",
      "pv-name pv-progress-name",
      "pv-hero pv-progress-hero",
      "pv-progress-line",
    ]);
    const bar = $(el, '[data-slot="bar"]');
    expect(el.lastElementChild).toBe(bar);
    expect(css(bar)).toContain("height:6px");
    expect(css(bar)).toContain("gap:6px");
    expect(css(bar)).toContain("margin-top:8px");
    expect(bar.children).toHaveLength(2);
    expect(text(bar)).toBe("");
    expect(text($(el, ".pv-meta"))).toMatch(/^· done /);
  });

  it("leads each region to its fields", () => {
    const full = canvas(DOCS, "medium");
    expect(regionFields(full)).toEqual({
      icon: ["icon", "accent"],
      hero: ["state", "end_date"],
      caption: ["state"],
      finish: ["end_date"],
      bar: ["progress", "segments", "bar_color"],
    });
    // The ring is the bar's region; the finish time is the end date's.
    expect($(full, ".pv-progress-ring").dataset["slot"]).toBe("bar");
    expect($(full, ".pv-meta").dataset["slot"]).toBe("finish");
    expect(Object.keys(regionFields(canvas({}, "medium"))).sort()).toEqual(["bar", "hero", "icon"]);
  });
});
