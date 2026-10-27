// The Remote widget in the panel: its preview at both sizes against the
// app's Remote template (plain buttons and marked ones, a cut-out and a
// photo, a number and a word), the regions that lead to its fields, its
// form, and what it says when the content is too big.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import { COLOR_HEX, WP } from "../src/const";
import { isMarked, isNumericValue, splitUnit } from "../src/preview/remote";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { tooBigText } from "../src/save-blockers";
import { sectionsFor, slotsFor } from "../src/slots";
import type { WidgetContent } from "../src/types/content";
import { labelFor } from "../src/util";
import { $, $$, css, META, mountPanel, sr, text, until } from "./harness";

const CAR = "https://pictures.example.com/car.png";

/** A remote as the integration would push it: a lock that is on, the
 * climate off, the horn, and two more buttons than Small shows. */
const FULL: WidgetContent = {
  value: { value: "78%" },
  image: { url: CAR, alt: "The car" },
  reported_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  stats: [{ label: "Range", value: { value: "312" }, unit: "km" }],
  actions: [
    { id: "lock", label: "Lock", icon: "lock.fill", kind: "toggle", on: true },
    { id: "climate", label: "Climate", icon: "thermometer.medium", kind: "toggle", on: false },
    { id: "horn", label: "Horn", icon: "speaker.wave.2.fill", kind: "button" },
    { id: "lights", label: "Lights", icon: "lightbulb.fill", kind: "button" },
    { id: "trunk", label: "Trunk", icon: "car.side.rear.open", kind: "button" },
  ],
  icon: "car.fill",
  accent: "blue",
};

const canvas = (content: WidgetContent, size: PreviewSize): HTMLElement =>
  $(previewWidget("remote", "Car", content, size), `.pv-canvas.is-${size}`);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("remote preview: the reading", () => {
  it("splits a number from a short unit after it", () => {
    expect(splitUnit({ value: "78%" })).toEqual({ number: "78", separator: "", unit: "%" });
    expect(splitUnit({ value: "7.4 kW" })).toEqual({ number: "7.4", separator: " ", unit: "kW" });
    expect(splitUnit({ value: "1 150 kWh" })?.number).toBe("1 150");
    expect(splitUnit({ value: "Closed" })).toBeNull();
    expect(splitUnit({ value: "78" })).toBeNull();
    expect(splitUnit({ value: "2026-10-05T10:00:00Z", formatter: "time_since" })).toBeNull();
  });

  it("takes a number, or one with its unit, as the numeric hero", () => {
    expect(isNumericValue({ value: "78" })).toBe(true);
    expect(isNumericValue({ value: "7.4 kW" })).toBe(true);
    expect(isNumericValue({ value: "Closed" })).toBe(false);
  });

  it("draws a unit at half the hero, and a word as a title", () => {
    const hero = $(canvas(FULL, "small"), ".pv-showcase-hero");
    expect(text(hero)).toBe("78%");
    expect(css(hero)).toContain("font-size:28px");
    expect(css($(hero, "span"))).toContain("font-size:0.5em");
    const word = $(canvas({ ...FULL, value: { value: "Closed" } }, "medium"), ".pv-showcase-hero");
    expect(word.className).toContain("is-word");
    // 0.72 of Medium's 34.
    expect(css(word)).toContain("font-size:24px");
  });
});

describe("remote preview: small", () => {
  it("is the name, the reading beside the picture, then two buttons", () => {
    const el = canvas(FULL, "small");
    expect(text($(el, ".pv-showcase-name"))).toBe("Car");
    expect($(el, ".pv-remote-zone .pv-remote-slot img").getAttribute("src")).toBe(CAR);
    const buttons = $$(el, ".pv-remote-button");
    expect(buttons.map((b) => b.dataset["action"])).toEqual(["lock", "climate"]);
    // No report time at this size.
    expect(el.querySelector(".pv-showcase-meta")).toBeNull();
  });

  it("fills an on toggle with the tint, an off one's glyph secondary", () => {
    const [lock, climate] = $$(canvas(FULL, "small"), ".pv-remote-button");
    expect(css(lock as HTMLElement)).toContain(`background:${COLOR_HEX.blue}`);
    expect(css(climate as HTMLElement)).toContain(`background:${WP.quaternary}`);
    expect(css(climate as HTMLElement)).toContain(`color:${WP.secondary}`);
  });

  it("fills the widget with a photo, the name and the reading laid on it", () => {
    const el = canvas({ ...FULL, image: { url: CAR, fit: "cover" } }, "small");
    expect($(el, ".pv-showcase-photo").className).toContain("is-remote");
    expect(text($(el, ".pv-remote-onphoto .pv-showcase-name"))).toBe("Car");
    expect($$(el, ".pv-remote-button")).toHaveLength(2);
  });
  it("stands the icon in for a missing picture, and holds places for what is missing", () => {
    const el = canvas({ icon: "door.garage.closed" }, "small");
    expect($(el, ".pv-showcase-cutout.is-icon")).toBeTruthy();
    expect($(el, '[data-ghost][data-slot="value"]')).toBeTruthy();
    expect($(el, '[data-ghost][data-slot="actions"]')).toBeTruthy();
  });

  it("writes dark on a pale fill, and says which buttons are on", () => {
    const actions = [
      { id: "a", label: "Fan", icon: "fan.fill", kind: "toggle" as const, on: true },
    ];
    const el = canvas({ ...FULL, accent: "yellow", actions }, "small");
    const button = $(el, ".pv-remote-button");
    expect(css(button)).toContain("color:#1c1c1f");
    expect(button.getAttribute("aria-label")).toBe("Fan, on");
  });
});

