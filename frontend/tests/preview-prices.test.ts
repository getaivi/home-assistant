// The Prices widget's preview (preview/prices.ts) against the app's
// Prices template: what each size draws for a full payload, for fewer
// periods than the window, for no periods, and which fields each region
// leads to.

import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX } from "../src/const";
import { currentPriceIndex, priceLevel } from "../src/preview/prices";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import { pricesPreviewStyles } from "../src/styles/preview/prices";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The app's own preview payload: a day of hourly prices.
const PRICES = [
  14.2, 12.8, 11.9, 11.2, 12.4, 15.8, 22.4, 31.7, 38.2, 33.4, 26.1, 21.8, 18.4, 16.2, 15.1, 17.9,
  24.6, 35.8, 42.9, 39.4, 30.2, 24.8, 19.4, 16.1,
];
const hour = (h: number): string => new Date(Date.UTC(2026, 0, 15, h)).toISOString();
const DAY: WidgetContent = {
  entries: PRICES.map((price, h) => ({ start: hour(h), price })),
  unit: "ct/kWh",
};

function at(h: number, minutes = 30): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 15, h, minutes)));
}

const bars = (el: HTMLElement): HTMLElement[] =>
  $$(el, '[data-slot="chart"] > .pv-prices-bars > i');
const dots = (el: HTMLElement): HTMLElement[] =>
  $$(el, '[data-slot="chart"] > .pv-prices-dots > i');
const opacity = (bar: HTMLElement): string | undefined => /opacity:([\d.]+)/.exec(css(bar))?.[1];
const height = (bar: HTMLElement): string | undefined => /height:([\d.]+%)/.exec(css(bar))?.[1];

function regionFields(el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", "prices", id)?.fields ?? []];
    }),
  );
}

describe("prices: small", () => {
  it("stacks the name, the price, its level and a twelve-period strip", () => {
    at(15);
    const el = previewWidget("prices", "Electricity", DAY, "small");
    expect([...$(el, ".pv-canvas.is-small").children].map((c) => c.className)).toEqual([
      "pv-name pv-prices-name",
      "pv-hero pv-prices-hero",
      "pv-state pv-prices-state",
      "pv-grow pv-prices-gap",
      "pv-prices-chart",
    ]);
    expect(text($(el, ".pv-name"))).toBe("Electricity");
    const hero = $(el, '[data-slot="hero"]');
    expect(text(hero)).toBe("17.9 ct/kWh");
    // 30 pt is Regular on the hero ladder; the unit is half size, on the
    // baseline.
    expect(css(hero)).toContain("font-size:30px");
    expect(css(hero)).toContain("font-weight:400");
    expect(css($(hero, "span"))).toContain("font-size:0.5em");
    expect(css($(hero, "span"))).not.toContain("vertical-align");
    expect(text($(el, ".pv-state"))).toBe("Low");
    expect(css($(el, ".pv-state"))).toContain(`color:${COLOR_HEX.green}`);
    // The window is backfilled when fewer than twelve periods are left:
    // hours 12 to 23, the current one fourth.
    expect(bars(el).map(opacity)).toEqual([
      "0.28",
      "0.28",
      "0.28",
      "1",
      ...Array<string>(8).fill("0.5"),
    ]);
    expect(dots(el).map((d) => d.children.length)).toEqual([
      0,
      0,
      0,
      1,
      ...Array<number>(8).fill(0),
    ]);
    expect(css($(dots(el)[3]!, "b"))).toContain(COLOR_HEX.green);
    // Heights span the posted range, not the window's: 42.9 is the top.
    expect(height(bars(el)[6]!)).toBe("100%");
    expect(css(bars(el)[6]!)).toContain(COLOR_HEX.red);
    expect(regionFields(el)).toEqual({
      hero: ["entries", "scale", "unit"],
      chart: ["entries"],
    });
  });

  it("leads the window with the current period while enough follow", () => {
    at(3);
    const el = previewWidget("prices", "Electricity", DAY, "small");
    expect(text($(el, '[data-slot="hero"]'))).toBe("11.2 ct/kWh");
    expect(bars(el).map(opacity)).toEqual(["1", ...Array<string>(11).fill("0.5")]);
    // The day's lowest price keeps 15 % of the height.
    expect(height(bars(el)[0]!)).toBe("15%");
  });
});

