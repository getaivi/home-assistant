// The medium widget renderers. Payloads are built inline against the
// wire types, after the docs' own examples; the samples also run through
// the integration's recorded answers.

import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE } from "../src/const";
import { energyNodes } from "../src/preview/energy";
import { prefersDarkInk } from "../src/preview/switchboard";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import type { WidgetContent } from "../src/types/content";
import {
  $,
  $$,
  css,
  mountPanel,
  openWidgetEditor,
  resolvedSample,
  sr,
  text,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.useRealTimers();
});

/** The fields each painted region of a widget leads to, by region. */
function regionFields(template: string, el: HTMLElement): Record<string, string[]> {
  return Object.fromEntries(
    $$(el, "[data-slot]").map((region) => {
      const id = region.dataset["slot"] ?? "";
      return [id, slotById("widget", template, id)?.fields ?? []];
    }),
  );
}

describe("medium: energy", () => {
  // The docs' example: solar exporting to the grid, the battery charging.
  const content: WidgetContent = {
    sources: [{ power: 3200, today: 12.4 }],
    grid: { power: -1400, today: 3.1 },
    battery: { power: 800, level: 76 },
    home: { power: 1000, today: 9.8 },
  };

  it("lines up all four nodes: chip, power, label", () => {
    const el = previewWidget("energy", "Energy", content, "medium");
    expect($(el, ".pv-canvas").classList.contains("is-medium")).toBe(true);
    const cols = $$(el, ".pv-cols > .pv-col");
    expect(cols.map((c) => c.dataset["node"])).toEqual(["source", "grid", "battery", "home"]);
    expect(cols.map((c) => text($(c, ".pv-col-value")))).toEqual([
      "3.2 kW",
      "-1.4 kW",
      "800 W",
      "1 kW",
    ]);
    // The battery captions its charge beside its label.
    expect(cols.map((c) => text($(c, ".pv-col-caption")))).toEqual([
      "Solar",
      "Grid",
      "Battery 76%",
      "Home",
    ]);
    // Each chip in its kind's color; an exporting grid reads green.
    expect(cols.map((c) => css($(c, ".pv-chip")))).toEqual(
      [COLOR_HEX.yellow, COLOR_HEX.green, COLOR_HEX.mint, COLOR_HEX.blue].map((color) =>
        expect.stringContaining(`color:${color}`),
      ),
    );
    // No name at this size, and the row is the one region.
    expect($$(el, ".pv-name")).toHaveLength(0);
    expect($(el, '[data-slot="hero"]')).toBe($(el, ".pv-cols"));
    expect($$(el, "[data-slot]")).toHaveLength(1);
  });

  it("draws the integration's own payload, a renamed source included", async () => {
    const resolved = await resolvedSample("energy", "energy-dashboard");
    const el = previewWidget("energy", "Energy", resolved, "medium");
    const caps = $$(el, ".pv-col-caption").map(text);
    expect(caps).toHaveLength(energyNodes(resolved).length);
    expect(caps[0]).toBe("Roof");
    expect(caps[caps.length - 1]).toBe("Home");
  });

  it("shows every node present and scales a line down only where it is too wide", () => {
    // Lay text out for the renderer's ruler: half its font size a character.
    const laidOut = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width =
          (this.textContent ?? "").length * (parseFloat(this.style.fontSize) || 0) * 0.5;
        return {
          width,
          height: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 0,
          x: 0,
          y: 0,
        } as DOMRect;
      });
    const six = previewWidget(
      "energy",
      "Energy",
      {
        ...content,
        sources: [{ power: 1 }, { power: 2, name: "Wind" }, { power: 3, color: "red" }],
      },
      "medium",
    );
    expect($$(six, ".pv-col")).toHaveLength(6);
    // "1 W" fits a sixth of the row; "Battery 76%" has to shrink.
    expect(css($(six, ".pv-col-value"))).toContain("font-size:15px");
    expect(parseFloat($(six, '[data-node="battery"] .pv-col-caption').style.fontSize)).toBeLessThan(
      12,
    );
    laidOut.mockRestore();
    expect($$(six, ".pv-col-caption").map(text).slice(0, 3)).toEqual(["Solar", "Wind", "Solar"]);
    const one = previewWidget("energy", "Energy", { grid: { power: 500 } }, "medium");
    expect($$(one, ".pv-col")).toHaveLength(1);
    expect(css($(one, ".pv-chip"))).toContain(`color:${COLOR_HEX.orange}`);
    expect(css($(one, ".pv-col-value"))).toContain("font-size:15px");
  });

  it("keeps the placeholders with nothing bound", () => {
    const none = previewWidget("energy", "Energy", {}, "medium");
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero", "caption"]);
  });
});

