// The pure threshold<->weight math behind the visual segments editor:
// normalized fractions, cumulative boundaries, and the list operations
// (move, resize, split, remove, seed): index arithmetic only, no DOM.

import { describe, expect, it } from "vitest";
import {
  bestSplitIndex,
  boundariesOf,
  boundaryRange,
  carriedFractions,
  displayFractions,
  fractionsOf,
  isSeed,
  isSourced,
  MIN_FRACTION,
  moveBoundary,
  moveBoundaryDraft,
  nextColor,
  parsePercent,
  pct,
  percentages,
  removeSegment,
  seedSegments,
  setSize,
  sizeText,
  splitSegment,
  thresholdAt,
} from "../src/segments";
import type { SegmentBinding } from "../src/types/bindings";

const seg = (value: number, fill = "blue"): SegmentBinding => ({
  value,
  fill_color: fill,
});

const values = (list: SegmentBinding[]): number[] => list.map((s) => s.value);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("fractionsOf", () => {
  it("normalizes arbitrary weights (the enter-100-25-25 case)", () => {
    expect(fractionsOf([seg(100), seg(25), seg(25)])).toEqual([0.6667, 0.1667, 0.1666]);
  });

  it("sums to exactly 1 (the last fraction absorbs rounding drift)", () => {
    for (const weights of [
      [1, 1, 1],
      [0.3333, 0.3333, 0.3334],
      [7, 11, 13, 17],
    ]) {
      expect(sum(fractionsOf(weights.map((w) => seg(w))))).toBe(1);
    }
  });

  it("tolerates zero/negative weights and an empty list", () => {
    expect(fractionsOf([])).toEqual([]);
    expect(fractionsOf([seg(0), seg(0)])).toEqual([0.5, 0.5]);
    expect(fractionsOf([seg(-2), seg(1)])).toEqual([0, 1]);
  });
});

describe("boundariesOf / boundaryRange", () => {
  it("yields cumulative thresholds for the N-1 inner boundaries", () => {
    expect(boundariesOf([seg(0.6), seg(0.25), seg(0.15)])).toEqual([0.6, 0.85]);
    expect(boundariesOf([seg(1)])).toEqual([]);
  });

  it("bounds each boundary by its neighbors' edges plus the minimum", () => {
    const list = [seg(0.6), seg(0.25), seg(0.15)];
    expect(boundaryRange(list, 0)).toEqual([MIN_FRACTION, 0.85 - MIN_FRACTION]);
    expect(boundaryRange(list, 1)).toEqual([0.6 + MIN_FRACTION, 1 - MIN_FRACTION]);
  });
});

describe("moveBoundary", () => {
  it("moves thresholds, adjusting only the adjacent pair", () => {
    const next = moveBoundary([seg(0.6), seg(0.25), seg(0.15)], 0, 0.5);
    expect(values(next)).toEqual([0.5, 0.35, 0.15]);
    expect(sum(values(next))).toBe(1);
  });

  it("clamps so both neighbors keep the minimum width", () => {
    const list = [seg(0.5), seg(0.5)];
    expect(values(moveBoundary(list, 0, 0))).toEqual([MIN_FRACTION, 1 - MIN_FRACTION]);
    expect(values(moveBoundary(list, 0, 2))).toEqual([1 - MIN_FRACTION, MIN_FRACTION]);
  });

  it("normalizes arbitrary weights on the way through and keeps styling", () => {
    const next = moveBoundary(
      [{ value: 100, fill_color: "cyan", label: "Wash" }, seg(25), seg(25)],
      1,
      0.75,
    );
    expect(next[0]).toEqual({ value: 0.6667, fill_color: "cyan", label: "Wash" });
    expect(sum(values(next))).toBe(1);
  });

  it("returns a normalized copy for out-of-range boundaries", () => {
    const list = [seg(1), seg(1)];
    expect(values(moveBoundary(list, 5, 0.5))).toEqual([0.5, 0.5]);
    expect(list[0]!.value).toBe(1); // input untouched
  });
});

