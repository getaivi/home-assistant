// Pure segment math for the visual segments editor: normalized fractions,
// cumulative thresholds, and the list operations behind boundary
// drag/nudge, resize, split, and remove. DOM-free so it is unit-testable.
//
// `SegmentBinding.value` is a weight the backend normalizes and quantizes
// to 1024ths at resolve time, but every operation here writes
// already-normalized fractions (4 decimals, summing to exactly 1), so the
// percentages the user reads are the weights that get saved. Bindings with
// arbitrary weights display proportionally and normalize on the first
// manipulation.

import type { SegmentBinding } from "./types/bindings";
import { clamp } from "./util";
import { segmentMode } from "./value-source";

/** No segment may shrink below 1%: a thinner capsule can't be seen,
 * grabbed, or recovered on the bar. */
export const MIN_FRACTION = 0.01;

const PRECISION = 1e4; // 4 decimals = 0.01% resolution

function round(x: number): number {
  return Math.round(x * PRECISION) / PRECISION;
}

export function pct(frac: number): number {
  return Math.round(frac * 100);
}

/** Whole percentages for a set of shares that sum to exactly 100
 * (largest-remainder rounding): each share is floored and the points left
 * over go to the largest fractional parts, the earlier phase winning a
 * tie. Rounding each share on its own reads 33/33/33 or 50/25/13/13. */
