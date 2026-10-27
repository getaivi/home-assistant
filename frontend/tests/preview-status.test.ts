// The Status widget's preview at both sizes, against the app's Status
// template: what each family draws, in which order, for a
// full, a partial and an empty payload, and which fields each region
// leads to.

import { afterEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE, WP } from "../src/const";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { slotsFor } from "../src/slots";
import { statusPreviewStyles } from "../src/styles/preview/status";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

// The docs' example payload.
const FULL: WidgetContent = {
  value: { value: "21°" },
  state: { value: "Comfortable", text_color: "green" },
  icon: { name: "thermometer.medium", primary_color: "orange" },
};
const SIZES: PreviewSize[] = ["small", "medium"];

const render = (content: WidgetContent, size: PreviewSize, name = "Living room"): HTMLElement =>
  $(previewWidget("status", name, content, size), `.pv-canvas.is-${size}`);

/** The classes of the painted regions, in document order. */
const order = (canvas: HTMLElement): string[] =>
  $$(canvas, ".pv-chip, .pv-ghost, .pv-name, .pv-hero, .pv-state").map(
    (el) => el.className.split(" ")[0] ?? "",
  );

/** The field keys a region leads to. */
const fieldsOf = (el: HTMLElement): readonly string[] =>
  slotsFor("widget", "status").find((s) => s.id === el.dataset["slot"])?.fields ?? [];

const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

afterEach(() => {
  vi.unstubAllGlobals();
  if (rangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRect);
});

describe("status preview: small", () => {
  it("stacks the 28 pt chip over the name, the 40 pt hero and the state line", () => {
    const canvas = render(FULL, "small");
    // One box, the app's content rectangle; the chip row, a spacer, then
    // the three lines pinned to the bottom.
    expect(canvas.children).toHaveLength(1);
    const box = $(canvas, ":scope > .pv-status-box");
    expect([...box.children].map((el) => el.className.split(" ")[0])).toEqual([
      "pv-status-top",
      "pv-grow",
      "pv-name",
      "pv-hero",
      "pv-state",
    ]);
    const chip = $(box, ".pv-status-top > .pv-chip");
    expect(css(chip)).toContain("width:28px;height:28px;font-size:14px");
    expect(css(chip)).toContain(`color:${COLOR_HEX.orange}`);
    expect(text($(box, ".pv-name"))).toBe("Living room");
    const hero = $(box, ".pv-hero");
    expect(text(hero)).toBe("21°");
    // Light from 34 pt, in primary: the hero never takes the tint.
    expect(css(hero)).toContain("font-size:40px;font-weight:300");
    expect(css(hero)).toContain(`color:${WP.primary}`);
    const state = $(box, ".pv-state");
    expect(text(state)).toBe("Comfortable");
    expect(css(state)).toBe(`color:${COLOR_HEX.green};`);
  });
});