describe("setSize", () => {
  it("resizes against the right neighbor (left, for the last segment)", () => {
    const list = [seg(0.5), seg(0.3), seg(0.2)];
    expect(values(setSize(list, 0, 0.4))).toEqual([0.4, 0.4, 0.2]);
    expect(values(setSize(list, 2, 0.4))).toEqual([0.5, 0.1, 0.4]);
  });

  it("clamps within the pair and pins a single segment at 1", () => {
    expect(values(setSize([seg(0.5), seg(0.5)], 0, 5))).toEqual([1 - MIN_FRACTION, MIN_FRACTION]);
    expect(values(setSize([seg(3)], 0, 0.4))).toEqual([1]);
  });
});

describe("splitSegment / bestSplitIndex", () => {
  it("halves the segment and gives the new right half the color", () => {
    const next = splitSegment([{ value: 1, fill_color: "cyan", label: "Wash" }], 0, "gray", 4);
    expect(next).toEqual([
      { value: 0.5, fill_color: "cyan", label: "Wash" },
      { value: 0.5, fill_color: "gray" },
    ]);
  });

  it("refuses at max, on too-thin segments, and out of range", () => {
    const four = [seg(0.25), seg(0.25), seg(0.25), seg(0.25)];
    expect(splitSegment(four, 0, "gray", 4)).toHaveLength(4);
    const thin = [seg(0.01), seg(0.99)];
    expect(values(splitSegment(thin, 0, "gray", 4))).toEqual([0.01, 0.99]);
    expect(splitSegment(thin, 9, "gray", 4)).toHaveLength(2);
  });

  it("prefers the last segment, else the widest splittable one", () => {
    expect(bestSplitIndex([seg(0.5), seg(0.5)])).toBe(1);
    expect(bestSplitIndex([seg(0.6), seg(0.39), seg(0.01)])).toBe(0);
    // A single segment always normalizes to the whole bar: splittable.
    expect(bestSplitIndex([seg(0.01)])).toBe(0);
    expect(bestSplitIndex([])).toBe(-1);
  });
});

describe("removeSegment", () => {
  it("lets the left neighbor absorb the space (right, for the first)", () => {
    const list = [seg(0.5), seg(0.3), seg(0.2)];
    expect(values(removeSegment(list, 1))).toEqual([0.8, 0.2]);
    expect(values(removeSegment(list, 0))).toEqual([0.8, 0.2]);
  });

  it("empties on the only segment; ignores out-of-range indices", () => {
    expect(removeSegment([seg(1)], 0)).toEqual([]);
    expect(values(removeSegment([seg(1), seg(1)], 7))).toEqual([0.5, 0.5]);
  });
});

describe("nextColor / seedSegments", () => {
  it("picks the first phase color not in use, cycling when all are taken", () => {
    const colors = ["red", "green", "blue"];
    // In the phase order (blue, green, …), limited to the palette given.
    expect(nextColor([seg(1, "red")], colors)).toBe("blue");
    expect(nextColor([seg(1, "red"), seg(1, "blue")], colors)).toBe("green");
    expect(nextColor([seg(1, "red"), seg(1, "green"), seg(1, "blue")], colors)).toBe("blue");
    expect(nextColor([], [])).toBe("blue");
  });

  it("never offers a gray: a gray phase reads as the bar's empty track", () => {
    const palette = ["gray", "gray2", "brown", "red", "blue"];
    const taken = [seg(1, "blue"), seg(1, "red")];
    expect(nextColor([], palette)).toBe("blue");
    // Everything clear is taken: cycle through the clear ones again.
    expect(["blue", "red"]).toContain(nextColor(taken, palette));
  });

  it("seeds 50/50 with the bar color and the next phase color beside it", () => {
    expect(seedSegments("cyan")).toEqual([
      { value: 0.5, fill_color: "cyan" },
      { value: 0.5, fill_color: "blue" },
    ]);
    expect(seedSegments(null)).toEqual([
      { value: 0.5, fill_color: "blue" },
      { value: 0.5, fill_color: "green" },
    ]);
    // Even from a gray bar the second phase is a color.
    expect(seedSegments("gray")[1]).toEqual({ value: 0.5, fill_color: "blue" });
  });
});