describe("remote preview: medium", () => {
  it("is the header with the report time, the picture and the reading, then five buttons", () => {
    const el = canvas(FULL, "medium");
    expect(text($(el, ".pv-showcase-meta"))).toContain("12m ago");
    expect(css($(el, ".pv-showcase-hero"))).toContain("font-size:34px");
    expect($$(el, ".pv-remote-button")).toHaveLength(5);
  });

  it("draws marked actions as the switchboard's tiles, four of them", () => {
    const actions = (FULL.actions ?? []).map((a, i) => (i === 0 ? { ...a, color: "red" } : a));
    expect(isMarked(actions)).toBe(true);
    const el = canvas({ ...FULL, actions }, "medium");
    expect(el.querySelector(".pv-remote-button")).toBeNull();
    const tiles = $$(el, ".pv-remote-buttons .pv-switchboard-tile");
    expect(tiles).toHaveLength(4);
    expect(text($(tiles[0] as HTMLElement, ".pv-switchboard-label"))).toBe("Lock");
    expect(css($(el, ".pv-showcase-hero"))).toContain("font-size:30px");
  });

  it("bleeds a photo from the leading edge down to the buttons", () => {
    const el = canvas({ ...FULL, image: { url: CAR, fit: "cover" } }, "medium");
    expect($(el, ".pv-remote-beside .pv-showcase-photo").className).toContain("is-bled");
    expect(text($(el, ".pv-remote-beside .pv-showcase-meta"))).toContain("12m ago");
  });
});

describe("remote: regions and form", () => {
  it("leads every region to the fields that paint it", () => {
    const slots = new Set(slotsFor("widget", "remote").map((s) => s.id));
    for (const size of ["small", "medium"] as const)
      for (const region of $$(canvas(FULL, size), "[data-slot]"))
        expect(slots).toContain(region.dataset["slot"]);
  });

  it("keeps the stats with what the widget shows", () => {
    const keys = (META.templates["remote"]?.fields ?? []).map((f) => f.key);
    const sections = sectionsFor("widget", "remote", keys, (key) =>
      ["icon", "accent"].includes(key),
    );
    expect(sections.find((s) => s.id === "content")?.keys).toEqual(
      expect.arrayContaining(["image", "value", "actions", "stats", "reported_at"]),
    );
    expect(sections.find((s) => s.id === "behavior")?.keys).toEqual(["tap_url"]);
  });

  it("calls a remote's actions buttons and its value the reading", () => {
    expect(labelFor("actions", "remote")).toBe("Buttons");
    expect(labelFor("actions", "switchboard")).toBe("Tiles");
    expect(labelFor("actions")).toBe("Tiles");
    expect(labelFor("value", "remote")).toBe("Reading");
    expect(labelFor("value", "status")).toBe("Value");
  });

  it("says what to cut when the content is too big", () => {
    expect(tooBigText({ bytes: 4200, limit: 4096, template: "remote" })).toContain(
      "remove buttons",
    );
  });

  async function newRemote(): Promise<{ panel: AiviPanel; editor: AiviEditor }> {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    panel.openEditor(
      acc,
      { slug: "carremote", name: "Car remote", template: "remote", supported: true },
      null,
    );
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "the editor");
    return { panel, editor: $(sr(panel), "aivi-editor") as AiviEditor };
  }

  it("labels the buttons field in the editor, and Save waits for a reading and a button", async () => {
    const { panel, editor } = await newRemote();
    expect(text($(editor, '.field[data-key="actions"] .flabel'))).toBe("Buttons");
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
  });
});
