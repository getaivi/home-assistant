// The progress template's bar section: the bar-style radiogroup, mode sets
// per surface, non-destructive switching with save-time pruning, seeding,
// the layered render, and the visual segments editor itself.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  $,
  $$,
  capsuleNames,
  css,
  inlineButton,
  key,
  modeSwitch,
  mountPanel,
  openActivityEditor,
  openColor,
  openSeeded,
  openWidgetEditor,
  pickMode,
  rerender,
  segs,
  setInput,
  setSelect,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("aivi-segments-editor", () => {
  it("starts Solid (mode-first) and entering Segmented seeds 50/50 from the fill color", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const seged = $(sr(panel), "aivi-segments-editor");
    // No segments stored -> the section derives Solid.
    expect($$(modeSwitch(seged), "button").map((b) => b.textContent)).toEqual([
      "Solid",
      "Segmented",
    ]);
    expect($$(modeSwitch(seged), "button")[0]!.getAttribute("aria-checked")).toBe("true");
    expect(seged.querySelector(".segbar")).toBeNull();
    expect(seged.querySelector("aivi-color-field")).not.toBeNull();
    expect(text($(seged, ".fhint"))).toBe("One fill color across the whole bar");
    // Entering Segmented seeds from the current fill color and announces
    // the style change through the polite live region.
    editor.editorState.bindings["bar_color"] = "cyan";
    await pickMode(seged, "Segmented");
    expect(segs(editor)).toEqual([
      { value: 0.5, fill_color: "cyan" },
      { value: 0.5, fill_color: "blue" },
    ]);
    expect(text($(seged, ".sr-only"))).toBe("Bar style: Segmented");
    expect(text($(seged, ".fhint"))).toBe(
      "Each phase is its own capsule, filled in order as the value rises",
    );
    // The bar renders both capsules with the shared preview style logic,
    // and the first (seeded selection) opens the inline editor.
    const caps = $$(seged, ".segcap");
    expect(caps).toHaveLength(2);
    expect(css(caps[0]!)).toContain("flex:0.5");
    // Each phase is painted in its own color from end to end: the live
    // preview shows how far the bar has got, the editor does not.
    expect(css($(caps[0]!, "i"))).toContain("width:100%");
    expect(css($(caps[0]!, "i"))).toContain("background:#3cd3fe");
    expect(caps[0]!.querySelectorAll("i")).toHaveLength(1);
    expect(caps[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(seged.querySelector(".seginline")).not.toBeNull();
  });

  it("edits color, size, and track styling for one segment at a time", async () => {
    const { editor, seged } = await openSeeded();
    const inline = $(seged, ".seginline");
    // Color via the swatch component (not a select).
    const teal = $$(await openColor(inline), ".swatches .sw").find(
      (b) => b.getAttribute("aria-label") === "Teal",
    );
    teal!.click();
    setInput($(inline, "input.pct"), "60");
    const selects = $$(inline, "select");
    // Track color options carry display names over raw wire values.
    const gray2 = [...selects[0]!.querySelectorAll("option")].find(
      (o) => o.getAttribute("value") === "gray2",
    );
    expect(gray2?.textContent).toBe("Gray 2");
    setSelect(selects[0]!, "gray2");
    setSelect(selects[1]!, "hatched");
    expect(segs(editor)[0]).toEqual({
      value: 0.6,
      fill_color: "teal",
      track_color: "gray2",
      track_fill: "hatched",
    });
    // Size comes out of the right neighbor; the sum stays 1.
    expect(segs(editor)[1]).toEqual({ value: 0.4, fill_color: "green" });
    // Clearing the optional keys removes them again.
    setSelect(selects[0]!, "");
    setSelect(selects[1]!, "solid");
    expect(segs(editor)[0]).toEqual({ value: 0.6, fill_color: "teal" });
  });

  it("offers the Label input on activity surfaces only", async () => {
    // Widgets never render segment labels on-device, so only activity
    // editors offer the input.
    const { seged } = await openSeeded();
    expect(seged.querySelector(".seginline input.lbl")).toBeNull();
    document.body.innerHTML = "";

    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    const aseged = $(sr(panel), "aivi-segments-editor");
    await pickMode(aseged, "Segmented");
    const lbl = $(aseged, ".seginline input.lbl");
    setInput(lbl, "Wash");
    expect(segs(editor)[0]!.label).toBe("Wash");
    setInput($(aseged, ".seginline input.lbl"), "");
    expect(segs(editor)[0]!.label).toBeUndefined();
  });

  it("drags thresholds by keyboard: arrows nudge 1%, Shift 5%, Home/End clamp", async () => {
    const { editor, seged } = await openSeeded();
    const handle = $(seged, ".seghandle");
    expect(handle.getAttribute("role")).toBe("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    key(handle, "ArrowRight");
    expect(segs(editor).map((s) => s.value)).toEqual([0.51, 0.49]);
    key(handle, "ArrowLeft", { shiftKey: true });
    expect(segs(editor).map((s) => s.value)).toEqual([0.46, 0.54]);
    // The move is spoken through the polite live region.
    await tick();
    expect(text($(seged, ".sr-only"))).toBe("Phase 1 46%, Phase 2 54%");
    key(handle, "Home");
    expect(segs(editor).map((s) => s.value)).toEqual([0.01, 0.99]);
    key(handle, "End");
    expect(segs(editor).map((s) => s.value)).toEqual([0.99, 0.01]);
    await tick();
    expect($(seged, ".seghandle").getAttribute("aria-valuenow")).toBe("99");
  });

  it("keyboard on the earlier boundaries of a 3-segment bar moves the right pair", async () => {
    // Nudging boundary 0 changes weights 0/1 (never 2), boundary 1
    // changes weights 1/2 (never 0).
    const { editor, seged } = await openSeeded();
    $(seged, ".segadd").click(); // 3 segments -> 2 handles
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.25, 0.25]);
    key($$(seged, ".seghandle")[0]!, "ArrowRight", { shiftKey: true });
    expect(segs(editor).map((s) => s.value)).toEqual([0.55, 0.2, 0.25]);
    await tick();
    key($$(seged, ".seghandle")[1]!, "ArrowRight", { shiftKey: true });
    expect(segs(editor).map((s) => s.value)).toEqual([0.55, 0.25, 0.2]);
  });

  it("roves one tab stop across handles with the vertical arrows", async () => {
    const { seged } = await openSeeded();
    $(seged, ".segadd").click(); // 3 segments -> 2 handles
    await tick();
    const handles = $$(seged, ".seghandle");
    expect(handles.map((h) => h.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    key(handles[0]!, "ArrowDown");
    await tick();
    expect($$(seged, ".seghandle").map((h) => h.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });

  it("adds by splitting, respects the cap of four, and removes with absorption", async () => {
    const { editor, seged } = await openSeeded();
    $(seged, ".segadd").click(); // splits the last 50 -> 25/25
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.25, 0.25]);
    // The new phase took a palette color nothing else uses.
    expect(new Set(segs(editor).map((s) => s.fill_color)).size).toBe(3);
    $(seged, ".segadd").click();
    await tick();
    expect(segs(editor)).toHaveLength(4);
    // At the cap the add affordance and the inline Split are gone.
    expect(seged.querySelector(".segadd")).toBeNull();
    expect($$(seged, ".seginline button").some((b) => b.textContent === "Split")).toBe(false);
    // The split selected the new phase, so its inline editor is open; the
    // left neighbor absorbs the removed space.
    expect($$(seged, ".segcap")[3]!.getAttribute("aria-pressed")).toBe("true");
    const remove = $$(seged, ".seginline button").find((b) => b.textContent === "Remove");
    remove!.click();
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.25, 0.25]);
    expect(text($(seged, ".sr-only"))).toContain("absorbed its space");
  });

  it("returns to Solid once the last phase goes", async () => {
    const { editor, seged } = await openSeeded();
    // Even a stale stored display marker goes with the phases.
    editor.editorState.bindings["segments__display"] = "layered";
    for (let i = 0; i < 2; i++) {
      // (Re)open the first capsule's inline editor unless already open:
      // clicking a selected capsule toggles the selection off.
      const cap = $$(seged, ".segcap")[0]!;
      if (cap.getAttribute("aria-pressed") !== "true") {
        cap.click();
        await tick();
      }
      $$(seged, ".seginline button")
        .find((b) => b.textContent === "Remove")!
        .click();
      await tick();
    }
    expect(editor.editorState.bindings["segments"]).toBeUndefined();
    expect(editor.editorState.bindings["segments__display"]).toBeUndefined();
    // No phases means Solid again.
    expect(editor.barMode()).toBe("solid");
    expect($$(modeSwitch(seged), "button")[0]!.getAttribute("aria-checked")).toBe("true");
    expect(seged.querySelector(".segbar")).toBeNull();
    expect(seged.querySelector("aivi-color-field")).not.toBeNull();
  });

  it("offers Solid|Segmented on widgets, Solid|Segmented|Layered on activities", async () => {
    const { seged } = await openSeeded();
    // Widgets always render split on-device, so Layered never shows.
    expect($$(modeSwitch(seged), "button").map((b) => b.textContent)).toEqual([
      "Solid",
      "Segmented",
    ]);
    document.body.innerHTML = "";
    const panel = await mountPanel();
    await openActivityEditor(panel, "washer");
    const aseged = $(sr(panel), "aivi-segments-editor");
    expect($$(modeSwitch(aseged), "button").map((b) => b.textContent)).toEqual([
      "Solid",
      "Segmented",
      "Layered",
    ]);
  });

  it("derives the mode from the stored shape", async () => {
    // Stored segments (even alongside a dormant bar_color: the segments
    // win, mirroring the wire where SegmentList's style override lands
    // after bar_color) render the Segmented body straight away.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const seged = $(sr(panel), "aivi-segments-editor");
    editor.editorState.bindings["bar_color"] = "cyan";
    editor.editorState.bindings["segments"] = [
      { value: 0.7, fill_color: "teal" },
      { value: 0.3, fill_color: "gray" },
    ];
    rerender(seged);
    await tick();
    expect(editor.barMode()).toBe("segmented");
    expect(seged.querySelector(".segbar")).not.toBeNull();
    expect($$(modeSwitch(seged), "button")[1]!.getAttribute("aria-checked")).toBe("true");
    // A stray layered marker on a widget surface still reads Segmented
    // (widgets have no Layered mode), and the split look renders.
    editor.editorState.bindings["segments__display"] = "layered";
    expect(editor.barMode()).toBe("segmented");
    // The saved payload drops both the dormant bar_color and the marker.
    const pruned = editor.prunedBindings();
    expect(pruned["bar_color"]).toBeUndefined();
    expect(pruned["segments__display"]).toBeUndefined();
    expect(pruned["segments"]).toEqual(editor.editorState.bindings["segments"]);
  });

  it("switches modes non-destructively in-session; save prunes to the active mode", async () => {
    const { editor, seged } = await openSeeded();
    // A stored label (the widget editor itself offers no Label input)
    // survives the detour too.
    segs(editor)[0]!.label = "Wash";
    editor.editorState.bindings["bar_color"] = "cyan";
    // Active Segmented: the save payload carries the phases, never the
    // dormant fill color.
    let pruned = editor.prunedBindings();
    expect(pruned["segments"]).toHaveLength(2);
    expect(pruned["bar_color"]).toBeUndefined();
    // A detour through Solid: the phases stay in the session bindings
    // (nothing destroyed), but the payload is the solid bar's.
    await pickMode(seged, "Solid");
    expect(seged.querySelector(".segbar")).toBeNull();
    expect(segs(editor)).toHaveLength(2);
    pruned = editor.prunedBindings();
    expect(pruned["segments"]).toBeUndefined();
    expect(pruned["bar_color"]).toBe("cyan");
    // And back: the phases, label included, survived the detour.
    await pickMode(seged, "Segmented");
    expect(seged.querySelector(".segbar")).not.toBeNull();
    expect(segs(editor)[0]!.label).toBe("Wash");
  });

  it("previews the active mode's outcome, mid-session switches included", async () => {
    const { editor, seged } = await openSeeded();
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.editorState.bindings["bar_color"] = "cyan";
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.preview?.progress?.style === "segmented",
      "segmented preview",
    );
    await pickMode(seged, "Solid");
    editor.schedulePreview(0);
    await until(() => editor.editorState.preview?.progress?.style === "simple", "solid preview");
    // The unsaved phases never leak into the solid payload.
    expect(editor.editorState.preview?.progress?.segments).toBeUndefined();
    expect(editor.editorState.preview?.progress?.color).toBe("cyan");
  });

  it("renders the layered look with labels in an activity editor", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    const seged = $(sr(panel), "aivi-segments-editor");
    // Choosing Layered with nothing stored seeds too, then the phases
    // are shaped for the assertion.
    await pickMode(seged, "Layered");
    expect(text($(seged, ".fhint"))).toBe("One continuous bar, the Live Activity look");
    editor.editorState.bindings["segments"] = [
      { value: 0.6, fill_color: "cyan", label: "Wash" },
      { value: 0.4, fill_color: "blue" },
    ];
    rerender(seged);
    await tick();
    // Layered: no gaps, outer-corner radii only.
    expect(css($(seged, ".segbar"))).toContain("gap:0px");
    const caps = $$(seged, ".segcap");
    expect(css(caps[0]!)).toContain("border-radius:14px0014px");
    expect(css(caps[1]!)).toContain("border-radius:014px14px0");
    // Labels sit below the bar as on device: the labeled segment's caption
    // in its own-width column, the unlabeled one an empty column.
    expect(text(caps[0]!)).toBe("");
    const row = $(seged, ".segcol").lastElementChild as HTMLElement;
    expect(css(row)).toContain("gap:0px");
    expect(text(row)).toBe("Wash");
    expect(row.children).toHaveLength(2);
    // The save payload carries the layered display marker (the marker is
    // the mode).
    expect(editor.prunedBindings()["segments__display"]).toBe("layered");
    await pickMode(seged, "Segmented");
    expect(css($(seged, ".segbar"))).toContain("gap:6px");
    // Split labels on an activity editor bar too: 2px label columns, the
    // device's own quirk (independent of the 6px capsule gap).
    expect(css($(seged, ".segcol").lastElementChild as HTMLElement)).toContain("gap:2px");
    expect(editor.prunedBindings()["segments__display"]).toBeUndefined();
  });
});

