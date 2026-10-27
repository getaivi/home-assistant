// The Countdown widget's preview at both sizes, against the app's
// Countdown template: what each family shows for a full payload, the
// expired, partial and empty states, the scale-to-fit of the name and
// the hero, and the field each region leads to.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX } from "../src/const";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import { countdownPreviewStyles } from "../src/styles/preview/countdown";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

const NOW = "2026-07-27T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** The docs' example payload, its target two days and two hours out. */
const TARGET = "2026-07-29T14:20:00Z";
const FULL: WidgetContent = {
  target: TARGET,
  subtitle: { value: "Paper & cardboard" },
  expired_text: "Out now",
  icon: { name: "trash.fill", primary_color: "green" },
};

const render = (content: WidgetContent, size: PreviewSize, name = "Garbage day"): HTMLElement =>
  $(previewWidget("countdown", name, content, size), ".pv-canvas");

/** The canvas's regions in document order, as [slot id, text]. */
const regions = (canvas: HTMLElement): [string, string][] =>
  $$(canvas, "[data-slot]").map((el) => [el.dataset["slot"] ?? "", text(el)]);

/** The fields a region leads to. */
const fields = (id: string): string[] => slotById("widget", "countdown", id)?.fields ?? [];

/** The target as the app's meta line words it, in the suite's locale. */
const targetDate = (iso: string): string =>
  new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(Date.parse(iso));

/** Lay text out at 0.4 of its font size per character, so the ruler the
 * renderer measures with has a width (happy-dom lays nothing out). */
function layOut(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = (parseFloat(this.style.fontSize) || 0) * 0.4 * (this.textContent ?? "").length;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
}

describe("countdown: small", () => {
  it("stacks the chip, then the name, the 32 pt hero and the subtitle at the bottom", () => {
    const canvas = render(FULL, "small");
    const col = $(canvas, ":scope > .pv-countdown-col");
    expect(canvas.children).toHaveLength(1);
    expect([...col.children].map((el) => el.className)).toEqual([
      "pv-countdown-top",
      "pv-grow",
      "pv-name pv-countdown-name",
      "pv-hero pv-countdown-hero",
      "pv-state pv-countdown-state",
    ]);
    expect(text($(col, ".pv-name"))).toBe("Garbage day");
    const hero = $(col, ".pv-hero");
    expect(text(hero)).toBe("2 days, 2 hr");
    // The hero: 32 pt earns Regular.
    expect(css(hero)).toBe("font-size:32px;font-weight:400;");
    const sub = $(col, ".pv-state");
    expect(text(sub)).toBe("Paper & cardboard");
    // No color of its own: the accent, which falls back to the icon's.
    expect(css(sub)).toContain(COLOR_HEX.green);
    // The 28 pt chip, its symbol in the accent.
    const chip = $(col, ".pv-countdown-top > .pv-chip.pv-countdown-chip-small");
    expect(css(chip)).toContain(`color:${COLOR_HEX.green}`);
    // Small has no room for the target date.
    expect(col.querySelector(".pv-meta")).toBeNull();
  });

  it("maps each region to its fields", () => {
    expect(regions(render(FULL, "small"))).toEqual([
      ["icon", "✦"],
      ["hero", "2 days, 2 hr"],
      ["caption", "Paper & cardboard"],
    ]);
    expect(fields("hero")).toEqual(["target", "expired_text"]);
    expect(fields("caption")).toEqual(["subtitle"]);
    expect(fields("icon")).toEqual(["icon", "accent"]);
  });

  it("ticks as a timer inside the last day", () => {
    const canvas = render({ ...FULL, target: "2026-07-27T18:30:00Z" }, "small");
    expect(text($(canvas, ".pv-hero"))).toBe("6:30:00");
  });

  it("shows the expired text once the target has passed, Done without one", () => {
    const past = "2026-07-27T11:00:00Z";
    expect(text($(render({ ...FULL, target: past }, "small"), ".pv-hero"))).toBe("Out now");
    expect(text($(render({ target: past }, "small"), ".pv-hero"))).toBe("Done");
  });

  it("paints the subtitle in its own color over the accent", () => {
    const canvas = render({ ...FULL, subtitle: { value: "Late", text_color: "red" } }, "small");
    const sub = $(canvas, ".pv-state");
    expect(css(sub)).toContain(COLOR_HEX.red);
    expect(css(sub)).not.toContain(COLOR_HEX.green);
  });

  it("keeps a dashed placeholder for the subtitle and the icon of a bare target", () => {
    const canvas = render({ target: TARGET }, "small", "Bin day");
    expect(regions(canvas)).toEqual([
      ["icon", "Icon"],
      ["hero", "2 days, 2 hr"],
      ["caption", "Subtitle"],
    ]);
    expect($$(canvas, "[data-ghost]").map((el) => el.dataset["slot"])).toEqual(["icon", "caption"]);
    expect($(canvas, '[data-slot="icon"]').className).toBe(
      "pv-ghost is-dark is-chip pv-countdown-chip-small",
    );
  });

  it("is the name over three placeholders with nothing bound", () => {
    const canvas = render({}, "small", "Bin day");
    expect(text($(canvas, ".pv-name"))).toBe("Bin day");
    expect(canvas.querySelector(".pv-hero")).toBeNull();
    expect($$(canvas, "[data-ghost]").map((el) => [el.dataset["slot"], text(el)])).toEqual([
      ["icon", "Icon"],
      ["hero", "Target time"],
      ["caption", "Subtitle"],
    ]);
  });

  it("shows a target that is not a date as it is", () => {
    expect(text($(render({ target: "whenever" }, "small"), ".pv-hero"))).toBe("whenever");
  });
});

