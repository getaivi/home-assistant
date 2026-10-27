// The Energy widget's preview (preview/energy.ts) against the app's
// Energy template: what Small headlines, Medium's row of nodes, each
// kind's defaults, the power format, the partial and empty states, and
// the regions that press through to the form.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, WP } from "../src/const";
import { energyHeadline, energyNodes, formatEnergy, formatPower } from "../src/preview/energy";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import type { Bindings } from "../src/types/bindings";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, makeHass, text } from "./harness";

// Home Assistant defines <ha-icon>; here a bare element stands in, so the
// chips draw their approximate icons.
customElements.define("ha-icon", class extends HTMLElement {});

// The docs' example: solar exporting to the grid, the battery charging.
const DOCS: WidgetContent = {
  sources: [{ power: 3200, today: 12.4 }],
  grid: { power: -1400, today: 3.1 },
  battery: { power: 800, level: 76 },
  home: { power: 1000, today: 9.8 },
};

const small = (content: WidgetContent, name = "Energy") =>
  previewWidget("energy", name, content, "small");
const medium = (content: WidgetContent, name = "Energy") =>
  previewWidget("energy", name, content, "medium");
const icon = (chip: Element) => chip.querySelector("ha-icon")?.getAttribute("icon") ?? text(chip);
const fontSize = (el: HTMLElement) => parseFloat(el.style.fontSize);

/** Lay text out for the ruler the renderer measures with (happy-dom lays
 * nothing out): every character 0.58 (semibold) or 0.53 of its font size wide. */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const size = parseFloat(this.style.fontSize) || 0;
    const width =
      (this.textContent ?? "").length * size * (Number(this.style.fontWeight) >= 600 ? 0.58 : 0.53);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("energy: readings", () => {
  it("writes whole watts below 950 and kilowatts from there, sign kept", () => {
    expect(formatPower(640)).toBe("640 W");
    expect(formatPower(949)).toBe("949 W");
    expect(formatPower(950)).toBe("1 kW");
    // A tie takes the even digit, as the app's number format does.
    expect(formatPower(1250)).toBe("1.2 kW");
    expect(formatPower(1350)).toBe("1.4 kW");
    expect(formatPower(1000)).toBe("1 kW");
    expect(formatPower(3200)).toBe("3.2 kW");
    expect(formatPower(12400)).toBe("12.4 kW");
    // Exporting and discharging read negative.
    expect(formatPower(-1400)).toBe("-1.4 kW");
    expect(formatPower(-800)).toBe("-800 W");
    expect(formatPower(0)).toBe("0 W");
    expect(formatPower(-0.3)).toBe("0 W");
    // A half rounds away from zero, as the app does.
    expect(formatPower(640.5)).toBe("641 W");
    expect(formatPower(-640.5)).toBe("-641 W");
  });

  it("writes today's energy with at most one decimal", () => {
    expect(formatEnergy(9.8)).toBe("9.8 kWh");
    expect(formatEnergy(12)).toBe("12 kWh");
    expect(formatEnergy(3.14)).toBe("3.1 kWh");
  });

  it("orders the nodes sources, grid, battery, home, each in its color", () => {
    const nodes = energyNodes({
      home: { power: 1 },
      battery: { power: 1 },
      grid: { power: 1 },
      sources: [
        { power: 1 },
        { power: 2, color: "teal" },
        { power: 3, icon: { name: "wind", primary_color: "cyan" } },
      ],
    });
    expect(nodes.map((n) => n.kind)).toEqual([
      "source",
      "source",
      "source",
      "grid",
      "battery",
      "home",
    ]);
    // Its own color, else its icon's, else its kind's; an importing grid
    // is orange.
    expect(nodes.map((n) => n.color)).toEqual([
      COLOR_HEX.yellow,
      COLOR_HEX.teal,
      COLOR_HEX.cyan,
      COLOR_HEX.orange,
      COLOR_HEX.mint,
      COLOR_HEX.blue,
    ]);
    expect(energyNodes({ grid: { power: -1 } })[0]?.color).toBe(COLOR_HEX.green);
    expect(energyNodes({ grid: { power: 0 } })[0]?.color).toBe(COLOR_HEX.orange);
    expect(energyNodes({})).toEqual([]);
  });

  it("headlines the home, else the first node present", () => {
    expect(energyHeadline(DOCS)?.kind).toBe("home");
    expect(energyHeadline({ sources: [{ power: 1 }], grid: { power: 1 } })?.kind).toBe("source");
    expect(energyHeadline({ grid: { power: 1 }, battery: { power: 1 } })?.kind).toBe("grid");
    expect(energyHeadline({})).toBeNull();
  });
});

