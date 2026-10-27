// The Budget widget's preview (preview/budget.ts) at both sizes, against
// the app's Budget template: the docs' example payload, the partial and
// empty states, the fit to the laid-out width, and the fields each region
// leads to.

import { afterEach, describe, expect, it } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE, WP } from "../src/const";
import { budgetAmount, budgetLine, fitBudgetTotal } from "../src/preview/budget";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

// The docs' example: $980.70 left of $1,500 with 20 days to go.
const DOCS: WidgetContent = {
  currency: "USD",
  display: "remaining",
  total: {
    spent: "519.30",
    budget: "1500",
    icon: { name: "banknote", primary_color: "yellow" },
    color: "yellow",
  },
  subtitle: { value: "20 days left" },
  categories: [
    { label: "Food", spent: "157.60", budget: "300", icon: "fork.knife", color: "blue" },
    { label: "Vehicle", spent: "98.70", budget: "200", icon: "car.fill", color: "green" },
    { label: "Gadgets", spent: "245.20", budget: "300", icon: "headphones", color: "pink" },
    { label: "Sports", spent: "20", budget: "50" },
  ],
};

function regionFields(el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", "budget", id)?.fields ?? []];
    }),
  );
}

const REGIONS = {
  total: ["spent", "currency"],
  ring: ["display", "total_color"],
  meta: ["budget", "subtitle"],
  categories: ["categories"],
};

/** The arc of a ring as a share of its circumference. */
function arc(ring: Element): number {
  const [dash, around] = ($$(ring, "circle")[1]?.getAttribute("stroke-dasharray") ?? "").split(" ");
  return Number(dash) / Number(around);
}

describe("budget figures", () => {
  it("headlines the remainder or what was spent, the ring following", () => {
    expect(budgetLine({ spent: "519.30", budget: "1500" }, "remaining")).toEqual({
      amount: 1500 - 519.3,
      fill: 1 - 519.3 / 1500,
      red: false,
    });
    // No display is remaining; spent mode fills up instead.
    expect(budgetLine({ spent: 50, budget: 200 }, undefined)).toEqual({
      amount: 150,
      fill: 0.75,
      red: false,
    });
    expect(budgetLine({ spent: 50, budget: 200 }, "spent")).toEqual({
      amount: 50,
      fill: 0.25,
      red: false,
    });
    // Overspent: a negative remainder in red on an empty ring; spent mode
    // shows a full ring and no red.
    expect(budgetLine({ spent: 120, budget: 100 }, "remaining")).toEqual({
      amount: -20,
      fill: 0,
      red: true,
    });
    expect(budgetLine({ spent: 120, budget: 100 }, "spent")).toEqual({
      amount: 120,
      fill: 1,
      red: false,
    });
    // Without a budget (or one that is no amount) it is what was spent,
    // and no ring.
    expect(budgetLine({ spent: "5" }, "remaining")).toEqual({ amount: 5, fill: null, red: false });
    expect(budgetLine({ spent: "5", budget: "soon" }, "remaining")).toEqual({
      amount: 5,
      fill: null,
      red: false,
    });
    expect(budgetLine({}, undefined)).toEqual({ amount: 0, fill: null, red: false });
    // A budget of 0 has no ring but still a remainder.
    expect(budgetLine({ spent: 5, budget: 0 }, "remaining")).toEqual({
      amount: -5,
      fill: null,
      red: true,
    });
  });

  it("writes amounts in the currency's digits, or whole with the narrow symbol", () => {
    expect(budgetAmount(980.7, "USD")).toBe("$980.70");
    expect(budgetAmount(-20, "USD")).toBe("-$20.00");
    expect(budgetAmount(1500, "USD", true)).toBe("$1,500");
    expect(budgetAmount(1234, "JPY")).toBe("¥1,234");
    expect(budgetAmount(12.5, undefined)).toBe("$12.50");
    // A foreign currency keeps its code in full, the narrow symbol whole.
    expect(budgetAmount(54.8, "CAD")).toBe("CA$54.80");
    expect(budgetAmount(54.8, "CAD", true)).toBe("$55");
    // Halves round to even, as on the device.
    expect(budgetAmount(142.5, "USD", true)).toBe("$142");
    expect(budgetAmount(143.5, "USD", true)).toBe("$144");
    // Not a currency: the plain number.
    expect(budgetAmount(5, "XXX!")).toBe("5");
  });
});

