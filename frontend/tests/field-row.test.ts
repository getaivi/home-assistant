// Field rows and where their value comes from: the Entity/Attribute/
// Template source menu, what each source keeps across a switch,
// watched-entity auto-detection for Jinja templates, the attribute picker,
// inline template feedback, and the style disclosure.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import {
  $,
  $$,
  fieldRow,
  mountPanel,
  openColor,
  openWidgetEditor,
  STATES,
  setInput,
  setSelect,
  sourceMenu,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

function pickSource(r: HTMLElement, id: string): void {
  setSelect(sourceMenu(r), id);
}

describe("source switch", () => {
  it("defaults to Entity and derives the mode from binding markers", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    expect($$(sourceMenu(r), "option").map(text)).toEqual(["Entity", "Attribute", "Template"]);
    expect(($(sourceMenu(r), "option[selected]") as HTMLOptionElement).value).toBe("entity");
    // Unmarked on its default source, marked once it leaves it.
    expect(sourceMenu(r).classList.contains("live")).toBe(false);
    expect(r.querySelector("aivi-entity-combobox")).not.toBeNull();
    // Picking the already-active source is a no-op.
    const before = { ...panel.editorState?.bindings };
    pickSource(r, "entity");
    await tick();
    expect(panel.editorState?.bindings).toEqual(before);
    pickSource(r, "attribute");
    await tick();
    expect(sourceMenu(r).classList.contains("live")).toBe(true);
  });

  it("Template mode starts from the entity and shows the editor", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "template");
    await tick();
    const b = editor.editorState.bindings;
    expect(b["state"]).toBeUndefined();
    expect(b["state__template"]).toBe("{{ states('input_boolean.front_door') }}");
    expect(r.querySelector("textarea")).not.toBeNull();
    // The required field stays filled.
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(false);
    // Emptied, the box says nothing yet, and Save waits for it.
    setInput($(r, "textarea"), "");
    await tick();
    expect(b["state__template"]).toBe("");
    expect(text($(r, ".tfb"))).toBe("");
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto-detects watched entities from the template text", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "template");
    await tick();
    setInput($(r, "textarea"), "{{ states('sensor.living_temp') }} / {{ states('sensor.nope') }}");
    await tick();
    const b = editor.editorState.bindings;
    expect(b["state__template"]).toContain("sensor.living_temp");
    // Only ids that exist in hass.states are watched.
    expect(b["state__watched"]).toEqual(["sensor.living_temp"]);
    setInput($(r, "textarea"), "no entities here");
    await tick();
    expect(b["state__watched"]).toBeUndefined();
  });

  it("Attribute mode keeps the entity and asks for an attribute pick", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "attribute");
    await tick();
    const b = editor.editorState.bindings;
    // The bound entity survives the switch; the attribute is still open.
    expect(b["state"]).toBe("input_boolean.front_door");
    expect(b["state__attribute"]).toBe("");

    // Picking a new entity resets the attribute and rebuilds the picker.
    const cbx = $(r, "aivi-entity-combobox") as AiviEntityCombobox;
    cbx.onSelect("climate.living_room");
    await tick();
    const select = $(r, ".subrow select");
    const opts = $$(select, "option").map((o) => o.getAttribute("value"));
    // friendly_name and icon never appear as attribute choices.
    expect(opts).toEqual(["", "current_temperature", "temperature", "hvac_action"]);
    setSelect(select, "current_temperature");
    await tick();
    expect(b["state__attribute"]).toBe("current_temperature");
    // Done state: the badge swaps "required" for the mdi check icon.
    expect($(r, ".freq .icon")).toBeTruthy();
    expect(text($(r, ".freq"))).toBe("");

    // Switching back to Entity clears the markers but keeps the entity.
    pickSource(r, "entity");
    await tick();
    expect(b["state__attribute"]).toBeUndefined();
    expect(b["state"]).toBe("climate.living_room");
  });

  it("shows the pick-an-entity hint in attribute mode with no entity", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const r = fieldRow(sr(panel), "progress");
    pickSource(r, "attribute");
    await tick();
    expect(editor.editorState.bindings["progress__attribute"]).toBe("");
    expect(text($(r, ".subrow"))).toContain("Pick an entity first");
  });
});