describe("medium: switchboard", () => {
  // The docs' six: an idle button with a gradient, an active one, an
  // open garage door, a camera with a picture, a warm light, a pump off.
  const content: WidgetContent = {
    actions: [
      {
        id: "morning",
        label: "Morning",
        icon: "sunrise.fill",
        kind: "button",
        gradient: ["#FFF3C4", "#FFD27A"],
        subtitle: { value: "Kitchen" },
      },
      {
        id: "evening",
        label: "Evening",
        icon: "sunset.fill",
        kind: "button",
        active: true,
        gradient: ["#FF9F5A", "#FF5E8A"],
      },
      {
        id: "garage",
        label: "Garage door",
        icon: "door.garage.open",
        kind: "toggle",
        on: true,
        color: "orange",
        subtitle: { value: "Driveway" },
        state_text: { on: "Open", off: "Closed" },
      },
      {
        id: "dogcam",
        label: "Dog cam",
        icon: "video.fill",
        kind: "toggle",
        on: true,
        color: "#A2795B",
        image: { url: "https://example.com/dog.jpg" },
        subtitle: { value: "Hallway" },
      },
      {
        id: "porch",
        label: "Porch light",
        icon: "lightbulb.fill",
        kind: "toggle",
        on: true,
        gradient: ["#FFE4AD", "#FFAE5E"],
        subtitle: { value: "2700 K" },
      },
      {
        id: "fountain",
        label: "Fountain",
        icon: "drop.fill",
        kind: "toggle",
        on: false,
        subtitle: { value: "Garden" },
      },
      { id: "feeder", label: "Cat feeder", icon: "fish.fill", kind: "button" },
    ],
  };

  it("draws the first six as a 2 x 3 grid, each with its second line", () => {
    const el = previewWidget("switchboard", "Living room", content, "medium");
    const tiles = $$(el, ".pv-switchboard-grid.is-three-rows > .pv-switchboard-tile.is-row");
    expect(tiles).toHaveLength(6);
    expect(tiles.map((tile) => text($(tile, ".pv-switchboard-label")))).toEqual([
      "Morning",
      "Evening",
      "Garage door",
      "Dog cam",
      "Porch light",
      "Fountain",
    ]);
    // The state word and the subtitle together; an idle button its
    // subtitle; an off toggle the word alone; a tile's own words win.
    expect(tiles.map((tile) => text($(tile, ".pv-switchboard-second")))).toEqual([
      "Kitchen",
      "Active",
      "Open · Driveway",
      "On · Hallway",
      "On · 2700 K",
      "Off",
    ]);
    expect(tiles.map((tile) => tile.classList.contains("is-on"))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(tiles[2]!.getAttribute("aria-label")).toBe("Garage door, on");
    expect(tiles[0]!.getAttribute("aria-label")).toBe("Morning");
    // No name at this size; the grid is the region.
    expect($$(el, ".pv-name")).toHaveLength(0);
    expect($(el, '[data-slot="grid"]')).toBe($(el, ".pv-switchboard-grid"));
  });

  it("fills a lit tile from the trailing corner and inks it for contrast", () => {
    const el = previewWidget("switchboard", "Living room", content, "medium");
    const tiles = $$(el, ".pv-switchboard-tile.is-row");
    const fill = (i: number): string => css(tiles[i]!);
    // Off and idle: the neutral plate.
    expect(fill(0)).toContain("rgba(235,235,245,.18)");
    expect(fill(5)).toContain("rgba(235,235,245,.18)");
    expect(fill(1)).toContain("linear-gradient(284.2deg,#FF9F5A,#FF5E8A)");
    expect(fill(2)).toContain(COLOR_HEX.orange);
    // Dark ink on the pale fills (orange, warm white), white on the rest.
    expect(fill(1)).toContain("color:#fff");
    expect(fill(2)).toContain("color:#1c1c1f");
    expect(fill(3)).toContain("color:#fff");
    expect(fill(4)).toContain("color:#1c1c1f");
    expect(fill(0)).not.toContain("color:#");
    expect(prefersDarkInk(["#FFFFFF"])).toBe(true);
    expect(prefersDarkInk(["#000000", "#FFFFFF"])).toBe(true);
    expect(prefersDarkInk(["#0091FF"])).toBe(false);
    expect(prefersDarkInk(["var(--x)"])).toBe(false);
    expect(prefersDarkInk([])).toBe(false);
  });

  it("marks: the gradient alone, the glyph on its color, muted when off", () => {
    const el = previewWidget("switchboard", "Living room", content, "medium");
    const orbs = $$(el, ".pv-switchboard-tile.is-row .pv-switchboard-orb");
    // A gradient mark carries no glyph; the orb's runs the other way.
    expect(text(orbs[0]!)).toBe("");
    expect(css(orbs[0]!)).toContain("linear-gradient(135deg,#FFF3C4,#FFD27A)");
    expect(text(orbs[2]!)).toBe("✦");
    expect(css(orbs[2]!)).toContain(COLOR_HEX.orange);
    // The picture is the phone's to fetch; the preview marks the orb.
    expect(orbs[3]!.classList.contains("has-picture")).toBe(true);
    // An off toggle: a quiet disc with a secondary glyph.
    expect(text(orbs[5]!)).toBe("✦");
    expect(css(orbs[5]!)).toContain("rgba(235,235,245,.18)");
  });

  it("keeps the anatomy with fewer than six, and the accent as the fill", () => {
    const el = previewWidget(
      "switchboard",
      "S",
      {
        actions: [
          { id: "a", label: "A", icon: "power", kind: "toggle", on: true },
          { id: "b", label: "B", icon: "play", kind: "button" },
          {
            id: "c",
            label: "C",
            icon: "power",
            kind: "toggle",
            on: true,
            state_text: { on: "" },
            subtitle: { value: "Hall" },
          },
        ],
      },
      "medium",
    );
    const cells = $$(el, ".pv-switchboard-grid > div");
    expect(cells).toHaveLength(6);
    expect(css(cells[0]!)).toContain(SYSTEM_BLUE);
    expect(text($(cells[0]!, ".pv-switchboard-second"))).toBe("On");
    // An idle button with no subtitle keeps a blank second line.
    expect(($(cells[1]!, ".pv-switchboard-second").textContent ?? "").trim()).toBe("");
    // A hidden state word leaves the subtitle.
    expect(text($(cells[2]!, ".pv-switchboard-second"))).toBe("Hall");
    expect(cells.slice(3).every((c) => c.classList.contains("is-empty"))).toBe(true);
    expect(
      $$(previewWidget("switchboard", "S", {}, "medium"), ".pv-switchboard-tile.is-empty"),
    ).toHaveLength(6);
  });
});

describe("medium: list", () => {
  const content: WidgetContent = {
    rows: [
      {
        label: "Living room",
        value: { value: "21.4°" },
        icon: { name: "thermometer.medium", primary_color: "orange" },
      },
      { label: "Front door", value: { value: "Locked", text_color: "green" }, icon: "lock.fill" },
      { label: "Humidity", value: { value: "54%" } },
      { label: "Garage", value: { value: "Closed" }, icon: "door.garage.closed" },
      { label: "Outdoor", value: { value: "12°" } },
    ],
  };

  it("draws four rows with their labels: icon, label, value", () => {
    const el = previewWidget("list", "Home", content, "medium");
    const rows = $$(el, ".pv-list-rows > .pv-list-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => text($(r, ".pv-list-label")))).toEqual([
      "Living room",
      "Front door",
      "Humidity",
      "Garage",
    ]);
    expect(rows.map((r) => text($(r, ".pv-list-value")))).toEqual([
      "21.4°",
      "Locked",
      "54%",
      "Closed",
    ]);
    expect(css($(rows[1]!, ".pv-list-value"))).toContain(`color:${COLOR_HEX.green}`);
    // The icon slot exists only on a row that has an icon.
    expect(rows.map((r) => $$(r, "span").length)).toEqual([3, 3, 2, 3]);
    expect(css($$(rows[0]!, "span")[0]!)).toContain(`color:${COLOR_HEX.orange}`);
    expect(text($(el, ".pv-name"))).toBe("Home");
    expect(text($(el, ".pv-meta"))).toBe("+1");
    expect($(el, '[data-slot="rows"]')).toBe($(el, ".pv-list-rows"));
  });

  it("a row without a value is its label alone; no rows keeps the region", () => {
    const el = previewWidget("list", "Home", { rows: [{ label: "Only a label" }] }, "medium");
    expect($$(el, ".pv-list-row span").map(text)).toEqual(["Only a label"]);
    expect(el.querySelector(".pv-meta")).toBeNull();
    const none = previewWidget("list", "Home", {}, "medium");
    expect($(none, '[data-slot="rows"]')).toBeTruthy();
    expect($$(none, ".pv-list-row")).toHaveLength(0);
  });
});

