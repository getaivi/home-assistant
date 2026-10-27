// The Showcase widget in the panel: its preview at both sizes against the
// app's Showcase template (a cut-out, a photo, no picture, numbers and
// words), the regions that lead to its fields, its form's sections, and
// what holds Save (a picture's URL, a reading's gauge ceiling).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import type { AiviPanel } from "../src/aivi-panel";
import { COLOR_HEX } from "../src/const";
import { fieldUrlProblem } from "../src/editor-validation";
import {
  isNumericReading,
  readingText,
  relativeWords,
  reportedPhrase,
  showcase,
  timeWords,
  unitSeparator,
} from "../src/preview/showcase";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { sectionsFor, slotsFor } from "../src/slots";
import { maxProblem, plainNumber } from "../src/switchboard";
import type { WidgetContent } from "../src/types/content";
import type { FieldMeta } from "../src/types/meta";
import {
  $,
  $$,
  css,
  META,
  mountPanel,
  previewSettled,
  setInput,
  setSelect,
  sr,
  text,
  tick,
  until,
} from "./harness";

const CAR = "https://pictures.example.com/car.png";

/** The spec's example, as the integration would push it. */
const FULL: WidgetContent = {
  image: { url: CAR, alt: "Ioniq 5" },
  badge: { url: "https://pictures.example.com/badge.png", alt: "Brand" },
  state: { icon: "lock.fill", text: { value: "Locked", text_color: "green" } } as never,
  reported_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  stats: [
    { label: "Battery", value: { value: "78" }, unit: "%", max: 100 },
    { label: "Range", value: { value: "312" }, unit: "km" },
    { label: "Odometer", value: { value: "24 180" }, unit: "km" },
    { label: "Tyres", value: { value: "OK" } },
  ],
  icon: "car.fill",
  accent: "blue",
};

const canvas = (content: WidgetContent, size: PreviewSize): HTMLElement =>
  $(previewWidget("showcase", "Car", content, size), `.pv-canvas.is-${size}`);

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("showcase preview: the module", () => {
  it("draws both families itself", () => {
    expect(typeof showcase.small).toBe("function");
    expect(typeof showcase.medium).toBe("function");
  });
});

describe("showcase preview: readings", () => {
  it("hugs a sign to its value and spaces a word", () => {
    expect(unitSeparator("%")).toBe("");
    expect(unitSeparator("°C")).toBe("");
    expect(unitSeparator("km")).toBe(" ");
    expect(unitSeparator("GB")).toBe(" ");
  });

  it("takes digits without letters as a number, and a time as words", () => {
    expect(isNumericReading({ value: { value: "78" } })).toBe(true);
    expect(isNumericReading({ value: { value: "142/230" } })).toBe(true);
    expect(isNumericReading({ value: { value: "Locked" } })).toBe(false);
    expect(isNumericReading({ value: { value: "2026-10-05", formatter: "time_since" } })).toBe(
      false,
    );
  });

  it("says a time in compact words that keep themselves current", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    const since = { value: "2026-10-05T10:00:00Z", formatter: "time_since" };
    expect(relativeWords(since)).toBe("2h ago");
    expect(relativeWords({ value: "2026-10-08T12:00:00Z", formatter: "time_until" })).toBe("in 3d");
    // No weeks: twelve days are days.
    expect(relativeWords({ value: "2026-09-23T12:00:00Z", formatter: "time_since" })).toBe(
      "12d ago",
    );
    expect(relativeWords({ value: "78" })).toBeNull();
    expect(readingText({ value: since })).toBe("2h ago");
    expect(readingText({})).toBe("–");
  });

  it("holds still within a minute of the time, either side", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(timeWords(now - 30_000, now)).toBe("Just now");
    expect(timeWords(now, now)).toBe("Just now");
    expect(timeWords(now + 30_000, now)).toBe("In a moment");
    expect(timeWords(now + 60_000, now)).toBe("In a moment");
    expect(timeWords(now - 60_000, now)).toBe("1m ago");
    expect(timeWords(now + 61_000, now)).toBe("in 1m");
  });

  it("words the report time as a time reading, never a date", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const ago = (s: number): string => new Date(now - s * 1000).toISOString();
    expect(reportedPhrase(ago(20), now)).toBe("Just now");
    expect(reportedPhrase(ago(-600), now)).toBe("Just now");
    expect(reportedPhrase(ago(5 * 60), now)).toBe("5m ago");
    expect(reportedPhrase(ago(3 * 3600), now)).toBe("3h ago");
    expect(reportedPhrase(ago(3 * 86400), now)).toBe("3d ago");
    expect(reportedPhrase(undefined, now)).toBeNull();
    expect(reportedPhrase("soon", now)).toBeNull();
  });
});