describe("source switching keeps what was entered", () => {
  const TPL = "{{ states('sensor.living_temp') }}";

  function cbx(r: HTMLElement): AiviEntityCombobox {
    return $(r, "aivi-entity-combobox") as AiviEntityCombobox;
  }

  it("brings the entity back after a detour through Template", async () => {
    // Entity to Template remembers the entity, so switching back
    // restores it without picking it again.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const b = editor.editorState.bindings;
    pickSource(r, "template");
    await tick();
    expect(b["state"]).toBeUndefined();
    pickSource(r, "entity");
    await tick();
    expect(b["state"]).toBe("input_boolean.front_door");
    expect(($(cbx(r), "input") as HTMLInputElement).value).toBe("Front door open");
    // Nothing changed, so nothing is unsaved.
    expect(editor.isDirty()).toBe(false);
  });

  it("brings the template back after a detour through Entity", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const b = editor.editorState.bindings;
    pickSource(r, "template");
    await tick();
    setInput($(r, "textarea"), TPL);
    await tick();
    pickSource(r, "entity");
    await tick();
    // The source not in use is remembered, never stored: a save and a
    // push hold the entity alone, exactly as before.
    expect(b["state__template"]).toBeUndefined();
    expect(b["state__watched"]).toBeUndefined();
    expect(editor.prunedBindings()["state"]).toBe("input_boolean.front_door");
    expect(JSON.stringify(editor.prunedBindings())).not.toContain("living_temp");
    pickSource(r, "template");
    await tick();
    expect(($(r, "textarea") as HTMLTextAreaElement).value).toBe(TPL);
    expect(b["state__template"]).toBe(TPL);
    expect(b["state__watched"]).toEqual(["sensor.living_temp"]);
    expect(b["state"]).toBeUndefined();
  });

  it("brings the attribute back, for the entity it was picked on", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const b = editor.editorState.bindings;
    pickSource(r, "attribute");
    await tick();
    cbx(r).onSelect("climate.living_room");
    await tick();
    setSelect($(r, ".subrow select"), "hvac_action");
    await tick();
    pickSource(r, "template");
    await tick();
    expect(b["state__attribute"]).toBeUndefined();
    pickSource(r, "attribute");
    await tick();
    expect(b["state"]).toBe("climate.living_room");
    expect(b["state__attribute"]).toBe("hvac_action");
    expect(($(r, ".subrow select option[selected]") as HTMLOptionElement).value).toBe(
      "hvac_action",
    );
    // Another entity picked in Entity mode: its attribute is a fresh pick.
    pickSource(r, "entity");
    await tick();
    cbx(r).onSelect("sensor.living_temp");
    await tick();
    pickSource(r, "attribute");
    await tick();
    expect(b["state"]).toBe("sensor.living_temp");
    expect(b["state__attribute"]).toBe("");
  });

  it("Entity to Attribute keeps the entity on a fixed-value slot too", async () => {
    // On a color, a unit, a label or the tap URL the switch keeps the
    // picked entity, as it does on State and Value.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = (): HTMLElement => fieldRow(sr(panel), "accent");
    const b = editor.editorState.bindings;
    setSelect(sourceMenu(r()), "entity");
    await tick();
    cbx(r()).onSelect("sensor.living_temp");
    await tick();
    // Picking the source it is already on is a no-op, not a reset.
    setSelect(sourceMenu(r()), "entity");
    await tick();
    expect(b["accent__entity"]).toBe("sensor.living_temp");
    setSelect(sourceMenu(r()), "attribute");
    await tick();
    expect(b["accent__entity"]).toBe("sensor.living_temp");
    expect(b["accent__attribute"]).toBe("");
    expect(($(cbx(r()), "input") as HTMLInputElement).value).toBe("Living room temperature");
    setSelect(sourceMenu(r()), "entity");
    await tick();
    expect(b["accent__entity"]).toBe("sensor.living_temp");
    expect(b["accent__attribute"]).toBeUndefined();
    // The fixed value is the fallback throughout, and comes back alone.
    setSelect(sourceMenu(r()), "literal");
    await tick();
    expect(b["accent"]).toBe("red");
    expect(b["accent__entity"]).toBeUndefined();
    expect(editor.isDirty()).toBe(false);
  });

  it("picking the same entity again keeps its attribute", async () => {
    // A pick of the same entity does not reset the attribute: the menu
    // (not rebuilt for the same entity) and the stored attribute agree.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const b = editor.editorState.bindings;
    pickSource(r, "attribute");
    await tick();
    cbx(r).onSelect("climate.living_room");
    await tick();
    setSelect($(r, ".subrow select"), "current_temperature");
    await tick();
    cbx(r).onSelect("climate.living_room");
    await tick();
    expect(b["state__attribute"]).toBe("current_temperature");
    expect(($(r, ".subrow select") as HTMLSelectElement).value).toBe("current_temperature");
    // Another entity: the stored attribute and the menu reset together.
    const before = $(r, ".subrow select");
    cbx(r).onSelect("sensor.living_temp");
    await tick();
    expect(b["state__attribute"]).toBe("");
    expect($(r, ".subrow select")).not.toBe(before);
    expect(($(r, ".subrow select") as HTMLSelectElement).value).toBe("");
  });

  it("an entity pick in Attribute mode leaves focus in the picker", async () => {
    // The pick does not re-key the picker, so the focused input is not
    // replaced and focus stays in it.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "attribute");
    await tick();
    const input = $(cbx(r), "input") as HTMLInputElement;
    input.focus();
    setInput(input, "thermostat");
    await tick();
    $(cbx(r), ".cbx-pop .opt").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true }),
    );
    await tick();
    expect(panel.editorState?.bindings["state"]).toBe("climate.living_room");
    expect(input.isConnected).toBe(true);
    expect(sr(panel).activeElement).toBe(input);
    // The attribute menu did change to the new entity's.
    expect($$(r, ".subrow select option").map((o) => o.getAttribute("value"))).toContain(
      "hvac_action",
    );
  });

  it("warns under an entity that is gone from Home Assistant", async () => {
    // Beside the raw id, a note says why the widget would be empty.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    expect(r.querySelector(".tnote")).toBeNull();
    expect($(cbx(r), "input").getAttribute("aria-describedby")).toBeNull();
    cbx(r).onSelect("sensor.gone_since_tuesday");
    await tick();
    const note = $(r, ".tnote.warn");
    expect(text(note)).toBe("This entity isn't available in Home Assistant right now.");
    expect($(cbx(r), "input").getAttribute("aria-describedby")).toBe(note.id);
    // A warning, never a block: the entity may be back.
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says why there is no attribute to pick", async () => {
    // An entity with only a name and an icon gets a line of text, not a
    // menu with nothing in it but its placeholder.
    const bare = Object.entries(STATES).find(([, st]) =>
      Object.keys(st.attributes).every((a) => ["friendly_name", "icon"].includes(a)),
    );
    expect(bare).toBeDefined();
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "attribute");
    await tick();
    cbx(r).onSelect(bare![0]);
    await tick();
    expect(r.querySelector(".subrow select")).toBeNull();
    expect(text($(r, ".subrow"))).toBe("This entity has no attributes to pick from.");
  });
});