describe("medium: battery", () => {
  it("draws four ring columns with the percent under each", () => {
    const el = previewWidget(
      "battery",
      "Batteries",
      {
        devices: [
          { name: "Fan", level: 68.4, icon: "fan.fill" },
          { name: "Lock", level: 45, charging: true },
          { name: "Sensor", level: 12 },
        ],
      },
      "medium",
    );
    const cols = $$(el, ".pv-cols > .pv-col");
    expect(cols).toHaveLength(4);
    expect(cols.slice(0, 3).map((c) => text($(c, ".pv-col-value")))).toEqual(["68%", "45%", "12%"]);
    expect($$(el, "svg")).toHaveLength(3);
    expect($$(el, "svg")[2]!.outerHTML).toContain(`stroke="${COLOR_HEX.red}"`);
    // The empty column keeps a quiet ring and an invisible metric line.
    expect(cols[3]!.querySelector("svg")).toBeNull();
    expect(css($(cols[3]!, ".pv-col-value"))).toContain("visibility:hidden");
    expect($(el, '[data-slot="grid"]')).toBe($(el, ".pv-cols"));
  });
});

describe("medium: list, as bound in the harness", () => {
  it("opens the ?more=1 list at Medium, and its rows lead to their field", async () => {
    history.replaceState(null, "", "/?more=1");
    const panel = await mountPanel();
    await openWidgetEditor(panel, "home");
    const root = sr(panel);
    expect(
      $$(root, "aivi-preview-pane .phead .seg button").map((o) => o.getAttribute("aria-checked")),
    ).toEqual(["false", "true"]);
    const rows = $$(root, ".pv-stage .pv-canvas.is-medium .pv-list-rows > .pv-list-row");
    expect(rows.map((r) => text($(r, ".pv-list-label")))).toEqual([
      "Living room",
      "Front door",
      "Humidity",
      "Garage",
    ]);
    expect(rows.map((r) => text($(r, ".pv-list-value")))).toEqual([
      "21.4",
      "jammed",
      "54",
      "closed",
    ]);
    // Three rows carry an icon, one starts at the leading edge.
    expect(rows.map((r) => $$(r, "span").length)).toEqual([3, 3, 2, 3]);
    const region = $(root, '.pv-stage [data-slot="rows"]');
    expect(region.getAttribute("role")).toBe("button");
    region.click();
    await until(() => !!root.querySelector("aivi-field-row.flash"), "a flashed row");
    expect($$(root, "aivi-field-row.flash").map((r) => r.dataset["key"])).toEqual(["rows"]);
  });
});

