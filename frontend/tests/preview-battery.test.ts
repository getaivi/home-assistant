// The Battery widget's preview at both sizes, against the app's Battery
// template: the ring, its color rule,
// the charging bolt, the layouts and their placeholder rings, and the one
// region that leads to the devices field.

import { describe, expect, it } from "vitest";
import { COLOR_HEX, WP } from "../src/const";
import { previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import type { PreviewDevice, WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

// The app's own preview payload (the docs' renders).
const FULL: WidgetContent = {
  devices: [
    { name: "Robot vacuum", level: 68, icon: "fan.fill" },
    { name: "Door lock", level: 45, charging: true, icon: "lock.fill" },
    { name: "Doorbell cam", level: 92, icon: "video.fill" },
    { name: "Motion sensor", level: 12, icon: "dot.radiowaves.left.and.right" },
  ],
};

const small = (devices?: PreviewDevice[]): HTMLElement =>
  previewWidget("battery", "Home devices", devices ? { devices } : {});
const medium = (devices?: PreviewDevice[]): HTMLElement =>
  previewWidget("battery", "Home devices", devices ? { devices } : {}, "medium");

/** What the canvas says in words, the icons' stand-ins aside. */
function said(el: HTMLElement): string {
  const canvas = $(el, ".pv-canvas").cloneNode(true) as HTMLElement;
  for (const glyph of canvas.querySelectorAll(".pv-battery-glyph")) glyph.remove();
  return text(canvas);
}

/** The level's arc of a ring, and the share of the circle it covers. */
const arc = (ring: Element): SVGElement | null => ring.querySelector<SVGElement>(".pv-battery-arc");
function share(ring: Element): number {
  const [dash, circ] = (arc(ring)?.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
  return (dash ?? NaN) / (circ ?? NaN);
}

describe("battery ring", () => {
  it("is 50 pt with a 4.5 pt line centerd on its edge, the arc from 12 o'clock", () => {
    const ring = $(small([{ name: "a", level: 68 }]), ".pv-battery-ring");
    const svg = $(ring, "svg");
    expect(svg.getAttribute("width")).toBe("50");
    expect($(svg, "g").getAttribute("stroke-width")).toBe("4.5");
    const [track, fill] = $$(svg, "circle");
    // Radius 25: the line straddles the frame's edge.
    expect(track!.getAttribute("r")).toBe("25");
    expect(track!.getAttribute("stroke")).toBe(WP.quaternary);
    expect(fill!.getAttribute("stroke-linecap")).toBe("round");
    expect(fill!.getAttribute("transform")).toBe("rotate(-90 25 25)");
    expect(share(ring)).toBeCloseTo(0.68, 3);
  });

  it("is green, red at 20 % and below unless charging, or the device's own color", () => {
    const rings = $$(
      small([
        { name: "ok", level: 21 },
        { name: "low", level: 20 },
        { name: "low, charging", level: 5, charging: true },
        { name: "own", level: 5, color: "orange" },
      ]),
      ".pv-battery-ring",
    );
    expect(rings.map((r) => arc(r)?.getAttribute("stroke"))).toEqual([
      COLOR_HEX.green,
      COLOR_HEX.red,
      COLOR_HEX.green,
      COLOR_HEX.orange,
    ]);
  });

  it("clamps the level, and keeps a dot for an empty battery", () => {
    const rings = $$(
      small([
        { name: "over", level: 140 },
        { name: "empty", level: 0 },
        { name: "under", level: -5 },
      ]),
      ".pv-battery-ring",
    );
    expect(share(rings[0]!)).toBe(1);
    expect(share(rings[1]!)).toBeCloseTo(0.001, 3);
    expect(share(rings[2]!)).toBeCloseTo(0.001, 3);
  });

  it("rides the bolt on the ring when charging, in the ring's color, in a knockout", () => {
    const [plain, charging, own] = $$(
      small([
        { name: "plain", level: 45 },
        { name: "charging", level: 45, charging: true },
        { name: "own", level: 45, charging: true, color: "blue" },
      ]),
      ".pv-battery-ring",
    );
    expect(plain!.querySelector(".pv-battery-bolt")).toBeNull();
    expect(plain!.querySelector("mask")).toBeNull();
    expect($(plain!, "g").hasAttribute("mask")).toBe(false);
    const bolt = $(charging!, ".pv-battery-bolt");
    expect(bolt.getAttribute("fill")).toBe(COLOR_HEX.green);
    // Centered on the ring's path at 12 o'clock.
    expect(bolt.getAttribute("transform")).toMatch(/^translate\(25 /);
    // The ring (track and arc) is masked by the bolt's dilated silhouette:
    // 2 pt beyond its outline all round.
    const mask = $(charging!, "mask");
    expect($(charging!, "g").getAttribute("mask")).toBe(`url(#${mask.id})`);
    const hole = $(mask, "path");
    expect(hole.getAttribute("d")).toBe(bolt.getAttribute("d"));
    expect(
      Number(hole.getAttribute("stroke-width")) - Number(bolt.getAttribute("stroke-width")),
    ).toBe(4);
    expect($(own!, ".pv-battery-bolt").getAttribute("fill")).toBe(COLOR_HEX.blue);
    // Each knockout is its own.
    expect($(own!, "mask").id).not.toBe(mask.id);
  });

  it("draws the icon in secondary, whatever its own color, and nothing without one", () => {
    const [tinted, bare] = $$(
      small([
        { name: "lock", level: 45, icon: { name: "lock.fill", primary_color: "indigo" } },
        { name: "bare", level: 45 },
      ]),
      ".pv-battery-ring",
    );
    const glyph = $(tinted!, ".pv-battery-glyph");
    expect(css(glyph)).toContain(`color:${WP.secondary}`);
    expect(css(glyph)).not.toContain(COLOR_HEX.indigo);
    expect(glyph.childNodes).toHaveLength(1);
    expect(bare!.querySelector(".pv-battery-glyph")).toBeNull();
  });

  it("keeps the track and icon of a device with no level, without an arc", () => {
    const ring = $(small([{ name: "new", icon: "lock.fill" }]), ".pv-battery-ring");
    expect($$(ring, "circle")).toHaveLength(1);
    expect(arc(ring)).toBeNull();
    expect(ring.querySelector(".pv-battery-glyph")).not.toBeNull();
  });
});

describe("battery: small", () => {
  it("draws a 2×2 grid of rings and nothing else", () => {
    const el = small(FULL.devices);
    expect($(el, ".pv-canvas").classList.contains("is-small")).toBe(true);
    const rows = $$(el, ".pv-battery-grid > .pv-battery-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => $$(r, ":scope > .pv-battery-ring").length)).toEqual([2, 2]);
    // Publisher order, row by row.
    expect($$(el, ".pv-battery-ring").map((r) => share(r).toFixed(2))).toEqual([
      "0.68",
      "0.45",
      "0.92",
      "0.12",
    ]);
    expect($$(el, ".pv-battery-ring").map((r) => arc(r)?.getAttribute("stroke"))).toEqual([
      COLOR_HEX.green,
      COLOR_HEX.green,
      COLOR_HEX.green,
      COLOR_HEX.red,
    ]);
    expect($$(el, ".pv-battery-bolt")).toHaveLength(1);
    expect($$(el, ".pv-battery-glyph")).toHaveLength(4);
    // No widget name, no device names, no percentages at this size.
    expect($$(el, ".pv-name")).toHaveLength(0);
    expect(said(el)).toBe("");
  });

  it("fills a short list from the top-leading corner with placeholder rings", () => {
    const el = small(FULL.devices?.slice(0, 3));
    const cells = $$(el, ".pv-battery-row > *").map((c) => c.className);
    expect(cells).toEqual([
      "pv-battery-ring",
      "pv-battery-ring",
      "pv-battery-ring",
      "pv-battery-placeholder",
    ]);
    // The placeholder: the same line in quaternary.
    expect(css($(el, ".pv-battery-placeholder"))).toContain(`border:4.5pxsolid${WP.quaternary}`);
  });

  it("shows the first four of a longer list", () => {
    const el = small([
      ...(FULL.devices ?? []),
      { name: "Fifth", level: 50 },
      { name: "Sixth", level: 30 },
    ]);
    expect($$(el, ".pv-battery-ring")).toHaveLength(4);
    expect($$(el, ".pv-battery-ring").map((r) => share(r).toFixed(2))).toEqual([
      "0.68",
      "0.45",
      "0.92",
      "0.12",
    ]);
    expect($$(el, ".pv-battery-placeholder")).toHaveLength(0);
  });

  it("keeps the grid's anatomy with no devices at all", () => {
    for (const el of [small(), small([])]) {
      expect($$(el, ".pv-battery-row > .pv-battery-placeholder")).toHaveLength(4);
      expect($$(el, "svg")).toHaveLength(0);
      expect($$(el, "[data-ghost]")).toHaveLength(0);
    }
  });

  it("is one region, the devices field's", () => {
    for (const el of [small(FULL.devices), small()]) {
      const regions = $$(el, "[data-slot]");
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe($(el, ".pv-battery-grid"));
      expect(regions[0]!.dataset["slot"]).toBe("grid");
    }
    expect(slotById("widget", "battery", "grid")?.fields).toEqual(["devices"]);
  });
});

describe("battery: medium", () => {
  it("draws four ring columns with the rounded percent under each", () => {
    const el = medium(FULL.devices);
    expect($(el, ".pv-canvas").classList.contains("is-medium")).toBe(true);
    const cols = $$(el, ".pv-battery-cols > .pv-col");
    expect(cols).toHaveLength(4);
    for (const col of cols)
      expect([...col.children].map((c) => c.classList[c.classList.length - 1])).toEqual([
        "pv-battery-ring",
        "pv-battery-percent",
      ]);
    expect(cols.map((c) => text($(c, ".pv-battery-percent")))).toEqual([
      "68%",
      "45%",
      "92%",
      "12%",
    ]);
    expect(cols.map((c) => arc(c)?.getAttribute("stroke"))).toEqual([
      COLOR_HEX.green,
      COLOR_HEX.green,
      COLOR_HEX.green,
      COLOR_HEX.red,
    ]);
    expect($$(el, ".pv-battery-bolt")).toHaveLength(1);
    expect(cols[1]!.querySelector(".pv-battery-bolt")).not.toBeNull();
    // No widget name and no device names at this size either.
    expect($$(el, ".pv-name")).toHaveLength(0);
    expect(said(el)).toBe("68%45%92%12%");
  });

  it("rounds the percent to a whole number", () => {
    const el = medium([
      { name: "a", level: 68.4 },
      { name: "b", level: 68.5 },
      { name: "c", level: 0 },
    ]);
    expect($$(el, ".pv-battery-percent").slice(0, 3).map(text)).toEqual(["68%", "69%", "0%"]);
  });

  it("keeps a placeholder ring over a hidden percent where there is no device", () => {
    const el = medium(FULL.devices?.slice(0, 3));
    const cols = $$(el, ".pv-battery-cols > .pv-col");
    expect(cols).toHaveLength(4);
    const last = cols[3]!;
    expect(last.querySelector(".pv-battery-ring")).toBeNull();
    expect(last.querySelector(".pv-battery-placeholder")).not.toBeNull();
    // The stand-in keeps every ring on the same line.
    expect(text($(last, ".pv-battery-percent"))).toBe("0%");
    expect(css($(last, ".pv-battery-percent"))).toContain("visibility:hidden");
    expect(cols.slice(0, 3).map((c) => css($(c, ".pv-battery-percent")))).toEqual(["", "", ""]);
  });

  it("shows the first four of a longer list", () => {
    const el = medium([...(FULL.devices ?? []), { name: "Fifth", level: 50 }]);
    expect($$(el, ".pv-battery-percent").map(text)).toEqual(["68%", "45%", "92%", "12%"]);
  });

  it("hides the percent of a device with no level, but keeps its ring", () => {
    const col = $(medium([{ name: "new", icon: "lock.fill" }]), ".pv-battery-cols > .pv-col");
    expect(col.querySelector(".pv-battery-ring")).not.toBeNull();
    expect(css($(col, ".pv-battery-percent"))).toContain("visibility:hidden");
  });

  it("keeps the four columns with no devices at all", () => {
    for (const el of [medium(), medium([])]) {
      expect($$(el, ".pv-battery-cols > .pv-col > .pv-battery-placeholder")).toHaveLength(4);
      expect($$(el, "svg")).toHaveLength(0);
      expect($$(el, "[data-ghost]")).toHaveLength(0);
    }
  });

  it("is one region, the devices field's", () => {
    for (const el of [medium(FULL.devices), medium()]) {
      const regions = $$(el, "[data-slot]");
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe($(el, ".pv-battery-cols"));
      expect(regions[0]!.dataset["slot"]).toBe("grid");
    }
    expect(slotById("widget", "battery", "grid")?.fields).toEqual(["devices"]);
  });
});