describe("showcase preview: small", () => {
  it("is the name and state glyph, the cut-out, then the first reading with its label", () => {
    const el = canvas(FULL, "small");
    expect([...el.children].map((c) => c.className.split(" ")[0])).toEqual([
      "pv-showcase-head",
      "pv-showcase-zone",
      "pv-showcase-lead",
    ]);
    expect(text($(el, ".pv-showcase-name"))).toBe("Car");
    expect(css($(el, ".pv-showcase-glyph"))).toContain(`color:${COLOR_HEX.green}`);
    const img = $(el, ".pv-showcase-cutout img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(CAR);
    expect(el.querySelector(".pv-showcase-shadow")).not.toBeNull();
    const hero = $(el, ".pv-showcase-hero");
    expect(text(hero)).toBe("78%");
    expect(css(hero)).toContain("font-size:28px");
    expect(text($(el, ".pv-showcase-caption"))).toBe("Battery");
  });

  it("sets a word reading as a title with its label under it", () => {
    const words = canvas(
      { ...FULL, stats: [{ label: "Doors", value: { value: "Locked" } }] },
      "small",
    );
    const hero = $(words, ".pv-showcase-hero");
    expect(hero.className).toContain("is-word");
    expect(css(hero)).toContain("font-size:22px");
    expect($(words, ".pv-showcase-lead").className).toContain("is-stacked");
    expect(text($(words, ".pv-showcase-caption"))).toBe("Doors");
    // A number has its label beside it.
    expect($(canvas(FULL, "small"), ".pv-showcase-lead").className).not.toContain("is-stacked");
  });

  it("marks a state without a symbol by its word in the header", () => {
    const state = { text: { value: "Locked", text_color: "green" } } as never;
    const el = canvas({ ...FULL, state }, "small");
    const glyph = $(el, ".pv-showcase-head .pv-showcase-glyph");
    expect(text(glyph)).toBe("Locked");
    expect(css(glyph)).toContain(`color:${COLOR_HEX.green}`);
  });

  it("stands the icon in for a missing picture, else a placeholder", () => {
    const { image: _picture, ...noPicture } = FULL;
    const icon = canvas(noPicture, "small");
    expect($(icon, ".pv-showcase-cutout").className).toContain("is-icon");
    expect($(icon, ".pv-showcase-cutout").dataset["slot"]).toBe("picture");
    const bare = canvas({ stats: FULL.stats ?? [] }, "small");
    expect($(bare, '[data-ghost][data-slot="picture"]')).toBeTruthy();
    expect($(bare, '[data-ghost][data-slot="state"]')).toBeTruthy();
  });

  it("fills the widget with a photo, the text laid on it", () => {
    const el = canvas({ ...FULL, image: { url: CAR, fit: "cover" } }, "small");
    expect($(el, ".pv-showcase-photo").className).toContain("is-fill");
    const on = $(el, ".pv-showcase-onphoto");
    expect(text($(on, ".pv-showcase-name"))).toBe("Car");
    expect(css($(on, ".pv-showcase-hero"))).toContain("font-size:30px");
    // The state keeps its own color in the header; the label is beside the
    // reading.
    expect(css($(on, ".pv-showcase-head .pv-showcase-glyph"))).toContain(
      `color:${COLOR_HEX.green}`,
    );
    expect(text($(on, ".pv-showcase-caption"))).toBe("Battery");
    expect(el.querySelector(".pv-showcase-cutout")).toBeNull();
    const plain = canvas(
      {
        ...FULL,
        image: { url: CAR, fit: "cover" },
        state: { icon: "lock.fill", text: { value: "Locked" } } as never,
      },
      "small",
    );
    expect(css($(plain, ".pv-showcase-glyph"))).toContain("color:#fff");
  });
});

describe("showcase preview: medium", () => {
  it("is the header, the state, then the picture and three readings", () => {
    const el = canvas(FULL, "medium");
    expect([...el.children].map((c) => c.className.split(" ")[0])).toEqual([
      "pv-showcase-head",
      "pv-showcase-state",
      "pv-showcase-bottom",
    ]);
    expect(text($(el, ".pv-showcase-meta"))).toContain("12m ago");
    expect(($(el, ".pv-showcase-badge") as HTMLImageElement).getAttribute("src")).toContain(
      "badge.png",
    );
    expect(text($(el, ".pv-showcase-state"))).toContain("Locked");
    const rows = $$(el, ".pv-showcase-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => text($(r, ".pv-showcase-label")))).toEqual([
      "Battery",
      "Range",
      "Odometer",
    ]);
    expect(rows.map((r) => text($(r, ".pv-showcase-value")))).toEqual([
      "78%",
      "312 km",
      "24 180 km",
    ]);
  });

  it("bleeds a photo across the leading side, the report time kept and the badge left off", () => {
    const el = canvas({ ...FULL, image: { url: CAR, fit: "cover" } }, "medium");
    expect($(el, ".pv-showcase-photo").className).toContain("is-side");
    expect(el.querySelector(".pv-showcase-badge")).toBeNull();
    expect(text($(el, ".pv-showcase-beside .pv-showcase-meta"))).toContain("12m ago");
    expect($$(el, ".pv-showcase-beside .pv-showcase-row")).toHaveLength(3);
  });

  it("colors a reading with its own color", () => {
    const el = canvas(
      { stats: [{ label: "Charge", value: { value: "12", text_color: "red" }, unit: "%" }] },
      "medium",
    );
    expect(css($(el, ".pv-showcase-value"))).toContain(`color:${COLOR_HEX.red}`);
  });
});

