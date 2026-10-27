// The editor bar's single source of geometry truth: seam
// centers, the CSS twin the adornment layer positions with, nearest-seam
// resolution for the hit overlay, capsule taps, and the float inverse a
// drag accumulates with. Pure math, no DOM.

import { describe, expect, it } from "vitest";
import {
  barMetrics,
  capsuleAt,
  nearestSeam,
  seamLeftCss,
  seamOffset,
  seamThreshold,
  seamTolerance,
} from "../src/seam-geometry";

// The canonical test frame: a 212px bar. Split (gap 6) with 3 segments
// leaves 200px of capsules; layered (gap 0) uses all 212.
const split3 = barMetrics(0, 212, 6, 3)!;
const layered3 = barMetrics(0, 212, 0, 3)!;

describe("barMetrics", () => {
  it("declines a frame with no usable width (zero-width test DOM)", () => {
    expect(barMetrics(0, 0, 6, 3)).toBeNull();
    expect(barMetrics(0, 12, 6, 3)).toBeNull();
    expect(barMetrics(0, 212, 6, 3)).not.toBeNull();
  });
});

describe("seamOffset / seamLeftCss", () => {
  it("scales the threshold onto the gap-less width, centered in its gap", () => {
    // [0.5, 0.25, 0.25]: seam 0 at 200*0.5 + 3, seam 1 at 200*0.75 + 9.
    expect(seamOffset(split3, 0.5, 0)).toBe(103);
    expect(seamOffset(split3, 0.75, 1)).toBe(159);
    // Layered: no gaps, plain proportion.
    expect(seamOffset(layered3, 0.5, 0)).toBe(106);
    expect(seamOffset(layered3, 0.75, 1)).toBe(159);
  });

  it("emits the identical formula in CSS units for the adornment layer", () => {
    expect(seamLeftCss(0.5, 0, 6, 3)).toBe("calc((100% - 12px) * 0.5 + 3px)");
    expect(seamLeftCss(0.75, 1, 6, 3)).toBe("calc((100% - 12px) * 0.75 + 9px)");
    expect(seamLeftCss(0.5, 0, 0, 2)).toBe("calc((100% - 0px) * 0.5 + 0px)");
  });
});

describe("nearestSeam", () => {
  const bounds = [0.5, 0.75]; // seams at x=103 and x=159 in split3
  it("resolves the seam nearest the pointer, with its distance", () => {
    expect(nearestSeam(bounds, split3, 100)).toEqual({ seam: 0, distance: 3 });
    expect(nearestSeam(bounds, split3, 150)).toEqual({ seam: 1, distance: 9 });
  });

  it("still resolves the earlier seam when boundaries crowd", () => {
    // Seams 1px apart: a pointer on seam 0's center resolves seam 0.
    const crowded = [0.5, 0.505];
    const x0 = seamOffset(split3, 0.5, 0);
    expect(nearestSeam(crowded, split3, x0)?.seam).toBe(0);
  });

  it("returns null for a bar with no seams", () => {
    expect(nearestSeam([], barMetrics(0, 212, 6, 1)!, 100)).toBeNull();
  });
});

describe("seamTolerance", () => {
  it("gives fingers and pens a wider target than a mouse", () => {
    expect(seamTolerance("mouse")).toBe(12);
    expect(seamTolerance(undefined)).toBe(12);
    expect(seamTolerance("touch")).toBe(22);
    expect(seamTolerance("pen")).toBe(22);
  });
});

describe("capsuleAt", () => {
  const bounds = [0.5, 0.75];
  it("resolves the capsule under the pointer from the same seam math", () => {
    expect(capsuleAt(bounds, split3, 50)).toBe(0);
    expect(capsuleAt(bounds, split3, 120)).toBe(1);
    expect(capsuleAt(bounds, split3, 200)).toBe(2);
    // The outer edges clamp into the outer capsules.
    expect(capsuleAt(bounds, split3, -10)).toBe(0);
    expect(capsuleAt(bounds, split3, 999)).toBe(2);
  });
});

describe("seamThreshold", () => {
  it("is the float inverse of seamOffset (drags accumulate unquantized)", () => {
    for (const at of [0.13, 0.5, 1 / 3, 0.987]) {
      expect(seamThreshold(split3, 0, seamOffset(split3, at, 0))).toBeCloseTo(at, 12);
      expect(seamThreshold(split3, 1, seamOffset(split3, at, 1))).toBeCloseTo(at, 12);
    }
  });

  it("clamps to [0, 1] beyond the bar", () => {
    expect(seamThreshold(split3, 0, -50)).toBe(0);
    expect(seamThreshold(split3, 0, 500)).toBe(1);
  });
});