describe("energy: small", () => {
  it("draws the home's chip, the name, its power and today's energy", () => {
    const el = small(DOCS);
    const canvas = $(el, ".pv-canvas");
    expect(canvas.classList.contains("is-medium")).toBe(false);
    // Chip top left, a spacer, then the three lines at the bottom.
    const [top, spacer, name, hero, today] = [...canvas.children] as HTMLElement[];
    expect(canvas.children).toHaveLength(5);
    const chip = $(top!, ".pv-chip");
    expect(icon(chip)).toBe("mdi:home");
    expect(css(chip)).toContain(`color:${COLOR_HEX.blue}`);
    expect(spacer!.className).toBe("pv-grow");
    expect(name!.classList.contains("pv-name")).toBe(true);
    expect(text(name!)).toBe("Energy");
    // The hero: 32 pt Regular, in primary whatever the accent.
    expect(text(hero!)).toBe("1 kW");
    expect(hero!.style.fontSize).toBe("32px");
    expect(hero!.style.fontWeight).toBe("400");
    expect(hero!.style.color).toBe("");
    // Today's line in the node's color.
    expect(text(today!)).toBe("Today 9.8 kWh");
    expect(today!.classList.contains("pv-state")).toBe(true);
    expect(css(today!)).toContain(`color:${COLOR_HEX.blue}`);
  });

  it("maps the power to the node fields and today's line to the meters", () => {
    const el = small(DOCS);
    expect($$(el, "[data-slot]").map((r) => r.dataset["slot"])).toEqual(["hero", "caption"]);
    expect(text($(el, '[data-slot="hero"]'))).toBe("1 kW");
    expect(text($(el, '[data-slot="caption"]'))).toBe("Today 9.8 kWh");
    expect(slotById("widget", "energy", "hero")?.fields).toContain("home_power");
    expect(slotById("widget", "energy", "caption")?.fields).toEqual(["home_today", "grid_today"]);
  });

  it("headlines the first node without a home, with its kind's defaults", () => {
    const solar = small({ sources: [{ power: 640, today: 12.4 }], grid: { power: 100 } });
    expect(icon($(solar, ".pv-chip"))).toBe("mdi:weather-sunny");
    expect(css($(solar, ".pv-chip"))).toContain(`color:${COLOR_HEX.yellow}`);
    expect(text($(solar, '[data-slot="hero"]'))).toBe("640 W");
    expect(css($(solar, '[data-slot="caption"]'))).toContain(`color:${COLOR_HEX.yellow}`);
    const exporting = small({ grid: { power: -1400, today: 3.1 } });
    expect(icon($(exporting, ".pv-chip"))).toBe("mdi:flash");
    expect(css($(exporting, ".pv-chip"))).toContain(`color:${COLOR_HEX.green}`);
    expect(text($(exporting, '[data-slot="hero"]'))).toBe("-1.4 kW");
    expect(text($(exporting, '[data-slot="caption"]'))).toBe("Today 3.1 kWh");
    // The battery block has no stand-in of its own: a battery is drawn.
    const battery = small({ battery: { power: -800, level: 76 } });
    expect(icon($(battery, ".pv-chip"))).toBe("mdi:car-battery");
    expect(css($(battery, ".pv-chip"))).toContain(`color:${COLOR_HEX.mint}`);
    expect(text($(battery, '[data-slot="hero"]'))).toBe("-800 W");
  });

  it("takes a node's own icon and color over its kind's", () => {
    const el = small({ home: { power: 1, icon: { name: "bolt.car", primary_color: "purple" } } });
    expect(icon($(el, ".pv-chip"))).toBe("mdi:car-electric-outline");
    expect(css($(el, ".pv-chip"))).toContain(`color:${COLOR_HEX.purple}`);
    const named = small({ home: { power: 1, icon: "fan", color: "red" } });
    expect(icon($(named, ".pv-chip"))).toBe("mdi:fan");
    expect(css($(named, ".pv-chip"))).toContain(`color:${COLOR_HEX.red}`);
  });

  it("keeps a placeholder for today's line while its meter is unset", () => {
    const home = small({ home: { power: 1000 } });
    const ghost = $(home, '[data-slot="caption"]');
    expect(ghost.dataset["ghost"]).toBe("");
    expect(text(ghost)).toBe("Home today");
    expect(text($(home, '[data-slot="hero"]'))).toBe("1 kW");
    expect(text($(small({ grid: { power: 5 } }), "[data-ghost]"))).toBe("Grid today");
  });

  it("keeps both placeholders with nothing bound", () => {
    const none = small({});
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero", "caption"]);
    expect($$(none, ".pv-chip, .pv-name")).toHaveLength(0);
  });

  it("scales a long reading down, to 60 % at most", () => {
    const long = $(small({ home: { power: -123456789 } }), '[data-slot="hero"]');
    expect(fontSize(long)).toBeLessThan(32);
    expect(fontSize(long)).toBeGreaterThanOrEqual(32 * 0.6);
    const name = $(small(DOCS, "A very long name for an energy widget"), ".pv-name");
    expect(fontSize(name)).toBe(12);
  });
});