describe("showcase: regions and form", () => {
  it("leads every region to the fields that paint it", () => {
    const el = canvas(FULL, "medium");
    const slots = new Set(slotsFor("widget", "showcase").map((s) => s.id));
    for (const region of $$(el, "[data-slot]")) expect(slots).toContain(region.dataset["slot"]);
    expect(slotsFor("widget", "showcase").find((s) => s.id === "header")?.fields).toContain(
      "reported_at",
    );
  });

  it("keeps the state's icon with the state, not under Appearance", () => {
    const keys = (META.templates["showcase"]?.fields ?? []).map((f) => f.key);
    const kinds = new Map(
      (META.templates["showcase"]?.fields ?? []).map((f) => [f.key, f.kind ?? ""]),
    );
    const look = (key: string): boolean =>
      ["icon", "color", "colors"].includes(kinds.get(key) ?? "") &&
      !(showcase.content ?? []).includes(key);
    const sections = sectionsFor("widget", "showcase", keys, look);
    const content = sections.find((s) => s.id === "content")?.keys ?? [];
    expect(content).toEqual(expect.arrayContaining(["image", "state", "state_icon", "stats"]));
    expect(sections.find((s) => s.id === "look")?.keys).toEqual(
      expect.arrayContaining(["icon", "accent"]),
    );
    expect(sections.find((s) => s.id === "behavior")?.keys).toEqual(["tap_url"]);
  });
});

