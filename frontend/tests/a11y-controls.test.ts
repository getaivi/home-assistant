// Accessibility contracts of the form kit's controls: the segmented
// switch (an APG radio group whose arrows move and select), the swatches
// (toggle buttons with a roving tabindex) and the color ramp editor.

import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-color-ramp";
import type { AiviColorRamp } from "../src/aivi-color-ramp";
import type { AiviSwatches } from "../src/aivi-swatches";
import { $, $$, key, mountPanel, openWidgetEditor, sr, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("segmented radiogroup", () => {
  it("exposes radios with a roving tabindex and a group name", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const seg = $(sr(panel), '.field[data-key="segments"] .barmode .seg');
    expect(seg.getAttribute("role")).toBe("radiogroup");
    expect(seg.getAttribute("aria-label")).toBe("Bar style");
    const radios = $$(seg, "button");
    expect(radios.map((r) => r.getAttribute("role"))).toEqual(["radio", "radio"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1"]);
  });

  it("ArrowRight moves selection and focus; Home/End jump; wraps around", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const seg = (): HTMLElement => $(sr(panel), '.field[data-key="segments"] .barmode .seg');
    const checked = (): (string | null)[] =>
      $$(seg(), "button").map((r) => r.getAttribute("aria-checked"));
    key($$(seg(), "button")[0]!, "ArrowRight");
    await tick();
    // Selection followed the arrow: the bar is segmented.
    expect(editor.barMode()).toBe("segmented");
    expect(checked()).toEqual(["false", "true"]);
    expect($$(seg(), "button").map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    key($$(seg(), "button")[1]!, "Home");
    await tick();
    expect(editor.barMode()).toBe("solid");
    key($$(seg(), "button")[0]!, "End");
    await tick();
    expect(editor.barMode()).toBe("segmented");
    key($$(seg(), "button")[1]!, "ArrowRight"); // wraps to the first
    await tick();
    expect(checked()).toEqual(["true", "false"]);
  });
});

async function mountSwatches(value: string | null = null): Promise<AiviSwatches> {
  const el = document.createElement("aivi-swatches") as AiviSwatches;
  el.colors = ["red", "green", "blue", "cyan"];
  el.value = value;
  el.onChange = () => {};
  document.body.append(el);
  await tick();
  return el;
}

describe("single-pick swatches", () => {
  it("is a set of aria-pressed toggle buttons with one tab stop", async () => {
    const el = await mountSwatches("green");
    const dots = $$(el, "button.sw");
    expect(dots.map((d) => d.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
      "false",
    ]);
    // The selected dot is the roving tab stop.
    expect(dots.map((d) => d.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
  });

  it("arrows move focus (wrapping); Home/End jump; click toggles", async () => {
    const el = await mountSwatches();
    const dots = (): HTMLElement[] => $$(el, "button.sw");
    expect(dots()[0]!.getAttribute("tabindex")).toBe("0");
    key(dots()[0]!, "ArrowRight");
    await tick();
    expect(document.activeElement).toBe(dots()[1]);
    expect(dots()[1]!.getAttribute("tabindex")).toBe("0");
    key(dots()[1]!, "ArrowLeft");
    key(dots()[0]!, "ArrowLeft"); // wraps to the last
    await tick();
    expect(document.activeElement).toBe(dots()[3]);
    key(dots()[3]!, "Home");
    await tick();
    expect(document.activeElement).toBe(dots()[0]);
    key(dots()[0]!, "End");
    await tick();
    expect(document.activeElement).toBe(dots()[3]);
    const onChange = vi.fn();
    el.onChange = onChange as unknown as (c: string | null) => void;
    dots()[3]!.click();
    await tick();
    expect(onChange).toHaveBeenCalledWith("cyan");
    expect(dots()[3]!.getAttribute("aria-pressed")).toBe("true");
    dots()[3]!.click(); // second activation clears the pick
    await tick();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("color ramp editor", () => {
  async function mount(value: string[] = []): Promise<AiviColorRamp> {
    const el = document.createElement("aivi-color-ramp") as AiviColorRamp;
    el.colors = ["red", "green", "blue", "cyan"];
    el.value = value;
    el.maxStops = 3;
    el.label = "Ring color";
    el.rangeMin = 0;
    el.rangeMax = 100;
    el.onChange = () => {};
    document.body.append(el);
    await tick();
    return el;
  }

  it("announces every stop change through a live region", async () => {
    const el = await mount(["red", "green"]);
    const status = (): string => text($(el, '.sr-only[role="status"]'));
    $$(el, ".rstop .rmv")[1]!.click(); // move stop 1 down
    await tick();
    expect(status()).toBe("Red moved to 2 of 2");
    $(el, ".rfoot .btn").click(); // add
    await tick();
    expect(status()).toBe("Color 3 added, 3 in total");
    $$(el, ".rstop .rdel")[0]!.click();
    await tick();
    expect(status()).toBe("Green removed, 2 left");
  });

  it("gives every stop control an accessible name carrying its position", async () => {
    const el = await mount(["red", "green"]);
    expect($$(el, ".rstop .rdot")[0]!.getAttribute("aria-label")).toBe("Color 1: Red");
    expect($$(el, ".rstop .rdel")[1]!.getAttribute("aria-label")).toBe("Remove color 2, Green");
    // Every move button names the stop it moves.
    expect($$(el, ".rstop .rmv").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Move color 1, Red, up",
      "Move color 1, Red, down",
      "Move color 2, Green, up",
      "Move color 2, Green, down",
    ]);
    // The move buttons at the ends are disabled, not silently inert.
    expect($$(el, ".rstop")[0]!.querySelector(".rmv")).toHaveProperty("disabled", true);
  });

  it("moves a stop with Alt+Arrow from anywhere in its row", async () => {
    const el = await mount(["red", "green", "blue"]);
    const row = $$(el, ".rstop")[2]!;
    row.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
      }),
    );
    await tick();
    expect(el.value).toEqual(["red", "blue", "green"]);
  });

  it("keeps arrow-key navigation over each stop's palette", async () => {
    const el = await mount(["red", "green"]);
    $$(el, ".rstop .rdot")[0]!.click();
    await tick();
    const dots = (): HTMLElement[] => $$(el, ".rpick button.sw");
    key(dots()[0]!, "ArrowDown");
    await tick();
    expect(document.activeElement).toBe(dots()[1]);
  });
});