describe("medium: budget", () => {
  // The docs' example: $980.70 left of $1,500, and the categories.
  const content: WidgetContent = {
    total: { spent: "519.30", budget: "1500", icon: "banknote.fill", color: "yellow" },
    categories: [
      { label: "Food", spent: "157.60", budget: "300", icon: "fork.knife", color: "blue" },
      { label: "Vehicle", spent: "98.70", budget: "200", icon: "car.fill", color: "green" },
      { label: "Gadgets", spent: "245.20", budget: "300", icon: "headphones", color: "pink" },
      { label: "Sports", spent: "20", budget: "50" },
    ],
    currency: "USD",
    subtitle: { value: "20 days left" },
  };

  it("draws the total beside three category rows, each with its ring", () => {
    const el = previewWidget("budget", "Monthly budget", content, "medium");
    const [lead, rows] = $$(el, ".pv-canvas.is-medium > .pv-split > *");
    expect(text($(lead!, ".pv-name"))).toBe("Monthly budget");
    // The total block: the 29 pt ring beside the hero, a step up from small.
    const total = $(lead!, '[data-slot="total"]');
    expect(text($(total, ".pv-hero"))).toBe("$980.70");
    expect(css($(total, ".pv-hero"))).toContain("font-size:28px");
    const ring = $(total, '[data-slot="ring"]');
    expect(css(ring)).toContain("width:29px");
    expect($(ring, "svg").outerHTML).toContain(`stroke="${COLOR_HEX.yellow}"`);
    expect(text(ring)).toBe("✦");
    // The budget and the subtitle share the meta line.
    expect($$($(lead!, '[data-slot="meta"]'), "span").map(text)).toEqual([
      "of $1,500",
      "·",
      "20 days left",
    ]);
    // Three rows, amounts in full, each ring in its category's color.
    expect(rows!.matches('.pv-budget-rows[data-slot="categories"]')).toBe(true);
    const entries = $$(rows!, ".pv-budget-row");
    expect(entries.map((r) => text($(r, ".pv-budget-label")))).toEqual([
      "Food",
      "Vehicle",
      "Gadgets",
    ]);
    expect(entries.map((r) => text($(r, ".pv-budget-amount")))).toEqual([
      "$142.40",
      "$101.30",
      "$54.80",
    ]);
    expect(entries.map((r) => $(r, "svg").outerHTML)).toEqual(
      [COLOR_HEX.blue, COLOR_HEX.green, COLOR_HEX.pink].map((color) =>
        expect.stringContaining(`stroke="${color}"`),
      ),
    );
    expect(css(entries[0]!.firstElementChild!)).toContain("width:24px");
    expect(regionFields("budget", el)).toEqual({
      total: ["spent", "currency"],
      ring: ["display", "total_color"],
      meta: ["budget", "subtitle"],
      categories: ["categories"],
    });
  });

  it("draws a category without a budget as its icon, or its text alone", async () => {
    const el = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "5" },
        currency: "USD",
        display: "remaining",
        categories: [
          { label: "Iconed", spent: "12", icon: { name: "cart.fill", primary_color: "teal" } },
          { label: "Plain", spent: "3.5" },
          { spent: "120", budget: "100" },
        ],
      },
      "medium",
    );
    const entries = $$(el, ".pv-budget-row");
    expect(entries.map((r) => r.children.length)).toEqual([2, 1, 2]);
    const chip = $(entries[0]!, ".pv-chip");
    expect(css(chip)).toContain(`color:${COLOR_HEX.teal}`);
    expect(entries[0]!.querySelector("svg")).toBeNull();
    // No budget headlines what was spent; an overspent remainder is red;
    // a row without a label is its amount alone.
    expect(entries.map((r) => text($(r, ".pv-budget-amount")))).toEqual([
      "$12.00",
      "$3.50",
      "-$20.00",
    ]);
    expect(css($(entries[2]!, ".pv-budget-amount"))).toContain(`color:${COLOR_HEX.red}`);
    expect(entries[2]!.querySelector(".pv-budget-label")).toBeNull();
    // Without a budget or a subtitle the meta line is a placeholder.
    expect($$(el, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta"]);
    // The integration's own payload: one category budgeted, one not.
    const resolved = previewWidget(
      "budget",
      "Spending",
      await resolvedSample("budget", "budget-categories"),
      "medium",
    );
    expect(text($(resolved, '[data-slot="total"]'))).toBe("$980.70");
    expect($$($(resolved, '[data-slot="meta"]'), "span").map(text)).toEqual([
      "of $1,500",
      "·",
      "Washing",
    ]);
    expect($$(resolved, ".pv-budget-row .pv-budget-text").map(text)).toEqual([
      "Food$142.40",
      "Car$98.70",
    ]);
    expect($$(resolved, ".pv-budget-row").map((r) => !!r.querySelector("svg"))).toEqual([
      true,
      false,
    ]);
  });

  it("keeps every region with nothing bound, and steps a long total down", () => {
    const none = previewWidget("budget", "B", {}, "medium");
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta", "categories"]);
    expect($(none, '[data-slot="total"] [data-slot="ring"]')).toBeTruthy();
    const over = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "1234567.5", budget: "100" },
        currency: "USD",
        subtitle: { value: "Soon" },
      },
      "medium",
    );
    const hero = $(over, '[data-slot="total"] .pv-hero');
    expect(text(hero)).toBe("-$1,234,467.50");
    // The step down is measured once the canvas is laid out
    // (preview-budget.test.ts); until then the hero is at its size.
    expect(css(hero)).toContain("font-size:28px");
    expect(css(hero)).toContain(`color:${COLOR_HEX.red}`);
    expect($$($(over, '[data-slot="meta"]'), "span").map(text)).toEqual(["of $100", "·", "Soon"]);
    const spent = previewWidget(
      "budget",
      "B",
      {
        total: { spent: "120", budget: "100" },
        currency: "USD",
        display: "spent",
      },
      "medium",
    );
    expect(css($(spent, '[data-slot="total"] .pv-hero'))).not.toContain(COLOR_HEX.red);
    expect($$($(spent, '[data-slot="meta"]'), "span").map(text)).toEqual(["of $100"]);
  });
});