describe("the Size field", () => {
  const field = (seged: HTMLElement): HTMLInputElement =>
    $(seged, ".seginline input.pct") as HTMLInputElement;

  const commit = (el: HTMLElement): void => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("shows what was applied once committed, and says it was clamped", async () => {
    // A typed size that stores less reads as the stored size once committed.
    const { editor, seged } = await openSeeded();
    setInput(field(seged), "99.5");
    expect(segs(editor).map((s) => s.value)).toEqual([0.99, 0.01]);
    // While the user is typing, the field keeps what was typed.
    expect(field(seged).value).toBe("99.5");
    commit(field(seged));
    await tick();
    expect(field(seged).value).toBe("99");
    expect(text($(seged, ".sr-only"))).toBe("Phase 1 set to 99%");
  });

  it("goes back to the applied size when emptied or given text", async () => {
    const { editor, seged } = await openSeeded();
    for (const typed of ["", "abc"]) {
      setInput(field(seged), typed);
      commit(field(seged));
      await tick();
      expect(field(seged).value).toBe("50");
      expect(text($(seged, ".sr-only"))).toBe("Phase 1 set to 50%");
    }
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
  });

  it("clamps zero and negatives to the minimum on commit", async () => {
    const { editor, seged } = await openSeeded();
    setInput(field(seged), "0");
    // Mid-typing ("0" on the way to "0.5") nothing is applied yet.
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    commit(field(seged));
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.01, 0.99]);
    expect(field(seged).value).toBe("1");
  });

  it("accepts a decimal comma and leaves a size that applied as typed alone", async () => {
    // "12,5" stores 12.5%, not 12%.
    const { editor, seged } = await openSeeded();
    setInput(field(seged), "12,5");
    commit(field(seged));
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.125, 0.875]);
    expect(field(seged).value).toBe("12,5");
    expect(text($(seged, ".sr-only"))).not.toContain("set to");
  });
});

