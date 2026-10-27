// The single source of truth for the editor bar's geometry: seam thresholds
// + measured metrics -> pixel positions, and the inverse (pointer x ->
// threshold). The paint, adornment (handles) and hit layers all consume
// these so they can never disagree about where a seam sits. Pure math; the
// component measures the bar and passes the metrics in.

import { thresholdAt } from "./segments";

export interface BarMetrics {
  /** The bar's left edge in client space, px. */
  left: number;
  /** The bar's full width, gaps included, px. */
  width: number;
  /** The inter-capsule gap: 0 layered, 6 split. */
  gap: number;
  count: number;
}

/** Metrics from a measurement, or null when the bar has no usable width
 * (a non-rendering test DOM, a hidden panel): without a frame no pointer
 * math is meaningful, so the hit layer stays inert. */
export function barMetrics(
  left: number,
  width: number,
  gap: number,
  count: number,
): BarMetrics | null {
  const usable = width - gap * (Math.max(count, 1) - 1);
  return usable > 0 ? { left, width, gap, count } : null;
}

function usable(m: BarMetrics): number {
  return m.width - m.gap * (m.count - 1);
}

/** The px offset (from the bar's left edge) of seam `i`'s center: the
 * threshold scaled onto the gap-less width, shifted past the `i` preceding
 * gaps into the middle of its own. */
export function seamOffset(m: BarMetrics, at: number, i: number): number {
  return usable(m) * at + i * m.gap + m.gap / 2;
}

/** `seamOffset` as CSS, for the adornment layer's handles. */
export function seamLeftCss(at: number, i: number, gap: number, count: number): string {
  const gapTotal = gap * (count - 1);
  return `calc((100% - ${gapTotal}px) * ${at} + ${i * gap + gap / 2}px)`;
}

interface SeamHit {
  /** The seam's index (boundary between segments seam and seam+1). */
  seam: number;
  /** How far the pointer sat from the seam's center, px. */
  distance: number;
}

/** The seam nearest `clientX`, with its distance; null when the bar has no
 * seams (a single segment). */
export function nearestSeam(
  bounds: readonly number[],
  m: BarMetrics,
  clientX: number,
): SeamHit | null {
  let best: SeamHit | null = null;
  bounds.forEach((at, i) => {
    const distance = Math.abs(clientX - (m.left + seamOffset(m, at, i)));
    if (!best || distance < best.distance) best = { seam: i, distance };
  });
  return best;
}

/** How close (px) a pointer must land to a seam to grab it: fingers and
 * pens get a wider target than a mouse cursor. */
export function seamTolerance(pointerType: string | undefined): number {
  return pointerType === "touch" || pointerType === "pen" ? 22 : 12;
}

/** The capsule under `clientX`: the first segment whose seam sits right
 * of the pointer, from the same seam math the drag uses (a pointer in a
 * gap resolves to the capsule past it, matching what the eye reads). */
export function capsuleAt(bounds: readonly number[], m: BarMetrics, clientX: number): number {
  const x = clientX - m.left;
  for (let i = 0; i < bounds.length; i++) {
    if (x < seamOffset(m, bounds[i] ?? 0, i)) return i;
  }
  return Math.max(0, m.count - 1);
}

/** The float threshold the pointer targets for seam `i`: the inverse of
 * `seamOffset`, unquantized: drags accumulate in float and quantize once
 * on commit. */
export function seamThreshold(m: BarMetrics, i: number, clientX: number): number | null {
  return thresholdAt(m.left, m.width, clientX, i * m.gap + m.gap / 2, m.gap * (m.count - 1));
}
