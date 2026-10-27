// The SF Symbols index the icon picker searches: every symbol's name, the
// iOS version it needs, its categories and its search terms, generated
// from Apple's own metadata by scripts/refresh_sf_symbols.py and served
// by the integration beside the panel bundle. Loaded once, on the first
// pick, since few sessions touch an icon.
//
// A browser can't draw SF Symbols, and the artwork is Apple's, so the
// picker shows names and words, never glyphs.

import { BUILD_STAMP } from "./build-info";

export interface SfSymbol {
  name: string;
  /** The iOS version the symbol first shipped in, e.g. "16.0". */
  ios: string;
  /** Indexes into `SfIndex.categories`. */
  categories: number[];
  /** Apple's search terms for it ("date", "laundry"). */
  terms: string[];
}

export interface SfIndex {
  /** Category keys in picker order (`symbols.cat-<key>` names them). */
  categories: string[];
  symbols: SfSymbol[];
}

interface Wire {
  categories: string[];
  symbols: [string, string, number[], string[]][];
}

/** Where the index lives: next to the bundle, which is what the
 * integration serves at /aivi_panel/ and what the dev harness serves from
 * the frontend directory. The build stamp busts caches on a release. */
export function symbolsUrl(): string {
  const base = typeof import.meta.url === "string" ? import.meta.url : "";
  const url = new URL("sf-symbols.json", base || "http://localhost/");
  url.searchParams.set("v", BUILD_STAMP);
  return url.toString();
}

let loading: Promise<SfIndex> | null = null;

export function loadSymbols(): Promise<SfIndex> {
  loading ??= fetch(symbolsUrl())
    .then(async (res) => {
      if (!res.ok) throw new Error(`sf-symbols.json: HTTP ${res.status}`);
      const wire = (await res.json()) as Wire;
      return {
        categories: wire.categories,
        symbols: wire.symbols.map(([name, ios, categories, terms]) => ({
          name,
          ios,
          categories,
          terms,
        })),
      };
    })
    .catch((err: unknown) => {
      loading = null; // the next open tries again
      throw err;
    });
  return loading;
}

/** Tests: forget a loaded index. */
export function resetSymbols(): void {
  loading = null;
}

/** What was typed, written the way symbol names are: lowercase, with dots
 * where the words were spaced ("Bolt fill" reads as "bolt.fill"). */
function symbolQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ".");
}

const NAMES = new WeakMap<SfIndex, Set<string>>();

/** The symbol the typed text names once read the way the search reads
 * it, or null when it names none (a symbol newer than the index, or a
 * slip): the picker stores this, so what it found is what is sent. */
export function symbolNamed(index: SfIndex, text: string): string | null {
  let names = NAMES.get(index);
  if (!names) {
    names = new Set(index.symbols.map((s) => s.name));
    NAMES.set(index, names);
  }
  const name = symbolQuery(text);
  return names.has(name) ? name : null;
}

/** The best matches for what was typed, within a category (-1 for all):
 * names starting with it first, then names containing it, then symbols
 * whose search terms match. Each tier keeps Apple's order. */
export function searchSymbols(
  index: SfIndex,
  query: string,
  category: number,
  limit = 60,
): SfSymbol[] {
  const q = symbolQuery(query);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pool =
    category < 0 ? index.symbols : index.symbols.filter((s) => s.categories.includes(category));
  if (!q) return pool.slice(0, limit);
  const starts: SfSymbol[] = [];
  const contains: SfSymbol[] = [];
  const terms: SfSymbol[] = [];
  for (const s of pool) {
    if (s.name.startsWith(q)) starts.push(s);
    else if (s.name.includes(q)) contains.push(s);
    else if (words.every((w) => s.terms.some((term) => term.includes(w)))) terms.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains, ...terms].slice(0, limit);
}

/** The fewest single-character edits that turn `a` into `b`, or
 * `limit + 1` once it is clear there are more than `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      row.push(next);
      best = Math.min(best, next);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length] ?? limit + 1;
}

/** The symbol the index lists that a name it does not list most likely
 * meant: the one it names once read the way the search reads it, else
 * the nearest by spelling (a slip of a character or two, or a word left
 * out), else null. */
export function closestSymbol(index: SfIndex, text: string): string | null {
  const named = symbolNamed(index, text);
  if (named) return named;
  const query = symbolQuery(text);
  if (!query) return null;
  const limit = Math.max(2, Math.round(query.length / 4));
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const s of index.symbols) {
    const distance = editDistance(query, s.name, Math.min(limit, bestDistance - 1));
    if (distance < bestDistance) {
      best = s.name;
      bestDistance = distance;
    }
  }
  return best;
}