describe("small things", () => {
  it("says why Split does nothing on a phase too thin to halve", async () => {
    const { editor, seged } = await openSeeded();
    key($(seged, ".seghandle"), "Home"); // phase 1 down to 1%
    await tick();
    const split = inlineButton(seged, "Split");
    expect(split.getAttribute("aria-disabled")).toBe("true");
    expect(split.getAttribute("title")).toBe("Phase 1 is too small to split");
    split.click();
    await tick();
    expect(segs(editor)).toHaveLength(2);
    expect(text($(seged, ".sr-only"))).toBe("Phase 1 is too small to split");
    // A phase with room to halve carries neither.
    $$(seged, ".segcap")[1]!.click();
    await tick();
    expect(inlineButton(seged, "Split").hasAttribute("aria-disabled")).toBe(false);
  });

  it("names the phases with percentages that sum to 100", async () => {
    // Three equal phases read 33 / 33 / 34, not 33 / 33 / 33.
    const { editor, seged } = await openSeeded();
    editor.editorState.bindings["segments"] = [
      { value: 1, fill_color: "cyan" },
      { value: 1, fill_color: "teal" },
      { value: 1, fill_color: "gray" },
    ];
    rerender(seged);
    await tick();
    expect(capsuleNames(seged)).toEqual([
      "Phase 1: 33% of the bar",
      "Phase 2: 33% of the bar",
      "Phase 3: 34% of the bar",
    ]);
  });

  it("keeps Split and Remove 44px tall on a touch device", () => {
    // `.seginline .segrow .rm { min-height: 32px }` would out-specify the
    // coarse-pointer rule, so the inline editor's own selector is in it.
    const coarse = readFileSync("frontend/src/styles/responsive.ts", "utf8").split(
      "@media (pointer: coarse)",
    )[1]!;
    const rule = /([^{};]*\.seginline \.segrow \.rm[^{]*)\{([^}]*)\}/.exec(coarse);
    expect(rule?.[2]).toContain("min-height: 44px");
  });

  it("seeds untouched phases again from a fill color picked later", async () => {
    // The phases do not keep the color of the first visit to Segmented.
    const { editor, seged } = await openSeeded();
    expect(segs(editor)[0]!.fill_color).toBe("blue");
    await pickMode(seged, "Solid");
    editor.editorState.bindings["bar_color"] = "cyan";
    await pickMode(seged, "Segmented");
    expect(segs(editor)).toEqual([
      { value: 0.5, fill_color: "cyan" },
      { value: 0.5, fill_color: "blue" },
    ]);
  });

  it("never re-seeds phases the user has edited", async () => {
    const { editor, seged } = await openSeeded();
    key($(seged, ".seghandle"), "ArrowRight");
    await pickMode(seged, "Solid");
    editor.editorState.bindings["bar_color"] = "cyan";
    await pickMode(seged, "Segmented");
    expect(segs(editor)).toEqual([
      { value: 0.51, fill_color: "blue" },
      { value: 0.49, fill_color: "green" },
    ]);
  });
});
