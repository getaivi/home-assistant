// The preview's two widget sizes: the Small | Medium switch in the pane
// (widgets only, a default per template, the choice kept on the panel for
// the session), and what holds at either size.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviPreviewPane } from "../src/aivi-preview-pane";
import { defaultPreviewSize, previewWidget } from "../src/preview-render";
import { previewStyles } from "../src/styles/preview";
import {
  $,
  $$,
  css,
  META,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

function sizeSwitch(root: ParentNode): HTMLElement[] {
  return $$(root, "aivi-preview-pane .phead .seg button");
}

describe("size switch", () => {
  it("opens data-rich templates at Medium and the rest at Small", () => {
    for (const template of [
      "energy",
      "switchboard",
      "list",
      "battery",
      "budget",
      "prices",
      "trend",
      "showcase",
      "remote",
    ])
      expect(defaultPreviewSize(template)).toBe("medium");
    for (const template of ["status", "gauge", "countdown", "progress"])
      expect(defaultPreviewSize(template)).toBe("small");
    // Every widget template has a deliberate default.
    expect(Object.keys(META.templates).sort()).toEqual([
      "battery",
      "budget",
      "countdown",
      "energy",
      "gauge",
      "list",
      "prices",
      "progress",
      "remote",
      "showcase",
      "status",
      "switchboard",
      "trend",
    ]);
  });

  it("is a two-option radio group on a widget's preview", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const group = $(root, "aivi-preview-pane .phead .seg");
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("Preview size");
    const options = sizeSwitch(root);
    expect(options.map(text)).toEqual(["Small", "Medium"]);
    // Status opens at Small.
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect($(root, ".pv-stage .pv-canvas").classList.contains("is-small")).toBe(true);
  });

  it("is absent from a Live Activity's preview", async () => {
    const panel = await mountPanel();
    await openActivityEditor(panel, "washer");
    const root = sr(panel);
    expect($(root, "aivi-preview-pane .phead h3")).toBeTruthy();
    expect(root.querySelector("aivi-preview-pane .seg")).toBeNull();
    expect(root.querySelector(".pv-stage .pv-canvas")).toBeNull();
  });

  it("opens a switchboard at Medium", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "livingroom");
    const root = sr(panel);
    expect(sizeSwitch(root).map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect($(root, ".pv-stage .pv-canvas").classList.contains("is-medium")).toBe(true);
    expect($$(root, ".pv-stage .pv-switchboard-grid > div")).toHaveLength(6);
  });

  it("re-renders at the picked size and keeps regions pressable", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const small = $(root, ".pv-stage .pv-scale");
    sizeSwitch(root)[1]!.click();
    await tick();
    const medium = $(root, ".pv-stage .pv-scale");
    expect(medium).not.toBe(small);
    expect($(medium, ".pv-canvas").classList.contains("is-medium")).toBe(true);
    expect(sizeSwitch(root).map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    // Status has its own medium layout: the text column beside the chip.
    expect($(medium, ".pv-canvas > .pv-status-row > .pv-status-col > .pv-hero")).toBeTruthy();
    // A region still leads to its fields, and is still a button.
    const hero = $(medium, '[data-slot="hero"]');
    expect(hero.getAttribute("role")).toBe("button");
    hero.click();
    await until(() => !!root.querySelector("aivi-field-row.flash"), "a flashed row");
    expect($$(root, "aivi-field-row.flash").map((r) => r.dataset["key"])).toContain("state");
    expect($(root, '.pv-stage [data-slot="hero"]').hasAttribute("data-slot-on")).toBe(true);
    // And back.
    sizeSwitch(root)[0]!.click();
    await tick();
    expect($(root, ".pv-stage .pv-canvas").classList.contains("is-small")).toBe(true);
    expect(root.querySelector(".pv-stage .wfit")).toBeNull();
  });

  it("follows the arrow keys, like the kit's other segmented controls", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    $(root, "aivi-preview-pane .phead .seg").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await tick();
    expect($(root, ".pv-stage .pv-canvas").classList.contains("is-medium")).toBe(true);
  });

  it("remembers the choice per template on the panel, for the session", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    sizeSwitch(sr(panel))[1]!.click();
    await tick();
    expect([...panel.previewSizes]).toEqual([["status", "medium"]]);
    // Another template keeps its own default...
    await openWidgetEditor(panel, "laundry");
    expect(($(sr(panel), "aivi-preview-pane") as AiviPreviewPane).size).toBe("small");
    // ...and the first one comes back as it was left.
    await openWidgetEditor(panel, "frontdoor");
    await until(
      () => !!sr(panel).querySelector(".pv-stage .pv-canvas.is-medium"),
      "the remembered size",
    );
    expect(sizeSwitch(sr(panel))[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps its own choice when mounted outside a panel", async () => {
    const pane = document.createElement("aivi-preview-pane") as AiviPreviewPane;
    pane.editorState = {
      kind: "widget",
      template: "list",
      name: "Home",
      preview: null,
    } as AiviPreviewPane["editorState"];
    document.body.append(pane);
    await tick();
    expect(pane.size).toBe("medium");
    sizeSwitch(document)[0]!.click();
    await tick();
    expect(pane.size).toBe("small");
    expect($(pane, ".pv-stage .pv-canvas").classList.contains("is-small")).toBe(true);
  });
});

describe("the icon chip", () => {
  it("stays round as a pressable region", () => {
    const sheet = previewStyles.cssText;
    // The regions' own corner radius must not outrank the mock's: it sits
    // in :where(), below `.pv-canvas .pv-chip`.
    expect(sheet).toMatch(/\.pv-canvas \.pv-chip, \.pv-banner \.pv-chip \{[^}]*border-radius: 50%/);
    expect(sheet).toMatch(/\.pv-stage :where\(\[data-slot\]\) \{ border-radius: 4px; \}/);
    expect(sheet).not.toMatch(/\.pv-stage \[data-slot\][^{]*\{[^}]*border-radius/);
    // The affordances are untouched: the pointer, hover and focus rings.
    expect(sheet).toMatch(/\.pv-stage \[data-slot\] \{ cursor: pointer; \}/);
    expect(sheet).toMatch(/\.pv-stage \[data-slot\]:hover \{\s*outline: 1\.5px solid/);
    expect(sheet).toMatch(/\.pv-stage \[data-slot\]:focus-visible \{[^}]*outline: 2px solid/);
    const el = previewWidget("status", "Door", { state: { value: "Open" }, icon: "lock.fill" });
    const chip = $(el, '.pv-chip[data-slot="icon"]');
    expect(css(chip)).not.toContain("border-radius");
  });
});

describe("a template the panel has no preview for", () => {
  it("says so at either size", () => {
    for (const size of ["small", "medium"] as const) {
      const unknown = previewWidget("mystery", "X", {}, size);
      expect(text($(unknown, ".pv-canvas > .pv-waiting"))).toBe("No preview for mystery");
    }
  });
});
