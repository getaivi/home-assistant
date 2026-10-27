// Panel-level behavior: entity listing/filtering from hass.states,
// editor state construction, and the toast lifecycle.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HassLike } from "../src/types/hass";
import { $, $$, mountPanel, STATES, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks(); // a pinned Date.now must not leak into the next test
});

describe("entities()", () => {
  it("lists every state, each domain block sorted by friendly name", async () => {
    const panel = await mountPanel();
    const all = panel.entities();
    expect(all).toHaveLength(Object.keys(STATES).length);
    const sensors = all.filter((o) => o.id.startsWith("sensor.")).map((o) => o.name);
    expect(sensors).toEqual([...sensors].sort((a, b) => a.localeCompare(b)));
  });

  it("filters by domain (single and list) and device_class", async () => {
    const panel = await mountPanel();
    const climate = panel.entities({ domain: "climate" }).map((o) => o.id);
    expect(climate.sort()).toEqual(["climate.living_room", "climate.my_car"]);
    const multi = panel.entities({ domain: ["climate", "binary_sensor"] });
    expect(multi.map((o) => o.id).sort()).toEqual([
      "binary_sensor.garage",
      "climate.living_room",
      "climate.my_car",
    ]);
    const batteries = panel.entities({ device_class: "battery" });
    expect(batteries).toHaveLength(4);
    expect(batteries.every((o) => o.id.includes("battery"))).toBe(true);
  });
});

describe("entities() relevance", () => {
  it("keeps only numeric states on request and lists the asked device class first", async () => {
    const panel = await mountPanel();
    const numeric = panel.entities({
      domain: ["sensor", "input_number"],
      numeric: true,
      device_class_first: "monetary",
    });
    const ids = numeric.map((o) => o.id);
    // A timestamp and a text state are out; a plain number is in.
    expect(ids).not.toContain("sensor.next_bin");
    expect(ids).toContain("sensor.monthly_budget");
    expect(ids).toContain("input_number.washer_progress");
    // Money first, each block by name.
    const monetary = numeric.filter((o) => STATES[o.id]?.attributes.device_class === "monetary");
    expect(monetary.length).toBeGreaterThan(1);
    expect(ids.slice(0, monetary.length)).toEqual(monetary.map((o) => o.id));
  });

  it("puts the domains a widget usually shows before the long tail when unfiltered", async () => {
    const panel = await mountPanel();
    const ids = panel.entities().map((o) => o.id.split(".")[0]);
    // Sensors come before scenes and scripts, which come before nothing
    // ranked lower here; within a rank the name order holds.
    expect(ids.indexOf("sensor")).toBeLessThan(ids.indexOf("scene"));
    expect(ids.lastIndexOf("sensor")).toBeLessThan(ids.indexOf("scene"));
  });
});

describe("editor state", () => {
  it("deep-clones bound bindings so edits never leak into the hub", async () => {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    expect(panel.editorState?.bindings).toEqual(bound.bindings);
    if (panel.editorState) panel.editorState.bindings["state"] = "sensor.humidity";
    expect(bound.bindings?.["state"]).toBe("input_boolean.front_door");
    panel.closeEditor();
    expect(panel.editorState).toBeNull();
    expect(panel.view).toBe("home");
  });
});

describe("toast", () => {
  it("appears in the shadow root and removes itself after 3 s", async () => {
    const panel = await mountPanel();
    vi.useFakeTimers();
    panel.toast("hello there");
    const toast = sr(panel).querySelector(".toast");
    expect(toast && text(toast)).toBe("hello there");
    vi.advanceTimersByTime(3100);
    expect(sr(panel).querySelector(".toast")).toBeNull();
  });

  it("survives a synchronous full template swap in both directions", async () => {
    // Toasts live in a renderBefore container outside Lit's root part
    // range, so a toast raised synchronously with a hub <-> editor
    // template swap must survive the commit.
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound); // hub -> editor swap pending
    panel.toast("survivor");
    await panel.updateComplete; // the swap commits with the toast up
    expect(text($(sr(panel), ".toast"))).toBe("survivor");
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "editor preview",
    );
    panel.closeEditor(); // editor -> hub, the other direction
    await panel.updateComplete;
    expect(text($(sr(panel), ".toast"))).toBe("survivor");
  });
});

