// Colors by value: a color picked by the band of numbers an entity's
// reading falls in ("below 20 % red, up to 50 % orange, above that
// green"). Stored as data under `<slot>__bands` (value-source.ts) and
// resolved by the integration (`Bands` in custom_components/aivi/
// sources.py, which tests/fixtures.test.ts pins this module to): n values
// and the n - 1 ascending limits between them. A reading that is no number
// has no band, and the slot's fixed color shows instead.
//
// Pure functions over the stored bands and Home Assistant's states.

import { t } from "./i18n";
import type { HassEntity } from "./types/hass";

export interface BandsBinding {
  entity: string;
  /** Ascending; one fewer than `values`. */
  limits: number[];
  values: string[];
}

/** The most bands one value takes. */
export const MAX_BANDS = 5;

/** Stored bands, or null when the integration would not use them (no
 * entity, limits that are not ascending finite numbers, values that do
 * not match them in number). */
export function parseBands(raw: unknown): BandsBinding | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { entity, limits, values } = raw as Record<string, unknown>;
  if (typeof entity !== "string" || !entity) return null;
  if (!Array.isArray(limits) || !Array.isArray(values)) return null;
  const numbers = limits.map((limit) => readingOf(limit));
  if (numbers.some((n) => n === null)) return null;
  const ascending = numbers as number[];
  if (values.length < 2 || values.length > MAX_BANDS) return null;
  if (values.length !== ascending.length + 1) return null;
  if (ascending.some((n, i) => i > 0 && n <= (ascending[i - 1] ?? n))) return null;
  if (!values.every((v): v is string => typeof v === "string")) return null;
  return { entity, limits: ascending, values };
}

/** A state, a number or numeric text, as a finite number; else null. */
export function readingOf(raw: unknown): number | null {
  if (typeof raw === "boolean" || raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The band a reading falls in: the count of limits at or below it. */
export function bandOf(bands: BandsBinding, reading: number): number {
  return bands.limits.filter((limit) => limit <= reading).length;
}

/** The value the integration picks for `state`, or null when the state is
 * no number. */
export function pickBand(bands: BandsBinding, state: unknown): string | null {
  const reading = readingOf(state);
  return reading === null ? null : (bands.values[bandOf(bands, reading)] ?? null);
}

/** A number as a limit is written: as typed, with no float noise. */
export function formatLimit(n: number): string {
  return String(Number(n.toPrecision(12)));
}

/** A reading with the entity's unit: "64 %". */
export function withUnit(n: number, unit: string): string {
  return unit ? `${formatLimit(n)} ${unit}` : formatLimit(n);
}

/** What band `i` covers, in words: "Below 20 %", "20 % to 50 %", "50 %
 * and up". */
export function bandRange(bands: BandsBinding, i: number, unit: string): string {
  const limits = bands.limits;
  const upper = limits[i];
  const lower = limits[i - 1];
  if (lower === undefined) return t("bands.below", { limit: withUnit(upper ?? 0, unit) });
  if (upper === undefined) return t("bands.above", { from: withUnit(lower, unit) });
  return t("bands.between", { from: withUnit(lower, unit), limit: withUnit(upper, unit) });
}

/** The same bands as a template, for the escape hatch: a reading that is
 * no number renders nothing, so the fixed color shows, as with the bands. */
export function bandsTemplate(bands: BandsBinding): string {
  const steps = bands.limits
    .map((limit, i) => `'${bands.values[i]}' if v < ${formatLimit(limit)} else `)
    .join("");
  const last = bands.values[bands.values.length - 1];
  return (
    `{% set v = states('${bands.entity}') | float(none) %}` +
    `{% if v is not none %}{{ ${steps}'${last}' }}{% endif %}`
  );
}

/** The span a reading of `e` lives in, when it has a known one: a
 * percentage's 0 to 100. */
export function knownRange(e: HassEntity | undefined): [number, number] | null {
  if (!e) return null;
  const unit = e.attributes["unit_of_measurement"];
  const dc = e.attributes.device_class;
  return unit === "%" || dc === "battery" || dc === "humidity" ? [0, 100] : null;
}

/** The span the ruler draws: `span` where the field has one (a gauge's
 * dial), else the entity's own, else the limits with room either side;
 * widened to take the reading. */
export function rulerRange(
  bands: BandsBinding,
  e: HassEntity | undefined,
  reading: number | null,
  span: [number, number] | null = null,
): [number, number] {
  const known = span ?? knownRange(e);
  const first = bands.limits[0] ?? 0;
  const last = bands.limits[bands.limits.length - 1] ?? first;
  const pad = Math.max((last - first) / 2, Math.abs(first) / 2, 1);
  let [min, max] = known ?? [first - pad, last + pad];
  if (reading !== null) {
    min = Math.min(min, reading);
    max = Math.max(max, reading);
  }
  min = Math.min(min, first);
  max = Math.max(max, last);
  return max > min ? [min, max] : [min, min + 1];
}

/** A reading inside each band, for "Preview as": the middle of a band
 * between two limits, and of the ruler's ends beyond them. */
export function sampleReadings(bands: BandsBinding, range: [number, number]): number[] {
  const [min, max] = range;
  const edges = [min, ...bands.limits, max];
  return bands.values.map((_, i) => {
    const lo = edges[i] ?? min;
    const hi = edges[i + 1] ?? max;
    return niceBetween(lo, hi);
  });
}

/** A round number between `lo` (included) and `hi` (excluded), the
 * nearest to their middle on a step of 5 or finer: 10 between 0 and 20,
 * 35 between 20 and 50. */
function niceBetween(lo: number, hi: number): number {
  const middle = (lo + hi) / 2;
  if (hi <= lo) return lo;
  for (const step of [5, 1, 0.5, 0.1, 0.01]) {
    const n = Math.round(middle / step) * step;
    if (n >= lo && n < hi) return Number(n.toPrecision(12));
  }
  return middle;
}

/** Bands to start from for entity `e`: thirds of the field's own span
 * (a gauge's dial), a percentage's 20 and 50, else limits around its
 * reading; red low, orange between, green high. */
export function seedBands(
  entity: string,
  e: HassEntity | undefined,
  span: [number, number] | null = null,
): BandsBinding {
  const values = ["red", "orange", "green"];
  if (span && span[1] > span[0]) {
    const [min, max] = span;
    const third = (max - min) / 3;
    const round = (n: number): number => (third >= 1 ? Math.round(n) : Number(n.toPrecision(2)));
    return { entity, limits: [round(min + third), round(max - third)], values };
  }
  if (knownRange(e)) return { entity, limits: [20, 50], values };
  const reading = readingOf(e?.state);
  if (reading === null) return { entity, limits: [10, 20], values };
  const step = niceStep(Math.abs(reading) / 5);
  const below = Math.floor(reading / step) * step;
  return { entity, limits: [below - step, below + step], values };
}

/** The round step closest above `n`: 1, 2 or 5 times a power of ten. */
function niceStep(n: number): number {
  if (!(n > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) if (m * power >= n) return m * power;
  return 10 * power;
}
