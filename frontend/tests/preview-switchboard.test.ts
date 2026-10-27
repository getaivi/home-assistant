// The Switchboard preview against the app's Switchboard template: the grid at each size, a tile's settled states, its
// fill, ink, orb and second line, and the region that presses through.

import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE } from "../src/const";
import {
  fillAngle,
  prefersDarkInk,
  stackedLabelSize,
  switchboard,
  tileColors,
  tileSecondLine,
} from "../src/preview/switchboard";
import { previewWidget } from "../src/preview-render";
import { slotById, slotsFor } from "../src/slots";
import { switchboardPreviewStyles } from "../src/styles/preview/switchboard";
import type { PreviewAction, WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

const QUATERNARY = "rgba(235,235,245,.18)";

// The docs' example payload, as far as the two sizes show it.
const DOCS: WidgetContent = {
  actions: [
    {
      id: "morning",
      label: "Morning",
      subtitle: { value: "Kitchen" },
      icon: "sunrise.fill",
      gradient: ["#FFF3C4", "#FFC46B"],
    },
    {
      id: "evening",
      label: "Evening",
      subtitle: { value: "Living room" },
      icon: "sunset.fill",
      gradient: ["#FF9A5A", "#FF4F8B"],
      active: true,
    },
    {
      id: "garage",
      label: "Garage door",
      subtitle: { value: "Driveway" },
      icon: "door.garage.open",
      kind: "toggle",
      on: true,
      color: "orange",
      state_text: { on: "Open", off: "Closed", turning_on: "Opening", turning_off: "Closing" },
    },
    {
      id: "dog_cam",
      label: "Dog cam",
      subtitle: { value: "Hallway" },
      icon: "video.fill",
      kind: "toggle",
      on: true,
      gradient: ["#E8C07A", "#B98545"],
      image: { url: "https://getaivi.app/demo/switchboard/dog-cam.jpg", alt: "The dog" },
    },
    {
      id: "porch",
      label: "Porch light",
      subtitle: { value: "2700 K" },
      icon: "lightbulb.fill",
      kind: "toggle",
      on: true,
      gradient: ["#FFE4AD", "#FFAE5E"],
    },
    {
      id: "fountain",
      label: "Fountain",
      subtitle: { value: "Garden" },
      icon: "drop.fill",
      kind: "toggle",
      on: false,
      color: "#30B0C7",
    },
    {
      id: "cat_feeder",
      label: "Cat feeder",
      subtitle: { value: "Kitchen" },
      icon: "pawprint.fill",
      color: "brown",
    },
    { id: "all_off", label: "All off", icon: "power", color: "gray" },
  ],
};

const small = (content: WidgetContent): HTMLElement =>
  previewWidget("switchboard", "Living room", content);
const medium = (content: WidgetContent): HTMLElement =>
  previewWidget("switchboard", "Living room", content, "medium");

/** Stand in for the browser's text layout (happy-dom lays nothing out):
 * every character `per` of the font's size wide. */
function measureWith(per: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = (this.textContent ?? "").length * per * (parseFloat(this.style.fontSize) || 0);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("switchboard preview: the module", () => {
  it("draws both families itself", () => {
    expect(typeof switchboard.small).toBe("function");
    expect(typeof switchboard.medium).toBe("function");
  });
});

describe("switchboard preview: small", () => {
  it("is a 2 x 2 of the first four actions: the orb over the label, no second line", () => {
    const el = small(DOCS);
    const cells = $$(el, ".pv-switchboard-grid > div");
    expect(cells).toHaveLength(4);
    expect($(el, ".pv-switchboard-grid").classList.contains("is-three-rows")).toBe(false);
    expect(cells.map((c) => c.getAttribute("data-action"))).toEqual([
      "morning",
      "evening",
      "garage",
      "dog_cam",
    ]);
    expect(cells.map((c) => [...c.children].map((k) => k.className))).toEqual([
      ["pv-switchboard-orb", "pv-switchboard-label"],
      ["pv-switchboard-orb", "pv-switchboard-label"],
      ["pv-switchboard-orb", "pv-switchboard-label"],
      ["pv-switchboard-orb has-picture", "pv-switchboard-label"],
    ]);
    expect(cells.map((c) => text($(c, ".pv-switchboard-label")))).toEqual([
      "Morning",
      "Evening",
      "Garage door",
      "Dog cam",
    ]);
    expect(el.querySelector(".pv-switchboard-second")).toBeNull();
    expect(el.querySelector(".pv-name")).toBeNull();
  });

  it("draws a 30 pt orb with a 13.8 pt glyph", () => {
    const orb = $(small(DOCS), '[data-action="garage"] .pv-switchboard-orb');
    expect(css(orb)).toContain("width:30px;height:30px;font-size:13.8px");
  });

  it("fills a lit square tile along its diagonal, from the bottom trailing corner", () => {
    const el = small(DOCS);
    expect(css($(el, '[data-action="evening"]'))).toContain(
      "background:linear-gradient(315deg,#FF9A5A,#FF4F8B)",
    );
    expect(css($(el, '[data-action="garage"]'))).toContain(`background:${COLOR_HEX.orange}`);
    expect(css($(el, '[data-action="morning"]'))).toBe(`background:${QUATERNARY};`);
  });

  it("shrinks a long label until it fits, to 0.8 at most, before it truncates", () => {
    // Unmeasurable, or fitting the 52 pt: caption2's 11.
    expect(stackedLabelSize(() => null)).toBe(11);
    expect(stackedLabelSize(() => 52)).toBe(11);
    // A width that scales with the size: one step lands half a point
    // inside.
    expect(stackedLabelSize((size) => size * 5)).toBe(10.3);
    // The system font tracks wider when smaller: a second step.
    expect(stackedLabelSize((size) => size * 5 + (11 - size) * 2)).toBeLessThan(10.3);
    expect(stackedLabelSize((size) => size * 20)).toBeCloseTo(8.8);
    // Half the size a character: "Morning" (38.5) fits, "Garage door"
    // (60.5) fits at 9.36; at 0.7 it is drawn at the floor.
    measureWith(0.5);
    const el = small(DOCS);
    expect(css($(el, '[data-action="morning"] .pv-switchboard-label'))).toBe("");
    expect(css($(el, '[data-action="garage"] .pv-switchboard-label'))).toBe("font-size:9.36px;");
    measureWith(0.7);
    expect(css($(small(DOCS), '[data-action="garage"] .pv-switchboard-label'))).toBe(
      "font-size:8.8px;",
    );
  });

  it("keeps the anatomy with fewer than four, and with none", () => {
    const el = small({ actions: [{ id: "a", label: "A", icon: "power", kind: "toggle" }] });
    const cells = $$(el, ".pv-switchboard-grid > div");
    expect(cells.map((c) => c.className)).toEqual([
      "pv-switchboard-tile is-off",
      "pv-switchboard-tile is-off is-empty",
      "pv-switchboard-tile is-off is-empty",
      "pv-switchboard-tile is-off is-empty",
    ]);
    expect(css(cells[1]!)).toBe(`background:${QUATERNARY};`);
    expect(cells[1]!.children).toHaveLength(0);
    expect($$(small({}), ".pv-switchboard-grid > .pv-switchboard-tile.is-empty")).toHaveLength(4);
  });
});

describe("switchboard preview: medium", () => {
  it("is a 2 x 3 of the first six actions: the orb beside the label and a second line", () => {
    const el = medium(DOCS);
    const cells = $$(el, ".pv-switchboard-grid.is-three-rows > div");
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.classList.contains("is-row"))).toBe(true);
    expect(cells.map((c) => c.getAttribute("data-action"))).toEqual([
      "morning",
      "evening",
      "garage",
      "dog_cam",
      "porch",
      "fountain",
    ]);
    for (const cell of cells) {
      expect([...cell.children].map((k) => k.className.split(" ")[0])).toEqual([
        "pv-switchboard-orb",
        "pv-switchboard-text",
      ]);
      expect([...$(cell, ".pv-switchboard-text").children].map((k) => k.className)).toEqual([
        "pv-switchboard-label",
        "pv-switchboard-second",
      ]);
    }
    // An idle button its subtitle; an active one, and a toggle that is
    // on, the word and the subtitle; an off toggle the word alone.
    expect(cells.map((c) => text($(c, ".pv-switchboard-second")))).toEqual([
      "Kitchen",
      "Active · Living room",
      "Open · Driveway",
      "On · Hallway",
      "On · 2700 K",
      "Off",
    ]);
    expect(el.querySelector(".pv-name")).toBeNull();
  });

  it("draws a 26 pt orb with a 11.96 pt glyph", () => {
    const orb = $(medium(DOCS), '[data-action="garage"] .pv-switchboard-orb');
    expect(css(orb)).toContain("width:26px;height:26px;font-size:11.96px");
  });

  it("fills a lit wide tile along its own diagonal, not CSS's corner-to-corner", () => {
    // 150 x 38: nearly side to side.
    expect(fillAngle(150, 38)).toBe("284.2deg");
    expect(fillAngle(60, 60)).toBe("315deg");
    expect(css($(medium(DOCS), '[data-action="evening"]'))).toContain(
      "background:linear-gradient(284.2deg,#FF9A5A,#FF4F8B)",
    );
  });

  it("drops the subtitle when the pair does not fit beside the orb", () => {
    // 98 pt of text: at 7 pt a character "On · 2700 K" (77) fits,
    // "Open · Driveway" (105) and "Active · Living room" do not.
    measureWith(7 / 11);
    const el = medium(DOCS);
    expect(text($(el, '[data-action="porch"] .pv-switchboard-second'))).toBe("On · 2700 K");
    expect(text($(el, '[data-action="garage"] .pv-switchboard-second'))).toBe("Open");
    expect(text($(el, '[data-action="evening"] .pv-switchboard-second'))).toBe("Active");
    // A subtitle on its own is never dropped: it truncates.
    expect(text($(el, '[data-action="morning"] .pv-switchboard-second'))).toBe("Kitchen");
  });

  it("keeps the anatomy with fewer than six, and with none", () => {
    const el = medium({ actions: [{ id: "a", label: "A", icon: "power", kind: "button" }] });
    const cells = $$(el, ".pv-switchboard-grid > div");
    expect(cells).toHaveLength(6);
    expect(cells.slice(1).every((c) => c.className === "pv-switchboard-tile is-off is-empty")).toBe(
      true,
    );
    // An idle button with no subtitle keeps a blank line, so labels align.
    expect($(cells[0]!, ".pv-switchboard-second").textContent).toBe(" ");
    expect($$(medium({}), ".pv-switchboard-grid > .pv-switchboard-tile.is-empty")).toHaveLength(6);
  });
});

