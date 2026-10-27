// The budget, trend, prices and energy templates in the panel: their
// previews, their editors (a new binding's starting state, the history
// and sign controls, the per-row budget, charging and today options), and
// the delivery settings every binding gets (stale_after, the throttle).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import { COLOR_HEX, fieldHint } from "../src/const";
import { isBound, missingOneOf } from "../src/editor-validation";
import { budgetLine } from "../src/preview/budget";
import { energyHeadline, formatPower } from "../src/preview/energy";
import { currentPriceIndex, priceLevel } from "../src/preview/prices";
import { normalizedPoints } from "../src/preview/trend";
import { previewWidget } from "../src/preview-render";
import type { WidgetContent } from "../src/types/content";
import type { FieldMeta } from "../src/types/meta";
import { durationLabel } from "../src/util";
import {
  $,
  $$,
  css,
  META,
  makeHass,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  previewSettled,
  rerender,
  resolvedSample,
  setInput,
  setSelect,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** Opens a new (unbound) widget of a template this harness lists with
 * ?more=1, as if its card had been clicked. */
async function openNew(panel: AiviPanel, slug: string, template: string): Promise<AiviEditor> {
  const acc = panel.accounts[0];
  if (!acc) throw new Error("no mock account");
  panel.openEditor(acc, { slug, name: slug, template, supported: true }, null);
  await until(() => !!sr(panel).querySelector("aivi-editor .form"), `editor for ${slug}`);
  return $(sr(panel), "aivi-editor") as AiviEditor;
}

function field(editor: AiviEditor, key: string): HTMLElement {
  return $(editor, `.field[data-key="${key}"]`);
}

describe("previews", () => {
  it("budget: the remainder against the ring, the meta line, two legends", async () => {
    const node = previewWidget(
      "budget",
      "Spending",
      await resolvedSample("budget", "budget-categories"),
    );
    expect(text($(node, '[data-slot="total"]'))).toBe("$980.70");
    expect(text($(node, '[data-slot="meta"]'))).toBe("of $1,500 · Washing");
    const legends = $$(node, '[data-slot="categories"] > div');
    expect(legends.map(text)).toEqual(["Food$142", "Car$99"]);
  });

  it("budget: spent mode headlines spent, an overspent remainder is red", async () => {
    const spent = await resolvedSample("budget", "budget-sourced-total");
    expect(text($(previewWidget("budget", "B", spent), '[data-slot="total"]'))).toBe("€519.30");
    const over: WidgetContent = { total: { spent: "120", budget: "100" }, currency: "USD" };
    const hero = $(previewWidget("budget", "B", over), '[data-slot="total"] .pv-hero');
    expect(text(hero)).toBe("-$20.00");
    expect(css(hero)).toContain(`color:${COLOR_HEX.red}`);
    const bare = previewWidget("budget", "B", { total: { spent: "5" }, currency: "XXX!" });
    expect($$(bare, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["meta", "categories"]);
    expect(budgetLine({ spent: 50, budget: 200 }, "spent")).toEqual({
      amount: 50,
      fill: 0.25,
      red: false,
    });
    expect(budgetLine({ spent: 50 }, undefined).fill).toBeNull();
  });

  it("trend: the reading with its unit, the state, the sparkline", async () => {
    const node = previewWidget("trend", "Indoor", await resolvedSample("trend", "trend-history"));
    expect(text($(node, '[data-slot="hero"]'))).toBe("21.4°C");
    expect(text($(node, '[data-slot="caption"]'))).toBe("Washing");
    expect($(node, '[data-slot="chart"] svg').innerHTML).toContain(COLOR_HEX.orange);
    const empty = previewWidget("trend", "Indoor", {});
    expect($$(empty, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual([
      "hero",
      "caption",
      "chart",
    ]);
    expect(normalizedPoints({ points: [5, 5] })).toEqual([0.5, 0.5]);
    expect(normalizedPoints({ points: [0, 10], min_value: 0, max_value: 20 })).toEqual([0, 0.5]);
  });

  it("prices: the current price and its level over a window of bars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:30:00+01:00"));
    const content = await resolvedSample("prices", "prices-cents");
    const node = previewWidget("prices", "Electricity", content);
    expect(text($(node, '[data-slot="hero"]'))).toBe("15.1 ct/kWh");
    expect(text($(node, ".pv-state"))).toBe("Low");
    expect($$(node, '[data-slot="chart"] > div:first-child > i')).toHaveLength(12);
    const entries = content.entries ?? [];
    expect(currentPriceIndex(entries)).toBe(12);
    expect(currentPriceIndex(entries, Date.parse("2020-01-01"))).toBe(0);
    expect(priceLevel([{ price: 1, level: "high" }], 0)).toBe("high");
    expect(priceLevel([{ price: 1 }, { price: 1 }], 0)).toBe("medium");
    expect(priceLevel([{ price: 1 }, { price: 2 }, { price: 3 }], 2)).toBe("high");
    expect(priceLevel([{ price: 1 }, { price: 2 }, { price: 3 }], 1)).toBe("medium");
    const none = previewWidget("prices", "Electricity", {});
    expect($(none, "[data-ghost]").dataset["slot"]).toBe("hero");
  });

  it("energy: the home's power and today's energy, else the first node", async () => {
    const node = previewWidget(
      "energy",
      "Energy",
      await resolvedSample("energy", "energy-dashboard"),
    );
    expect(text($(node, '[data-slot="hero"]'))).toBe("1.2 kW");
    expect($(node, '[data-slot="caption"]').dataset["ghost"]).toBe("");
    const solar = previewWidget("energy", "Energy", {
      sources: [{ power: 640, today: 12.4 }],
    });
    expect(text($(solar, '[data-slot="hero"]'))).toBe("640 W");
    expect(text($(solar, '[data-slot="caption"]'))).toBe("Today 12.4 kWh");
    expect(energyHeadline({ grid: { power: -1 } })?.color).toBe(COLOR_HEX.green);
    expect(energyHeadline({ battery: { power: 1, color: "red" } })?.color).toBe(COLOR_HEX.red);
    expect(energyHeadline({})).toBeNull();
    expect(formatPower(-1400)).toBe("-1.4 kW");
    const none = previewWidget("energy", "Energy", {});
    expect($$(none, "[data-ghost]").map((g) => g.dataset["slot"])).toEqual(["hero", "caption"]);
  });
});

describe("editors", () => {
  it("a new binding starts from what Home Assistant knows", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "electricity", "prices");
    await until(() => editor.editorState.bindings["entries"] === "sensor.nordpool", "defaults");
    await previewSettled(editor);
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(false);
    // A bound one keeps what it has.
    const hass = makeHass();
    const call = vi.spyOn(hass, "callWS");
    const other = await mountPanel(hass);
    await openWidgetEditor(other, "frontdoor");
    await tick();
    expect(call.mock.calls.some(([m]) => (m as { type: string }).type === "aivi/defaults")).toBe(
      false,
    );
  });

  it("an energy widget needs one node to save", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "power", "energy");
    await until(() => !!editor.editorState.bindings["grid_power"], "defaults");
    const meter = editor.editorState.bindings["grid_power"]!;
    editor.editorState.bindings = {};
    editor.updateValidation();
    await tick();
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
    expect(text($(sr(panel), ".missing"))).toContain(
      "one of Generation, Grid power, Battery power, Home power",
    );
    // The sign flip adjusts a value: it appears only once a meter is set,
    // and the field's hint is marked settled once the field is set.
    expect(field(editor, "grid_power").querySelector("label.chk")).toBeNull();
    expect(field(editor, "grid_power").querySelector(".fhint.settled")).toBeNull();
    editor.editorState.bindings = { grid_power: meter };
    editor.updateValidation();
    editor.requestUpdate();
    await tick();
    const grid = field(editor, "grid_power");
    expect(grid.querySelector(".fhint.settled")).not.toBeNull();
    // The hint stays available as the label's title.
    expect($(grid, ".flabel").getAttribute("title")).toContain("drawing from the grid");
    const box = $(grid, "label.chk input") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.editorState.bindings["grid_power__invert"]).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.editorState.bindings["grid_power__invert"]).toBeUndefined();
  });

  it("a trend's points: the time span, another entity, a list, a template", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "indoor", "trend");
    const points = field(editor, "points");
    expect(text($(points, ".tnote"))).toContain("Feed Value from an entity");
    const span = (): HTMLElement => $(field(editor, "points"), 'select[aria-label="Time span"]');
    setSelect(span(), "6");
    expect(editor.editorState.bindings["points__hours"]).toBe(6);
    setSelect(span(), "24");
    expect(editor.editorState.bindings["points__hours"]).toBeUndefined();
    const options = $$(span(), "option").map(text);
    expect(options).toEqual([
      "1 hour",
      "3 hours",
      "6 hours",
      "12 hours",
      "1 day",
      "2 days",
      "7 days",
    ]);
    // Where the points come from is the field's source menu, like any
    // other field's.
    const source = (): HTMLElement => $(field(editor, "points"), ".fsrc > select.srcsel");
    expect($$(source(), "option").map(text)).toEqual(["History", "List", "Template"]);
    setSelect(source(), "list");
    await tick();
    expect(editor.editorState.bindings["points__attribute"]).toBe("");
    setSelect(source(), "template");
    await tick();
    expect(editor.editorState.bindings["points__template"]).toBe("");
    expect(editor.editorState.bindings["points__attribute"]).toBeUndefined();
    setSelect(source(), "history");
    await tick();
    expect(editor.editorState.bindings["points__template"]).toBeUndefined();
  });

  it("a trend's points menu brings back what each source held", async () => {
    // The same menu as a field's source, with the same guarantee: switching
    // away and back loses nothing, and what is not in use is not stored.
    const panel = await mountPanel();
    const editor = await openNew(panel, "indoor", "trend");
    const b = editor.editorState.bindings;
    const points = (): HTMLElement => field(editor, "points");
    const source = (): HTMLElement => $(points(), ".fsrc > select.srcsel");
    setSelect(source(), "list");
    await tick();
    ($(points(), "aivi-entity-combobox") as unknown as { onSelect(id: string): void }).onSelect(
      "climate.living_room",
    );
    await tick();
    setSelect($(points(), ".subrow select"), "temperature");
    await tick();
    setSelect(source(), "template");
    await tick();
    setInput($(points(), "textarea"), "{{ [1, 2, 3] }}");
    await tick();
    expect(b["points__entity"]).toBeUndefined();
    expect(b["points__attribute"]).toBeUndefined();
    setSelect(source(), "history");
    await tick();
    expect(Object.keys(b).filter((k) => k.startsWith("points__"))).toEqual([]);
    setSelect(source(), "list");
    await tick();
    expect(b["points__entity"]).toBe("climate.living_room");
    expect(b["points__attribute"]).toBe("temperature");
    setSelect(source(), "template");
    await tick();
    expect(b["points__template"]).toBe("{{ [1, 2, 3] }}");
    expect(($(points(), "textarea") as HTMLTextAreaElement).value).toBe("{{ [1, 2, 3] }}");
  });

  it("a row picker offers what fits the field, and not what another field already holds", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "spending", "budget");
    await until(() => editor.editorState.bindings["currency"] === "USD", "defaults");
    editor.editorState.bindings["spent"] = "sensor.monthly_spent";
    editor.applySuggestion();
    await tick();
    const checks = $(field(editor, "categories"), "aivi-rows-checklist");
    const offered = (
      $(checks, "aivi-entity-combobox.rowadd") as unknown as { options: { id: string }[] }
    ).options.map((o) => o.id);
    // Numeric sensors only, money first (by name); the Spent sensor is
    // left out, since the Spent field holds it.
    expect(offered[0]).toBe("sensor.food_spent");
    expect(offered).not.toContain("sensor.monthly_spent");
    expect(offered).not.toContain("sensor.next_bin");
    expect(offered).toContain("sensor.monthly_budget");
  });

  it("a budget's typed amount can come from an entity, and rows take a budget", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "spending", "budget");
    await until(() => editor.editorState.bindings["currency"] === "USD", "defaults");
    const budget = field(editor, "budget");
    setInput($(budget, 'input[inputmode="decimal"]'), "1500");
    expect(editor.editorState.bindings["budget"]).toBe(1500);
    editor.editorState.bindings["categories"] = ["sensor.food_spent"];
    editor.updateValidation();
    const checks = $(field(editor, "categories"), "aivi-rows-checklist");
    rerender(checks);
    await tick();
    $(checks, ".rowtoggle").click();
    await tick();
    setInput($(checks, 'input[aria-label="Budget for Food"]'), "300");
    expect(editor.editorState.bindings["categories__options"]).toEqual({
      "sensor.food_spent": { budget: "300" },
    });
    // Spent from an entity counts as bound.
    expect(isBound({ key: "spent" }, { spent__entity: "sensor.x" })).toBe(true);
  });

  it("battery rows: a charging sensor, or no bolt at all", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    editor.editorState.bindings["devices"] = ["sensor.phone_battery"];
    editor.updateValidation();
    const checks = $(field(editor, "devices"), "aivi-rows-checklist");
    rerender(checks);
    await tick();
    $(checks, ".rowtoggle").click();
    await tick();
    expect(text(checks)).toContain("Charging");
    const off = $(
      checks,
      'input[aria-label="No charging bolt for Phone battery"]',
    ) as HTMLInputElement;
    off.checked = true;
    off.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toEqual({
      "sensor.phone_battery": { charging: "off" },
    });
    off.checked = false;
    off.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toBeUndefined();
  });

  it("battery rows say when the charging sensor cannot be read", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    editor.editorState.bindings["devices"] = ["sensor.phone_battery"];
    editor.editorState.bindings["devices__options"] = {
      "sensor.phone_battery": { charging__entity: "binary_sensor.nope" },
    };
    const checks = $(field(editor, "devices"), "aivi-rows-checklist");
    rerender(checks);
    await tick();
    $(checks, ".rowtoggle").click();
    editor.schedulePreview(0);
    await until(
      () => !!editor.editorState.fieldFeedback?.["devices.sensor.phone_battery.charging"],
      "row feedback",
    );
    await tick();
    expect(text($(checks, ".tnote.warn"))).toBe(
      "Can't read this sensor right now, so no charging bolt is shown.",
    );
  });

  it("energy sources take today's energy per row", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "power", "energy");
    await until(() => !!editor.editorState.bindings["sources"], "defaults");
    const checks = $(field(editor, "sources"), "aivi-rows-checklist");
    $(checks, ".rowtoggle").click();
    await tick();
    expect(text(checks)).toContain("Today");
    expect(text(checks)).toContain("counted from midnight");
  });
});

