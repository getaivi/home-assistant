// The hub's search box and status chips: instant filtering
// over widget and Live Activity cards, chip counts, the combined
// search+chip narrowing, the no-matches state, Escape-to-clear, focus
// preservation across the typing re-render, and the state staying out of
// the URL (the hub route remains /aivi).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HassLike } from "../src/types/hass";
import { $, $$, makeHass, mountPanel, setInput, sr, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function search(root: ParentNode): HTMLInputElement {
  return $(root, '.hubbar input[type="search"]') as HTMLInputElement;
}

function chip(root: ParentNode, label: string): HTMLElement {
  const el = $$(root, ".fchip").find((c) => text(c).startsWith(label));
  if (!el) throw new Error(`no chip labeled ${label}`);
  return el;
}

function chipCount(root: ParentNode, label: string): string {
  return text($(chip(root, label), ".n"));
}

function cardNames(root: ParentNode): string[] {
  return $$(root, "aivi-widget-card .nm").map((el) => text(el));
}

/** A hass without the fixture's unsupported Weather widget or demo
 * activity, for the chip-only dead-end case (Unsupported count 0). */
function hassAllSupported(): HassLike {
  const hass = makeHass();
  const orig = hass.callWS.bind(hass);
  hass.callWS = async (msg: object): Promise<unknown> => {
    const res = await orig(msg);
    if ((msg as { type: string }).type === "aivi/widgets") {
      const r = res as { widgets: Array<{ supported?: boolean }> };
      r.widgets = r.widgets.filter((w) => w.supported !== false);
    }
    return res;
  };
  return hass;
}

describe("hub search and filters", () => {
  it("renders the toolbar with per-status counts", async () => {
    const panel = await mountPanel();
    expect(search(sr(panel)).getAttribute("placeholder")).toBe("Search widgets & Live Activities…");
    // 7 remote widgets (frontdoor bound, weather unsupported) plus the
    // two remote Live Activities (washer bound, grill unbound).
    expect(chipCount(sr(panel), "All")).toBe("9");
    expect(chipCount(sr(panel), "Fed")).toBe("2");
    expect(chipCount(sr(panel), "Not fed")).toBe("6");
    expect(chipCount(sr(panel), "Unsupported")).toBe("1");
    expect(chip(sr(panel), "All").getAttribute("aria-pressed")).toBe("true");
    expect(chip(sr(panel), "Fed").getAttribute("aria-pressed")).toBe("false");
  });

  it("hides the toolbar when there is nothing to search", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      const type = (msg as { type: string }).type;
      if (type === "aivi/config")
        for (const acc of (res as { accounts: Array<Record<string, unknown>> }).accounts) {
          acc["widgets"] = [];
          acc["activities"] = [];
        }
      if (type === "aivi/widgets") (res as { widgets: object[] }).widgets = [];
      if (type === "aivi/activities") (res as { activities: object[] }).activities = [];
      return res;
    };
    const panel = await mountPanel(hass);
    expect(sr(panel).querySelector(".hubbar")).toBeNull();
    expect(text($(sr(panel), ".acct-empty h2"))).toBe("No widgets or Live Activities yet");
  });

  it("filters instantly on the name, keeping focus in the search box", async () => {
    const panel = await mountPanel();
    const input = search(sr(panel));
    input.focus();
    setInput(input, "laundry");
    await tick();
    expect(cardNames(sr(panel))).toEqual(["Laundry"]);
    // The typing re-render updated the toolbar in place: same element,
    // still focused, text intact.
    expect(sr(panel).activeElement).toBe(input);
    expect(search(sr(panel))).toBe(input);
    expect(input.value).toBe("laundry");
  });

  it("matches case- and diacritic-insensitively", async () => {
    const panel = await mountPanel();
    setInput(search(sr(panel)), "LÄUNDRY");
    await tick();
    expect(cardNames(sr(panel))).toEqual(["Laundry"]);
  });

  it("matches on the template as well as the name", async () => {
    const panel = await mountPanel();
    setInput(search(sr(panel)), "gauge");
    await tick();
    expect(cardNames(sr(panel))).toEqual(["Thermostat"]);
  });

  it("counts follow the search text", async () => {
    const panel = await mountPanel();
    setInput(search(sr(panel)), "batter");
    await tick();
    expect(chipCount(sr(panel), "All")).toBe("1");
    expect(chipCount(sr(panel), "Not fed")).toBe("1");
    expect(chipCount(sr(panel), "Fed")).toBe("0");
  });

  it("chips narrow by status and combine with the search text", async () => {
    const panel = await mountPanel();
    chip(sr(panel), "Not fed").click();
    await tick();
    expect(cardNames(sr(panel))).toHaveLength(5);
    expect(cardNames(sr(panel))).not.toContain("Front door");
    expect(chip(sr(panel), "Not fed").getAttribute("aria-pressed")).toBe("true");
    setInput(search(sr(panel)), "door");
    await tick();
    // "Front door" matches the text but is bound; nothing passes both.
    // The chip is the excluder here, so the empty state blames the filter
    // (a "No matches for door" would contradict the visible chip counts).
    expect(cardNames(sr(panel))).toEqual([]);
    expect(text($(sr(panel), ".hero-empty"))).toContain("Nothing matches this filter");
  });

  it("buckets unsupported templates behind the Unsupported chip", async () => {
    const panel = await mountPanel();
    expect(chipCount(sr(panel), "Unsupported")).toBe("1");
    chip(sr(panel), "Unsupported").click();
    await tick();
    expect(cardNames(sr(panel))).toEqual(["Weather"]);
    expect($(sr(panel), "aivi-widget-card").className).toContain("dim");
  });

  it("shows the localized no-matches state, and its clear action resets", async () => {
    const panel = await mountPanel();
    chip(sr(panel), "Fed").click();
    setInput(search(sr(panel)), "zzz");
    await tick();
    expect(sr(panel).querySelector("aivi-widget-card")).toBeNull();
    const empty = $(sr(panel), ".hero-empty");
    expect(text(empty)).toContain("No matches for “zzz”");
    $(empty, "button").click();
    await tick();
    expect(search(sr(panel)).value).toBe("");
    expect(chip(sr(panel), "All").getAttribute("aria-pressed")).toBe("true");
    expect(cardNames(sr(panel))).toHaveLength(7);
    expect($$(sr(panel), "aivi-activity-card")).toHaveLength(2);
  });

  it("words the no-matches state for a chip-only dead end", async () => {
    const panel = await mountPanel(hassAllSupported()); // Unsupported: 0
    // An empty Unsupported chip is not shown: it would filter to
    // nothing. The dead end is still reachable: the chip is kept while it
    // is the selection, so a stale pick still shows as the active filter.
    expect($$(sr(panel), ".fchip").map(text)).not.toContain("Unsupported0");
    const hub = $(sr(panel), "aivi-hub") as unknown as { _chip: string; requestUpdate(): void };
    hub._chip = "unsupported";
    hub.requestUpdate();
    await tick();
    expect(chip(sr(panel), "Unsupported").getAttribute("aria-pressed")).toBe("true");
    expect(text($(sr(panel), ".hero-empty"))).toContain("Nothing matches this filter");
  });

  it("Escape clears the search text", async () => {
    const panel = await mountPanel();
    const input = search(sr(panel));
    setInput(input, "laundry");
    await tick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(input.value).toBe("");
    expect(cardNames(sr(panel))).toHaveLength(7);
  });

  it("covers the Live Activities section too", async () => {
    const panel = await mountPanel();
    // The remote activities count like widgets: 7 + 2 cards, 2 bound.
    expect(chipCount(sr(panel), "All")).toBe("9");
    expect(chipCount(sr(panel), "Fed")).toBe("2");
    setInput(search(sr(panel)), "washer");
    await tick();
    expect(cardNames(sr(panel))).toEqual([]); // widgets section omitted
    expect($$(sr(panel), "aivi-activity-card")).toHaveLength(1);
    expect(text($(sr(panel), "aivi-activity-card .nm"))).toBe("Washer");
    // The omitted widgets section takes its eyebrow with it.
    expect($$(sr(panel), ".eyebrow").map((e) => text(e))).toEqual(["Live Activities"]);
  });

  it("keeps search state out of the URL: the hub route stays put", async () => {
    const panel = await mountPanel();
    const url = location.pathname + location.search + location.hash;
    setInput(search(sr(panel)), "laundry");
    chip(sr(panel), "Not fed").click();
    await tick();
    expect(panel.view).toBe("home");
    expect(location.pathname + location.search + location.hash).toBe(url);
  });

  it("survives a data refresh without losing the filter", async () => {
    const panel = await mountPanel();
    setInput(search(sr(panel)), "laundry");
    await tick();
    await panel.refresh();
    await tick();
    expect(search(sr(panel)).value).toBe("laundry");
    expect(cardNames(sr(panel))).toEqual(["Laundry"]);
  });
});
