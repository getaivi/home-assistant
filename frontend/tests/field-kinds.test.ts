// The plain field kinds of a field row: color, number, icon, text (with
// tap_url's suggestions and checks), enum, and the color ramp.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import {
  $,
  $$,
  fieldRow,
  mountPanel,
  openActivityEditor,
  openColor,
  openWidgetEditor,
  setInput,
  setSelect,
  sourceMenu,
  sr,
  text,
  tick,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("plain field kinds", () => {
  it("color: the accent field binds and clears the palette name", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "accent");
    // Bound fixture value is preselected.
    expect(text($(r, ".cfname"))).toBe("Red");
    const pop = await openColor(r);
    expect($(pop, "button.sw.sel").getAttribute("title")).toBe("Red");
    $(pop, 'button[title="Cyan"]').click();
    expect(editor.editorState.bindings["accent"]).toBe("cyan");
    // Default clears the pick.
    await tick();
    $(await openColor(r), ".cfnone").click();
    expect(editor.editorState.bindings["accent"]).toBeUndefined();
  });

  it("number_literal: parses numbers and clears on junk", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    const r = fieldRow(sr(panel), "min_value");
    setInput($(r, "input"), "42.5");
    expect(editor.editorState.bindings["min_value"]).toBe(42.5);
    setInput($(r, "input"), "abc");
    expect(editor.editorState.bindings["min_value"]).toBeUndefined();
  });

  it("icon: binds the symbol name, its color, and advanced styling", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "icon");
    setInput($(r, 'input[type="text"]'), "door.left.hand.open");
    expect(editor.editorState.bindings["icon"]).toBe("door.left.hand.open");
    $(await openColor($(r, ".fmain.r2 .vsrc")), 'button[title="Orange"]').click();
    expect(editor.editorState.bindings["icon__color"]).toBe("orange");
    const styling = $(r, "details.style");
    setSelect($$(styling, "select:not(.srcsel)")[0]!, "hierarchical");
    expect(editor.editorState.bindings["icon__rendering_mode"]).toBe("hierarchical");
  });

  it("icon: styling selects show display names over raw wire values", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "icon");
    const styling = $(r, "details.style");
    // Rendering mode: localized labels, raw META values on the wire.
    const rendering = $$(styling, "select:not(.srcsel)")[0]!;
    expect($$(rendering, "option").map(text)).toEqual([
      "Default",
      "Monochrome",
      "Hierarchical",
      "Palette",
      "Multicolor",
    ]);
    expect($$(rendering, "option").map((o) => o.getAttribute("value"))).toEqual([
      "",
      "monochrome",
      "hierarchical",
      "palette",
      "multicolor",
    ]);
    // Color style: unset shows the wire default (flat) by display name.
    const colorStyle = $$(styling, "select:not(.srcsel)")[1]!;
    expect($$(colorStyle, "option").map(text)).toEqual(["Solid", "Solid", "Gradient"]);
    setSelect(colorStyle, "gradient");
    expect(editor.editorState.bindings["icon__color_rendering"]).toBe("gradient");
  });

  it("text: tap_url suggests deep links derived from bound entities", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "tap_url");
    const chips = $$(r, ".urlsug .chip");
    // The fixture registries know front door's device, so the device
    // deep link leads; then the entity history link, then the dashboard.
    expect(chips.map(text)).toEqual([
      "Device: Front door sensor",
      "History: Front door open",
      "Dashboard",
    ]);
    chips[1]!.click();
    expect(editor.editorState.bindings["tap_url"]).toBe(
      "homeassistant://navigate/history?entity_id=input_boolean.front_door",
    );
    expect(($(r, "input") as HTMLInputElement).value).toContain(
      "history?entity_id=input_boolean.front_door",
    );
    // Chips are real buttons, so keyboard activation is the platform's;
    // clicking the dashboard chip applies its deep link.
    chips[2]!.click();
    expect(editor.editorState.bindings["tap_url"]).toBe("homeassistant://navigate/lovelace/0");
  });

  it("text: flags a tap_url Aivi would refuse and holds Save until fixed", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const save = (): HTMLButtonElement => $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save().disabled).toBe(false);
    const input = (): HTMLInputElement =>
      $(fieldRow(sr(panel), "tap_url"), "input") as HTMLInputElement;
    setInput(input(), "example.com/door");
    await tick();
    const note = $(fieldRow(sr(panel), "tap_url"), '.tnote.error[role="alert"]');
    expect(text(note)).toContain("Use a full URL");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(input().getAttribute("aria-describedby")).toBe(note.id);
    expect(save().disabled).toBe(true);
    expect(text($(sr(panel), ".form > .banner.error"))).toBe(
      "Fix the fields marked in red to save.",
    );
    // Any scheme is a URL to Aivi, deep links included.
    setInput(input(), "homeassistant://navigate/lovelace/0");
    await tick();
    expect(fieldRow(sr(panel), "tap_url").querySelector(".tnote.error")).toBeNull();
    expect(save().disabled).toBe(false);
    setInput(input(), `https://example.com/${"a".repeat(240)}`);
    await tick();
    expect(text($(fieldRow(sr(panel), "tap_url"), ".tnote.error"))).toBe(
      "The URL is longer than 256 characters.",
    );
    expect(editor.editorState.bindings["tap_url"]).toMatch(/^https:/);
  });

  it("text: tap_url suggestions track binding changes without a field edit", async () => {
    // The chips derive from the current bindings: rebinding an entity in
    // another row must refresh them though tap_url itself is untouched.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    expect($$(fieldRow(root, "tap_url"), ".urlsug .chip").map(text)).toContain(
      "History: Front door open",
    );
    const cbx = $(fieldRow(root, "state"), "aivi-entity-combobox") as AiviEntityCombobox;
    cbx.onSelect("climate.living_room");
    await tick();
    const chips = $$(fieldRow(root, "tap_url"), ".urlsug .chip").map(text);
    expect(chips).toEqual(["History: Living room thermostat", "Dashboard"]);

    // Template mode starts from the same entity, so the chips stay;
    // a template naming no entity empties the derived set down to the
    // dashboard fallback.
    setSelect(sourceMenu(fieldRow(root, "state")), "template");
    await tick();
    expect($$(fieldRow(root, "tap_url"), ".urlsug .chip").map(text)).toEqual(chips);
    setInput($(fieldRow(root, "state"), "textarea"), "{{ 'Closed' }}");
    await tick();
    expect($$(fieldRow(root, "tap_url"), ".urlsug .chip").map(text)).toEqual(["Dashboard"]);
  });

  it("text: tap_url's device deep link targets the registry's device id", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const chips = $$(fieldRow(sr(panel), "tap_url"), ".urlsug .chip");
    expect(chips[0]!.getAttribute("title")).toBe(
      "homeassistant://navigate/config/devices/device/dev-door",
    );
  });

  it("enum: options show display names but bind the raw wire value", async () => {
    const panel = await mountPanel();
    // The listed (unbound) grill activity carries the monitor template,
    // whose primary_column field is the only enum in the fixture META.
    const editor = await openActivityEditor(panel, "grill");
    // Both columns show something, so the choice is live.
    editor.editorState.bindings["left_value"] = "sensor.living_temp";
    editor.editorState.bindings["right_value"] = "sensor.outdoor_temp";
    editor.applySuggestion();
    await tick();
    const r = fieldRow(sr(panel), "primary_column");
    const opts = $$(r, "select option");
    expect(opts.map(text)).toEqual(["None", "Left", "Right"]);
    expect(opts.map((o) => o.getAttribute("value"))).toEqual(["", "left", "right"]);
    setSelect($(r, "select"), "right");
    expect(panel.editorState?.bindings["primary_column"]).toBe("right");
  });

  it("enum: a choice between two columns waits until both show something", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "grill");
    const select = (): HTMLSelectElement =>
      $(fieldRow(sr(panel), "primary_column"), "select") as HTMLSelectElement;
    const hint = (): string => text($(fieldRow(sr(panel), "primary_column"), ".fhint"));
    // Nothing set yet: the choice is disabled, and its hint says why.
    expect(select().disabled).toBe(true);
    expect(hint()).toContain("once both columns show something");
    // One column is still nothing to choose between.
    editor.editorState.bindings["right_value"] = "sensor.living_temp";
    editor.applySuggestion();
    await tick();
    expect(select().disabled).toBe(true);
    // Anything in the other column (a header counts) makes it a choice.
    editor.editorState.bindings["left_header"] = "Inside";
    editor.applySuggestion();
    await tick();
    expect(select().disabled).toBe(false);
    expect(hint()).toContain("Dynamic Island");
  });

  it("colors: a preset writes the whole ring ramp in one press", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    const r = fieldRow(sr(panel), "ring");
    $$(r, ".rpreset")[1]!.click(); // Cool to warm
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["blue", "orange", "red"]);
    // The applied preset is the one shown as active.
    expect($$(r, ".rpreset")[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("colors: reordering a stop is a move, never a delete-then-add", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    const r = fieldRow(sr(panel), "ring");
    $$(r, ".rpreset")[2]!.click(); // Good to bad: green, yellow, red
    await tick();
    $(r, ".rfoot .btn:last-of-type").click(); // Reverse
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["red", "yellow", "green"]);
    // A move never passes through a state with fewer stops, so the wire
    // key never flips to solid mid-edit.
    $$(r, ".rstop")[0]!.querySelectorAll<HTMLElement>(".rmv")[1]!.click();
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["yellow", "red", "green"]);
  });

  it("colors: says where each stop lands in the gauge's own units", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    editor.editorState.bindings["min_value"] = 0;
    editor.editorState.bindings["max_value"] = 100;
    editor.editorState.bindings["unit"] = "°C";
    const r = fieldRow(sr(panel), "ring");
    $$(r, ".rpreset")[2]!.click();
    await tick();
    // Rows pick the range up on the next validation nudge, which is what
    // the debounced preview round-trip does after a min/max edit.
    editor.updateValidation();
    await tick();
    expect($$(fieldRow(sr(panel), "ring"), ".rwhere").map(text)).toEqual([
      "at 0 °C",
      "at 50 °C",
      "at 100 °C",
    ]);
  });

  it("colors: solid mode keeps one color and remembers the ramp", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    const r = fieldRow(sr(panel), "ring");
    $$(r, ".rpreset")[2]!.click();
    await tick();
    const seg = (label: string): HTMLElement =>
      $$(r, '.seg[role="radiogroup"] button').find((b) => text(b) === label)!;
    seg("One color").click();
    await tick();
    // Only the first stop is pushed, so the wire key matches the mode.
    expect(editor.editorState.bindings["ring"]).toEqual(["green"]);
    seg("Color range").click();
    await tick();
    expect(editor.editorState.bindings["ring"]).toEqual(["green", "yellow", "red"]);
  });
});