describe("streaming hass updates", () => {
  /** A hass whose states differ from `panel.hass` in `id` only. */
  function withState(
    panel: Awaited<ReturnType<typeof mountPanel>>,
    id: string,
    state: string,
  ): HassLike {
    const prev = panel.hass;
    const old = prev.states[id];
    if (!old) throw new Error(`no fixture state ${id}`);
    return { ...prev, states: { ...prev.states, [id]: { ...old, state } } };
  }

  async function openBound(): Promise<Awaited<ReturnType<typeof mountPanel>>> {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "initial preview",
    );
    await new Promise((r) => setTimeout(r, 300));
    return panel;
  }

  it("refreshes the preview when a bound entity changes", async () => {
    const panel = await openBound();
    const spy = vi.spyOn(panel.api, "preview");
    panel.hass = withState(panel, "input_boolean.front_door", "off");
    await until(() => spy.mock.calls.length > 0, "preview refresh");
  });

  it("ignores state changes to entities the bindings don't read", async () => {
    const panel = await openBound();
    const spy = vi.spyOn(panel.api, "preview");
    panel.hass = withState(panel, "sensor.humidity", "99");
    panel.hass = { ...panel.hass }; // same states object
    await new Promise((r) => setTimeout(r, 400));
    expect(spy).not.toHaveBeenCalled();
  });

  it("still previews under a steady stream of updates", async () => {
    // A restarting 250 ms debounce would never fire with an update every
    // 50 ms; a pending refresh must not be pushed back.
    const panel = await openBound();
    const spy = vi.spyOn(panel.api, "preview");
    for (let i = 0; i < 12; i++) {
      panel.hass = withState(panel, "input_boolean.front_door", i % 2 ? "on" : "off");
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("entities() memo", () => {
  it("reuses the list until hass.states is replaced", async () => {
    const panel = await mountPanel();
    const first = panel.entities({ domain: "sensor" });
    expect(panel.entities({ domain: "sensor" })).toBe(first);
    expect(panel.entities()).not.toBe(first);
    panel.hass = { ...panel.hass, states: { ...panel.hass.states } };
    expect(panel.entities({ domain: "sensor" })).not.toBe(first);
    expect(panel.entities({ domain: "sensor" })).toEqual(first);
  });
});

describe("hearing about changes made in the Aivi app", () => {
  // The API sends nothing when a widget is created or deleted in the app:
  // the hub asks again on a press of Refresh, and only then.
  it("Refresh turns, then wears a tick and rests: the button is the message", async () => {
    const panel = await mountPanel();
    vi.useFakeTimers();
    const refresh = vi.spyOn(panel, "refresh");
    const button = $(sr(panel), ".topbar .refreshbtn");
    expect(button.getAttribute("aria-label")).toBe("Refresh");
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.classList.contains("busy")).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // A press while it turns, or while it shows the outcome, does nothing.
    button.click();
    await vi.advanceTimersByTimeAsync(900);
    expect(button.classList.contains("done")).toBe(true);
    button.click();
    expect(refresh).toHaveBeenCalledTimes(1);
    // No toast: a tick on the button, and a line for screen readers.
    expect(sr(panel).querySelector(".toast")).toBeNull();
    expect(text($(sr(panel), ".topbar [role=status]"))).toBe(
      "Up to date: nothing changed in the Aivi app.",
    );
    await vi.advanceTimersByTimeAsync(2100);
    expect(button.className).toContain("idle");
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("a widget the refresh finds glows once on the hub", async () => {
    const panel = await mountPanel();
    vi.useFakeTimers();
    const acc = panel.accounts[0]!;
    vi.spyOn(panel.api, "widgets").mockResolvedValueOnce({
      widgets: [
        ...(panel.aiviWidgets[acc.entry_id] ?? []),
        { slug: "new-one", name: "New one", template: "status", supported: true },
      ],
    });
    $(sr(panel), ".topbar .refreshbtn").click();
    await vi.advanceTimersByTimeAsync(900);
    const cards = $$(sr(panel), "aivi-widget-card.fresh");
    expect(cards.map((card) => text($(card, ".nm")))).toEqual(["New one"]);
    expect(text($(sr(panel), ".topbar [role=status]"))).toBe("Updated from the Aivi app.");
    await vi.advanceTimersByTimeAsync(2100);
    expect($$(sr(panel), "aivi-widget-card.fresh")).toHaveLength(0);
  });

  it("wears a warning instead when Aivi cannot be reached", async () => {
    const panel = await mountPanel();
    vi.useFakeTimers();
    vi.spyOn(panel, "refresh").mockRejectedValue(new Error("down"));
    const button = $(sr(panel), ".topbar .refreshbtn");
    button.click();
    await vi.advanceTimersByTimeAsync(900);
    expect(button.classList.contains("failed")).toBe(true);
    expect(text($(sr(panel), ".topbar [role=status]"))).toBe("Couldn't reach Aivi.");
  });

  it("asks nothing on its own: coming back to the tab reads no lists", async () => {
    const panel = await mountPanel();
    const refresh = vi.spyOn(panel, "refresh");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });
});