describe("medium: prices", () => {
  // A day of hourly prices, after the docs' example.
  const PRICES = [
    14.2, 12.8, 11.9, 11.2, 12.4, 15.8, 22.4, 31.7, 38.2, 33.4, 26.1, 21.8, 18.4, 16.2, 15.1, 17.9,
    24.6, 35.8, 42.9, 39.4, 30.2, 24.8, 19.4, 16.1,
  ];
  const hour = (h: number): string => new Date(Date.UTC(2026, 0, 15, h)).toISOString();
  const content: WidgetContent = {
    entries: PRICES.map((price, h) => ({ start: hour(h), price })),
    unit: "ct/kWh",
  };

  it("draws the current price beside a day of bars", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 15, 15, 30)));
    const el = previewWidget("prices", "Electricity", content, "medium");
    const [lead, chart] = $$(el, ".pv-canvas.is-medium > .pv-split > *");
    expect([...lead!.children].map((c) => c.className)).toEqual([
      "pv-name pv-prices-name",
      "pv-grow",
      "pv-hero pv-prices-hero",
      "pv-state pv-prices-state",
    ]);
    const hero = $(lead!, '[data-slot="hero"]');
    expect(text(hero)).toBe("17.9 ct/kWh");
    expect(css(hero)).toContain("font-size:40px");
    expect(css(hero)).toContain("font-weight:300");
    // A word-length unit stays on the baseline.
    expect(css($(hero, "span"))).not.toContain("vertical-align");
    expect(text($(lead!, ".pv-state"))).toBe("Low");
    expect(css($(lead!, ".pv-state"))).toContain(`color:${COLOR_HEX.green}`);
    // Twenty-four capsules: the past dimmed, the current one at full
    // strength over its dot, what is ahead at half.
    expect(chart!.dataset["slot"]).toBe("chart");
    const bars = $$(chart!, "div:first-child > i");
    expect(bars).toHaveLength(24);
    expect(bars.map((b) => /opacity:([\d.]+)/.exec(css(b))?.[1])).toEqual([
      ...Array(15).fill("0.28"),
      "1",
      ...Array(8).fill("0.5"),
    ]);
    expect(css(bars[18]!)).toContain("height:100%");
    expect(css(bars[18]!)).toContain(COLOR_HEX.red);
    expect(css(bars[3]!)).toContain("height:15%");
    const dots = $$(chart!, "div:last-child > i");
    expect(dots.map((d) => d.children.length)).toEqual([
      ...Array(15).fill(0),
      1,
      ...Array(8).fill(0),
    ]);
    expect(regionFields("prices", el)).toEqual({
      hero: ["entries", "scale", "unit"],
      chart: ["entries"],
    });
  });

  it("windows a longer timeline from the current period on", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 15, 20, 30)));
    const two: WidgetContent = {
      entries: [...PRICES, ...PRICES].map((price, h) => ({ start: hour(h), price, level: "high" })),
    };
    const el = previewWidget("prices", "Electricity", two, "medium");
    const bars = $$(el, '[data-slot="chart"] > div:first-child > i');
    expect(bars).toHaveLength(24);
    // The current period leads the window.
    expect(css(bars[0]!)).toContain("opacity:1");
    expect(text($(el, '[data-slot="hero"]'))).toBe("30.2");
    expect(text($(el, ".pv-state"))).toBe("High");
    // The small family shows twelve of them.
    expect(
      $$(previewWidget("prices", "E", two), '[data-slot="chart"] > div:first-child > i'),
    ).toHaveLength(12);
  });

  it("draws the integration's own payload, and a placeholder with none", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:30:00+01:00"));
    const el = previewWidget(
      "prices",
      "Electricity",
      await resolvedSample("prices", "prices-cents"),
      "medium",
    );
    expect(text($(el, '[data-slot="hero"]'))).toBe("15.1 ct/kWh");
    expect($$(el, '[data-slot="chart"] > div:first-child > i')).toHaveLength(24);
    const none = previewWidget("prices", "Electricity", {}, "medium");
    expect(text($(none, ".pv-name"))).toBe("Electricity");
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero"]);
  });
});