describe("thresholdAt", () => {
  it("maps pointer x to a clamped fraction of the gap-less width", () => {
    expect(thresholdAt(100, 200, 200)).toBe(0.5);
    expect(thresholdAt(100, 200, 0)).toBe(0);
    expect(thresholdAt(100, 200, 999)).toBe(1);
    // Two 6 px gaps on a 212 px bar: the pointer past one gap.
    expect(thresholdAt(0, 212, 103, 3, 12)).toBe(0.5);
  });

  it("declines an unmeasurable bar (zero-width test DOM)", () => {
    expect(thresholdAt(0, 0, 50)).toBeNull();
    expect(thresholdAt(0, 10, 5, 0, 12)).toBeNull();
  });
});

describe("moveBoundaryDraft", () => {
  it("moves the pair in floats: no quantization, render-only", () => {
    const t = 1 / 3;
    const draft = moveBoundaryDraft([0.5, 0.5], 0, t);
    expect(draft[0]).toBeCloseTo(t, 12);
    expect(draft[1]).toBeCloseTo(1 - t, 12);
    // Only the adjacent pair moves.
    expect(moveBoundaryDraft([0.5, 0.25, 0.25], 1, 0.6)).toEqual([0.5, 0.09999999999999998, 0.4]);
  });

  it("clamps to the same MIN_FRACTION envelope moveBoundary commits", () => {
    expect(moveBoundaryDraft([0.5, 0.5], 0, 0)).toEqual([MIN_FRACTION, 1 - MIN_FRACTION]);
    expect(moveBoundaryDraft([0.5, 0.5], 0, 2)[1]).toBeCloseTo(MIN_FRACTION, 12);
  });

  it("returns an unchanged copy for an out-of-range seam", () => {
    expect(moveBoundaryDraft([0.5, 0.5], -1, 0.3)).toEqual([0.5, 0.5]);
    expect(moveBoundaryDraft([0.5, 0.5], 1, 0.3)).toEqual([0.5, 0.5]);
  });
});

describe("pct", () => {
  it("rounds fractions to whole display percentages", () => {
    expect(pct(0.6667)).toBe(67);
    expect(pct(0)).toBe(0);
    expect(pct(1)).toBe(100);
  });
});

describe("isSourced", () => {
  it("detects any source marker, even while empty (mode stickiness)", () => {
    expect(isSourced(seg(0.5))).toBe(false);
    expect(isSourced({ ...seg(0.5), source: "sensor.a" })).toBe(true);
    expect(isSourced({ ...seg(0.5), source: "" })).toBe(true);
    expect(isSourced({ ...seg(0.5), source__attribute: "" })).toBe(true);
    expect(isSourced({ ...seg(0.5), source__template: "" })).toBe(true);
  });
});

describe("displayFractions", () => {
  it("normalizes matching resolved shares (last absorbs drift)", () => {
    const list = [seg(0.5), seg(0.5)];
    expect(displayFractions(list, [0.6, 0.4])).toEqual([0.6, 0.4]);
    expect(displayFractions(list, [1, 1, 1])).toEqual([0.5, 0.5]); // mismatch
    expect(displayFractions(list, undefined)).toEqual([0.5, 0.5]);
    const three = displayFractions([seg(1), seg(1), seg(1)], [1, 1, 1]);
    expect(sum(three)).toBe(1);
  });

  it("degrades to stored weights on missing or non-positive values", () => {
    const list = [seg(0.7), seg(0.3)];
    expect(displayFractions(list, [0.5, undefined])).toEqual([0.7, 0.3]);
    expect(displayFractions(list, [0.5, 0])).toEqual([0.7, 0.3]);
  });
});