describe("budget: small", () => {
  it("draws the name, the ring beside the hero, the meta line and two legends", () => {
    const el = previewWidget("budget", "Monthly budget", DOCS, "small");
    const kids = $$(el, ".pv-canvas.is-small > *");
    expect(kids.map((k) => k.className)).toEqual([
      "pv-name pv-budget-name",
      "pv-budget-total",
      "pv-meta pv-budget-meta",
      "pv-grow pv-budget-gap",
      "pv-budget-legends",
    ]);
    expect(text(kids[0]!)).toBe("Monthly budget");
    // The 29 pt ring, drained to what is left, in the total's color.
    const ring = $(kids[1]!, '[data-slot="ring"]');
    expect(css(ring)).toContain("width:29px");
    expect($(ring, "svg").outerHTML).toContain(`stroke="${COLOR_HEX.yellow}"`);
    expect(arc(ring)).toBeCloseTo(980.7 / 1500, 3);
    expect(text(ring)).toBe("✦");
    // The hero at 26, regular, in primary.
    const hero = $(kids[1]!, ".pv-hero");
    expect(text(hero)).toBe("$980.70");
    expect(css(hero)).toBe("font-size:26px;font-weight:400;");
    // The budget, a dot and the subtitle; the budget is whole.
    expect($$(kids[2]!, "span").map((s) => [s.className, text(s)])).toEqual([
      ["pv-budget-of", "of $1,500"],
      ["pv-budget-dot", "·"],
      ["pv-budget-subtitle", "20 days left"],
    ]);
    expect(text(kids[2]!)).toBe("of $1,500 · 20 days left");
    // Two legends: the label in the category's color over the whole
    // amount in primary.
    const legends = $$(kids[4]!, ".pv-budget-legend");
    expect(legends.map(text)).toEqual(["Food$142", "Vehicle$101"]);
    expect(legends.map((l) => css($(l, ".pv-budget-label")))).toEqual([
      `color:${COLOR_HEX.blue};`,
      `color:${COLOR_HEX.green};`,
    ]);
    expect(css($(legends[0]!, ".pv-budget-amount"))).toContain(`color:${WP.primary}`);
    expect(el.querySelector("[data-ghost]")).toBeNull();
    expect(regionFields(el)).toEqual(REGIONS);
  });

  it("draws spent mode filling up, and an overspent remainder in red", () => {
    const spent = previewWidget("budget", "B", { ...DOCS, display: "spent" }, "small");
    expect(text($(spent, ".pv-hero"))).toBe("$519.30");
    expect(arc($(spent, '[data-slot="ring"]'))).toBeCloseTo(519.3 / 1500, 3);
    expect($$(spent, ".pv-budget-legend").map(text)).toEqual(["Food$158", "Vehicle$99"]);
    const over = previewWidget(
      "budget",
      "B",
      {
        currency: "USD",
        total: { spent: "120", budget: "100" },
        categories: [{ label: "Over", spent: "30.5", budget: "10" }, { spent: "4" }],
      },
      "small",
    );
    expect(text($(over, ".pv-hero"))).toBe("-$20.00");
    expect(css($(over, ".pv-hero"))).toContain(`color:${COLOR_HEX.red}`);
    expect(arc($(over, '[data-slot="ring"]'))).toBe(0);
    // A legend's remainder is red too; one without a label is its amount.
    const legends = $$(over, ".pv-budget-legend");
    expect(legends.map(text)).toEqual(["Over-$20", "$4"]);
    expect(css($(legends[0]!, ".pv-budget-amount"))).toContain(`color:${COLOR_HEX.red}`);
    expect(css($(legends[1]!, ".pv-budget-amount"))).toContain(`color:${WP.primary}`);
    // Spent mode shows no red.
    const calm = previewWidget(
      "budget",
      "B",
      {
        currency: "USD",
        display: "spent",
        total: { spent: "120", budget: "100" },
      },
      "small",
    );
    expect(css($(calm, ".pv-hero"))).not.toContain(COLOR_HEX.red);
    expect(arc($(calm, '[data-slot="ring"]'))).toBe(1);
  });

  it("draws a total without a budget as its icon in a chip, and a part of the meta line alone", () => {
    const el = previewWidget(
      "budget",
      "B",
      {
        currency: "EUR",
        total: { spent: "5", icon: { name: "cart.fill", primary_color: "teal" } },
        subtitle: { value: "This week" },
        categories: [{ label: "One", spent: "1" }],
      },
      "small",
    );
    // No ring: the plain chip, half the size its glyph, in the icon's
    // color (which is also what an uncolored category falls back to).
    const chip = $(el, '[data-slot="ring"]');
    expect(chip.matches(".pv-chip")).toBe(true);
    expect(chip.querySelector("svg")).toBeNull();
    expect(css(chip)).toContain("width:29px;height:29px;font-size:14.5px");
    expect(css(chip)).toContain(`color:${COLOR_HEX.teal}`);
    expect(text($(el, ".pv-hero"))).toBe("€5.00");
    expect($$($(el, '[data-slot="meta"]'), "span").map(text)).toEqual(["This week"]);
    expect($$(el, ".pv-budget-legend").length).toBe(1);
    expect(css($(el, ".pv-budget-legend .pv-budget-label"))).toContain(`color:${COLOR_HEX.teal}`);
    const budgeted = previewWidget(
      "budget",
      "B",
      {
        currency: "USD",
        total: { spent: "5", budget: "20" },
      },
      "small",
    );
    expect($$($(budgeted, '[data-slot="meta"]'), "span").map(text)).toEqual(["of $20"]);
    // The total's icon is its own, else the widget's; the accent wins
    // over an icon's color, and without either it is the app's.
    const widgetIcon = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "5", budget: "20" },
        icon: { name: "cart.fill", primary_color: "teal" },
      },
      "small",
    );
    expect($(widgetIcon, "svg").outerHTML).toContain(`stroke="${COLOR_HEX.teal}"`);
    const accented = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "5", budget: "20", icon: { name: "cart.fill", primary_color: "teal" } },
        accent: "orange",
      },
      "small",
    );
    expect($(accented, "svg").outerHTML).toContain(`stroke="${COLOR_HEX.teal}"`);
    const ownIcon = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "5", budget: "20", icon: "cart.fill" },
        icon: { name: "bolt", primary_color: "teal" },
        categories: [{ label: "One", spent: "1" }],
      },
      "small",
    );
    expect($(ownIcon, "svg").outerHTML).toContain(`stroke="${SYSTEM_BLUE}"`);
    expect(css($(ownIcon, ".pv-budget-legend .pv-budget-label"))).toContain(`color:${SYSTEM_BLUE}`);
  });

  it("keeps every region pressable with nothing bound", () => {
    const el = previewWidget("budget", "B", {}, "small");
    expect(text($(el, ".pv-hero"))).toBe("$0.00");
    // The bare track stands in for the ring; the rest are placeholders.
    const ring = $(el, '[data-slot="total"] [data-slot="ring"]');
    expect($$(ring, "circle").length).toBe(1);
    expect($$(el, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta", "categories"]);
    expect(regionFields(el)).toEqual(REGIONS);
  });
});