describe("countdown: medium", () => {
  it("puts the name over the 40 pt hero, subtitle and target date, the 44 pt chip top right", () => {
    const canvas = render(FULL, "medium");
    expect(canvas.querySelector(".wfit")).toBeNull();
    const row = $(canvas, ":scope > .pv-countdown-row");
    expect([...row.children].map((el) => el.className)).toEqual([
      "pv-countdown-lead",
      "pv-chip pv-countdown-chip-large",
    ]);
    const lead = $(row, ".pv-countdown-lead");
    expect([...lead.children].map((el) => el.className)).toEqual([
      "pv-name pv-countdown-name",
      "pv-grow",
      "pv-hero pv-countdown-hero",
      "pv-state pv-countdown-state",
      "pv-meta pv-countdown-meta",
    ]);
    expect(text($(lead, ".pv-name"))).toBe("Garbage day");
    const hero = $(lead, ".pv-hero");
    expect(text(hero)).toBe("2 days, 2 hr");
    // The hero: 40 pt earns Light.
    expect(css(hero)).toBe("font-size:40px;font-weight:300;");
    expect(text($(lead, ".pv-state"))).toBe("Paper & cardboard");
    expect(css($(lead, ".pv-state"))).toContain(COLOR_HEX.green);
    expect(text($(lead, ".pv-meta"))).toBe(targetDate(FULL.target ?? ""));
    expect(text($(lead, ".pv-meta"))).toMatch(/^Wed, Jul 29\D+\d{1,2}:20/);
    expect(css($(row, ".pv-chip"))).toContain(COLOR_HEX.green);
  });

  it("maps each region to its fields, the target date to the target's", () => {
    expect(regions(render(FULL, "medium"))).toEqual([
      ["hero", "2 days, 2 hr"],
      ["caption", "Paper & cardboard"],
      ["hero", targetDate(FULL.target ?? "")],
      ["icon", "✦"],
    ]);
  });

  it("keeps the target date under the expired text", () => {
    const past = "2026-07-27T11:00:00Z";
    const canvas = render({ ...FULL, target: past }, "medium");
    expect(text($(canvas, ".pv-hero"))).toBe("Out now");
    expect(text($(canvas, ".pv-meta"))).toBe(targetDate(past));
  });

  it("keeps a dashed placeholder for the subtitle and the icon of a bare target", () => {
    const canvas = render({ target: TARGET }, "medium", "Bin day");
    expect(regions(canvas)).toEqual([
      ["hero", "2 days, 2 hr"],
      ["caption", "Subtitle"],
      ["hero", targetDate(FULL.target ?? "")],
      ["icon", "Icon"],
    ]);
    expect($(canvas, '[data-slot="icon"]').className).toBe(
      "pv-ghost is-dark is-chip pv-countdown-chip-large",
    );
  });

  it("is the name over three placeholders with nothing bound, and no date", () => {
    const canvas = render({}, "medium", "Bin day");
    expect(text($(canvas, ".pv-name"))).toBe("Bin day");
    expect(canvas.querySelector(".pv-meta")).toBeNull();
    expect($$(canvas, "[data-ghost]").map((el) => [el.dataset["slot"], text(el)])).toEqual([
      ["hero", "Target time"],
      ["caption", "Subtitle"],
      ["icon", "Icon"],
    ]);
  });

  it("draws no date for a target that is not one", () => {
    const canvas = render({ target: "whenever" }, "medium");
    expect(text($(canvas, ".pv-hero"))).toBe("whenever");
    expect(canvas.querySelector(".pv-meta")).toBeNull();
  });
});