describe("moveBoundary with sourced segments", () => {
  const src = (value: number): SegmentBinding => ({
    ...seg(value, "cyan"),
    source: "sensor.share",
  });

  it("refuses to move a boundary adjacent to a sourced segment", () => {
    const list = [seg(0.5), src(0.5)];
    expect(values(moveBoundary(list, 0, 0.7))).toEqual([0.5, 0.5]);
  });

  it("moves a literal-literal boundary in display space, preserving the pair's stored sum", () => {
    // Stored 0.4/0.4/0.2(fallback); the source resolves to half the bar,
    // so the display is [0.25, 0.25, 0.5]. Dragging boundary 0 to display
    // 0.375 splits the stored pair 0.8 in the display ratio 0.375:0.125;
    // the sourced segment's stored fallback stays untouched.
    const list = [seg(0.4), seg(0.4), src(0.2)];
    const display = [0.25, 0.25, 0.5];
    const moved = moveBoundary(list, 0, 0.375, display);
    expect(moved[2]!.value).toBe(0.2);
    expect(moved[2]!.source).toBe("sensor.share");
    expect(sum(values(moved))).toBe(1);
    expect(moved[0]!.value).toBe(0.6); // 0.8 * (0.375 / 0.5)
    expect(moved[1]!.value).toBe(0.2);
  });
});

describe("setSize with sourced segments", () => {
  it("prefers a literal neighbor and refuses when none exists", () => {
    const src = { ...seg(0.4, "cyan"), source: "sensor.a" };
    // Right neighbor sourced: the delta comes from the left instead.
    const list = [seg(0.3), seg(0.3), src];
    expect(values(setSize(list, 1, 0.5))).toEqual([0.1, 0.5, 0.4]);
    // A literal whose only neighbor is sourced: unchanged (the sourced
    // fallback never gives up weight).
    const boxed = [{ ...seg(0.5, "cyan"), source: "sensor.a" }, seg(0.5)];
    expect(values(setSize(boxed, 1, 0.8))).toEqual([0.5, 0.5]);
    // No literal neighbor at all: unchanged.
    const alone = [
      { ...seg(0.5, "cyan"), source: "sensor.a" },
      { ...seg(0.5), source: "sensor.b" },
    ];
    expect(values(setSize(alone, 0, 0.8))).toEqual([0.5, 0.5]);
  });

  it("resizes a sourced segment's stored fallback against a literal neighbor", () => {
    const list = [{ ...seg(0.5, "cyan"), source: "sensor.a" }, seg(0.5)];
    const out = setSize(list, 0, 0.3);
    expect(values(out)).toEqual([0.3, 0.7]);
    expect(out[0]!.source).toBe("sensor.a");
  });
});

