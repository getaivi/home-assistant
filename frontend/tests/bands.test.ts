// Colors by value: the bands themselves (bands.ts), how a slot stores and
// leaves them (value-source.ts), the form's editor for them
// (aivi-bands-field.ts) and "Preview as" (preview-as.ts). What the
// integration reads from stored bands is pinned in fixtures.test.ts.

import { afterEach, describe, expect, it } from "vitest";
import {
  type BandsBinding,
  bandRange,
  bandsTemplate,
  knownRange,
  rulerRange,
  sampleReadings,
  seedBands,
} from "../src/bands";
import { bandsByEntity, previewStates } from "../src/preview-as";
import type { HassEntity } from "../src/types/hass";
import { pruneSlots, setSlotMode, slotMode } from "../src/value-source";
import {
  $,
  $$,
  fieldRow,
  mountPanel,
  openWidgetEditor,
  previewSettled,
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

const BATTERY: BandsBinding = {
  entity: "sensor.phone_battery",
  limits: [20, 50],
  values: ["red", "orange", "green"],
};

const entity = (state: string, attributes: Record<string, unknown> = {}): HassEntity => ({
  entity_id: "sensor.x",
  state,
  attributes,
});

describe("the bands", () => {
  it("read as a template that says the same, the fixed color showing without a number", () => {
    expect(bandsTemplate(BATTERY)).toBe(
      "{% set v = states('sensor.phone_battery') | float(none) %}{% if v is not none %}" +
        "{{ 'red' if v < 20 else 'orange' if v < 50 else 'green' }}{% endif %}",
    );
  });

  it("say the span of each band with the reading's unit", () => {
    expect([0, 1, 2].map((i) => bandRange(BATTERY, i, "%"))).toEqual([
      "Below 20 %",
      "20 % to 50 %",
      "50 % and up",
    ]);
    expect(bandRange({ ...BATTERY, limits: [0.5, 2] }, 1, "")).toBe("0.5 to 2");
  });

  it("are drawn to a percentage's own span, else around the limits and the reading", () => {
    expect(knownRange(entity("64", { device_class: "battery" }))).toEqual([0, 100]);
    expect(knownRange(entity("21", { unit_of_measurement: "°C" }))).toBeNull();
    expect(rulerRange(BATTERY, entity("64", { unit_of_measurement: "%" }), 64)).toEqual([0, 100]);
    const heat = { entity: "sensor.t", limits: [18, 24], values: ["blue", "green", "red"] };
    expect(rulerRange(heat, entity("21"), 21)).toEqual([9, 33]);
    expect(rulerRange(heat, entity("40"), 40)).toEqual([9, 40]);
    // A reading for every band, round and inside it.
    expect(sampleReadings(BATTERY, [0, 100])).toEqual([10, 35, 75]);
    expect(sampleReadings(heat, [9, 33])).toEqual([15, 20, 30]);
  });

  it("start from a percentage's 20 and 50, else from limits around the reading", () => {
    expect(seedBands("sensor.b", entity("81", { device_class: "battery" })).limits).toEqual([
      20, 50,
    ]);
    expect(seedBands("sensor.t", entity("21.4")).limits).toEqual([15, 25]);
    expect(seedBands("sensor.p", entity("1200")).limits).toEqual([500, 1500]);
    expect(seedBands("", undefined)).toEqual({
      entity: "",
      limits: [10, 20],
      values: ["red", "orange", "green"],
    });
  });

  it("are stored whole and only when the integration can use them", () => {
    const scope = {
      accent: "gray",
      accent__bands: BATTERY,
      state__color__bands: { ...BATTERY, limits: [50, 20] },
    };
    expect(pruneSlots(scope)).toEqual({ accent: "gray", accent__bands: BATTERY });
  });

  it("come with the switch to By value, and go to a template as the same bands", () => {
    const scope: Record<string, unknown> = { accent: "gray" };
    setSlotMode(scope as never, "accent", "bands", "literal", () => BATTERY);
    expect(slotMode(scope as never, "accent")).toBe("bands");
    expect(scope["accent__bands"]).toEqual(BATTERY);
    setSlotMode(scope as never, "accent", "template");
    expect(scope["accent__template"]).toBe(bandsTemplate(BATTERY));
    expect(scope["accent__bands"]).toBeUndefined();
    // Back to By value: the bands left come back.
    setSlotMode(scope as never, "accent", "bands", "literal", () => ({
      ...BATTERY,
      limits: [1, 2],
    }));
    expect(scope["accent__bands"]).toEqual(BATTERY);
    expect(scope["accent"]).toBe("gray");
  });

  it("preview the widget at a reading inside each band, every limit of an entity's colors", () => {
    const bindings = {
      accent__bands: BATTERY,
      icon__color__bands: { ...BATTERY, entity: "sensor.humidity" },
    };
    expect(bandsByEntity(bindings)).toEqual([
      { ...BATTERY, mixed: false },
      { ...BATTERY, entity: "sensor.humidity", mixed: false },
    ]);
    const as = (band: number, b: Record<string, unknown> = bindings) =>
      previewStates(b as never, STATES, { entity: "sensor.phone_battery", band });
    expect([0, 1, 2].map((band) => as(band))).toEqual([
      { "sensor.phone_battery": "10" },
      { "sensor.phone_battery": "35" },
      { "sensor.phone_battery": "75" },
    ]);
    expect(as(3)).toBeNull();
    expect(previewStates(bindings, STATES, undefined)).toBeNull();
    expect(previewStates({}, STATES, { entity: "sensor.phone_battery", band: 0 })).toBeNull();
    // Two colors that split the same reading differently: every limit,
    // and no one color for a band.
    const both = { ...bindings, state__color__bands: { ...BATTERY, limits: [10, 90] } };
    expect(bandsByEntity(both)[0]).toEqual({
      entity: "sensor.phone_battery",
      limits: [10, 20, 50, 90],
      values: ["red", "red", "orange", "green", "green"],
      mixed: true,
    });
    expect([0, 1, 2, 3, 4].map((band) => as(band, both)?.["sensor.phone_battery"])).toEqual([
      "5",
      "15",
      "35",
      "70",
      "95",
    ]);
  });
});

describe("a color by value in the form", () => {
  async function accentByValue() {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    // The widget shows the phone's battery: By value starts from it.
    editor.editorState.bindings["state"] = "sensor.phone_battery";
    editor.requestUpdate();
    await tick();
    const row = () => fieldRow(root, "accent");
    setSelect(sourceMenu(row()), "bands");
    await tick();
    return { panel, editor, root, row };
  }

  it("is offered on every palette color, and starts from the widget's reading", async () => {
    const { editor, row } = await accentByValue();
    const modes = $$(sourceMenu(row()), "option").map(text);
    expect(modes).toEqual(["Fixed value", "By value", "Entity", "Attribute", "Template"]);
    expect(editor.editorState.bindings["accent__bands"]).toEqual({
      entity: "sensor.phone_battery",
      limits: [20, 50],
      values: ["red", "orange", "green"],
    });
    // The fixed color stays, as what shows without a reading.
    expect(editor.editorState.bindings["accent"]).toBe("red");
    expect($(row(), ".vsrc .fallback aivi-color-field")).toBeTruthy();
    const field = $(row(), "aivi-bands-field");
    expect($$(field, ".brow .bpre, .brow .brange").map(text)).toEqual([
      "Below",
      "20 to",
      "50 and up",
    ]);
    expect($$(field, ".btick").map(text)).toEqual(["0", "20", "50", "100"]);
    expect(text($(field, ".bnow"))).toBe("Now 81, so Green");
    // The widget shows the reading itself: no word about color alone.
    expect(text(field)).not.toContain("Lock Screen");
  });

  it("stores a typed limit between its neighbours, and says when one is not", async () => {
    const { editor, row } = await accentByValue();
    const bands = () => editor.editorState.bindings["accent__bands"] as BandsBinding;
    const inputs = () => $$(row(), "input.blimit") as HTMLInputElement[];
    setInput(inputs()[0]!, "30");
    await tick();
    expect(bands().limits).toEqual([30, 50]);
    setInput(inputs()[0]!, "60");
    await tick();
    expect(bands().limits).toEqual([30, 50]);
    expect(inputs()[0]!.getAttribute("aria-invalid")).toBe("true");
    expect(text($(row(), ".brow .tnote.error"))).toContain("above the limit before it");
    inputs()[0]!.dispatchEvent(new Event("change"));
    await tick();
    expect(inputs()[0]!.value).toBe("30");
    expect(row().querySelector(".brow .tnote.error")).toBeNull();
    // A band added on top, then the middle one taken out.
    $(row(), ".bands .rfoot .btn.quiet").click();
    await tick();
    expect(bands()).toMatchObject({
      limits: [30, 50, 70],
      values: ["red", "orange", "green", "blue"],
    });
    $$(row(), ".brow .rdel")[1]!.click();
    await tick();
    expect(bands()).toMatchObject({ limits: [50, 70], values: ["red", "green", "blue"] });
  });

  it("follows another reading, and says color alone is not enough when nothing else shows it", async () => {
    const { editor, row } = await accentByValue();
    editor.editorState.bindings["state"] = "input_boolean.front_door";
    const input = $(row(), "aivi-bands-field aivi-entity-combobox input") as HTMLInputElement;
    input.focus();
    setInput(input, "humidity");
    await tick();
    const option = $$(row(), "aivi-entity-combobox [role=option]").find((o) =>
      text(o).includes("sensor.humidity"),
    );
    option?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await tick();
    expect((editor.editorState.bindings["accent__bands"] as BandsBinding).entity).toBe(
      "sensor.humidity",
    );
    expect(text($(row(), "aivi-bands-field"))).toContain("Colors don't show on the Lock Screen");
  });

  it("writes the same bands out as a template", async () => {
    const { editor, row } = await accentByValue();
    $(row(), ".btpl").click();
    await tick();
    expect(editor.editorState.bindings["accent__template"]).toBe(bandsTemplate(BATTERY));
    expect(editor.editorState.bindings["accent__bands"]).toBeUndefined();
    expect(sourceMenu(row()).value).toBe("template");
    await until(() => editor.editorState.fieldFeedback?.["accent"]?.value === "green", "result");
  });

  it("previews the widget at each band, and back to now", async () => {
    const { editor, root } = await accentByValue();
    await until(() => editor.editorState.preview?.["accent"] === "green", "the bands' color");
    const chips = () => $$(root, ".pvas .fchip");
    expect(chips().map(text)).toEqual(["Now", "Below 20", "20 to 50", "50 and up"]);
    expect(chips()[0]?.getAttribute("aria-pressed")).toBe("true");
    chips()[1]!.click();
    await until(() => editor.editorState.preview?.["accent"] === "red", "previewed as low");
    expect(chips()[1]?.getAttribute("aria-pressed")).toBe("true");
    // What the form says stays what it is now.
    expect(editor.editorState.fieldFeedback?.["accent"]?.value).toBe("green");
    chips()[0]!.click();
    await until(() => editor.editorState.preview?.["accent"] === "green", "back to now");
    await previewSettled(editor);
  });
});