describe("prices: medium", () => {
  it("sets the text column beside twenty-four bars", () => {
    at(15);
    const el = previewWidget("prices", "Electricity", DAY, "medium");
    const [lead, chart] = $$(el, ".pv-canvas.is-medium > .pv-prices-split > *");
    expect([...lead!.children].map((c) => c.className)).toEqual([
      "pv-name pv-prices-name",
      "pv-grow",
      "pv-hero pv-prices-hero",
      "pv-state pv-prices-state",
    ]);
    const hero = $(lead!, '[data-slot="hero"]');
    expect(text(hero)).toBe("17.9 ct/kWh");
    // 40 pt is Light.
    expect(css(hero)).toContain("font-size:40px");
    expect(css(hero)).toContain("font-weight:300");
    expect(text($(lead!, ".pv-state"))).toBe("Low");
    expect(chart!.dataset["slot"]).toBe("chart");
    expect(bars(el).map(opacity)).toEqual([
      ...Array<string>(15).fill("0.28"),
      "1",
      ...Array<string>(8).fill("0.5"),
    ]);
    expect(dots(el).map((d) => d.children.length)).toEqual([
      ...Array<number>(15).fill(0),
      1,
      ...Array<number>(8).fill(0),
    ]);
    expect(height(bars(el)[18]!)).toBe("100%");
    expect(height(bars(el)[3]!)).toBe("15%");
    expect(regionFields(el)).toEqual({
      hero: ["entries", "scale", "unit"],
      chart: ["entries"],
    });
  });

  it("gives the text column half the row at most, the bars as capsules", () => {
    const sheet = pricesPreviewStyles.cssText;
    expect(sheet).toMatch(/\.pv-prices-split \.pv-lead \{ max-width: 145px; \}/);
    expect(sheet).toMatch(/\.pv-prices-bars i \{[^}]*min-height: 3px;\s*border-radius: 99px; \}/);
    expect(sheet).toMatch(/\.pv-prices-bars \{[^}]*gap: 2px; \}/);
  });
});