describe("showcase: what holds Save", () => {
  const image = META.templates["showcase"]?.fields.find((f) => f.key === "image") as FieldMeta;

  it("checks a picture's URL as a picture's", () => {
    expect(image.picture).toBe(true);
    expect(fieldUrlProblem(image, "")).toBeNull();
    expect(fieldUrlProblem(image, CAR)).toBeNull();
    expect(fieldUrlProblem(image, "http://example.com/car.png")).toBe("switchboard.image-https");
    expect(fieldUrlProblem(image, "https://example.com/a car.png")).toBe("switchboard.image-space");
    // Longer than a tap URL may be, which a picture's may.
    expect(fieldUrlProblem(image, `https://example.com/${"a".repeat(400)}`)).toBeNull();
    expect(fieldUrlProblem({ key: "tap_url" }, `https://example.com/${"a".repeat(400)}`)).toBe(
      "field.url-long",
    );
  });

  it("takes a gauge ceiling above 0, and knows a number from a word", () => {
    expect(maxProblem(undefined)).toBeNull();
    expect(maxProblem("100")).toBeNull();
    expect(maxProblem("0.5")).toBeNull();
    for (const bad of ["0", "-5", "abc", "Infinity"])
      expect(maxProblem(bad)).toBe("checklist.max-invalid");
    expect(plainNumber("78")).toBe(true);
    expect(plainNumber("-3.5")).toBe(true);
    expect(plainNumber("1e3")).toBe(false);
    expect(plainNumber("Charging")).toBe(false);
  });

  async function newShowcase(): Promise<{ panel: AiviPanel; editor: AiviEditor }> {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    panel.openEditor(
      acc,
      { slug: "car", name: "Car", template: "showcase", supported: true },
      null,
    );
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "the editor");
    return { panel, editor: $(sr(panel), "aivi-editor") as AiviEditor };
  }

  it("a reading's unit and gauge ceiling, and a bad ceiling holds Save", async () => {
    const { panel, editor } = await newShowcase();
    const checks = $(editor, '.field[data-key="stats"] aivi-rows-checklist');
    ($(checks, "aivi-entity-combobox.rowadd") as AiviEntityCombobox).onSelect(
      "sensor.my_car_charge",
    );
    await tick();
    $(checks, ".rowtoggle").click();
    await tick();
    await previewSettled(editor);
    const unit = $(checks, 'input[aria-label="Unit for Car charge"]') as HTMLInputElement;
    expect(unit.placeholder).toBe("%");
    const max = (): HTMLInputElement =>
      $(checks, 'input[aria-label="Gauge maximum for Car charge"]') as HTMLInputElement;
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    setInput(max(), "abc");
    await tick();
    expect(max().getAttribute("aria-invalid")).toBe("true");
    expect(text($(checks, '.rowopts .tnote.error[role="alert"]'))).toBe(
      "Use a number above 0, like 100.",
    );
    expect(save.disabled).toBe(true);
    setInput(max(), "100");
    await tick();
    expect(max().getAttribute("aria-invalid")).toBe("false");
    expect(
      (editor.editorState.bindings["stats__options"] as Record<string, Record<string, string>>)[
        "sensor.my_car_charge"
      ]?.["max"],
    ).toBe("100");
  });

  it("a reading that is a word gets a note under its ceiling, not a block", async () => {
    const { editor } = await newShowcase();
    const checks = $(editor, '.field[data-key="stats"] aivi-rows-checklist');
    ($(checks, "aivi-entity-combobox.rowadd") as AiviEntityCombobox).onSelect(
      "sensor.my_car_doors",
    );
    await tick();
    $(checks, ".rowtoggle").click();
    await tick();
    await previewSettled(editor);
    setInput($(checks, 'input[aria-label="Gauge maximum for Car doors"]'), "100");
    await tick();
    expect(text($(checks, '.rowopts .tnote.warn[role="status"]'))).toContain("Reads Locked now");
  });

  it("the picture's style is always one of the two, a cut-out stored as nothing", async () => {
    const { editor } = await newShowcase();
    const select = $(editor, '.field[data-key="image_fit"] select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Cut-out", "Photo"]);
    expect(select.value).toBe("contain");
    setSelect(select, "cover");
    await tick();
    expect(editor.editorState.bindings["image_fit"]).toBe("cover");
    setSelect(select, "contain");
    await tick();
    expect(editor.editorState.bindings).not.toHaveProperty("image_fit");
  });

  it("a picture's URL that is not https holds Save", async () => {
    const { panel, editor } = await newShowcase();
    const row = $(editor, '.field[data-key="image"]');
    const input = $(row, "input[type=text]") as HTMLInputElement;
    setInput(input, "http://example.com/car.png");
    await tick();
    expect(text($(row, ".tnote.error"))).toBe("The URL must start with https://.");
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
  });
});