describe("delivery", () => {
  it("a widget's stale_after is offered and saved", async () => {
    const hass = makeHass();
    const call = vi.spyOn(hass, "callWS");
    const panel = await mountPanel(hass);
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    // The last field of the behavior group, in view like every other.
    const select = $(editor, '.fsect[data-section="behavior"] .field.delivery select');
    expect(text($(editor, ".field.delivery .flabel"))).toBe("Show as outdated after");
    expect($$(select, "option").map(text).slice(0, 4)).toEqual([
      "As set in the Aivi app",
      "Never",
      "15 minutes",
      "30 minutes",
    ]);
    setSelect(select, "3600");
    expect(editor.editorState.staleAfter).toBe(3600);
    $(sr(panel), ".topbar .btn.primary").click();
    await until(
      () => call.mock.calls.some(([m]) => (m as { type: string }).type === "aivi/save"),
      "save",
    );
    const save = call.mock.calls.find(([m]) => (m as { type: string }).type === "aivi/save")![0];
    expect(save).toMatchObject({ stale_after: 3600 });
    await until(() => panel.editorState?.saving === false, "saved");
    $(sr(panel), ".backbtn").click();
    await until(() => panel.editorState === null, "editor closed");
    const reopened = await openWidgetEditor(panel, "frontdoor");
    expect(reopened.editorState.staleAfter).toBe(3600);
    expect(($(reopened, ".field.delivery option[selected]") as HTMLOptionElement).value).toBe(
      "3600",
    );
  });

  it("an activity's throttle defaults to a minute and can be lifted", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    const select = $(editor, ".field.delivery select");
    expect(($(select, "option[selected]") as HTMLOptionElement | null)?.textContent).toBe(
      "1 minute",
    );
    setSelect(select, "0");
    expect(editor.editorState.throttle).toBe(0);
    editor.editorState.throttle = 90;
    editor.requestUpdate();
    await tick();
    expect($$(editor, ".field.delivery option").map(text)).toContain("90 seconds");
  });
});

describe("helpers", () => {
  it("durations, scoped hints and the one-of rule", () => {
    expect(durationLabel(60)).toBe("1 minute");
    expect(durationLabel(7200)).toBe("2 hours");
    expect(durationLabel(604800)).toBe("7 days");
    expect(durationLabel(45)).toBe("45 seconds");
    expect(fieldHint("min_value", "trend")).toContain("chart");
    expect(fieldHint("min_value", "gauge")).toContain("dial");
    const energy = META.templates["energy"]!;
    expect(missingOneOf(energy, {}).map((f: FieldMeta) => f.key)).toEqual(energy.requires_any);
    expect(missingOneOf(energy, { home_power: "sensor.x" })).toEqual([]);
    expect(missingOneOf(META.templates["status"]!, {})).toEqual([]);
  });
});