describe("template feedback", () => {
  it("surfaces a Jinja error inline with its line, and keeps it until the next result", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "template");
    await tick();
    setInput($(r, "textarea"), "{% broken");
    // Leaving the box shows the error without waiting for a pause.
    $(r, "textarea").dispatchEvent(new Event("blur"));
    await until(
      () => editor.editorState.fieldFeedback?.["state"]?.status === "error",
      "error feedback",
    );
    await tick();
    const note = $(r, ".tnote.error");
    expect(text(note)).toContain("Line 1:");
    expect(text(note)).toContain("TemplateSyntaxError");
    // One problem at a time: a template that doesn't parse has no result
    // and no "Updates on" line while the error stands.
    expect(r.querySelector(".tchips")).toBeNull();
    expect(r.querySelector(".tres")).toBeNull();
    // The required field's badge says the template fails.
    expect(r.querySelector(".freq.err")).not.toBeNull();

    // Editing the template keeps the error, dimmed, until the next
    // answer says something about the new text.
    setInput($(r, "textarea"), "{{ 42 }}");
    await tick();
    expect(r.querySelector(".tfb.stale .tnote.error")).not.toBeNull();
    await until(() => editor.previewedTemplate("state") === "{{ 42 }}", "the new answer");
    await tick();
    expect(r.querySelector(".tnote.error")).toBeNull();
    expect(r.querySelector(".tfb.stale")).toBeNull();
    expect(r.querySelector(".freq.err")).toBeNull();
    // A template that renders from no entity never updates on its own.
    expect(text($(r, ".tnote.never"))).toContain("never updates on its own");
  });

  it("warns (gently) when the template renders to nothing", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "template");
    await tick();
    setInput($(r, "textarea"), "{{ states('sensor.nope') }}");
    await until(
      () => editor.editorState.fieldFeedback?.["state"]?.status === "empty",
      "empty feedback",
    );
    await tick();
    expect(text($(r, ".tnote.warn"))).toContain("renders to nothing");
    expect(text($(r, ".tres .tval"))).toBe("unknown");
    expect(text($(r, ".tres .tkind"))).toBe("nothing");
    expect(r.querySelector(".tnote.error")).toBeNull();
  });

  it("shows the value, its kind and what it updates on", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    pickSource(r, "template");
    await tick();
    const template = "{{ states('sensor.living_temp') }}";
    setInput($(r, "textarea"), template);
    await until(
      () =>
        editor.previewedTemplate("state") === template &&
        editor.editorState.fieldFeedback?.["state"]?.status === "ok",
      "ok feedback",
    );
    await tick();
    expect(r.querySelector(".tnote")).toBeNull();
    expect(text($(r, ".tres .k"))).toBe("Result");
    expect(text($(r, ".tres .tval"))).toBe(STATES["sensor.living_temp"]!.state);
    expect(text($(r, ".tres .tkind"))).toBe("number");
    expect(text($(r, ".tchips .none"))).toBe("Updates on");
    expect($$(r, ".tchips .chip").map(text)).toEqual(["sensor.living_temp"]);
    expect(r.querySelector(".tnote.never")).toBeNull();
    expect($(r, "textarea").getAttribute("aria-describedby")).toBe($(r, ".tfb").id);
  });
});

describe("style disclosure", () => {
  it("binds text color and formatter markers", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    const style = $(r, "details.style");
    expect((style as HTMLDetailsElement).open).toBe(false);
    // The swatch label is the display name; the bound value stays raw.
    $(await openColor(style), 'button[title="Red"]').click();
    expect(editor.editorState.bindings["state__color"]).toBe("red");
    await tick();
    // The field names the pick, and the popover closed on it.
    expect(text($(style, ".cfname"))).toBe("Red");
    expect(style.querySelector(".cfpop")).toBeNull();
    // Picking the same swatch again clears it.
    $(await openColor(style), 'button[title="Red"]').click();
    expect(editor.editorState.bindings["state__color"]).toBeUndefined();
    const format = $(style, 'select[aria-label="Format"]');
    setSelect(format, "time_since");
    expect(editor.editorState.bindings["state__formatter"]).toBe("time_since");
    setSelect(format, "");
    expect(editor.editorState.bindings["state__formatter"]).toBeUndefined();
  });
});
