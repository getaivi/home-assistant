// The hub's pure search/filter logic: folding, status buckets, the
// name+template search predicate, chip narrowing, and the per-chip counts
// that follow the search text.

import { describe, expect, it } from "vitest";
import {
  cardStatus,
  chipCounts,
  filtering,
  fold,
  HUB_CHIPS,
  type HubCardFacts,
  matches,
  matchesChip,
  matchesQuery,
} from "../src/hub-filter";

function card(
  name: string,
  template: string[],
  status: HubCardFacts["status"] = "unbound",
): HubCardFacts {
  return { name, template, status };
}

describe("fold", () => {
  it("lowercases and strips diacritics", () => {
    expect(fold("Thermostât")).toBe("thermostat");
    expect(fold("LAUNDRY")).toBe("laundry");
    expect(fold("Épée à côté")).toBe("epee a cote");
  });

  it("leaves plain ascii alone", () => {
    expect(fold("front door 2")).toBe("front door 2");
  });
});

describe("cardStatus", () => {
  it("a binding wins over supportedness", () => {
    expect(cardStatus(true, true)).toBe("bound");
    expect(cardStatus(true, false)).toBe("bound");
  });

  it("unbound cards split by supportedness", () => {
    expect(cardStatus(false, true)).toBe("unbound");
    expect(cardStatus(false, false)).toBe("unsupported");
  });
});

describe("matchesQuery", () => {
  const laundry = card("Laundry", ["progress", "Progress"]);

  it("an empty or whitespace query matches everything", () => {
    expect(matchesQuery(laundry, "")).toBe(true);
    expect(matchesQuery(laundry, "   ")).toBe(true);
  });

  it("substring-matches the name, case-insensitively", () => {
    expect(matchesQuery(laundry, "laun")).toBe(true);
    expect(matchesQuery(laundry, "AUNDR")).toBe(true);
    expect(matchesQuery(laundry, "washer")).toBe(false);
  });

  it("matches the template slug and its localized label", () => {
    expect(matchesQuery(laundry, "progress")).toBe(true);
    expect(matchesQuery(card("Tvätt", ["progress", "Förlopp"]), "förlopp")).toBe(true);
  });

  it("is diacritic-insensitive in both directions", () => {
    expect(matchesQuery(laundry, "läundry")).toBe(true);
    expect(matchesQuery(card("Thermostât", ["gauge", "Gauge"]), "thermostat")).toBe(true);
  });
});

describe("matchesChip and matches", () => {
  const bound = card("A", ["status", "Status"], "bound");
  const unbound = card("B", ["status", "Status"], "unbound");

  it("'all' passes everything; a status chip narrows to it", () => {
    expect(matchesChip(bound, "all")).toBe(true);
    expect(matchesChip(bound, "bound")).toBe(true);
    expect(matchesChip(bound, "unbound")).toBe(false);
  });

  it("search text and chip combine", () => {
    expect(matches(unbound, "b", "unbound")).toBe(true);
    expect(matches(unbound, "b", "bound")).toBe(false);
    expect(matches(unbound, "zzz", "unbound")).toBe(false);
  });
});

describe("chipCounts", () => {
  const cards = [
    card("Front door", ["status", "Status"], "bound"),
    card("Laundry", ["progress", "Progress"], "unbound"),
    card("Weather", ["forecast", "forecast"], "unsupported"),
  ];

  it("counts every status bucket plus the total", () => {
    expect(chipCounts(cards, "")).toEqual({
      all: 3,
      bound: 1,
      unbound: 1,
      unsupported: 1,
    });
  });

  it("follows the search text (counts advertise the combined result)", () => {
    expect(chipCounts(cards, "laundry")).toEqual({
      all: 1,
      bound: 0,
      unbound: 1,
      unsupported: 0,
    });
  });

  it("has a bucket for every chip", () => {
    const counts = chipCounts([], "");
    for (const chip of HUB_CHIPS) expect(counts[chip]).toBe(0);
  });
});

describe("filtering", () => {
  it("is active when either refinement is set", () => {
    expect(filtering("", "all")).toBe(false);
    expect(filtering("  ", "all")).toBe(false);
    expect(filtering("x", "all")).toBe(true);
    expect(filtering("", "bound")).toBe(true);
  });
});