describe("prices: levels, formatting and partial payloads", () => {
  it("bands by an entry's own level, else by terciles of the posted range", () => {
    at(1);
    const el = previewWidget(
      "prices",
      "E",
      {
        entries: [
          { start: hour(0), price: 0 },
          { start: hour(1), price: 10, level: "high" },
          { start: hour(2), price: 15 },
          { start: hour(3), price: 20 },
          { start: hour(4), price: 30 },
        ],
      },
      "medium",
    );
    expect(text($(el, ".pv-state"))).toBe("High");
    expect(css($(el, ".pv-state"))).toContain(`color:${COLOR_HEX.red}`);
    const color = [COLOR_HEX.green, COLOR_HEX.red, COLOR_HEX.yellow, COLOR_HEX.red, COLOR_HEX.red];
    bars(el).forEach((bar, i) => {
      expect(css(bar)).toContain(color[i]);
    });
    // The boundaries belong to low and high.
    const thirds = [{ price: 0 }, { price: 10 }, { price: 20 }, { price: 30 }];
    expect(thirds.map((_, i) => priceLevel(thirds, i))).toEqual(["low", "low", "high", "high"]);
    expect(priceLevel(thirds, 9)).toBe("medium");
    expect(priceLevel([{ price: 1, level: "peak" }, { price: 2 }], 0)).toBe("low");
  });

  it("draws negative prices on the same scale, to one decimal at most", () => {
    at(1);
    const el = previewWidget(
      "prices",
      "E",
      {
        entries: [
          { start: hour(0), price: 12 },
          { start: hour(1), price: -3.26 },
          { start: hour(2), price: 4.5 },
        ],
        unit: "öre",
      },
      "small",
    );
    expect(text($(el, '[data-slot="hero"]'))).toBe("-3.3 öre");
    expect(text($(el, ".pv-state"))).toBe("Low");
    expect(bars(el).map(height)).toEqual(["100%", "15%", "58.2%"]);
    expect(bars(el).map(opacity)).toEqual(["0.28", "1", "0.5"]);
  });

  it("draws what there is when fewer periods than the window are posted", () => {
    at(15);
    const one = previewWidget(
      "prices",
      "Fixed rate",
      { entries: [{ start: hour(0), price: 24 }] },
      "medium",
    );
    // No unit: the number alone. A flat range is medium, at mid height.
    expect(text($(one, '[data-slot="hero"]'))).toBe("24");
    expect($$(one, '[data-slot="hero"] span')).toHaveLength(0);
    expect(text($(one, ".pv-state"))).toBe("Medium");
    expect(bars(one).map(height)).toEqual(["57.5%"]);
    expect(css(bars(one)[0]!)).toContain(COLOR_HEX.yellow);
    expect(dots(one).map((d) => d.children.length)).toEqual([1]);
  });

  it("highlights the first period before any has started, the last after all", () => {
    const entries = DAY.entries ?? [];
    expect(currentPriceIndex(entries, Date.parse("2020-01-01"))).toBe(0);
    expect(currentPriceIndex(entries, Date.parse("2030-01-01"))).toBe(23);
    expect(currentPriceIndex(entries, Date.UTC(2026, 0, 15, 7))).toBe(7);
    at(23);
    const late = previewWidget("prices", "E", DAY, "small");
    expect(text($(late, '[data-slot="hero"]'))).toBe("16.1 ct/kWh");
    expect(bars(late).map(opacity)).toEqual([...Array<string>(11).fill("0.28"), "1"]);
  });

  it("keeps the name and a placeholder for the price sensor with no periods", () => {
    for (const size of ["small", "medium"] as const) {
      for (const content of [{}, { entries: [] }, { unit: "ct/kWh" }] as WidgetContent[]) {
        const el = previewWidget("prices", "Electricity", content, size);
        expect([...$(el, ".pv-canvas").children].map((c) => c.className)).toEqual([
          "pv-name pv-prices-name",
          "pv-ghost is-dark",
        ]);
        expect($$(el, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero"]);
        expect(regionFields(el)).toEqual({ hero: ["entries", "scale", "unit"] });
      }
    }
  });
});

describe("prices: lines that do not fit", () => {
  /** Lay text out at `perPx` wide per px of font size and character. */
  function layOut(perPx: number): void {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const size = parseFloat(this.style.fontSize) || 0;
      const width = (this.textContent ?? "").length * size * perPx;
      return {
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
  }

  it("shrinks the hero to fit before it truncates, never under 60 %", () => {
    at(15);
    // "17.9" at 40 px and " ct/kWh" at 20 px: 150 px wide, into the
    // column's 145 less the half pixel kept clear.
    layOut(0.5);
    const hero = $(previewWidget("prices", "E", DAY, "medium"), '[data-slot="hero"]');
    const size = parseFloat(hero.style.fontSize);
    expect(size).toBeLessThan((40 * 144.5) / 150 + 0.01);
    expect(size).toBeGreaterThan(38.5);
    // The weight stays the nominal size's.
    expect(css(hero)).toContain("font-weight:300");
    layOut(5);
    const floor = $(previewWidget("prices", "E", DAY, "small"), '[data-slot="hero"]');
    expect(floor.style.fontSize).toBe("18px");
  });

  it("shrinks the name to 80 % at most, and leaves lines that fit alone", () => {
    at(15);
    layOut(5);
    expect(
      $(previewWidget("prices", "A long widget name", DAY, "small"), ".pv-name").style.fontSize,
    ).toBe("12px");
    layOut(0.01);
    const el = previewWidget("prices", "Electricity", DAY, "small");
    expect($(el, ".pv-name").style.fontSize).toBe("15px");
    expect($(el, '[data-slot="hero"]').style.fontSize).toBe("30px");
  });
});
