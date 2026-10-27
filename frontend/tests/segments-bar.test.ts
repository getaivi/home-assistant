// The segment label model, asserted against how the Aivi app renders
// labels on device (split and layered bars alike):
//
// - labels render in a caption row below the bar, never on the capsules;
// - every segment with a label shows it: no min-width rule, no
//   current-phase filter; unlabeled segments keep empty columns;
// - the row renders only when at least one segment is labeled;
// - each column is as wide as its segment; the last segment's column is
//   trailing-aligned, all others leading;
// - typography is caption2 (11pt regular), color a fixed 60% white,
//   never derived from the segment fill;
// - widgets never render labels (in any family), so
//   the split bar only gains the row when the caller asks for it.

import { describe, expect, it } from "vitest";
import {
  fillStyle,
  LAYERED_TRACK,
  labelColumns,
  labelsRow,
  layeredBar,
  segmentedBar,
  trackStyle,
} from "../src/segments-bar";
import { css, text } from "./harness";

const SEGS = {
  value: 0.5,
  segments: [
    { value: 0.4, fill_color: "blue", label: "Wash" },
    { value: 0.3, fill_color: "indigo" },
    { value: 0.3, fill_color: "teal", label: "Spin" },
  ],
};

describe("labelColumns", () => {
  it("is empty when no segment is labeled: the row never renders", () => {
    expect(labelColumns({ value: 1, segments: [{ value: 1, fill_color: "blue" }] })).toEqual([]);
    expect(labelColumns({ segments: [] })).toEqual([]);
  });

  it("labels every labeled segment and keeps empty columns between", () => {
    const cols = labelColumns(SEGS);
    expect(cols.map((c) => c.label)).toEqual(["Wash", null, "Spin"]);
    // Columns are as wide as their segments (normalized shares).
    expect(cols.map((c) => c.frac)).toEqual([0.4, 0.3, 0.3]);
  });

  it("trailing-aligns the last segment only, by position not by label", () => {
    expect(labelColumns(SEGS).map((c) => c.align)).toEqual(["left", "left", "right"]);
    // A labeled segment that is not last stays leading-aligned even when
    // it is the last labeled one.
    const cols = labelColumns({
      segments: [
        { value: 0.5, fill_color: "blue", label: "Wash" },
        { value: 0.5, fill_color: "teal" },
      ],
    });
    expect(cols.map((c) => c.align)).toEqual(["left", "right"]);
    expect(cols[1]!.label).toBeNull();
  });
});

describe("labelsRow", () => {
  it("returns null when nothing is labeled", () => {
    expect(labelsRow({ segments: [{ value: 1, fill_color: "blue" }] }, 2)).toBeNull();
  });

  it("renders the 14px caption row: 11px regular, fixed 60% white", () => {
    const row = labelsRow(SEGS, 2)!;
    expect(css(row)).toContain("height:14px");
    expect(css(row)).toContain("gap:2px");
    const cells = [...row.children] as HTMLElement[];
    expect(cells).toHaveLength(3);
    expect(text(cells[0]!)).toBe("Wash");
    expect(text(cells[1]!)).toBe("");
    expect(text(cells[2]!)).toBe("Spin");
    for (const cell of cells) {
      expect(css(cell)).toContain("font-size:11px");
      expect(css(cell)).toContain("font-weight:400");
      // The device color is fixed, never the segment's fill.
      expect(css(cell)).toMatch(/color:rgba\(255,255,255,0?\.6\)/);
      // Overlong labels truncate on one line (an approximation
      // of the device clipping inside the fixed-height row).
      expect(css(cell)).toContain("text-overflow:ellipsis");
      expect(css(cell)).toContain("white-space:nowrap");
    }
    expect(css(cells[0]!)).toContain("text-align:left");
    expect(css(cells[2]!)).toContain("text-align:right");
  });

  it("takes a color override for the editor-bar surface", () => {
    const row = labelsRow(SEGS, 0, "var(--aivi-muted)")!;
    expect(css(row.firstElementChild!)).toContain("color:var(--aivi-muted)");
  });
});

