// The gauge ring's ramp arithmetic: mode derivation, presets, and where a
// stop lands. DOM-free, like the module it covers.

import { describe, expect, it } from "vitest";
import {
  addStop,
  BUILTIN_RAMP,
  deriveRampMode,
  formatStopValue,
  presetFor,
  presetLabel,
  pruneForRampMode,
  RAMP_MAX,
  RAMP_PRESETS,
  removeStop,
  reverseStops,
  setStop,
  stopFraction,
  stopValue,
} from "../src/ramp";
import { en } from "../src/translations/en";

describe("mode", () => {
  it("derives solid only for exactly one stop", () => {
    expect(deriveRampMode(["red"])).toBe("solid");
    expect(deriveRampMode(["red", "green"])).toBe("ramp");
    expect(deriveRampMode(["red", "green", "blue"])).toBe("ramp");
  });

  it("derives ramp for nothing stored, because the dial paints one", () => {
    // An unset ring is not an uncolored one: the device falls back to the
    // built-in ramp, so Ramp is the mode that matches what it shows.
    expect(deriveRampMode([])).toBe("ramp");
  });

  it("keeps only the first stop for solid, and everything for ramp", () => {
    const stops = ["green", "yellow", "red"];
    expect(pruneForRampMode(stops, "solid")).toEqual(["green"]);
    expect(pruneForRampMode(stops, "ramp")).toEqual(stops);
    expect(pruneForRampMode([], "solid")).toEqual([]);
  });
});

describe("presets", () => {
  it("uses only palette colors the backend accepts", () => {
    // Every preset color must survive ColorRamp's palette filter, or the
    // card would push a ramp missing stops.
    const palette = new Set(
      Object.keys(en)
        .filter((k) => k.startsWith("enum.color."))
        .map((k) => k.slice("enum.color.".length)),
    );
    expect(palette.size).toBeGreaterThan(0);
    for (const preset of RAMP_PRESETS)
      for (const c of preset.colors) expect(palette.has(c)).toBe(true);
  });

  it("stays within the stop cap", () => {
    for (const preset of RAMP_PRESETS) expect(preset.colors.length).toBeLessThanOrEqual(RAMP_MAX);
  });

  it("has a catalog name for every preset", () => {
    for (const preset of RAMP_PRESETS)
      expect(`ramp.preset.${preset.id}` in en, preset.id).toBe(true);
  });

  it("falls back to the id rather than rendering blank", () => {
    expect(presetLabel("builtin")).toBe("Built-in");
    expect(presetLabel("from-a-newer-build")).toBe("from-a-newer-build");
  });

  it("recognizes an exact match, and only an exact one", () => {
    expect(presetFor(["cyan", "green", "orange"])?.id).toBe("builtin");
    // Order is part of the value: the same colors reversed is a
    // different ramp, not the same preset.
    expect(presetFor(["orange", "green", "cyan"])).toBeNull();
    expect(presetFor(["cyan", "green"])).toBeNull();
    expect(presetFor([])).toBeNull();
  });

  it("names the built-in ramp the device actually falls back to", () => {
    // The gauge preview paints cyan -> green -> orange when the
    // ring is unbound; the preset must stay that, or the empty state
    // would show a ramp the dial is not using.
    expect(BUILTIN_RAMP.colors).toEqual(["cyan", "green", "orange"]);
  });
});

describe("stop positions", () => {
  it("spreads stops evenly, first at the start and last at the end", () => {
    // Mirrors the gauge preview, which mirrors the device.
    expect([0, 1, 2].map((i) => stopFraction(i, 3))).toEqual([0, 0.5, 1]);
    expect([0, 1, 2, 3].map((i) => stopFraction(i, 4))).toEqual([0, 1 / 3, 2 / 3, 1]);
  });

  it("gives a single stop no position: it is the whole ring", () => {
    expect(stopFraction(0, 1)).toBe(0);
    expect(stopValue(0, 1, 0, 100)).toBeNull();
  });

  it("converts a position into the gauge's own units", () => {
    expect([0, 1, 2].map((i) => stopValue(i, 3, 0, 100))).toEqual([0, 50, 100]);
    expect([0, 1, 2].map((i) => stopValue(i, 3, -20, 40))).toEqual([-20, 10, 40]);
  });

  it("refuses to invent a position from an unusable range", () => {
    expect(stopValue(1, 3, 100, 100)).toBeNull();
    expect(stopValue(1, 3, 100, 0)).toBeNull();
    expect(stopValue(1, 3, Number.NaN, 100)).toBeNull();
  });

  it("rounds for display without inventing precision", () => {
    expect(formatStopValue(0.5, "en")).toBe("0.5");
    expect(formatStopValue(33.333, "en")).toBe("33.3");
    expect(formatStopValue(1234.56, "en")).toBe("1,235");
  });
});

describe("stop edits", () => {
  it("replaces one stop without touching the rest", () => {
    expect(setStop(["red", "green", "blue"], 1, "yellow")).toEqual(["red", "yellow", "blue"]);
    expect(setStop(["red"], 5, "yellow")).toEqual(["red"]);
  });

  it("removes exactly one stop, not every stop of that color", () => {
    expect(removeStop(["red", "green", "red"], 0)).toEqual(["green", "red"]);
  });

  it("appends by repeating the last color, and caps", () => {
    // Repeating means adding a stop never silently restyles the dial.
    expect(addStop(["green"])).toEqual(["green", "green"]);
    expect(addStop([])).toEqual(["green"]);
    const full = ["red", "green", "blue", "cyan"];
    expect(addStop(full)).toEqual(full);
  });

  it("reverses the whole ramp", () => {
    expect(reverseStops(["green", "yellow", "red"])).toEqual(["red", "yellow", "green"]);
    expect(reverseStops([])).toEqual([]);
  });

  it("never mutates its input", () => {
    const stops = ["red", "green"];
    setStop(stops, 0, "blue");
    removeStop(stops, 0);
    addStop(stops);
    reverseStops(stops);
    pruneForRampMode(stops, "solid");
    expect(stops).toEqual(["red", "green"]);
  });
});
