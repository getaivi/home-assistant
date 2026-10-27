// Sourceable values: a literal control whose value can come from live
// state. The mode set comes from the backend's slot metadata, so a value
// the integration makes sourceable becomes editable with no panel change.

import { afterEach, describe, expect, it } from "vitest";
import {
  $,
  $$,
  fieldRow,
  mountPanel,
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

describe("sourceable values", () => {
  const modes = (r: HTMLElement): string[] => $$(sourceMenu(r), "option").map(text);

  it("offers a fixed value plus the sources the metadata declares", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "accent");
    expect(modes(r)).toEqual(["Fixed value", "By value", "Entity", "Attribute", "Template"]);
    // Unmarked while fixed; marked once the value follows a source.
    expect(sourceMenu(r).classList.contains("live")).toBe(false);
    setSelect(sourceMenu(r), "entity");
    await tick();
    expect(sourceMenu(fieldRow(sr(panel), "accent")).classList.contains("live")).toBe(true);
  });

  it("keeps every source menu at the trailing edge of its row", async () => {
    // One control, one position, whatever the field: the row's own menu
    // sits in the row's trailing cell, a sub-slot's at the end of its
    // option row. No field uses a segmented switch for its source.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const menus = $$(root, "aivi-field-row select.srcsel");
    expect(menus.length).toBeGreaterThan(4);
    for (const control of menus) {
      const cell = control.parentElement!;
      expect(
        cell.classList.contains("fsrc") || cell.classList.contains("orow"),
        control.getAttribute("aria-label") ?? "",
      ).toBe(true);
      expect(cell.lastElementChild).toBe(control);
    }
    expect($$(root, "aivi-field-row > .fsrc .seg")).toEqual([]);
  });

  it("keeps the literal as a fallback when a source is chosen", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = () => fieldRow(sr(panel), "accent");
    // The seeded widget has accent: "red".
    expect(editor.editorState.bindings["accent"]).toBe("red");
    setSelect(sourceMenu(r()), "template");
    await tick();
    // Switching modes must not throw away the swatch: it is what the
    // runtime uses whenever the template can't be read.
    expect(editor.editorState.bindings["accent"]).toBe("red");
    expect($(r(), ".vsrc .fallback aivi-color-field")).toBeTruthy();
    expect($(r(), ".vsrc textarea")).toBeTruthy();
  });

  it("sticks in a mode whose marker is still empty", async () => {
    // The reason for writing an empty marker: the switch must not
    // snap back while the user is still filling the template in.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = () => fieldRow(sr(panel), "accent");
    setSelect(sourceMenu(r()), "template");
    await tick();
    // It starts from the fixed color; emptied, it stays a template.
    expect(editor.editorState.bindings["accent__template"]).toBe("red");
    setInput($(r(), ".vsrc textarea"), "");
    await tick();
    expect(editor.editorState.bindings["accent__template"]).toBe("");
    editor.updateValidation();
    await tick();
    expect($(r(), ".vsrc textarea")).toBeTruthy();
    // …and the empty marker is dropped on the way out.
    expect(editor.prunedBindings()["accent__template"]).toBeUndefined();
  });

  it("sources a text field", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "thermostat");
    const r = () => fieldRow(sr(panel), "unit");
    expect(modes(r())).toContain("Template");
    setSelect(sourceMenu(r()), "entity");
    await tick();
    // Entity mode writes the explicit marker, never the bare key: the
    // bare key is the literal fallback for a literal-bare slot.
    expect(editor.editorState.bindings["unit__entity"]).toBe("");
    expect(editor.editorState.bindings["unit"]).toBeUndefined();
  });

  it("sources an icon's symbol and each of its three colors", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = () => fieldRow(sr(panel), "icon");
    expect(modes(r())).toEqual(["Fixed value", "Entity", "Attribute", "Template"]);
    setSelect(sourceMenu(r()), "template");
    await tick();
    // The symbol picker stays, as the fallback.
    expect(editor.editorState.bindings["icon__template"]).toBe("");
    expect($(r(), ".vsrc .fallback aivi-icon-field")).toBeTruthy();
    // The second and third colors sit in the symbol styling, each with
    // the menu every other color has.
    const rows = (): HTMLElement[] => $$(r(), ".fold .orow");
    expect(rows().map((o) => text($(o, ".k")))).toEqual(["Second color", "Third color"]);
    setSelect($(rows()[1]!, "select.srcsel"), "template");
    await tick();
    expect(editor.editorState.bindings["icon__tertiary_color__template"]).toBe("");
    expect(text($(r(), ".fold .fsum"))).toBe("1 set");
  });

  it("sources a value's text color independently of the value", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const color = $$(r, ".orow").find((o) => text($(o, ".k")).startsWith("Color"));
    expect(color, "the text color is its own sourceable slot").toBeTruthy();
    setSelect($(color!, "select.srcsel"), "template");
    await tick();
    // The value keeps its own entity source; only the color changed.
    expect(editor.editorState.bindings["state"]).toBe("input_boolean.front_door");
    expect(editor.editorState.bindings["state__color__template"]).toBe("");
  });
});
