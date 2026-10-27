// Binding narrowing helpers: heterogeneous binding values are narrowed at
// the point of use, never trusted.

import { describe, expect, it } from "vitest";
import { asSegments, asString, asStringArray } from "../src/types/bindings";

describe("asString", () => {
  it("passes strings through and rejects everything else", () => {
    expect(asString("sensor.x")).toBe("sensor.x");
    expect(asString(3)).toBeNull();
    expect(asString(["a"])).toBeNull();
    expect(asString(undefined)).toBeNull();
  });
});

describe("asStringArray", () => {
  it("keeps only string members of arrays", () => {
    expect(asStringArray(["a", "b"])).toEqual(["a", "b"]);
    expect(asStringArray("a")).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray([{ value: 1 }, "keep"] as unknown as string[])).toEqual(["keep"]);
  });
});

describe("asSegments", () => {
  it("keeps only object members of arrays", () => {
    const seg = { value: 0.5, fill_color: "blue" };
    expect(asSegments([seg])).toEqual([seg]);
    expect(asSegments(["nope", seg] as unknown as string[])).toEqual([seg]);
    expect(asSegments("x")).toEqual([]);
    expect(asSegments(undefined)).toEqual([]);
  });
});
