// The entities a picker offers: filtered per field, sorted by relevance,
// and memoized, since every field row asks on every render.

import type { EntityOption, HassLike } from "./types/hass";
import type { EntityFilter } from "./types/meta";

/** The domains a widget usually shows, ahead of the long tail in an
 * unfiltered picker. */
const DOMAIN_RANK: Record<string, number> = {
  sensor: 1,
  binary_sensor: 2,
  light: 3,
  switch: 3,
  cover: 4,
  lock: 4,
  climate: 4,
  fan: 4,
  media_player: 5,
  person: 5,
  input_number: 6,
  input_boolean: 6,
  input_text: 6,
  input_select: 6,
  input_datetime: 6,
  weather: 6,
  calendar: 6,
  vacuum: 6,
  camera: 7,
  scene: 7,
  script: 7,
  automation: 7,
};
const DOMAIN_RANK_TAIL = 9;

export class EntityOptions {
  private _cache: {
    states: HassLike["states"];
    byFilter: Map<string, EntityOption[]>;
  } | null = null;

  /** Sorted pickable entities, memoized per filter until `states` is
   * replaced. Treat the result as read-only, it is shared. */
  for(states: HassLike["states"], filter?: EntityFilter): EntityOption[] {
    if (this._cache?.states !== states) this._cache = { states, byFilter: new Map() };
    const key = JSON.stringify(filter ?? {});
    const cached = this._cache.byFilter.get(key);
    if (cached) return cached;
    const domains = filter?.domain ? ([] as string[]).concat(filter.domain) : null;
    const out: EntityOption[] = [];
    const rank = new Map<string, number>();
    for (const [id, st] of Object.entries(states)) {
      const domain = id.split(".")[0] ?? "";
      if (domains && !domains.includes(domain)) continue;
      if (filter?.device_class && st.attributes.device_class !== filter.device_class) continue;
      if (filter?.numeric && !Number.isFinite(Number(st.state))) continue;
      out.push({ id, name: st.attributes.friendly_name || id });
      // Relevance, then name: the asked device class first; without a
      // domain filter, the domains a widget usually shows before the
      // long tail (updates, zones, the sun…).
      rank.set(
        id,
        filter?.device_class_first && st.attributes.device_class === filter.device_class_first
          ? 0
          : domains
            ? 1
            : (DOMAIN_RANK[domain] ?? DOMAIN_RANK_TAIL),
      );
    }
    out.sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || a.name.localeCompare(b.name),
    );
    this._cache.byFilter.set(key, out);
    return out;
  }
}