describe("energy: medium", () => {
  it("lines the nodes up as columns: chip, power, caption", () => {
    const el = medium(DOCS);
    expect($(el, ".pv-canvas").classList.contains("is-medium")).toBe(true);
    const cols = $$(el, ".pv-cols > .pv-col");
    expect(cols.map((c) => c.dataset["node"])).toEqual(["source", "grid", "battery", "home"]);
    for (const col of cols)
      expect([...col.children].map((c) => c.classList[0])).toEqual([
        "pv-chip",
        "pv-col-value",
        "pv-col-caption",
      ]);
    // Each kind's symbol in its color; an exporting grid reads green.
    expect(cols.map((c) => icon($(c, ".pv-chip")))).toEqual([
      "mdi:weather-sunny",
      "mdi:flash",
      "mdi:car-battery",
      "mdi:home",
    ]);
    expect(cols.map((c) => css($(c, ".pv-chip")))).toEqual(
      [COLOR_HEX.yellow, COLOR_HEX.green, COLOR_HEX.mint, COLOR_HEX.blue].map((color) =>
        expect.stringContaining(`color:${color}`),
      ),
    );
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
    // Four columns leave every line its own size: subheadline over caption.
    for (const col of cols) {
      expect($(col, ".pv-col-value").style.fontSize).toBe("15px");
      expect($(col, ".pv-col-caption").style.fontSize).toBe("12px");
      expect(css($(col, ".pv-col-caption"))).toContain(`color:${WP.secondary}`);
    }
    // No name and no today's line at this size.
    expect($$(el, ".pv-name, .pv-state")).toHaveLength(0);
  });

  it("is one region, the nodes' fields", () => {
    const el = medium(DOCS);
    expect($$(el, "[data-slot]")).toHaveLength(1);
    expect($(el, '[data-slot="hero"]')).toBe($(el, ".pv-cols"));
    expect(slotById("widget", "energy", "hero")?.fields).toEqual([
      "sources",
      "grid_power",
      "battery_power",
      "battery_level",
      "home_power",
    ]);
  });

  it("draws several sources first, named ones by their name", () => {
    const el = medium({
      ...DOCS,
      sources: [
        { power: 3200 },
        { name: "Wind", power: 800, icon: "wind", color: "teal" },
        { power: 12400, name: "Hydro" },
      ],
    });
    const cols = $$(el, ".pv-col");
    expect(cols.map((c) => c.dataset["node"])).toEqual([
      "source",
      "source",
      "source",
      "grid",
      "battery",
      "home",
    ]);
    expect(cols.map((c) => text($(c, ".pv-col-caption"))).slice(0, 3)).toEqual([
      "Solar",
      "Wind",
      "Hydro",
    ]);
    expect(icon($(cols[1]!, ".pv-chip"))).toBe("mdi:weather-windy");
    expect(css($(cols[1]!, ".pv-chip"))).toContain(`color:${COLOR_HEX.teal}`);
    expect(icon($(cols[2]!, ".pv-chip"))).toBe("mdi:weather-sunny");
  });

  it("scales a line down only where its column is too narrow for it", () => {
    const six = medium({
      ...DOCS,
      sources: [{ power: 1 }, { power: 2 }, { power: 12400 }],
    });
    const cols = $$(six, ".pv-col");
    // A short line keeps its size beside a long one that shrinks.
    expect($(cols[0]!, ".pv-col-value").style.fontSize).toBe("15px");
    expect($(cols[5]!, ".pv-col-caption").style.fontSize).toBe("12px");
    const caption = $(cols[4]!, ".pv-col-caption");
    expect(text(caption)).toBe("Battery 76%");
    expect(fontSize(caption)).toBeLessThan(12);
    expect(fontSize(caption)).toBeGreaterThanOrEqual(12 * 0.7);
    const reading = $(cols[2]!, ".pv-col-value");
    expect(fontSize(reading)).toBeLessThan(15);
    expect(fontSize(reading)).toBeGreaterThanOrEqual(15 * 0.7);
  });

  it("draws the nodes present, a battery without a charge by its label", () => {
    const two = medium({ grid: { power: 420 }, battery: { power: -800 } });
    const cols = $$(two, ".pv-col");
    expect(cols.map((c) => c.dataset["node"])).toEqual(["grid", "battery"]);
    expect(cols.map((c) => text($(c, ".pv-col-value")))).toEqual(["420 W", "-800 W"]);
    expect(cols.map((c) => text($(c, ".pv-col-caption")))).toEqual(["Grid", "Battery"]);
    // An importing grid is orange.
    expect(css($(cols[0]!, ".pv-chip"))).toContain(`color:${COLOR_HEX.orange}`);
    expect(
      text($(medium({ battery: { power: 0, level: 75.5, name: "Powerwall" } }), ".pv-col-caption")),
    ).toBe("Powerwall 76%");
  });

  it("keeps the placeholders with nothing bound", () => {
    const none = medium({});
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero", "caption"]);
    expect($$(none, ".pv-col")).toHaveLength(0);
  });

  it("draws the integration's own payload", async () => {
    const samples = (await import("../harness/sample-data.json", { with: { type: "json" } }))
      .default.samples as { id: string; bindings: Bindings }[];
    const sample = samples.find((s) => s.id === "energy-dashboard");
    const res = (await makeHass().callWS({
      type: "aivi/preview",
      template: "energy",
      bindings: structuredClone(sample!.bindings),
      kind: "widget",
    })) as { content: WidgetContent };
    const caps = $$(medium(res.content), ".pv-col-caption").map(text);
    expect(caps).toHaveLength(energyNodes(res.content).length);
    expect(caps[0]).toBe("Roof");
    expect(caps[caps.length - 1]).toBe("Home");
  });
});
