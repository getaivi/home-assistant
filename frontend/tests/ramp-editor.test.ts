// The ring color editor's behavior:
// nothing chosen is its own state (the built-in range, shown and
// selected), no press writes a color nobody chose, the palette opens and
// closes like the kit's other popovers, and focus follows the stop.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import { addStop, effectiveStops, storedStops } from "../src/ramp";
import { enumLabel } from "../src/util";
import { $, $$, mountPanel, openWidgetEditor, sr, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

async function ring(): Promise<{ panel: AiviPanel; editor: AiviEditor; r: HTMLElement }> {
  const panel = await mountPanel();
  const editor = await openWidgetEditor(panel, "thermostat");
  return { panel, editor, r: $(sr(panel), 'aivi-field-row[data-key="ring"]') };
}
const mode = (r: HTMLElement): string => text($(r, ".seg button.on"));
const stops = (r: HTMLElement): string[] => $$(r, ".rstop .rlabel").map(text);
const press = async (el: HTMLElement): Promise<void> => {
  el.click();
  await tick();
};
const seg = (r: HTMLElement, label: string): HTMLElement =>
  $$(r, ".seg button").find((b) => text(b) === label)!;
const active = (panel: AiviPanel): Element | null => sr(panel).activeElement;

describe("the stored shape", () => {
  it("stores the built-in range as nothing, and shows nothing as the built-in range", () => {
    expect(storedStops(["cyan", "green", "orange"])).toEqual([]);
    expect(storedStops(["green", "red"])).toEqual(["green", "red"]);
    expect(effectiveStops([])).toEqual(["cyan", "green", "orange"]);
    expect(effectiveStops(["red"])).toEqual(["red"]);
  });

  it("adds the first palette color the range does not use yet", () => {
    expect(addStop(["red", "orange"], ["red", "orange", "yellow"])).toEqual([
      "red",
      "orange",
      "yellow",
    ]);
    // Every color used: repeat the last rather than fail.
    expect(addStop(["red"], ["red"])).toEqual(["red", "red"]);
  });
});

describe("nothing chosen", () => {
  it("is the Built-in range: its card selected, its three stops listed, nothing stored", async () => {
    const { editor, r } = await ring();
    expect(mode(r)).toBe("Color range");
    expect(text($(r, ".rpreset.on .rpname"))).toBe("Built-in");
    expect(stops(r)).toEqual(["Cyan", "Green", "Orange"]);
    expect(editor.editorState.bindings["ring"]).toBeUndefined();
    expect(r.querySelector(".tnote")).toBeNull();
  });

  it("Add a color builds on the range instead of flipping to One color", async () => {
    const { editor, r } = await ring();
    await press($(r, ".radd"));
    expect(mode(r)).toBe("Color range");
    expect(stops(r)).toHaveLength(4);
    expect(editor.editorState.bindings["ring"]).toHaveLength(4);
    // The new stop is a color the range did not have, not a repeat.
    expect(new Set(editor.editorState.bindings["ring"] as string[]).size).toBe(4);
  });

  it("looking at One color and coming back writes nothing", async () => {
    const { editor, r } = await ring();
    await press(seg(r, "One color"));
    expect(editor.editorState.bindings["ring"]).toBeUndefined();
    // One color asks for a color; its popover offers no Default.
    expect(text($(r, ".rsolid .cfname"))).toBe("Pick a color");
    expect(text($(r, ".rsolid .fhint"))).toContain("keeps its color range");
    await press($(r, ".rsolid .cfbtn"));
    expect(r.querySelector(".cfpop .cfnone")).toBeNull();
    await press(seg(r, "Color range"));
    expect(editor.editorState.bindings["ring"]).toBeUndefined();
    expect(stops(r)).toEqual(["Cyan", "Green", "Orange"]);
  });

  it("the Built-in card is the way back to nothing chosen", async () => {
    const { editor, r } = await ring();
    await press($$(r, ".rpreset")[2]!);
    expect(editor.editorState.bindings["ring"]).toEqual(["green", "yellow", "red"]);
    await press($$(r, ".rpreset")[0]!);
    expect(editor.editorState.bindings["ring"]).toBeUndefined();
    expect(text($(r, ".rpreset.on .rpname"))).toBe("Built-in");
  });
});

describe("a range being built", () => {
  it("stays a range at one stop, where Remove waits for a second color", async () => {
    const { editor, r } = await ring();
    await press($$(r, ".rpreset")[1]!); // blue, orange, red
    await press($$(r, ".rdel")[2]!);
    await press($$(r, ".rdel")[1]!);
    expect(editor.editorState.bindings["ring"]).toEqual(["blue"]);
    expect(mode(r)).toBe("Color range");
    expect(stops(r)).toEqual(["Blue"]);
    expect(($(r, ".rdel") as HTMLButtonElement).disabled).toBe(true);
    expect(text($(r, ".rlist + .fhint"))).toContain("Add another");
  });

  it("says why no more can be added at the cap", async () => {
    const { r } = await ring();
    await press($(r, ".radd"));
    expect(r.querySelector(".radd")).toBeNull();
    expect(text($(r, ".rfull"))).toBe("Up to 4 colors");
  });
});

describe("a stop's palette", () => {
  it("takes focus when it opens and hands it back to the stop when a color is picked", async () => {
    const { panel, editor, r } = await ring();
    await press($$(r, ".rpreset")[1]!);
    await press($$(r, ".rdot")[1]!);
    await tick();
    expect(active(panel)?.closest(".rpick")).toBeTruthy();
    expect(active(panel)?.getAttribute("aria-pressed")).toBe("true");
    const green = $$(r, ".rpick .sw").find((b) => b.getAttribute("aria-label") === "Green")!;
    await press(green);
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["blue", "green", "red"]);
    expect(r.querySelector(".rpick")).toBeNull();
    expect(active(panel)).toBe($$(r, ".rdot")[1]);
    expect(text($(r, '[role="status"]'))).toBe("Color 2 is now Green");
  });

  it("closes on Escape (focus back on the stop) and on a press outside", async () => {
    const { panel, r } = await ring();
    await press($$(r, ".rpreset")[1]!);
    await press($$(r, ".rdot")[0]!);
    await tick();
    active(panel)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await tick();
    await tick();
    expect(r.querySelector(".rpick")).toBeNull();
    expect(active(panel)).toBe($$(r, ".rdot")[0]);
    await press($$(r, ".rdot")[0]!);
    $(sr(panel), ".topbar").dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
    await tick();
    expect(r.querySelector(".rpick")).toBeNull();
  });

  it("opens for the stop Add a color just made, with focus in it", async () => {
    const { panel, r } = await ring();
    await press($$(r, ".rpreset")[1]!);
    await press($(r, ".radd"));
    await tick();
    expect($$(r, ".rstop")[3]!.querySelector(".rpick")).toBeTruthy();
    expect(active(panel)?.closest(".rpick")).toBeTruthy();
  });
});