describe("budget: medium", () => {
  it("draws the total block beside three category rows", () => {
    const el = previewWidget("budget", "Monthly budget", DOCS, "medium");
    const [lead, rows] = $$(el, ".pv-canvas.is-medium > .pv-budget-split > *");
    expect($$(lead!, ":scope > *").map((k) => k.className)).toEqual([
      "pv-name pv-budget-name",
      "pv-budget-total",
      "pv-meta pv-budget-meta",
    ]);
    expect(text($(lead!, ".pv-name"))).toBe("Monthly budget");
    // The hero a step up from small, beside the same ring.
    expect(css($(lead!, ".pv-hero"))).toBe("font-size:28px;font-weight:400;");
    expect(text($(lead!, ".pv-hero"))).toBe("$980.70");
    expect(css($(lead!, '[data-slot="ring"]'))).toContain("width:29px");
    expect(text($(lead!, '[data-slot="meta"]'))).toBe("of $1,500 · 20 days left");
    // Three of the four categories: a 24 pt ring in the category's
    // color, the label over the amount in full.
    expect(rows!.matches('.pv-budget-rows[data-slot="categories"]')).toBe(true);
    const entries = $$(rows!, ".pv-budget-row");
    expect(entries.map((r) => text($(r, ".pv-budget-text")))).toEqual([
      "Food$142.40",
      "Vehicle$101.30",
      "Gadgets$54.80",
    ]);
    expect(entries.map((r) => css(r.firstElementChild!))).toEqual(
      [1, 2, 3].map(() => expect.stringContaining("width:24px")),
    );
    expect(entries.map((r) => $(r, "svg").outerHTML)).toEqual(
      [COLOR_HEX.blue, COLOR_HEX.green, COLOR_HEX.pink].map((color) =>
        expect.stringContaining(`stroke="${color}"`),
      ),
    );
    expect(arc(entries[0]!)).toBeCloseTo(142.4 / 300, 3);
    expect(el.querySelector("[data-ghost]")).toBeNull();
    expect(regionFields(el)).toEqual(REGIONS);
  });

  it("draws a category without a budget as its icon in a chip, or its text alone", () => {
    const el = previewWidget(
      "budget",
      "B",
      {
        currency: "USD",
        total: { spent: "5", budget: "20" },
        accent: "purple",
        categories: [
          { label: "Iconed", spent: "12", icon: "cart.fill" },
          { label: "Plain", spent: "3.5" },
          { spent: "120", budget: "100", icon: "bolt" },
        ],
      },
      "medium",
    );
    const entries = $$(el, ".pv-budget-row");
    expect(entries.map((r) => r.children.length)).toEqual([2, 1, 2]);
    // The chip: 24 pt, its glyph at half that, in the widget's accent.
    const chip = $(entries[0]!, ".pv-chip");
    expect(css(chip)).toContain("width:24px;height:24px;font-size:12px");
    expect(css(chip)).toContain(`color:${COLOR_HEX.purple}`);
    expect(entries[0]!.querySelector("svg")).toBeNull();
    expect(entries.map((r) => text($(r, ".pv-budget-amount")))).toEqual([
      "$12.00",
      "$3.50",
      "-$20.00",
    ]);
    expect(css($(entries[2]!, ".pv-budget-amount"))).toContain(`color:${COLOR_HEX.red}`);
    expect(css($(entries[0]!, ".pv-budget-amount"))).toBe("");
    expect(entries[2]!.querySelector(".pv-budget-label")).toBeNull();
  });

  it("keeps every region pressable with nothing bound", () => {
    const el = previewWidget("budget", "B", {}, "medium");
    expect($(el, '[data-slot="total"] [data-slot="ring"]')).toBeTruthy();
    expect($$(el, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta", "categories"]);
    expect(regionFields(el)).toEqual(REGIONS);
    // Categories alone leave only the meta line a placeholder.
    const rows = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "5" },
        categories: [{ label: "One", spent: "1" }],
      },
      "medium",
    );
    expect($$(rows, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta"]);
  });
});

describe("budget: the fit to the laid-out width", () => {
  // happy-dom lays nothing out, so the widths are given here: a line's
  // box is `box` wide and its text half its type size per character.
  const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  afterEach(() => {
    if (rangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRect);
  });

  function layOut(el: HTMLElement, box: (line: HTMLElement) => number): HTMLElement[] {
    const hidden = (line: HTMLElement): boolean => {
      const fit = line.parentElement?.dataset["fit"];
      return (
        (fit === "subtitle" && !line.matches(".pv-budget-subtitle")) ||
        (fit === "budget" && !line.matches(".pv-budget-of"))
      );
    };
    const size = (line: HTMLElement): number =>
      parseFloat(line.style.fontSize) || (line.matches(".pv-budget-subtitle") ? 11 : 12);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        const line = this.startContainer as HTMLElement;
        return { width: hidden(line) ? 0 : text(line).length * size(line) * 0.5 };
      },
    });
    const block = $$(el, ".pv-budget-name, .pv-budget-total, .pv-budget-meta");
    for (const line of $$(
      el,
      ".pv-budget-name, .pv-budget-hero, .pv-budget-meta, .pv-budget-meta > span",
    )) {
      Object.defineProperty(line, "clientWidth", { configurable: true, get: () => box(line) });
      line.getBoundingClientRect = () =>
        ({
          width: line.matches("span")
            ? Math.min(box(line), text(line).length * size(line) * 0.5)
            : box(line),
        }) as DOMRect;
    }
    return block;
  }

  it("leaves a block that fits as it is", () => {
    const el = previewWidget("budget", "Monthly budget", DOCS, "medium");
    fitBudgetTotal(
      layOut(el, () => 200),
      28,
    );
    expect(css($(el, ".pv-budget-name"))).toBe("font-size:15px;");
    expect(css($(el, ".pv-budget-hero"))).toContain("font-size:28px");
    expect($(el, ".pv-budget-meta").hasAttribute("data-fit")).toBe(false);
  });

  it("scales the hero and the name down to their floors, then lets them truncate", () => {
    const el = previewWidget("budget", "Monthly budget", DOCS, "small");
    // "$980.70" is 91 pt wide at 26 and has 89, of which half a point is
    // kept clear: it fits at 25.28.
    fitBudgetTotal(
      layOut(el, (line) => (line.matches(".pv-budget-hero") ? 89 : 126)),
      26,
    );
    expect(css($(el, ".pv-budget-hero"))).toContain("font-size:25.28px");
    expect(css($(el, ".pv-budget-name"))).toBe("font-size:15px;");
    // Far too wide: the hero stops at 60 %, the name at 80 %.
    const tight = previewWidget("budget", "A name that is far too long to fit", DOCS, "small");
    fitBudgetTotal(
      layOut(tight, () => 30),
      26,
    );
    expect(css($(tight, ".pv-budget-hero"))).toContain("font-size:15.6px");
    expect(css($(tight, ".pv-budget-name"))).toBe("font-size:12px;");
    // A second pass starts over from the full size.
    fitBudgetTotal(
      layOut(tight, () => 400),
      26,
    );
    expect(css($(tight, ".pv-budget-hero"))).toContain("font-size:26px");
    expect(css($(tight, ".pv-budget-name"))).toBe("font-size:15px;");
  });

  it("drops the budget from a meta line that does not fit, then the subtitle", () => {
    const el = previewWidget("budget", "B", DOCS, "small");
    const meta = $(el, ".pv-budget-meta");
    // The three parts want 54 + 6 + 66 pt; each is given a 40 pt box.
    const narrow = (line: HTMLElement): number => (line.matches(".pv-budget-meta") ? 126 : 40);
    const roomy = (line: HTMLElement): number =>
      line.matches(".pv-budget-subtitle") ? 70 : narrow(line);
    fitBudgetTotal(layOut(el, roomy), 26);
    expect(meta.dataset["fit"]).toBe("subtitle");
    // The subtitle alone does not fit either: the budget, truncated.
    fitBudgetTotal(layOut(el, narrow), 26);
    expect(meta.dataset["fit"]).toBe("budget");
    // Wide again: the pair comes back.
    fitBudgetTotal(
      layOut(el, () => 300),
      26,
    );
    expect(meta.hasAttribute("data-fit")).toBe(false);
    // A lone part has nothing to drop; before layout nothing is measured.
    const lone = previewWidget("budget", "B", { total: { spent: "1", budget: "2" } }, "small");
    fitBudgetTotal(
      layOut(lone, () => 10),
      26,
    );
    expect($(lone, ".pv-budget-meta").hasAttribute("data-fit")).toBe(false);
    const unlaid = previewWidget("budget", "B", DOCS, "small");
    fitBudgetTotal($$(unlaid, ".pv-budget-name, .pv-budget-total, .pv-budget-meta"), 26);
    expect($(unlaid, ".pv-budget-meta").hasAttribute("data-fit")).toBe(false);
  });
});
