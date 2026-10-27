// The stored source markers: one module spells them out, and its codec
// reads them the same way everywhere. How the integration reads a stored
// source is pinned in fixtures.test.ts.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bindings, SegmentBinding } from "../src/types/bindings";
import {
  baseKey,
  hasValue,
  isDerivedKey,
  markerKey,
  markerKeys,
  markerOf,
  segmentMode,
  setSegmentMode,
  setSegmentTemplate,
  setSlotMode,
  slotMode,
} from "../src/value-source";

// The codec, and the typed segment shape it reads and writes.
const OWNERS = new Set(["value-source.ts", join("types", "bindings.ts")]);
const MARKER = /__(entity|attribute|template|watched)\b/;

function sources(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name), join(prefix, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(prefix, entry.name)]
        : [],
  );
}

describe("marker keys", () => {
  it("are spelled out only by the codec", () => {
    // npm scripts run from the repo root.
    const offenders = sources("frontend/src")
      .filter((file) => !OWNERS.has(file))
      .filter((file) => MARKER.test(readFileSync(join("frontend/src", file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("join a marker to its address", () => {
    expect(markerKey("state", "template")).toBe("state__template");
    expect(markerKeys("x__color")).toEqual([
      "x__color__entity",
      "x__color__attribute",
      "x__color__template",
      "x__color__watched",
      "x__color__bands",
    ]);
  });

  it("are told apart from values and options", () => {
    expect(markerOf("state__entity")).toBe("entity");
    expect(markerOf("state__color__template")).toBe("template");
    expect(markerOf("state__color")).toBeNull();
    expect(markerOf("rows__options")).toBeNull();
    expect(baseKey("state__color__attribute")).toBe("state__color");
    expect(baseKey("state__color")).toBe("state__color");
    expect(isDerivedKey("state__watched")).toBe(true);
    expect(isDerivedKey("state__template")).toBe(false);
  });
});

describe("hasValue", () => {
  it("counts a mode switched to but not filled in as nothing", () => {
    expect(hasValue({ x: "light.a", x__template: "" }, "x")).toBe(false);
    expect(hasValue({ x__entity: "light.a", x__attribute: "" }, "x")).toBe(false);
    // The sticky mode is still the one the switch shows.
    expect(slotMode({ x: "light.a", x__template: "" }, "x", "entity")).toBe("template");
  });

  it("counts a template, an entity with its attribute, an entity or a literal", () => {
    expect(hasValue({ x__template: "{{ 1 }}" }, "x")).toBe(true);
    expect(hasValue({ x__entity: "light.a", x__attribute: "brightness" }, "x")).toBe(true);
    expect(hasValue({ x__entity: "light.a" }, "x")).toBe(true);
    expect(hasValue({ x: "red" }, "x")).toBe(true);
    expect(hasValue({}, "x")).toBe(false);
  });
});

describe("a segment's weight source", () => {
  const seg = (extra: Partial<SegmentBinding> = {}): SegmentBinding => ({ value: 1, ...extra });

  it("is literal without any of its keys, and sticks while empty", () => {
    expect(segmentMode(seg())).toBe("literal");
    expect(segmentMode(seg({ source: "" }))).toBe("entity");
    expect(segmentMode(seg({ source: "sensor.a", source__attribute: "" }))).toBe("attribute");
    expect(segmentMode(seg({ source__template: "" }))).toBe("template");
  });

  it("switches modes keeping the literal weight", () => {
    const s = seg({ source__template: "{{ 1 }}", source__watched: ["sensor.a"] });
    setSegmentMode(s, "attribute", "sensor.b");
    expect(s).toEqual({ value: 1, source: "sensor.b", source__attribute: "" });
    setSegmentMode(s, "literal", "");
    expect(s).toEqual({ value: 1 });
  });

  it("keeps the template's watch list with its text", () => {
    const s = seg();
    setSegmentTemplate(s, "{{ states('sensor.a') }}", ["sensor.a"]);
    expect(s.source__watched).toEqual(["sensor.a"]);
    setSegmentTemplate(s, "{{ 1 }}", []);
    expect(s).toEqual({ value: 1, source__template: "{{ 1 }}" });
  });
});

describe("switching a slot to a template", () => {
  const template = (scope: Bindings): unknown => scope[markerKey("x", "template")];

  it("starts from the entity the slot showed", () => {
    const scope: Bindings = { x: "light.porch" };
    setSlotMode(scope, "x", "template", "entity");
    expect(template(scope)).toBe("{{ states('light.porch') }}");
    expect(hasValue(scope, "x")).toBe(true);
    const marked: Bindings = { x: "fallback", [markerKey("x", "entity")]: "sensor.a" };
    setSlotMode(marked, "x", "template");
    expect(template(marked)).toBe("{{ states('sensor.a') }}");
    // The literal stays: it is the fallback.
    expect(marked["x"]).toBe("fallback");
  });

  it("starts from the attribute the slot showed, or the entity when none is picked", () => {
    const scope: Bindings = {
      x: "climate.living_room",
      [markerKey("x", "attribute")]: "hvac_action",
    };
    setSlotMode(scope, "x", "template", "entity");
    expect(template(scope)).toBe("{{ state_attr('climate.living_room', 'hvac_action') }}");
    const unpicked: Bindings = {
      [markerKey("x", "entity")]: "climate.living_room",
      [markerKey("x", "attribute")]: "",
    };
    setSlotMode(unpicked, "x", "template");
    expect(template(unpicked)).toBe("{{ states('climate.living_room') }}");
  });

  it("starts from the fixed value, and empty when nothing was set", () => {
    const text: Bindings = { x: "Open" };
    setSlotMode(text, "x", "template");
    expect(template(text)).toBe("Open");
    const number: Bindings = { x: 21.5 };
    setSlotMode(number, "x", "template");
    expect(template(number)).toBe("21.5");
    const empties: Bindings[] = [{}, { x: "" }, { x: true }, { [markerKey("x", "entity")]: "" }];
    for (const scope of empties) {
      setSlotMode(scope, "x", "template");
      expect(template(scope)).toBe("");
      expect(hasValue(scope, "x")).toBe(false);
    }
  });

  it("brings back the template left earlier in the session over a new start", () => {
    const scope: Bindings = { x: "light.porch" };
    setSlotMode(scope, "x", "template", "entity");
    scope[markerKey("x", "template")] = "{{ 'mine' }}";
    setSlotMode(scope, "x", "entity", "entity");
    expect(scope["x"]).toBe("light.porch");
    expect(template(scope)).toBeUndefined();
    setSlotMode(scope, "x", "template", "entity");
    expect(template(scope)).toBe("{{ 'mine' }}");
  });
});