describe("reordering", () => {
  it("keeps focus on the stop that moved, on the control that moved it", async () => {
    const { panel, editor, r } = await ring();
    await press($$(r, ".rpreset")[1]!); // blue, orange, red
    // Down: the moved stop's Move down keeps focus, so pressing again goes on.
    await press($$(r, ".rstop")[0]!.querySelector<HTMLElement>(".rmv.down")!);
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["orange", "blue", "red"]);
    expect(active(panel)).toBe($$(r, ".rstop")[1]!.querySelector(".rmv.down"));
    // Up into first place: Move up is disabled there, so the stop's color
    // takes focus rather than the other stop's button.
    await press($$(r, ".rstop")[1]!.querySelector<HTMLElement>(".rmv.up")!);
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["blue", "orange", "red"]);
    expect(active(panel)).toBe($$(r, ".rstop")[0]!.querySelector(".rdot"));
    // Alt+Arrow from the color keeps focus on the color.
    $$(r, ".rdot")[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    await tick();
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["orange", "blue", "red"]);
    expect(active(panel)).toBe($$(r, ".rstop")[1]!.querySelector(".rdot"));
  });

  it("keeps focus on a Remove after removing a stop", async () => {
    const { panel, r } = await ring();
    await press($$(r, ".rpreset")[1]!);
    await press($$(r, ".rdel")[2]!);
    await tick();
    expect(active(panel)).toBe($$(r, ".rdel")[1]);
  });
});

describe("one color by value", () => {
  it("follows the gauge's reading in bands drawn on the dial, and leaves the range as it was", async () => {
    const { editor, r } = await ring();
    const b = editor.editorState.bindings;
    b["value"] = "sensor.living_temp";
    b["min_value"] = 10;
    b["max_value"] = 30;
    await press($$(r, ".rpreset")[1]!);
    const range = [...(b["ring"] as string[])];
    await press(seg(r, "By value"));
    const row = r;
    expect(mode(row)).toBe("By value");
    // Thirds of the dial, on the gauge's own reading.
    expect(b["ring__bands"]).toEqual({
      entity: "sensor.living_temp",
      limits: [17, 23],
      values: ["red", "orange", "green"],
    });
    expect($$(row, ".btick").map(text)).toEqual(["10", "17", "23", "30"]);
    expect(row.querySelector(".btpl")).toBeNull();
    // Without a reading to place, the range's first color.
    expect(text($(row, ".fallback .cfname"))).toBe(enumLabel("color", range[0] ?? ""));
    await press(seg(row, "Color range"));
    expect(b["ring__bands"]).toBeUndefined();
    expect(b["ring"]).toEqual(range);
    // The bands come back with the mode.
    await press(seg(row, "By value"));
    expect((b["ring__bands"] as { limits: number[] }).limits).toEqual([17, 23]);
  });
});
