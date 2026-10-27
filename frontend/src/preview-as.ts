// "Preview as": the widget drawn as if an entity that colors follow by
// value read a number inside one of their bands. The integration draws it
// (aivi/preview's `states`), so the value, its color and anything else
// read from that entity change together, and Home Assistant is left alone.

import {
  type BandsBinding,
  parseBands,
  pickBand,
  readingOf,
  rulerRange,
  sampleReadings,
} from "./bands";
import type { Bindings } from "./types/bindings";
import type { HassEntity } from "./types/hass";
import { markerOf } from "./value-source";

/** Which band of which entity the widget is previewed in. */
export interface PreviewAs {
  entity: string;
  band: number;
}

/** The bands one entity's readings fall in, across every color that
 * follows it: each limit any of them sets. `mixed` when colors differ in
 * their limits, so a band has no one color. */
export interface EntityBands extends BandsBinding {
  mixed: boolean;
}

/** The bands at the top level of the bindings, by the entity they
 * follow. */
export function bandsByEntity(bindings: Bindings): EntityBands[] {
  const sets = new Map<string, BandsBinding[]>();
  for (const [key, value] of Object.entries(bindings)) {
    const bands = markerOf(key) === "bands" ? parseBands(value) : null;
    if (bands) sets.set(bands.entity, [...(sets.get(bands.entity) ?? []), bands]);
  }
  return [...sets.entries()].map(([entity, all]) => {
    const first = all[0] as BandsBinding;
    const limits = [...new Set(all.flatMap((b) => b.limits))].sort((a, b) => a - b);
    const mixed = all.some((b) => b.limits.join() !== first.limits.join());
    // Each band's color as the first color names it, at its lower limit.
    const values = [limits[0] ?? 0, ...limits].map((limit, i) =>
      i === 0 ? (first.values[0] ?? "") : (pickBand(first, limit) ?? ""),
    );
    return { entity, limits, values, mixed };
  });
}

/** A reading inside each band of `bands`, on the ruler the form draws. */
export function bandReadings(bands: BandsBinding, e: HassEntity | undefined): number[] {
  return sampleReadings(bands, rulerRange(bands, e, readingOf(e?.state)));
}

/** The states to preview with, or null when no bands follow the entity
 * `as` names any more (or there is no `as`). */
export function previewStates(
  bindings: Bindings,
  states: Record<string, HassEntity>,
  as: PreviewAs | undefined,
): Record<string, string> | null {
  if (!as) return null;
  const bands = bandsByEntity(bindings).find((b) => b.entity === as.entity);
  const reading = bands ? bandReadings(bands, states[as.entity])[as.band] : undefined;
  return reading === undefined ? null : { [as.entity]: String(reading) };
}
