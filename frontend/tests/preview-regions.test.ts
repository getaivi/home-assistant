// The preview as a control: its regions are buttons, and pressing one
// goes to the fields that paint it. Nothing is filtered.

import { afterEach, describe, expect, it } from "vitest";
import {
  $,
  $$,
  key,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  previewSettled,
  rule,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe("the preview's regions", () => {
  it("are buttons a keyboard can reach, named for what they lead to", async () => {
    // The hint reads "Press any part of the preview", so each part can
    // take focus.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const regions = $$(sr(panel), ".pv-stage [data-slot]");
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.getAttribute("role")).toBe("button");
      expect(region.getAttribute("tabindex")).toBe("0");
    }
    expect($(sr(panel), '.pv-stage [data-slot="hero"]').getAttribute("aria-label")).toBe(
      "State: go to its settings",
    );
    // The focus ring is an outline on the region, like the selection's.
    expect(rule("preview", ".pv-stage [data-slot]:focus-visible")).toContain("outline: 2px solid");
  });

  it("Enter and Space press a region and take focus to its field", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const hero = $(root, '.pv-stage [data-slot="hero"]');
    const row = $(root, '.field[data-key="state"]');
    expect(key(hero, "Enter")).toBe(false); // handled
    await frame();
    expect(row.classList.contains("flash")).toBe(true);
    expect(row.contains(root.activeElement)).toBe(true);
    ($(root, ".backbtn") as HTMLElement).focus();
    expect(key(hero, " ")).toBe(false); // and Space does not scroll the page
    await frame();
    expect(row.contains(root.activeElement)).toBe(true);
    // Any other key is left to the page.
    expect(key(hero, "a")).toBe(true);
  });

  it("a pointer press leaves focus where it was", async () => {
    // Only the keyboard path moves focus (a focused picker opens its
    // list; a mouse user did not ask for that).
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const back = $(root, ".backbtn");
    back.focus();
    $(root, '.pv-stage [data-slot="hero"]').click();
    await frame();
    expect(root.activeElement).toBe(back);
  });

  it("on a phone, a press closes the preview sheet before going to the field", async () => {
    // The sheet closes first, so the field is not scrolled to behind it.
    const panel = await mountPanel();
    panel.narrow = true;
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    $(root, ".pvtoggle").click();
    await tick();
    expect($(root, ".side").classList.contains("open")).toBe(true);
    const row = $(root, '.field[data-key="state"]');
    let sheetOpenAtScroll: boolean | null = null;
    row.scrollIntoView = (): void => {
      sheetOpenAtScroll = $(root, ".side").classList.contains("open");
    };
    $(root, '.pv-stage [data-slot="hero"]').click();
    await frame();
    await tick();
    expect(sheetOpenAtScroll).toBe(false);
    expect($(root, ".pvtoggle").getAttribute("aria-expanded")).toBe("false");
    // The pressed region closed with the sheet: focus moves to its toggle.
    expect(root.activeElement).toBe($(root, ".pvtoggle"));
  });
});

describe("pressing a region", () => {
  it("flashes every field that paints it, without hiding anything", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);
    const before = $$(root, "aivi-field-row").length;

    $(root, '.pv-stage [data-slot="bar"]').click();
    await until(() => !!root.querySelector("aivi-field-row.flash"), "a flashed row");
    const flashed = $$(root, "aivi-field-row.flash").map((r) => r.dataset["key"]);
    expect(flashed).toContain("progress");
    expect(flashed).toContain("segments");
    // The form is untouched: no field is filtered out.
    expect($$(root, "aivi-field-row").length).toBe(before);
    expect($(root, '.pv-stage [data-slot="bar"]').hasAttribute("data-slot-on")).toBe(true);
  });

  it("clears the flash marker instead of leaving rows marked", async () => {
    // Under prefers-reduced-motion the flash is a static bar with no
    // animation to end, so it has to be cleared on a timer or every row
    // ever pressed stays marked for the rest of the session.
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);
    $(root, '.pv-stage [data-slot="bar"]').click();
    await until(() => !!root.querySelector("aivi-field-row.flash"), "a flash");
    await until(() => !root.querySelector("aivi-field-row.flash"), "the flash to clear");
  });

  it("reaches a field through a placeholder for something unset", async () => {
    // compact_value paints nothing until it is bound. Its ghost is the
    // only way the canvas can offer it at all.
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);
    delete editor.editorState.bindings["compact_value"];
    editor.schedulePreview(0);
    await until(
      () => !!root.querySelector('[data-ghost][data-slot="island-value"]'),
      "the island-value placeholder",
    );

    $(root, '[data-ghost][data-slot="island-value"]').click();
    await until(() => !!root.querySelector("aivi-field-row.flash"), "a flashed row");
    expect($$(root, "aivi-field-row.flash").map((r) => r.dataset["key"])).toEqual([
      "compact_value",
    ]);
  });

  it("highlights every region the focused field paints", async () => {
    // Activity `progress` feeds the island ring and the banner bar. Both
    // are highlighted, because the device shows both.
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);

    $(root, "aivi-field-row[data-key='progress'] input").focus();
    await tick();
    const on = (id: string): boolean =>
      $(root, `.pv-stage [data-slot="${id}"]`).hasAttribute("data-slot-on");
    expect(on("island-ring")).toBe(true);
    expect(on("bar")).toBe(true);
    expect(on("header-left")).toBe(false);
  });

  it("says when a field also paints on the other surface", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);
    const row = $(root, "aivi-field-row[data-key='progress']");
    expect(text($(row, ".flab .ftag"))).toBe("Also shows in the Dynamic Island");
    // A field that paints on one surface only shows no tag.
    expect(root.querySelector("aivi-field-row[data-key='header_left'] .ftag")).toBeNull();
  });
});