describe("countdown: scale to fit", () => {
  it("shrinks Small's hero to the 126 pt it has, Medium's fits its 230 pt", () => {
    layOut();
    // 12 characters: 153.6 pt wide at 32 pt, 192 pt at 40 pt. Half a
    // point of the 126 is kept clear.
    expect(css($(render(FULL, "small"), ".pv-hero"))).toBe("font-size:26.14px;font-weight:400;");
    expect(css($(render(FULL, "medium"), ".pv-hero"))).toBe("font-size:40px;font-weight:300;");
    // The ruler does not stay in the document.
    expect(document.body.children).toHaveLength(0);
  });

  it("stops at 0.6 of the hero's size and leaves the rest to the ellipsis", () => {
    layOut();
    const content = {
      ...FULL,
      target: "2026-07-27T11:00:00Z",
      expired_text: "Already out on the kerb",
    };
    expect(css($(render(content, "small"), ".pv-hero"))).toBe("font-size:19.2px;font-weight:400;");
    // 23 characters at 40 pt are 368 pt: 229.5 pt is a 24.94 pt hero.
    expect(css($(render(content, "medium"), ".pv-hero"))).toBe(
      "font-size:24.94px;font-weight:300;",
    );
  });

  it("shrinks a long name to 0.8 of its size, and no further", () => {
    layOut();
    expect(css($(render(FULL, "small"), ".pv-name"))).toBe("");
    const long = "A very long widget name that cannot fit";
    expect(css($(render(FULL, "small", long), ".pv-name"))).toBe("font-size:12px;");
    // 22 characters: 132 pt at 15 pt, 125.5 pt at 14.26 pt.
    expect(css($(render(FULL, "small", "Garbage and recycling!"), ".pv-name"))).toBe(
      "font-size:14.26px;",
    );
  });
});

describe("countdown: styles", () => {
  const sheet = countdownPreviewStyles.cssText;

  it("truncates the target date on one line and gives each line its font's height", () => {
    expect(sheet).toMatch(
      /\.pv-countdown-meta \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/,
    );
    expect(sheet).toMatch(/\.pv-countdown-hero \{\s*line-height: 1\.193;/);
  });

  it("sizes the medium chip at 44 pt with a 22 pt symbol", () => {
    expect(sheet).toMatch(
      /\.pv-countdown-chip-large \{ width: 44px; height: 44px; font-size: 22px;/,
    );
  });
});
