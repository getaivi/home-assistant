// Palette lookup and the watched-entity regex, checked against the
// generated META so the panel palette can't drift from the wire palette.

import { describe, expect, it } from "vitest";
import { COLOR_HEX, colorHex, entityIdsIn, mentionsEntity } from "../src/const";
import { META } from "./harness";

describe("colorHex", () => {
  it("maps every META palette name to a hex value", () => {
    for (const name of META.colors) {
      expect(colorHex(name), name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("tolerates unknown and absent names", () => {
    expect(colorHex("chartreuse")).toBeUndefined();
    expect(colorHex(null)).toBeUndefined();
    expect(colorHex(undefined)).toBeUndefined();
    expect(colorHex("red")).toBe(COLOR_HEX.red);
  });

  it("answers nothing for names every object inherits", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(colorHex(name), name).toBeUndefined();
    }
  });
});

describe("entity id detection", () => {
  it("finds entity ids inside Jinja templates", () => {
    const template =
      "{{ states('sensor.living_temp') | float }} in {{ states(\"climate.living_room\") }}";
    expect(entityIdsIn(template)).toEqual(["sensor.living_temp", "climate.living_room"]);
  });

  it("does not match bare words or numbers", () => {
    expect(entityIdsIn("just words, 3.14 and nothing_else")).toEqual([]);
    expect(mentionsEntity("just words, 3.14 and nothing_else")).toBe(false);
  });

  it("answers the same on every call (no shared regex state)", () => {
    const answers = [1, 2, 3, 4].map(() => mentionsEntity("sensor.living_temp"));
    expect(answers).toEqual([true, true, true, true]);
  });
});