describe("status preview: medium", () => {
  it("sets the name over the bottom-pinned 44 pt hero, the 44 pt chip top-right", () => {
    const canvas = render(FULL, "medium");
    expect(canvas.children).toHaveLength(1);
    const row = $(canvas, ":scope > .pv-status-box.pv-status-row");
    expect(row.classList.contains("is-iconless")).toBe(false);
    expect([...row.children].map((el) => el.className.split(" ")[0])).toEqual([
      "pv-status-col",
      "pv-chip",
    ]);
    expect([...$(row, ".pv-status-col").children].map((el) => el.className.split(" ")[0])).toEqual([
      "pv-name",
      "pv-grow",
      "pv-hero",
      "pv-state",
    ]);
    // The glyph is half the chip, as at every size.
    expect(css($(row, ":scope > .pv-chip"))).toContain("width:44px;height:44px;font-size:22px");
    expect(css($(row, ".pv-hero"))).toContain("font-size:44px;font-weight:300");
    expect(text($(row, ".pv-hero"))).toBe("21°");
    expect(text($(row, ".pv-state"))).toBe("Comfortable");
    // Not the small render centered.
    expect(canvas.querySelector(".wfit")).toBeNull();
  });

  it("keeps the text 32 pt clear of the chip, and gives it the width without one", () => {
    const sheet = statusPreviewStyles.cssText;
    expect(sheet).toMatch(/\.pv-status-col \{[^}]*margin-right: 32px/);
    expect(sheet).toMatch(/\.pv-status-row\.is-iconless \.pv-status-col \{ margin-right: 0; \}/);
    expect(sheet).toMatch(
      /\.pv-status-row\.is-iconless > \.pv-ghost\.is-chip \{ position: absolute;/,
    );
    // No top padding on the medium hero; 2 pt (less the baseline lift) on small.
    expect(sheet).toMatch(/\.pv-status-col \.pv-status-hero \{ margin-top: -\.032em; \}/);
  });
});

describe.each(SIZES)("status preview: states at %s", (size) => {
  it("paints chip, name, hero and state line for a full payload", () => {
    expect(order(render(FULL, size)).sort()).toEqual(["pv-chip", "pv-hero", "pv-name", "pv-state"]);
  });

  it("makes the state the hero, in its color, when there is no value", () => {
    const canvas = render({ state: { value: "Open", text_color: "red" }, icon: "lock.fill" }, size);
    const hero = $(canvas, ".pv-hero");
    expect(text(hero)).toBe("Open");
    expect(css(hero)).toContain(`color:${COLOR_HEX.red}`);
    // The line under the hero would only echo it.
    expect(canvas.querySelector(".pv-state")).toBeNull();
    expect(canvas.querySelector("[data-ghost]")).toBeNull();
    // A plain icon name carries no color: the app accent tints the chip.
    expect(css($(canvas, ".pv-chip"))).toContain(`color:${SYSTEM_BLUE}`);
  });

  it("draws a value alone as the hero, with no state line", () => {
    const canvas = render({ value: { value: "62%", text_color: "teal" } }, size);
    expect(text($(canvas, ".pv-hero"))).toBe("62%");
    expect(css($(canvas, ".pv-hero"))).toContain(`color:${COLOR_HEX.teal}`);
    expect(canvas.querySelector(".pv-state")).toBeNull();
  });

  it("tints an uncolored state line with the accent, which outranks the icon's color", () => {
    const tinted = render({ ...FULL, state: { value: "Comfortable" } }, size);
    expect(css($(tinted, ".pv-state"))).toBe(`color:${COLOR_HEX.orange};`);
    const accented = render({ ...FULL, state: { value: "Comfortable" }, accent: "purple" }, size);
    expect(css($(accented, ".pv-state"))).toBe(`color:${COLOR_HEX.purple};`);
    expect(css($(accented, ".pv-chip"))).toContain(`color:${COLOR_HEX.purple}`);
    // The hero stays primary under any accent.
    expect(css($(accented, ".pv-hero"))).toContain(`color:${WP.primary}`);
  });

  it("with nothing to show, placeholders for the hero and the chip, not the name twice", () => {
    const canvas = render({}, size, "Front door");
    expect(text($(canvas, ".pv-name"))).toBe("Front door");
    expect(canvas.querySelector(".pv-hero")).toBeNull();
    expect(canvas.querySelector(".pv-state")).toBeNull();
    // The app draws no chip without an icon; the preview keeps the icon
    // reachable with a dashed stand-in of the chip's size.
    const ghosts = $$(canvas, "[data-ghost]");
    expect(ghosts.map((g) => g.dataset["slot"]).sort()).toEqual(["hero", "icon"]);
    expect(text(ghosts.find((g) => g.dataset["slot"] === "hero")!)).toBe("State");
    const chip = ghosts.find((g) => g.dataset["slot"] === "icon")!;
    expect(chip.dataset["slot"]).toBe("icon");
    expect(chip.className).toBe("pv-ghost is-dark is-chip");
    expect(text(chip)).toBe("Icon");
    const side = size === "medium" ? 44 : 28;
    expect(css(chip)).toBe(`width:${side}px;height:${side}px;`);
    if (size === "medium")
      expect($(canvas, ".pv-status-row").classList.contains("is-iconless")).toBe(true);
  });

  it("keeps long text on one line each", () => {
    const canvas = render(
      {
        value: { value: "Partly cloudy with rain" },
        state: { value: "Comfortable but getting warmer by the hour" },
        icon: "thermometer",
      },
      size,
      "The downstairs living room thermostat",
    );
    // One element per line, each a single truncating line (the shared
    // name, hero and state roles), never wrapped or dropped.
    expect(text($(canvas, ".pv-name.pv-status-name"))).toBe(
      "The downstairs living room thermostat",
    );
    expect(text($(canvas, ".pv-hero.pv-status-hero"))).toBe("Partly cloudy with rain");
    expect(text($(canvas, ".pv-state.pv-status-state"))).toBe(
      "Comfortable but getting warmer by the hour",
    );
  });

  it("maps each region to its fields", () => {
    const canvas = render(FULL, size);
    const regions = $$(canvas, "[data-slot]");
    expect(regions.map((el) => el.dataset["slot"]).sort()).toEqual(["caption", "hero", "icon"]);
    expect(fieldsOf($(canvas, ".pv-hero"))).toEqual(["state", "value"]);
    expect(fieldsOf($(canvas, ".pv-state"))).toEqual(["state"]);
    expect(fieldsOf($(canvas, ".pv-chip"))).toEqual(["icon", "accent"]);
    // The name is the widget's own, not a field: not a region.
    expect($(canvas, ".pv-name").hasAttribute("data-slot")).toBe(false);
    // With nothing bound every field is still reachable: the hero and
    // the chip's placeholder.
    const empty = render({}, size);
    expect(
      $$(empty, "[data-slot]")
        .flatMap((el) => [...fieldsOf(el)])
        .sort(),
    ).toEqual(["accent", "icon", "state", "value"]);
  });
});

describe("status preview: scale to fit", () => {
  it("fits the hero to 60 % and the name to 80 % once they are laid out", () => {
    const observed: [HTMLElement, () => void][] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly cb: () => void) {}
        observe(el: HTMLElement): void {
          observed.push([el, this.cb]);
        }
      },
    );
    const canvas = render(
      { state: { value: "A long reading" } },
      "small",
      "A rather long widget name",
    );
    // A line `perPoint` wide per point of type size, in the 126 pt column.
    const perPoint = new Map<Node, number>();
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        const line = this.startContainer as HTMLElement;
        return { width: parseFloat(line.style.fontSize) * (perPoint.get(line) ?? 0) };
      },
    });
    const layOut = (el: HTMLElement, per: number): void => {
      perPoint.set(el, per);
      Object.defineProperty(el, "clientWidth", { get: () => 126 });
      el.getBoundingClientRect = () => ({ width: 126 }) as DOMRect;
    };
    const hero = $(canvas, ".pv-hero"),
      name = $(canvas, ".pv-name");
    layOut(hero, 4);
    layOut(name, 20);
    for (const [el, refit] of observed) if (el === hero || el === name) refit();
    // 40 pt would be 160 wide: 31.37 pt fits the 126 with half a point
    // clear.
    expect(parseFloat(hero.style.fontSize)).toBeCloseTo(31.37, 5);
    // 15 pt would be 300 wide: the name stops at 80 %.
    expect(parseFloat(name.style.fontSize)).toBeCloseTo(12, 5);
    // The weight follows the nominal size, not the scaled one.
    expect(hero.style.fontWeight).toBe("300");
  });
});