describe("medium: trend", () => {
  // The docs' example: a living room warming up.
  const content: WidgetContent = {
    value: 21.4,
    unit: "°",
    state: { value: "Rising" },
    points: [18.2, 19.1, 20.3, 21.6, 21.2, 20.9, 21.4],
    color: "orange",
    accent: "orange",
  };

  it("draws the reading and its state beside the sparkline", () => {
    const el = previewWidget("trend", "Living room", content, "medium");
    const [lead, chart] = $$(el, ".pv-canvas.is-medium > .pv-split > *");
    expect([...lead!.children].map((c) => c.className)).toEqual([
      "pv-name",
      "pv-grow",
      "pv-hero",
      "pv-state",
    ]);
    const hero = $(lead!, '[data-slot="hero"]');
    expect(text(hero)).toBe("21.4°");
    expect(css(hero)).toContain("font-size:40px");
    // The unit rides at half size, raised toward the cap height.
    expect(css($(hero, "span"))).toContain("font-size:0.5em");
    expect(css($(hero, "span"))).toContain("vertical-align:.56em");
    const caption = $(lead!, '[data-slot="caption"]');
    expect(text(caption)).toBe("Rising");
    expect(css(caption)).toContain(`color:${COLOR_HEX.orange}`);
    // The chart: a clipped area, the line at its own weight however the
    // box stretches, and a dot on the latest point (preview-trend.test.ts
    // has the geometry).
    expect(chart!.matches('.pv-trend-chart[data-slot="chart"]')).toBe(true);
    const [area, line] = [...$(chart!, ".pv-trend-spark").children] as HTMLElement[];
    expect(css(area!)).toContain("clip-path:polygon(calc(0.00%+3.00px)");
    // Seven points and the two feet under the ends.
    expect(/polygon\((.*?)\);background/.exec(css(area!))?.[1]?.split(",")).toHaveLength(9);
    const path = $(line!, "svg path");
    expect(path.getAttribute("stroke")).toBe(COLOR_HEX.orange);
    expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(path.getAttribute("d")?.split("L")).toHaveLength(7);
    expect($(line!, "svg").getAttribute("preserveAspectRatio")).toBe("none");
    const dot = $(line!, "svg path.pv-trend-dot");
    expect(dot.getAttribute("d")).toBe("M100.00 5.88h0");
    expect(dot.getAttribute("stroke")).toBe(COLOR_HEX.orange);
    // Not dimmed, as the small family's strip is.
    expect(css(chart!)).not.toContain("opacity");
    expect(regionFields("trend", el)).toEqual({
      hero: ["value", "unit"],
      caption: ["state"],
      chart: ["points", "min_value", "max_value", "color", "accent"],
    });
  });

  it("draws the integration's own payload, and placeholders with none", async () => {
    const el = previewWidget(
      "trend",
      "Indoor",
      await resolvedSample("trend", "trend-history"),
      "medium",
    );
    expect(text($(el, '[data-slot="hero"]'))).toBe("21.4°C");
    expect(text($(el, '[data-slot="caption"]'))).toBe("Washing");
    expect($(el, '[data-slot="chart"] svg path').getAttribute("stroke")).toBe(COLOR_HEX.orange);
    const none = previewWidget("trend", "Indoor", {}, "medium");
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual([
      "hero",
      "caption",
      "chart",
    ]);
    // The line falls back to the accent, the state to it too.
    const plain = previewWidget(
      "trend",
      "T",
      { value: 3, state: { value: "Flat" }, points: [1, 2] },
      "medium",
    );
    expect($(plain, '[data-slot="chart"] svg path').getAttribute("stroke")).toBe(SYSTEM_BLUE);
    expect(css($(plain, '[data-slot="caption"]'))).toContain(`color:${SYSTEM_BLUE}`);
  });
});
