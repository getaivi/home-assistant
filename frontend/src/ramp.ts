// The gauge ring's color ramp: mode, presets, and where each stop lands
// on the dial. DOM-free so the arithmetic is unit-testable.
//
// The stored shape is a bare `string[]` of 1–4 palette names
// (blocks.ColorRamp): one color lands as the payload's solid key, two or
// more as the gradient key. Everything here is derived from that list,
// never stored (the bar-mode.ts contract).
//
// blocks.ColorRamp carries no positions; the device spreads stops evenly
// across the arc, so stop k of n sits at k/(n-1). Given the gauge's
// min_value/max_value that spread has exact values the editor can show
// ("orange at 50 °C"). Positioned stops or hard-edged bands would need an
// Aivi app change.

import { tOpt } from "./i18n";

/** Solid or a multi-stop ramp, derived from the stored list's length. An
 * explicit mode makes the solid/gradient choice visible and reversible. */
export type RampMode = "solid" | "ramp";

export const RAMP_MAX = 4;

/** A named ramp. Ids are catalog keys (`ramp.preset.<id>`); colors are
 * palette names. */
interface RampPreset {
  id: string;
  colors: string[];
}

/** "Built-in" first: it is what an unset ring renders (preview-render.ts's
 * cyan → green → orange fallback), so "no colors" does not mean "no ramp". */
export const RAMP_PRESETS: readonly RampPreset[] = [
  { id: "builtin", colors: ["cyan", "green", "orange"] },
  { id: "cool-warm", colors: ["blue", "orange", "red"] },
  { id: "good-bad", colors: ["green", "yellow", "red"] },
  { id: "bad-good", colors: ["red", "yellow", "green"] },
];

/** Nothing stored derives to "ramp", not solid: an unset ring shows the
 * built-in ramp on device, and landing in ramp mode surfaces the presets. */
export function deriveRampMode(stops: readonly string[]): RampMode {
  return stops.length === 1 ? "solid" : "ramp";
}

/** The ramp the device falls back to when nothing is stored. */
export const BUILTIN_RAMP = RAMP_PRESETS[0] as RampPreset;

/** The stops as the active mode would push them. Solid keeps only the
 * first; the rest survive in the bindings for the session so switching
 * back restores them. Save prunes, as pruneForBarMode does for the bar. */
export function pruneForRampMode(stops: readonly string[], mode: RampMode): string[] {
  if (mode === "solid") return stops.length ? [stops[0] as string] : [];
  return [...stops];
}

/** The preset a stop list currently equals, if any. */
export function presetFor(stops: readonly string[]): RampPreset | null {
  return (
    RAMP_PRESETS.find(
      (p) => p.colors.length === stops.length && p.colors.every((c, i) => c === stops[i]),
    ) ?? null
  );
}

/** Where stop `index` of `count` sits along the arc, as a fraction: evenly
 * spaced, mirroring rampAt in preview/kit.ts (which mirrors the device). A
 * single stop has no position. */
export function stopFraction(index: number, count: number): number {
  if (count <= 1) return 0;
  return index / (count - 1);
}

/** The stop's position in the gauge's own units, or null when the range
 * isn't usable (a single stop, or min >= max). */
export function stopValue(index: number, count: number, min: number, max: number): number | null {
  if (count <= 1 || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max <= min) return null;
  return min + stopFraction(index, count) * (max - min);
}

/** Round for display; the magnitude decides how many decimals to show. */
export function formatStopValue(value: number, locale: string): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

export function setStop(stops: readonly string[], index: number, color: string): string[] {
  const out = [...stops];
  if (index >= 0 && index < out.length) out[index] = color;
  return out;
}

export function removeStop(stops: readonly string[], index: number): string[] {
  return stops.filter((_, i) => i !== index);
}

/** The list with one stop appended, capped at RAMP_MAX. The new stop is
 * the first palette color the ramp does not use yet, so adding one shows
 * on the strip at once (a repeat of the last color would look like nothing
 * had happened). */
export function addStop(stops: readonly string[], palette: readonly string[] = []): string[] {
  if (stops.length >= RAMP_MAX) return [...stops];
  const fresh = palette.find((c) => !stops.includes(c));
  return [...stops, fresh ?? stops[stops.length - 1] ?? "green"];
}

/** What to store for a stop list: the built-in ramp is the unset state,
 * so choosing it (or arriving back at it) stores nothing. */
export function storedStops(stops: readonly string[]): string[] {
  return presetFor(stops)?.id === BUILTIN_RAMP.id ? [] : [...stops];
}

/** The stops a range shows and edits: the stored ones, else the built-in
 * ramp the dial paints when nothing is stored. */
export function effectiveStops(stops: readonly string[]): string[] {
  return stops.length ? [...stops] : [...BUILTIN_RAMP.colors];
}

export function reverseStops(stops: readonly string[]): string[] {
  return [...stops].reverse();
}

/** A preset's display name; an id without a catalog key falls back to the
 * id rather than rendering blank. */
export function presetLabel(id: string): string {
  return tOpt(`ramp.preset.${id}`) ?? id;
}
