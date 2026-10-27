// Pure search/filter logic for the hub grid.
//
// The state is not in the URL: the URL carries views, and with a search
// string in history, browser back would undo the search instead of
// leaving the view. It is kept on the panel for its lifetime,
// so the hub comes back from an editor with the same search.

type HubStatus = "bound" | "unbound" | "unsupported";
export type HubChip = "all" | HubStatus;

export const HUB_CHIPS = ["all", "bound", "unbound", "unsupported"] as const;

/** A hub card as the filter sees it; the hub adapts widget and activity
 * cards into these facts. */
export interface HubCardFacts {
  name: string;
  /** Searchable template words: the raw slug plus its localized label. */
  template: string[];
  status: HubStatus;
}

/** Case- and diacritic-insensitive fold: NFD-decompose, strip combining
 * marks, lowercase, so "Thermostât" and "THERMOSTAT" collapse together. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** The status bucket of a hub card. A binding wins: a bound widget stays
 * bound even when its template is unsupported or the remote widget
 * vanished (it still renders with Edit/Unbind). Otherwise supportedness
 * decides. */
export function cardStatus(bound: boolean, supported: boolean): HubStatus {
  if (bound) return "bound";
  return supported ? "unbound" : "unsupported";
}

/** Substring match of the folded query against the folded name and
 * template words; an empty (or whitespace) query matches everything. */
export function matchesQuery(card: HubCardFacts, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [card.name, ...card.template].some((s) => fold(s).includes(q));
}

export function matchesChip(card: HubCardFacts, chip: HubChip): boolean {
  return chip === "all" || card.status === chip;
}

/** Search text and chip combine: the chip narrows the search results. */
export function matches(card: HubCardFacts, query: string, chip: HubChip): boolean {
  return matchesQuery(card, query) && matchesChip(card, chip);
}

/** Per-chip counts over the search-filtered set: each chip shows how
 * many cards selecting it would show under the current search text. */
export function chipCounts(cards: readonly HubCardFacts[], query: string): Record<HubChip, number> {
  const counts: Record<HubChip, number> = {
    all: 0,
    bound: 0,
    unbound: 0,
    unsupported: 0,
  };
  for (const card of cards) {
    if (!matchesQuery(card, query)) continue;
    counts.all += 1;
    counts[card.status] += 1;
  }
  return counts;
}

/** Whether any refinement is active (the hub then omits non-matching
 * sections). */
export function filtering(query: string, chip: HubChip): boolean {
  return query.trim() !== "" || chip !== "all";
}