describe("bar builders", () => {
  it("segmentedBar without labels stays a bare capsule row (widgets)", () => {
    const bar = segmentedBar(SEGS, 6, 6);
    expect(text(bar)).toBe("");
    expect(css(bar)).toContain("height:6px");
  });

  it("segmentedBar with labels stacks the 2px-gapped row under the bar", () => {
    const stack = segmentedBar(SEGS, 8, 6, true);
    const [bar, row] = [...stack.children] as HTMLElement[];
    expect(css(bar!)).toContain("gap:6px");
    expect(text(bar!)).toBe("");
    // On device the labels row spaces its columns at 2pt, independent of
    // the 6pt capsule gap; the preview does the same.
    expect(css(row!)).toContain("gap:2px");
    expect(text(row!)).toBe("WashSpin");
  });

  it("layeredBar with labels uses gapless columns; capsules stay bare", () => {
    const stack = layeredBar(SEGS, 8, true);
    const [bar, row] = [...stack.children] as HTMLElement[];
    expect(css(bar!)).not.toContain("gap");
    expect(text(bar!)).toBe("");
    expect(css(row!)).toContain("gap:0px");
    expect(text(row!)).toBe("WashSpin");
  });

  it("labels flag is inert when no segment is labeled", () => {
    const plain = {
      value: 0.5,
      segments: [{ value: 1, fill_color: "blue" }],
    };
    // No wrapper appears: the element is the bar row.
    expect(css(segmentedBar(plain, 8, 6, true))).toContain("height:8px");
    expect(css(layeredBar(plain, 8, true))).toContain("height:8px");
  });
});

describe("hatch paint (on-device ground truth)", () => {
  it("hatches run bottom-left to top-right, 2pt lines at the 4.24px period", () => {
    // The device path draws (x, maxY) → (x+height, minY): a "/" line, which
    // is CSS 135deg (45deg mirrors it); the 6pt horizontal step measures
    // 6·cos45° ≈ 4.24px along the gradient axis.
    const style = trackStyle({ track_fill: "hatched", track_color: "gray2" });
    expect(style).toContain("repeating-linear-gradient(135deg");
    expect(style).toContain("0 2px");
    expect(style).toContain("2px 4.24px");
  });

  it("a hatched segment's fill is hatched in the fill color, never solid", () => {
    // The device strokes the hatch pattern across the fill width in the
    // fill color; only the width clips, the paint stays hatched.
    const style = fillStyle(0.5, {
      fill_color: "green",
      track_fill: "hatched",
    });
    expect(style).toContain("width:50%");
    expect(style).toContain("repeating-linear-gradient(135deg,#30d158");
    // A solid segment's fill stays a solid block.
    expect(fillStyle(0.5, { fill_color: "green" })).toContain("background:#30d158");
  });

  it("split and layered defaults differ: solid gray vs gray at 30%", () => {
    // The split bar defaults its track to solid gray; the layered bar to
    // gray at 30% opacity.
    expect(trackStyle({})).toContain("background:#8e8e93");
    expect(trackStyle({}, LAYERED_TRACK)).toContain("background:rgba(142,142,147,.3)");
  });
});

describe("layeredBar compositing", () => {
  const BAR = {
    value: 0.5,
    segments: [
      { value: 0.25, fill_color: "cyan" },
      { value: 0.5, fill_color: "blue" },
      { value: 0.25, fill_color: "teal" },
    ],
  };

  it("stacks layers back-to-front from x=0 to each cumulative end", () => {
    const bar = layeredBar(BAR, 12);
    expect(css(bar)).toContain("border-radius:6px");
    expect(css(bar)).toContain("overflow:hidden");
    const layers = [...bar.children] as HTMLElement[];
    expect(layers.map((l) => css(l))).toEqual([
      expect.stringContaining("width:25%"),
      expect.stringContaining("width:75%"),
      expect.stringContaining("width:100%"),
    ]);
    // First segment paints topmost.
    expect(css(layers[0]!)).toContain("z-index:3");
    expect(css(layers[2]!)).toContain("z-index:1");
  });

  it("later layers emerge through a soft gradient mask; the first has none", () => {
    const bar = layeredBar(BAR, 12);
    const layers = [...bar.children] as HTMLElement[];
    expect(css(layers[0]!)).not.toContain("mask-image");
    // Layer 2 spans 0..0.75; its own start (0.25/0.75) minus half the
    // 12%-of-bar gradient (0.12/0.75) lands the fade at 25.33%..41.33%.
    expect(css(layers[1]!)).toContain(
      // css() strips whitespace.
      "mask-image:linear-gradient(toright,transparent25.33%,#00041.33%)",
    );
  });

  it("fills run to the value's absolute position per layer, 0 before entry", () => {
    const bar = layeredBar(BAR, 12);
    const layers = [...bar.children] as HTMLElement[];
    // value 0.5: layer 1 (0..0.25) full; layer 2 (0..0.75) to 2/3; layer 3
    // untouched (no fill element at all).
    expect(css([...layers[0]!.children][1] as HTMLElement)).toContain("width:100%");
    expect(css([...layers[1]!.children][1] as HTMLElement)).toMatch(/width:66\.6+/);
    expect(layers[2]!.children).toHaveLength(1);
  });
});