describe("switchboard preview: a tile's states", () => {
  const tile = (action: PreviewAction, accent?: string): HTMLElement =>
    $(medium({ actions: [action], ...(accent ? { accent } : {}) }), ".pv-switchboard-tile");

  it("an off toggle: neutral plate, muted orb, primary label, secondary word", () => {
    const el = tile({
      id: "a",
      label: "Fan",
      icon: "fan",
      kind: "toggle",
      on: false,
      color: "teal",
    });
    expect(el.className).toBe("pv-switchboard-tile is-row is-off");
    expect(css(el)).toBe(`background:${QUATERNARY};`);
    const orb = $(el, ".pv-switchboard-orb");
    expect(css(orb)).toContain(`background:${QUATERNARY};color:rgba(235,235,245,.6)`);
    expect(css(orb)).not.toContain("box-shadow");
    expect(text(orb)).toBe("✦");
    expect(css($(el, ".pv-switchboard-second"))).toBe("color:rgba(235,235,245,.6);");
    expect(el.getAttribute("aria-label")).toBe("Fan, off");
    expect(switchboardPreviewStyles.cssText).toMatch(
      /\.pv-canvas \.pv-switchboard-tile\.is-off \{ color: #fff; \}/,
    );
  });

  it("an off toggle with a gradient: a blank muted orb", () => {
    const orb = $(
      tile({
        id: "a",
        label: "Lamp",
        icon: "lightbulb",
        kind: "toggle",
        gradient: ["red", "blue"],
      }),
      ".pv-switchboard-orb",
    );
    expect(css(orb)).toContain(`background:${QUATERNARY}`);
    expect(css(orb)).not.toContain("gradient");
    expect(orb.childNodes).toHaveLength(0);
  });

  it("a toggle that is on: filled, the orb lifted by a shadow in the fill's hue", () => {
    const el = tile({
      id: "a",
      label: "Fan",
      icon: "fan",
      kind: "toggle",
      on: true,
      color: "indigo",
    });
    expect(el.className).toBe("pv-switchboard-tile is-row is-on");
    expect(css(el)).toBe(`background:${COLOR_HEX.indigo};color:#fff;`);
    const orb = $(el, ".pv-switchboard-orb");
    expect(css(orb)).toContain(`background:${COLOR_HEX.indigo}`);
    // The fill's color 60 % toward black, at 0.55 under white ink.
    expect(css(orb)).toContain(
      `box-shadow:02.5px14pxcolor-mix(insrgb,color-mix(inoklab,${COLOR_HEX.indigo}40%,#000)55%,transparent)`,
    );
    expect(text(orb)).toBe("✦");
    expect(css($(el, ".pv-switchboard-second"))).toBe("color:rgba(255,255,255,.82);");
    expect(el.getAttribute("aria-label")).toBe("Fan, on");
  });

  it("a pale fill: dark ink, a fainter second line, a lighter shadow", () => {
    const el = tile({
      id: "a",
      label: "Porch",
      icon: "lightbulb",
      kind: "toggle",
      on: true,
      gradient: ["#FFE4AD", "#FFAE5E"],
    });
    expect(css(el)).toContain("color:#1c1c1f");
    expect(css($(el, ".pv-switchboard-second"))).toBe("color:rgba(28,28,31,.72);");
    // The shadow takes the gradient's last stop.
    expect(css($(el, ".pv-switchboard-orb"))).toContain("color-mix(inoklab,#FFAE5E40%,#000)45%");
    expect(prefersDarkInk(["#FFFFFF"])).toBe(true);
    expect(prefersDarkInk(["#000000", "#FFFFFF"])).toBe(true);
    expect(prefersDarkInk([COLOR_HEX.orange])).toBe(true);
    expect(prefersDarkInk([SYSTEM_BLUE])).toBe(false);
    expect(prefersDarkInk(["var(--x)"])).toBe(false);
    expect(prefersDarkInk([])).toBe(false);
  });

  it("an idle button: the full mark on a neutral plate, no shadow, no word", () => {
    const el = tile({ id: "a", label: "Movie", icon: "film", color: "purple" });
    expect(el.className).toBe("pv-switchboard-tile is-row is-off");
    expect(css(el)).toBe(`background:${QUATERNARY};`);
    const orb = $(el, ".pv-switchboard-orb");
    expect(css(orb)).toContain(`background:${COLOR_HEX.purple}`);
    expect(css(orb)).not.toContain("box-shadow");
    expect($(el, ".pv-switchboard-second").textContent).toBe(" ");
    expect(el.getAttribute("aria-label")).toBe("Movie");
  });

  it("an active button: one look with a toggle that is on", () => {
    const el = tile({
      id: "a",
      label: "Movie",
      icon: "film",
      kind: "button",
      active: true,
      color: "purple",
    });
    expect(el.className).toBe("pv-switchboard-tile is-row is-on");
    expect(css(el)).toContain(`background:${COLOR_HEX.purple}`);
    expect(css($(el, ".pv-switchboard-orb"))).toContain("box-shadow");
    expect(text($(el, ".pv-switchboard-second"))).toBe("Active");
    expect(el.getAttribute("aria-label")).toBe("Movie, active");
  });

  it("a gradient orb: the stops from the top leading corner under a sheen, no glyph", () => {
    const orb = $(
      tile({ id: "a", label: "Morning", icon: "sunrise.fill", gradient: ["#FFF3C4", "#FFC46B"] }),
      ".pv-switchboard-orb",
    );
    expect(css(orb)).toContain("background:linear-gradient(135deg,#FFF3C4,#FFC46B)");
    // White at 0.28 up and left, gone at 0.55 of the orb.
    expect([...orb.children].map((k) => k.className)).toEqual(["pv-switchboard-sheen"]);
    expect(css($(orb, ".pv-switchboard-sheen"))).toBe(
      "background:radial-gradient(circle14.3pxat30%25%,rgba(255,255,255,.28),rgba(255,255,255,0));",
    );
    expect(text(orb)).toBe("");
    expect(switchboardPreviewStyles.cssText).toMatch(
      /\.pv-canvas \.pv-switchboard-sheen \{ position: absolute; inset: 0/,
    );
  });

  it("a gradient is its first three stops; a single stop is no gradient", () => {
    expect(tileColors({ gradient: ["red", "#00FF00", "blue", "pink"] }, SYSTEM_BLUE)).toEqual([
      COLOR_HEX.red,
      "#00FF00",
      COLOR_HEX.blue,
    ]);
    expect(tileColors({ gradient: ["red"], color: "teal" }, SYSTEM_BLUE)).toEqual([COLOR_HEX.teal]);
    expect(tileColors({}, SYSTEM_BLUE)).toEqual([SYSTEM_BLUE]);
  });

  it("takes a color that is neither a palette name nor six hex digits as the accent", () => {
    expect(tileColors({ color: "#30B0C7" }, SYSTEM_BLUE)).toEqual(["#30B0C7"]);
    for (const color of ["#fff", "#30B0C7ff", "rgb(1,2,3)", "red;outline:9px solid lime", "url(x)"])
      expect(tileColors({ color }, SYSTEM_BLUE)).toEqual([SYSTEM_BLUE]);
    expect(tileColors({ gradient: ["red", "red;x:y"] }, SYSTEM_BLUE)).toEqual([
      COLOR_HEX.red,
      SYSTEM_BLUE,
    ]);
    const bad = tile({
      id: "a",
      label: "A",
      icon: "power",
      color: "red;outline:9px solid lime",
      active: true,
    });
    expect(css(bad)).toContain(`background:${SYSTEM_BLUE}`);
    expect(css(bad)).not.toContain("outline");
  });

  it("a tile with no color takes the widget accent; a picture keeps the fallback mark", () => {
    const plain = tile({ id: "a", label: "A", icon: "power", kind: "toggle", on: true });
    expect(css(plain)).toContain(`background:${SYSTEM_BLUE}`);
    const accented = tile(
      { id: "a", label: "A", icon: "power", kind: "toggle", on: true },
      "green",
    );
    expect(css(accented)).toContain(`background:${COLOR_HEX.green}`);
    expect(css($(accented, ".pv-switchboard-orb"))).toContain(`background:${COLOR_HEX.green}`);
    const pic = $(
      tile({
        id: "a",
        label: "Cam",
        icon: "video.fill",
        color: "brown",
        image: { url: "https://e.com/a.jpg" },
      }),
      ".pv-switchboard-orb",
    );
    expect(pic.className).toBe("pv-switchboard-orb has-picture");
    expect(css(pic)).toContain(`background:${COLOR_HEX.brown}`);
  });

  it("a tile with no icon or label still draws its plate and mark", () => {
    const el = tile({ id: "a", kind: "toggle", on: true });
    expect(text($(el, ".pv-switchboard-orb"))).toBe("✦");
    expect($(el, ".pv-switchboard-label").textContent).toBe("");
    expect(text($(el, ".pv-switchboard-second"))).toBe("On");
    expect(el.getAttribute("aria-label")).toBe(", on");
  });
});

describe("switchboard preview: the second line", () => {
  const toggle = (extra: PreviewAction): PreviewAction => ({ kind: "toggle", ...extra });

  it("says the app's words", () => {
    expect(tileSecondLine(toggle({ on: true }))).toBe("On");
    expect(tileSecondLine(toggle({ on: false }))).toBe("Off");
    expect(tileSecondLine({ active: true })).toBe("Active");
    expect(tileSecondLine({})).toBe("");
  });

  it("joins the word and the subtitle, except on an off toggle", () => {
    expect(tileSecondLine(toggle({ on: true, subtitle: { value: "2700 K" } }))).toBe("On · 2700 K");
    expect(tileSecondLine(toggle({ on: false, subtitle: { value: "Garden" } }))).toBe("Off");
    expect(tileSecondLine({ active: true, subtitle: { value: "Hall" } })).toBe("Active · Hall");
    expect(tileSecondLine({ subtitle: { value: "Hall" } })).toBe("Hall");
    expect(tileSecondLine(toggle({ on: true, subtitle: { value: "" } }))).toBe("On");
  });

  it("takes the tile's own words, trimmed, and hides an empty one", () => {
    const words = { on: " Open ", off: "Closed", idle: "Ready", active: "Running" };
    expect(tileSecondLine(toggle({ on: true, state_text: words }))).toBe("Open");
    expect(tileSecondLine(toggle({ on: false, state_text: words }))).toBe("Closed");
    expect(tileSecondLine({ state_text: words, subtitle: { value: "Hall" } })).toBe("Ready · Hall");
    expect(tileSecondLine({ active: true, state_text: words })).toBe("Running");
    expect(
      tileSecondLine(toggle({ on: true, state_text: { on: "Unlocked", off: "Locked" } })),
    ).toBe("Unlocked");
    // A hidden word leaves the subtitle, or nothing.
    expect(
      tileSecondLine(toggle({ on: true, state_text: { on: "" }, subtitle: { value: "Hall" } })),
    ).toBe("Hall");
    expect(tileSecondLine(toggle({ on: false, state_text: { off: " " } }))).toBe("");
  });

  it("falls back to the word alone where the pair does not fit", () => {
    const action = toggle({ on: true, subtitle: { value: "Driveway" } });
    expect(tileSecondLine(action, () => false)).toBe("On");
    expect(tileSecondLine(action, () => true)).toBe("On · Driveway");
  });
});

describe("switchboard preview: regions", () => {
  it("the grid is the one region at both sizes, and it owns the actions", () => {
    for (const el of [small(DOCS), medium(DOCS), small({}), medium({})]) {
      const regions = $$(el, "[data-slot]");
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe($(el, ".pv-switchboard-grid"));
      expect(regions[0]!.getAttribute("data-slot")).toBe("grid");
      expect(el.querySelector("[data-ghost]")).toBeNull();
    }
    expect(slotById("widget", "switchboard", "grid")?.fields).toEqual(["actions", "accent"]);
    expect(slotsFor("widget", "switchboard").map((s) => s.id)).toContain("grid");
  });

  it("keeps the class names the end-to-end journey waits on", () => {
    const el = medium({
      actions: [{ id: "a", label: "A", icon: "power", kind: "toggle", on: false }],
    });
    expect(el.querySelector(".pv-switchboard-grid .pv-switchboard-tile.is-off")).toBeTruthy();
  });
});

describe("switchboard preview: the stylesheet", () => {
  const sheet = switchboardPreviewStyles.cssText;

  it("is the app's grid and tile", () => {
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-grid \{[^}]*grid-template-columns: 1fr 1fr;[^}]*gap: 6px/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-grid\.is-three-rows \{ grid-template-rows: repeat\(3, 1fr\)/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-tile \{ border-radius: 14px; padding: 0 4px;[^}]*gap: 4px/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-tile\.is-row \{[^}]*gap: 8px;\s*padding: 0 9px/,
    );
    expect(sheet).toMatch(/\.pv-canvas \.pv-switchboard-tile\.is-empty \{ opacity: \.4/);
  });

  it("sets the label and second line in the app's type", () => {
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-label \{ font-size: 11px; font-weight: 600/,
    );
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-switchboard-tile\.is-row \.pv-switchboard-label \{ font-size: 13px/,
    );
    expect(sheet).toMatch(/\.pv-switchboard-second \{ font-size: 11px;\s*font-weight: 400/);
  });
});
