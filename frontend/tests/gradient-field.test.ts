// The gradient field: its stops are color fields, the stored value is
// comma-separated text, and adding or removing a stop
// never drops focus. Colors come from the generated META palette.

import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-color-field";
import "../src/aivi-gradient-field";
import "../src/aivi-swatches";
import type { AiviGradientField } from "../src/aivi-gradient-field";
import {
  $,
  $$,
  META,
  mountPanel,
  openColor,
  openWidgetEditor,
  setInput,
  sr,
  text,
  tick,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(
  value: string | null,
): Promise<{ el: AiviGradientField; onChange: ReturnType<typeof vi.fn> }> {
  const el = document.createElement("aivi-gradient-field") as AiviGradientField;
  const onChange = vi.fn();
  el.colors = META.colors;
  el.value = value;
  el.label = "Gradient";
  el.onChange = onChange;
  document.body.append(el);
  await tick();
  return { el, onChange };
}

const stops = (el: HTMLElement): HTMLElement[] => $$(el, ".gstop aivi-color-field");

describe("aivi-gradient-field", () => {
  it("a comma typed in a stop never splits it into more stops", async () => {
    // Stops are stored joined by commas and read back by splitting on
    // them, so "a,b,c" in one hex box must not make four stops of two.
    const { el, onChange } = await mount("red, blue");
    const box = $(await openColor(stops(el)[0]!), 'input[aria-label$="hex code"]');
    setInput(box, "a,b,c");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("abc, blue");
    expect(stops(el)).toHaveLength(2);
    // Only commas: the stop keeps what it had.
    setInput($(el, 'input[aria-label$="hex code"]'), ",,");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("abc, blue");
  });

  it("moves focus to the new stop when adding takes the Add button away", async () => {
    // The third stop is the last: the button that was pressed is gone,
    // and focus must not fall to the page.
    const { el } = await mount("red, blue");
    const add = $(el, ".gstops > .btn");
    add.focus();
    add.click();
    await tick();
    expect(stops(el)).toHaveLength(3);
    expect(el.querySelector(".gstops > .btn")).toBeNull();
    expect(document.activeElement).toBe($(stops(el)[2]!, ".cfbtn"));
  });

  it("keeps focus on the Add button while there is room for more", async () => {
    // A stored one-stop gradient (typed by hand, not through the builder).
    const { el } = await mount("red");
    const add = $(el, ".gstops > .btn");
    add.focus();
    add.click();
    await tick();
    expect(stops(el)).toHaveLength(2);
    expect(document.activeElement).toBe($(el, ".gstops > .btn"));
  });

  it("moves focus to the stop left in place when one is removed", async () => {
    // Two stops have no remove buttons: the one pressed is gone.
    const { el, onChange } = await mount("red, blue, green");
    const remove = $$(el, ".gstop .rm")[2]!;
    remove.focus();
    remove.click();
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("red, blue");
    expect(el.querySelector(".gstop .rm")).toBeNull();
    expect(document.activeElement).toBe($(stops(el)[1]!, ".cfbtn"));
  });

  it("says one thing about one bad stop", async () => {
    // The stop's own field marks it; the gradient does not repeat it as
    // a second alert.
    const { el } = await mount("#12, blue");
    expect(text(el).match(/Use a hex code/g)).toHaveLength(1);
    expect(text(el)).not.toContain("One of the stops is not a color");
    expect($$(el, '[role="alert"]')).toHaveLength(0);
    // The gradient itself reports a wrong number of stops.
    const one = await mount("red");
    expect(text($(one.el, '[role="alert"]'))).toBe("A gradient needs 2 or 3 colors.");
  });

  it("remembers the custom stops while the row is collapsed", async () => {
    // The memory is not the element's own, as collapsing a row unmounts it:
    // Custom, None, collapse, expand, Custom brings back the stops, not
    // the seed.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "livingroom");
    const checks = $(sr(panel), "aivi-rows-checklist");
    const gradient = (): HTMLElement => $(checks, "aivi-gradient-field");
    const modes = (): HTMLElement[] => $$(gradient(), '[role="radio"]');
    const options = (): Record<string, string> | undefined =>
      (
        editor.editorState.bindings["actions__options"] as
          | Record<string, Record<string, string>>
          | undefined
      )?.["light.porch"];
    (
      $(checks, "aivi-entity-combobox.rowadd") as unknown as {
        onSelect(id: string): void;
      }
    ).onSelect("light.porch");
    await tick();
    const header = (): HTMLElement => $$(checks, ".rowtoggle")[0]!;
    header().click();
    await tick();
    modes()[2]!.click();
    await tick();
    $(await openColor(stops(gradient())[1]!), 'button[title="Teal"]').click();
    await tick();
    expect(options()?.["gradient"]).toBe("#FFD27A, teal");
    modes()[1]!.click();
    await tick();
    // What is remembered is not stored: None is all a save would hold.
    expect(options()?.["gradient"]).toBe("none");
    expect(JSON.stringify(editor.prunedBindings())).not.toContain("teal");
    header().click();
    await tick();
    expect(checks.querySelector("aivi-gradient-field")).toBeNull();
    header().click();
    await tick();
    modes()[2]!.click();
    await tick();
    expect(options()?.["gradient"]).toBe("#FFD27A, teal");
  });
});
