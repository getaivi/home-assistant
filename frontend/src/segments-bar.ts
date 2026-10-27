// Segmented-bar rendering shared by preview-render.ts and
// aivi-segments-editor.ts so the editor bar and the preview can never
// disagree on proportions, fills, tracks, or hatching.

import { COLOR_HEX, colorHex } from "./const";
import { h } from "./dom";
import { clamp } from "./util";

/** Both PreviewSegment and SegmentBinding are assignable to this. */
interface BarSegment {
  value?: number;
  fill_color?: string | null;
  label?: string;
  track_color?: string | null;
  track_fill?: string | null;
}

interface BarProgress {
  value?: number;
  segments?: BarSegment[];
}

export interface BarSegmentGeometry {
  /** The segment's share of the whole bar, normalized. */
  frac: number;
  /** How much of this segment the global value fills, 0..1. */
  fill: number;
}

/** Per-segment proportions and fill levels for a segmented progress
 * payload: one global value filling left to right across capsules. */
export function barGeometry(progress: BarProgress): BarSegmentGeometry[] {
  const segments = progress.segments ?? [];
  const value = progress.value ?? 0;
  const total = segments.reduce((a, s) => a + (s.value ?? 0), 0) || 1;
  let start = 0;
  return segments.map((s) => {
    const frac = (s.value ?? 0) / total;
    const end = start + frac;
    const fill = clamp((value - start) / (end - start || 1), 0, 1);
    start = end;
    return { frac, fill };
  });
}

/** The on-device hatch pattern as a CSS gradient: 45° lines running
 * bottom-left → top-right ("/": the device path goes
 * (x, maxY)→(x+height, minY), which is CSS `135deg`, not
 * `45deg`), stroked 2 pt with a 4 pt horizontal spacing. CSS measures
 * along the gradient axis (perpendicular to the lines), so the 6 pt
 * horizontal step becomes a 6·cos45° ≈ 4.24 px period. */
export function hatch(color: string): string {
  return `repeating-linear-gradient(135deg,${color} 0 2px,transparent 2px 4.24px)`;
}

/** The capsule's track: solid color or the hatch. `fallback` differs per
 * bar on device: the split bar uses `Color.gray`, the layered bar
 * `Color.gray.opacity(0.3)`. */
export function trackStyle(s: BarSegment, fallback: string = COLOR_HEX.gray): string {
  const track = colorHex(s.track_color) ?? fallback;
  return s.track_fill === "hatched" ? `background:${hatch(track)}` : `background:${track}`;
}

export function capsuleStyle(
  s: BarSegment,
  frac: number,
  height: number,
  radius = `${height / 2}px`,
): string {
  return `flex:${frac};position:relative;border-radius:${radius};overflow:hidden;${trackStyle(s)}`;
}

/** The value fill inside a capsule. A hatched segment's fill is hatched
 * too on-device (the hatch stroked in the fill color, clipped to the
 * fill width), never a solid block over the hatch. */
export function fillStyle(fill: number, s: BarSegment): string {
  const color = colorHex(s.fill_color) ?? "#888";
  return (
    `position:absolute;inset:0;width:${fill * 100}%;display:block;` +
    `background:${s.track_fill === "hatched" ? hatch(color) : color}`
  );
}

/** Corner radii for capsule `i` of `count` in the layered bar: the outer
 * corners only, so the capsules read as one continuous bar. */
export function layeredRadius(i: number, count: number, height: number): string {
  const r = `${height / 2}px`;
  const first = i === 0 ? r : "0";
  const last = i === count - 1 ? r : "0";
  return `${first} ${last} ${last} ${first}`;
}

/** One column of the on-device labels row. */
interface BarLabelColumn {
  /** The caption, or null for an unlabeled segment's empty column. */
  label: string | null;
  /** The column's share of the row width: the segment's own share. */
  frac: number;
  /** iOS trailing-aligns the last segment's column; every other one is
   * leading-aligned. */
  align: "left" | "right";
}

/** The on-device label color: `.white.opacity(0.6)`, fixed, never
 * derived from the segment fill and never auto-contrasted. */
const BAR_LABEL_COLOR = "rgba(255,255,255,.6)";

/** The label model of the on-device labels row (the same for split and
 * layered bars): every segment that
 * carries a label shows it (there is no min-width rule and no
 * current-phase filter) in a column as wide as the segment itself; an
 * unlabeled segment keeps its column as empty space so the neighbors
 * stay put. Returns [] when no segment has a label: the row does not
 * render at all then. */
export function labelColumns(progress: BarProgress): BarLabelColumn[] {
  const segments = progress.segments ?? [];
  if (!segments.some((s) => s.label)) return [];
  const geometry = barGeometry(progress);
  return segments.map((s, i) => ({
    label: s.label || null,
    frac: geometry[i]?.frac ?? 0,
    align: i === segments.length - 1 ? "right" : "left",
  }));
}

/** The caption row under a segmented/layered bar, mirroring the device's
 * labels row: a 14 pt row 4 pt below the bar, `.caption2` (11 pt), fixed
 * 60 % white. `gap` is the row's own column spacing, independent of the
 * capsule gap on device: 2 pt under a split bar, 0 under a layered one.
 * `color` exists for the editor bar, which sits on the panel surface
 * rather than the dark banner. Returns null when nothing is labeled. */