describe("percentages", () => {
  it("rounds by largest remainder, so the phases always read 100 in all", () => {
    // Each share rounded on its own would read 50/25/13/13 and 33/33/33.
    expect(percentages([0.5, 0.25, 0.125, 0.125])).toEqual([50, 25, 13, 12]);
    expect(percentages([0.3333, 0.3333, 0.3334])).toEqual([33, 33, 34]);
    expect(percentages([0.6699, 0.3301])).toEqual([67, 33]);
  });

  it("leaves whole percentages alone, float noise included", () => {
    // 0.07 * 100 is 7.000000000000001: no remainder to hand out.
    expect(percentages([0.07, 0.93])).toEqual([7, 93]);
    expect(percentages([0.6, 0.25, 0.15])).toEqual([60, 25, 15]);
  });

  it("tolerates an empty list and all-zero shares", () => {
    expect(percentages([])).toEqual([]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
});

describe("parsePercent / sizeText", () => {
  it("reads a decimal comma as a point", () => {
    // parseFloat alone stops at the comma and would store "12,5" as 12%.
    expect(parsePercent("12,5")).toBe(12.5);
    expect(parsePercent("12.5")).toBe(12.5);
    expect(parsePercent(" 40 % ")).toBe(40);
    expect(parsePercent(",5")).toBe(0.5);
    expect(parsePercent("-3")).toBe(-3);
  });

  it("refuses anything that is not one number", () => {
    for (const text of ["", " ", "abc", "12abc", "1,2,3", "%", "-"])
      expect(parsePercent(text)).toBeNull();
  });

  it("writes a share as percent with at most two decimals", () => {
    expect(sizeText(0.62)).toBe("62");
    expect(sizeText(0.125)).toBe("12.5");
    expect(sizeText(0.6199)).toBe("61.99");
    expect(sizeText(0.07)).toBe("7");
  });
});

describe("carriedFractions", () => {
  const sourced = (value: number): SegmentBinding => ({
    ...seg(value),
    source: "sensor.x",
  });

  it("keeps a sourced share and divides the rest by the stored weights", () => {
    // The bar showed 25/25/50 (the sensor resolved above its fallback);
    // the literal pair was then restored 0.36/0.24. The sensor's share
    // stays, the pair divides the other half 3:2.
    const next = [seg(0.36), seg(0.24), sourced(0.4)];
    expect(carriedFractions(next, [0.25, 0.25, 0.5])).toEqual([0.3, 0.2, 0.5]);
  });

  it("sums to exactly 1: the last literal absorbs the drift", () => {
    const next = [seg(1), seg(1), seg(1), sourced(1)];
    const out = carriedFractions(next, [0.2, 0.2, 0.2, 0.4]);
    expect(out[3]).toBe(0.4);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("falls back to the stored model when the shares cover other segments", () => {
    const next = [seg(0.5), sourced(0.5)];
    expect(carriedFractions(next, [0.2, 0.2, 0.6])).toEqual([0.5, 0.5]);
    expect(carriedFractions([], [])).toEqual([]);
  });

  it("keeps the shown shares when no literal weight is left to divide", () => {
    expect(carriedFractions([sourced(0.5), sourced(0.5)], [0.3, 0.7])).toEqual([0.3, 0.7]);
  });
});

describe("setSize in display space", () => {
  it("sizes a literal phase by its shown share, keeping the pair's stored sum", () => {
    // Stored 0.3/0.3/0.4, shown 25/25/50. Sizing phase 0 to the 30% its
    // capsule should read takes it from the 50 points the literal pair
    // shows, and writes the pair's stored 0.6 back 3:2.
    const list = [seg(0.3), seg(0.3), { ...seg(0.4), source: "sensor.x" }];
    const out = setSize(list, 0, 0.3, [0.25, 0.25, 0.5]);
    expect(out.map((s) => s.value)).toEqual([0.36, 0.24, 0.4]);
  });

  it("clamps to the room the pair shows", () => {
    const list = [seg(0.3), seg(0.3), { ...seg(0.4), source: "sensor.x" }];
    const out = setSize(list, 0, 0.95, [0.25, 0.25, 0.5]);
    // 49 of the pair's 50 shown points: stored 0.6 * 0.49 / 0.5.
    expect(out.map((s) => s.value)).toEqual([0.588, 0.012, 0.4]);
  });

  it("still sizes a sourced phase's fallback in stored space", () => {
    const list = [seg(0.5), { ...seg(0.5), source: "sensor.x" }];
    const out = setSize(list, 1, 0.3, [0.25, 0.75]);
    expect(out.map((s) => s.value)).toEqual([0.7, 0.3]);
  });
});

describe("isSeed", () => {
  it("tells untouched seeded phases from edited ones", () => {
    expect(isSeed(seedSegments("cyan"), "cyan")).toBe(true);
    expect(isSeed(seedSegments("cyan"), "blue")).toBe(false);
    expect(isSeed(setSize(seedSegments("cyan"), 0, 0.6), "cyan")).toBe(false);
    expect(isSeed([{ ...seg(0.5, "cyan"), label: "Wash" }, seg(0.5, "blue")], "cyan")).toBe(false);
  });
});
