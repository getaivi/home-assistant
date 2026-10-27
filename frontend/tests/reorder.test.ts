// The pure reordering helpers behind the rows checklist's drag/keyboard
// moves: index arithmetic only, no DOM.

import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD,
  dropIndex,
  indicatorOffset,
  indicatorSlot,
  isDrag,
  moveItem,
} from "../src/reorder";

describe("moveItem", () => {
  it("moves an item up and down", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("returns an unchanged copy for no-ops and out-of-range moves", () => {
    const list = ["a", "b"];
    for (const [from, to] of [
      [1, 1],
      [-1, 0],
      [2, 0],
      [0, -1],
      [0, 2],
    ] as const) {
      const out = moveItem(list, from, to);
      expect(out).toEqual(list);
      expect(out).not.toBe(list);
    }
  });
});

describe("dropIndex", () => {
  // Three 20 px rows: middles at 10, 30 and 50.
  const midpoints = [10, 30, 50];

  it("stays put until the pointer crosses a neighbor's middle", () => {
    // Anywhere in its own row, and in the near half of a neighbor: no
    // move. (Counting the dragged row's own middle would make a 4 px drag
    // down a full position.)
    expect(dropIndex(midpoints, 0, 14)).toBe(0);
    expect(dropIndex(midpoints, 0, 29)).toBe(0);
    expect(dropIndex(midpoints, 1, 30)).toBe(1);
    expect(dropIndex(midpoints, 1, 11)).toBe(1);
    expect(dropIndex(midpoints, 1, 49)).toBe(1);
  });

  it("moves one position per neighbor crossed, down and up alike", () => {
    expect(dropIndex(midpoints, 0, 31)).toBe(1);
    expect(dropIndex(midpoints, 0, 51)).toBe(2);
    expect(dropIndex(midpoints, 2, 29)).toBe(1);
    expect(dropIndex(midpoints, 2, 9)).toBe(0);
    expect(dropIndex(midpoints, 1, 51)).toBe(2);
    expect(dropIndex(midpoints, 1, 9)).toBe(0);
  });

  it("clamps beyond the ends and survives an empty list or a bad origin", () => {
    expect(dropIndex(midpoints, 0, 999)).toBe(2);
    expect(dropIndex(midpoints, 2, -999)).toBe(0);
    expect(dropIndex([], 0, 42)).toBe(0);
    expect(dropIndex(midpoints, 7, 42)).toBe(0);
  });
});

describe("isDrag", () => {
  it("takes a few pixels of travel, either way, before a press is a drag", () => {
    expect(isDrag(0)).toBe(false);
    expect(isDrag(1)).toBe(false);
    expect(isDrag(-(DRAG_THRESHOLD - 1))).toBe(false);
    expect(isDrag(DRAG_THRESHOLD)).toBe(true);
    expect(isDrag(-DRAG_THRESHOLD)).toBe(true);
  });
});

describe("indicatorSlot", () => {
  it("puts the line above the target when moving up, below when moving down", () => {
    expect(indicatorSlot(2, 0)).toBe(0);
    expect(indicatorSlot(2, 1)).toBe(1);
    expect(indicatorSlot(0, 1)).toBe(2);
    expect(indicatorSlot(0, 2)).toBe(3);
  });

  it("maps a no-op drop to the origin gap", () => {
    expect(indicatorSlot(1, 1)).toBe(1);
  });
});

describe("indicatorOffset", () => {
  const rows = [
    { top: 7, bottom: 27 },
    { top: 31, bottom: 51 },
    { top: 55, bottom: 75 },
  ];

  it("centers the line in the gap between neighboring rows", () => {
    expect(indicatorOffset(rows, 1)).toBe(29);
    expect(indicatorOffset(rows, 2)).toBe(53);
  });

  it("hugs the outer edges at the first and last gaps", () => {
    expect(indicatorOffset(rows, 0)).toBe(7);
    expect(indicatorOffset(rows, 3)).toBe(75);
  });

  it("yields 0 for an empty list", () => {
    expect(indicatorOffset([], 0)).toBe(0);
  });
});