export function labelsRow(
  progress: BarProgress,
  gap: number,
  color = BAR_LABEL_COLOR,
): HTMLElement | null {
  const cols = labelColumns(progress);
  if (!cols.length) return null;
  const row = h("div", {
    // Stable hook for tests and the snapshot script; styling is inline.
    class: "barlabels",
    style: `display:flex;gap:${gap}px;height:14px;margin-top:4px;flex:none`,
  });
  for (const c of cols) {
    row.append(
      h(
        "span",
        {
          style:
            `flex:${c.frac};min-width:0;text-align:${c.align};` +
            `font-size:11px;font-weight:400;line-height:14px;color:${color};` +
            // The device wraps an overlong label inside the fixed-height row
            // and clips it; one line with an ellipsis is the
            // web approximation of that overflow.
            "overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
        },
        c.label ?? "",
      ),
    );
  }
  return row;
}

function withLabels(bar: HTMLElement, labels: HTMLElement | null): HTMLElement {
  if (!labels) return bar;
  return h("div", { style: "flex:none" }, bar, labels);
}

/** The layered bar's soft-emergence span: how far, as a
 * fraction of the whole bar, a layer's gradient transition runs where it
 * emerges from under the previous segment. */
const LAYER_OVERLAP = 0.12;

/** The layered track's on-device default: `Color.gray.opacity(0.3)`. */
export const LAYERED_TRACK = "rgba(142,142,147,.3)";

/** The layered segmented bar, the Live Activity variant: one
 * capsule-clipped bar built from layers
 * stacked back-to-front (the last segment bottommost), each layer spanning
 * x=0 to its segment's cumulative end and emerging from under the previous
 * one through a soft gradient (12 % of the bar width, CSS mask). The fill
 * runs 0 → min(value, cumulative end) on each layer, so the boundary
 * between two fills blends the same way the tracks do. With `labels`, the
 * on-device caption row renders below the bar. Widgets never render this:
 * the wire contract renders widgets split. */
export function layeredBar(
  progress: BarProgress,
  height: number,
  labels = false,
  topMargin = 6,
): HTMLElement {
  const segments = progress.segments ?? [];
  const geometry = barGeometry(progress);
  const value = clamp(progress.value ?? 0, 0, 1);
  const wrap = h("div", {
    style:
      `position:relative;height:${height}px;margin-top:${topMargin}px;` +
      `border-radius:${height / 2}px;overflow:hidden;flex:none`,
  });
  let cum = 0;
  const ends = geometry.map((g) => (cum += g.frac));
  segments.forEach((s, i) => {
    const end = ends[i] ?? 0;
    if (!(end > 0)) return;
    const start = i === 0 ? 0 : (ends[i - 1] ?? 0);
    // The mask fades the layer in around its own start, positioned within
    // the layer's width (0..end of the bar), exactly as the device's mask
    // does: gradient width = overlap/end, starting half a gradient early
    // so the layer is already part-opaque when it emerges.
    const gradFrac = LAYER_OVERLAP / end;
    const gradStart = Math.max(0, start / end - gradFrac / 2);
    const from = (gradStart * 100).toFixed(2);
    const to = (Math.min(1, gradStart + gradFrac) * 100).toFixed(2);
    const mask =
      i === 0
        ? ""
        : `;mask-image:linear-gradient(to right,transparent ${from}%,#000 ${to}%)` +
          `;-webkit-mask-image:linear-gradient(to right,transparent ${from}%,#000 ${to}%)`;
    const layer = h("div", {
      style:
        `position:absolute;top:0;bottom:0;left:0;width:${end * 100}%;` +
        `z-index:${segments.length - i}${mask}`,
    });
    layer.append(
      h("i", {
        style: `position:absolute;inset:0;display:block;${trackStyle(s, LAYERED_TRACK)}`,
      }),
    );
    // Absolute fill position: 0 when the value hasn't entered the segment
    // (the on-device clamp that keeps fill from bleeding through the
    // gradient), else the value's position within this layer.
    const fillFrac = value > start ? Math.min(value, end) / end : 0;
    if (fillFrac > 0) layer.append(h("i", { style: fillStyle(fillFrac, s) }));
    wrap.append(layer);
  });
  return withLabels(wrap, labels ? labelsRow(progress, 0) : null);
}

/** A split segmented bar, mirroring the device's split bar: per-segment
 * capsules with real gaps, solid or hatched tracks, one global value
 * filling left to right. With `labels`, the on-device caption row renders
 * below the bar: the Live Activity banner shows it; widgets keep labels
 * off (no widget family shows segment labels on device). */
export function segmentedBar(
  progress: BarProgress,
  height: number,
  gap: number,
  labels = false,
  topMargin = 6,
): HTMLElement {
  const segments = progress.segments ?? [];
  const geometry = barGeometry(progress);
  const wrap = h("div", {
    style: `display:flex;gap:${gap}px;height:${height}px;margin-top:${topMargin}px;flex:none`,
  });
  segments.forEach((s, i) => {
    const g = geometry[i];
    if (!g) return;
    const seg = h("div", { style: capsuleStyle(s, g.frac, height) });
    if (g.fill > 0) seg.append(h("i", { style: fillStyle(g.fill, s) }));
    wrap.append(seg);
  });
  // 2 px label column spacing, independent of the capsule gap (as on device).
  return withLabels(wrap, labels ? labelsRow(progress, 2) : null);
}
