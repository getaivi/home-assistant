// The layout rules behind the long names, the layers and the toast.
// happy-dom computes no layout, so these read the stylesheet modules'
// source text (frontend/src/styles/*.ts) and assert that a named rule
// keeps the declaration the layout depends on.

import { afterEach, describe, expect, it } from "vitest";
import { $, mountPanel, openWidgetEditor, rule, sr, text } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("layout rules", () => {
  it("wrap a long unbreakable name inside its card", () => {
    // The card does not grow with the name, so the phone does not scroll
    // sideways.
    expect(rule("hub", ".wcard .nm")).toContain("overflow-wrap: anywhere");
    expect(rule("hub", ".wcard .nm")).toContain("min-width: 0");
    expect(rule("hub", ".cards")).toContain("minmax(min(300px, 100%), 1fr)");
  });

  it("wrap a long unbreakable name inside the leave dialog", () => {
    expect(rule("editor", "dialog.dlg p")).toContain("overflow-wrap: anywhere");
  });

  it("keep the sticky bar above the field popups and below the sheets", () => {
    // The entity list, color and icon popups do not paint over the bar.
    const z = (file: string, selector: string): number => {
      const match = /z-index: (\d+)/.exec(rule(file, selector));
      if (!match) throw new Error(`no z-index on ${selector}`);
      return Number(match[1]);
    };
    const bar = z("editor", ".edbar");
    for (const [file, selector] of [
      ["form", ".cbx-pop"],
      ["kit", ".cfpop"],
      ["kit", ".icpop"],
    ] as const)
      expect(z(file, selector)).toBeLessThan(bar);
    expect(bar).toBeLessThan(z("responsive", ":host([narrow]) .side"));
    expect(bar).toBeLessThan(z("toast", ".toast"));
  });

  it("keep the toast inside the viewport and off the phone's preview toggle", () => {
    expect(rule("toast", ".toast")).toContain("max-width: calc(100vw - 32px)");
    expect(rule("toast", ":host([narrow]) .wrap:has(aivi-editor) ~ .toasts .toast")).toMatch(
      /bottom: calc\(\d+px \+ env\(safe-area-inset-bottom/,
    );
  });

  it("give the widget name the phone's bar: Suggest goes by its icon", async () => {
    // The name is not cut to "Lau…" at 390 px. The label stays in the
    // DOM (visually hidden), so the button keeps its name.
    expect(rule("editor", ":host([narrow]) .aibtn > span")).toContain("clip: rect(0 0 0 0)");
    const panel = await mountPanel();
    panel.narrow = true;
    await openWidgetEditor(panel, "laundry");
    expect(text($(sr(panel), ".edbar .aibtn"))).toBe("Suggest");
  });
});