export function percentages(fracs: readonly number[]): number[] {
  const total = fracs.reduce((a, b) => a + Math.max(b, 0), 0);
  if (!(total > 0)) return fracs.map(() => 0);
  // 1e-9 keeps a share that is a whole percent in floats (0.07 * 100 =
  // 7.000000000000001) from claiming a remainder it does not have.
  const exact = fracs.map((f) => (Math.max(f, 0) / total) * 100);
  const out = exact.map((x) => Math.floor(x + 1e-9));
  const order = exact
    .map((x, i) => ({ i, rest: x - (out[i] ?? 0) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left--;
  }
  return out;
}

/** A typed size as a number of percent, or null when it is not a number.
 * A decimal comma counts as a point ("12,5" is twelve and a half), and a
 * trailing percent sign is tolerated. */
export function parsePercent(text: string): number | null {
  const m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*%?$/.exec(text.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** A share as the Size field writes it: percent, at most two decimals
 * (the store's resolution), no trailing zeros. */
export function sizeText(frac: number): string {
  return String(Math.round(frac * PRECISION) / (PRECISION / 100));
}

/** Whether the segment's weight comes from a live source (entity /
 * attribute / template) instead of its stored literal weight. Marker
 * presence counts even while empty (a just-switched mode sticks), the
 * same rule the scalar source switch uses. */
export function isSourced(s: SegmentBinding): boolean {
  return segmentMode(s) !== "literal";
}

/** The fractions the editor bar displays: the last resolved proportions
 * (from the live preview) when they cover the same segments, else the
 * stored weights. Sourced segments render at their live share; a preview
 * that hasn't caught up (length mismatch, missing values) degrades to
 * the stored model. */
export function displayFractions(
  segments: readonly SegmentBinding[],
  resolved: readonly (number | undefined)[] | undefined,
): number[] {
  if (
    resolved &&
    resolved.length === segments.length &&
    segments.length > 0 &&
    resolved.every((v): v is number => typeof v === "number" && v > 0)
  ) {
    const total = resolved.reduce((a, b) => a + b, 0);
    const out = resolved.map((v) => round(v / total));
    const sum = out.slice(0, -1).reduce((a, b) => a + b, 0);
    out[out.length - 1] = round(1 - sum);
    return out;
  }
  return fractionsOf(segments);
}

/** A segment's stored weight; a negative or NaN one counts as 0. */
function weightOf(s: SegmentBinding): number {
  return Math.max(s.value, 0) || 0;
}

/** The shares the bar shows right after an edit to the stored weights,
 * before any preview has resolved it: a sourced segment keeps the share it
 * was showing (`display`, its last resolved one), and the literal segments
 * divide the rest in proportion to their stored weights, which is how the
 * integration resolves them. Falls back to the stored model when `display`
 * does not cover the same segments. */
export function carriedFractions(
  next: readonly SegmentBinding[],
  display: readonly number[],
): number[] {
  if (display.length !== next.length || !next.length) return fractionsOf(next);
  let live = 0;
  let literal = 0;
  let lastLiteral = -1;
  next.forEach((s, i) => {
    if (isSourced(s)) live += display[i] ?? 0;
    else {
      literal += weightOf(s);
      lastLiteral = i;
    }
  });
  if (!(literal > 0)) return [...display];
  const room = Math.max(0, 1 - live);
  const out = next.map((s, i) =>
    isSourced(s) ? (display[i] ?? 0) : round((room * weightOf(s)) / literal),
  );
  // The last literal absorbs the rounding drift, so the sum stays 1.
  const sum = out.reduce((a, b) => a + b, 0);
  out[lastLiteral] = round((out[lastLiteral] ?? 0) + 1 - sum);
  return out;
}

/** Normalized fractions per segment (0-weight tolerated, equal split when
 * every weight is 0). Rounded to 4 decimals; the last fraction absorbs the
 * rounding drift so the sum is exactly 1. */
export function fractionsOf(segments: readonly SegmentBinding[]): number[] {
  if (!segments.length) return [];
  const weights = segments.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  const fracs = total > 0 ? weights.map((w) => w / total) : segments.map(() => 1 / segments.length);
  const out = fracs.map(round);
  const sum = out.slice(0, -1).reduce((a, b) => a + b, 0);
  out[out.length - 1] = round(1 - sum);
  return out;
}

function cumulative(fracs: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < fracs.length - 1; i++) {
    acc = round(acc + (fracs[i] ?? 0));
    out.push(acc);
  }
  return out;
}

/** The N-1 inner boundaries as cumulative thresholds in (0, 1), over the
 * stored weights or over explicit (display) fractions. */
export function boundariesOf(
  segments: readonly SegmentBinding[],
  fracs: readonly number[] = fractionsOf(segments),
): number[] {
  return cumulative(fracs);
}

function withFractions(
  segments: readonly SegmentBinding[],
  fracs: readonly number[],
): SegmentBinding[] {
  return segments.map((s, i) => ({ ...s, value: fracs[i] ?? 0 }));
}

/** The [lo, hi] threshold range boundary `i` may occupy: its neighbors'
 * outer boundaries, inset by the minimum segment width. Pass the display
 * fractions when the bar is showing resolved sourced shares. */
export function boundaryRange(
  segments: readonly SegmentBinding[],
  i: number,
  fracs: readonly number[] = fractionsOf(segments),
): [number, number] {
  const bounds = cumulative(fracs);
  const lo = (i > 0 ? (bounds[i - 1] ?? 0) : 0) + MIN_FRACTION;
  const hi = (bounds[i + 1] ?? 1) - MIN_FRACTION;
  return [round(lo), round(hi)];
}

/** Boundary `i` (between segments i and i+1) moved to the cumulative
 * `threshold`, clamped so both neighbors keep at least MIN_FRACTION.
 * Only the two adjacent weights change. Refused (unchanged copy) when
 * either neighbor is sourced. `display` carries the fractions the bar
 * shows when they differ from the stored weights (resolved sourced
 * shares): the move happens in display space and writes back the two
 * neighbors' stored weights preserving their stored sum. */
export function moveBoundary(
  segments: readonly SegmentBinding[],
  i: number,
  threshold: number,
  display?: readonly number[],
): SegmentBinding[] {
  const stored = fractionsOf(segments);
  const left = segments[i];
  const right = segments[i + 1];
  if (i < 0 || i >= stored.length - 1 || !left || !right || isSourced(left) || isSourced(right))
    return withFractions(segments, stored);
  const fracs = display && display.length === segments.length ? [...display] : [...stored];
  const bounds = cumulative(fracs);
  const [lo, hi] = boundaryRange(segments, i, fracs);
  if (lo > hi) return withFractions(segments, stored);
  const at = round(clamp(threshold, lo, hi));
  const start = i > 0 ? (bounds[i - 1] ?? 0) : 0;
  const end = bounds[i + 1] ?? 1;
  const mine = at - start;
  const theirs = end - at;
  const pair = round((stored[i] ?? 0) + (stored[i + 1] ?? 0));
  stored[i] = round((pair * mine) / (mine + theirs || 1));
  stored[i + 1] = round(pair - (stored[i] ?? 0));
  return withFractions(segments, stored);
}

/** The fractions the bar renders mid-drag: `moveBoundary`'s clamp without
 * quantization or writes. The drag commits once through `moveBoundary` on
 * release, so quantization happens once and the seam never jitters. */
export function moveBoundaryDraft(
  fracs: readonly number[],
  i: number,
  threshold: number,
): number[] {
  const out = [...fracs];
  if (i < 0 || i >= fracs.length - 1) return out;
  let start = 0;
  for (let j = 0; j < i; j++) start += fracs[j] ?? 0;
  const end = start + (fracs[i] ?? 0) + (fracs[i + 1] ?? 0);
  const lo = start + MIN_FRACTION;
  const hi = end - MIN_FRACTION;
  if (lo > hi) return out;
  const at = clamp(threshold, lo, hi);
  out[i] = at - start;
  out[i + 1] = end - at;
  return out;
}

/** Segment `i` resized to `size` (a fraction of the whole bar); the delta
 * comes out of the nearest literal neighbor (right first: a sourced
 * neighbor's share follows its source, not this input), clamped so both
 * keep at least MIN_FRACTION. Refused when no literal neighbor exists;
 * a single segment stays at 1. For a sourced segment `i` this resizes
 * its stored fallback weight. `display` carries the shares the bar shows
 * when they differ from the stored weights (a sourced phase elsewhere):
 * a literal segment is then sized in display space, the number its
 * capsule reads, and the pair's stored weights are written back
 * preserving their stored sum, as `moveBoundary` does. */
export function setSize(
  segments: readonly SegmentBinding[],
  i: number,
  size: number,
  display?: readonly number[],
): SegmentBinding[] {
  const fracs = fractionsOf(segments);
  const self = segments[i];
  if (!self) return withFractions(segments, fracs);
  const literal = (j: number): boolean => {
    const s = segments[j];
    return !!s && !isSourced(s);
  };
  let j = -1;
  if (i < segments.length - 1 && literal(i + 1)) j = i + 1;
  else if (i > 0 && literal(i - 1)) j = i - 1;
  if (j < 0) return withFractions(segments, fracs);
  const shown = display && display.length === segments.length && !isSourced(self) ? display : fracs;
  const room = round((shown[i] ?? 0) + (shown[j] ?? 0));
  if (room < 2 * MIN_FRACTION) return withFractions(segments, fracs);
  const mine = clamp(size, MIN_FRACTION, room - MIN_FRACTION);
  const pair = round((fracs[i] ?? 0) + (fracs[j] ?? 0));
  fracs[i] = round((pair * mine) / room);
  fracs[j] = round(pair - (fracs[i] ?? 0));
  return withFractions(segments, fracs);
}

/** Segment `i` split in half; the new right half takes `fillColor` and no
 * label/track styling of its own. Refused (unchanged copy) when the
 * segment is too thin to split or the list is already at `max`. */
export function splitSegment(
  segments: readonly SegmentBinding[],
  i: number,
  fillColor: string,
  max: number,
): SegmentBinding[] {
  const fracs = fractionsOf(segments);
  const frac = fracs[i];
  if (
    i < 0 ||
    i >= segments.length ||
    segments.length >= max ||
    frac === undefined ||
    frac < 2 * MIN_FRACTION
  )
    return withFractions(segments, fracs);
  const left = round(frac / 2);
  const right = round(frac - left);
  const out = withFractions(segments, fracs);
  const src = out[i];
  if (!src) return out;
  src.value = left;
  out.splice(i + 1, 0, { value: right, fill_color: fillColor });
  return out;
}

/** Where an add-a-phase split should land: the last segment, unless it is
 * too thin to split, then the widest one. -1 when nothing is splittable. */
export function bestSplitIndex(segments: readonly SegmentBinding[]): number {
  const fracs = fractionsOf(segments);
  const last = fracs.length - 1;
  if ((fracs[last] ?? 0) >= 2 * MIN_FRACTION) return last;
  let best = -1;
  for (let i = 0; i < fracs.length; i++) {
    if ((fracs[i] ?? 0) >= 2 * MIN_FRACTION && (best < 0 || (fracs[i] ?? 0) > (fracs[best] ?? 0)))
      best = i;
  }
  return best;
}

/** Segment `i` removed; its left neighbor (right, for the first segment)
 * absorbs the space. Removing the only segment empties the list. */
export function removeSegment(segments: readonly SegmentBinding[], i: number): SegmentBinding[] {
  if (i < 0 || i >= segments.length) return withFractions(segments, fractionsOf(segments));
  if (segments.length === 1) return [];
  const fracs = fractionsOf(segments);
  const j = i > 0 ? i - 1 : i + 1;
  fracs[j] = round((fracs[j] ?? 0) + (fracs[i] ?? 0));
  const out = withFractions(segments, fracs);
  out.splice(i, 1);
  return out;
}

/** The colors a new phase may take, in the order they are offered: clear
 * hues that sit well beside each other. Never a gray (a gray phase reads
 * as the bar's empty track, not as a phase) and never brown. */
const PHASE_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "pink",
  "teal",
  "yellow",
  "red",
  "indigo",
  "mint",
  "cyan",
];

/** The first phase color no segment uses yet (so a new phase is visibly
 * its own), limited to what the palette offers; cycles when all are
 * taken. */
export function nextColor(segments: readonly SegmentBinding[], colors: readonly string[]): string {
  const used = new Set(segments.map((s) => s.fill_color));
  const offered = PHASE_COLORS.filter((c) => !colors.length || colors.includes(c));
  return (
    offered.find((c) => !used.has(c)) ?? offered[segments.length % (offered.length || 1)] ?? "blue"
  );
}

/** The seeded default on first activation: two phases, 50/50, the bound
 * bar color (blue when unset) and the next phase color beside it. */
export function seedSegments(barColor: string | null): SegmentBinding[] {
  const first: SegmentBinding = { value: 0.5, fill_color: barColor ?? "blue" };
  return [first, { value: 0.5, fill_color: nextColor([first], []) }];
}

/** Whether the phases are still exactly what `seedSegments(barColor)`
 * produced: nothing about them was edited. */
export function isSeed(segments: readonly SegmentBinding[], barColor: string | null): boolean {
  return JSON.stringify(segments) === JSON.stringify(seedSegments(barColor));
}

/** The threshold a pointer at `clientX` targets on a bar whose capsules
 * start at `left` and share `width` minus `gapTotal` px of inter-capsule
 * gaps, `gapOffset` px of which sit left of this boundary. Null when the
 * bar has no measurable width (e.g. a non-rendering test DOM). */
export function thresholdAt(
  left: number,
  width: number,
  clientX: number,
  gapOffset = 0,
  gapTotal = 0,
): number | null {
  const usable = width - gapTotal;
  if (!(usable > 0)) return null;
  return clamp((clientX - left - gapOffset) / usable, 0, 1);
}
