// The mode-first bar model's pure core: every stored shape
// maps onto a mode (UI truth, no migration), per-surface mode sets, and
// the active-mode pruning that preview and save share.

import { describe, expect, it } from "vitest";
import { BAR_COLOR_KEY, barModes, deriveBarMode, pruneForBarMode } from "../src/bar-mode";
import type { Bindings } from "../src/types/bindings";

const SEGS = [
  { value: 0.6, fill_color: "cyan" },
  { value: 0.4, fill_color: "gray" },
];

describe("barModes", () => {
  it("offers Solid|Segmented to widgets and adds Layered for activities", () => {
    expect(barModes("widget")).toEqual(["solid", "segmented"]);
    expect(barModes("activity")).toEqual(["solid", "segmented", "layered"]);
  });
});

describe("deriveBarMode: every stored shape maps onto a mode", () => {
  const cases: Array<[string, Bindings, "widget" | "activity", string]> = [
    ["nothing stored", {}, "widget", "solid"],
    ["bar_color only", { bar_color: "cyan" }, "widget", "solid"],
    ["an empty segments list", { segments: [] }, "widget", "solid"],
    ["segments, no display", { segments: SEGS }, "widget", "segmented"],
    [
      "segments + display split",
      { segments: SEGS, segments__display: "split" },
      "widget",
      "segmented",
    ],
    [
      "segments + display layered on a widget (always renders split)",
      { segments: SEGS, segments__display: "layered" },
      "widget",
      "segmented",
    ],
    [
      "segments + display layered on an activity",
      { segments: SEGS, segments__display: "layered" },
      "activity",
      "layered",
    ],
    [
      "segments + display split on an activity",
      { segments: SEGS, segments__display: "split" },
      "activity",
      "segmented",
    ],
    [
      "bar_color alongside segments (segments win, like the wire)",
      { bar_color: "cyan", segments: SEGS },
      "widget",
      "segmented",
    ],
    [
      "bar_color alongside layered segments on an activity",
      { bar_color: "cyan", segments: SEGS, segments__display: "layered" },
      "activity",
      "layered",
    ],
  ];
  for (const [name, bindings, kind, mode] of cases)
    it(`${name} -> ${mode}`, () => {
      expect(deriveBarMode(bindings, "segments", kind)).toBe(mode);
    });
});

describe("pruneForBarMode: only the active mode's data goes out", () => {
  const both: Bindings = {
    progress: "sensor.p",
    bar_color: "cyan",
    segments: SEGS,
    segments__display: "layered",
  };

  it("solid drops the segments and their display marker", () => {
    const out = pruneForBarMode(both, "segments", "solid");
    expect(out).toEqual({ progress: "sensor.p", bar_color: "cyan" });
  });

  it("segmented drops the fill color and the display marker", () => {
    const out = pruneForBarMode(both, "segments", "segmented");
    expect(out).toEqual({ progress: "sensor.p", segments: SEGS });
  });

  it("layered drops the fill color and asserts the marker", () => {
    const out = pruneForBarMode(
      { progress: "sensor.p", bar_color: "cyan", segments: SEGS },
      "segments",
      "layered",
    );
    expect(out).toEqual({
      progress: "sensor.p",
      segments: SEGS,
      segments__display: "layered",
    });
  });

  it("layered never emits a marker without segments", () => {
    const out = pruneForBarMode({ progress: "sensor.p", bar_color: "cyan" }, "segments", "layered");
    expect(out["segments__display"]).toBeUndefined();
  });

  it("never mutates the session bindings (non-destructive switching)", () => {
    const before = structuredClone(both);
    pruneForBarMode(both, "segments", "solid");
    pruneForBarMode(both, "segments", "segmented");
    expect(both).toEqual(before);
    expect(both[BAR_COLOR_KEY]).toBe("cyan");
  });
});
