// Sourced phase sizes in the segments editor: the weight-source switch,
// what it stores, the inline feedback for a source that fails, and the bar
// working from what it just stored until the preview catches up.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { SegmentBinding } from "../src/types/bindings";
import {
  $,
  $$,
  capsuleNames,
  css,
  key,
  openSeeded,
  pressBar,
  rerender,
  segs,
  setInput,
  setSelect,
  sizeBar,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

const srcSwitch = (seged: HTMLElement): HTMLElement => $(seged, ".seginline .seg[role=radiogroup]");

describe("sourced weights", () => {
  it("offers the Literal/Entity/Attribute/Template weight-source switch", async () => {
    const { editor, seged } = await openSeeded();
    const sw = srcSwitch(seged);
    expect($$(sw, "button").map((b) => b.textContent)).toEqual([
      "Fixed value",
      "Entity",
      "Attribute",
      "Template",
    ]);
    // Literal is the default; switching to Entity plants the sticky
    // marker and renders the combobox.
    expect($$(sw, "button")[0]!.getAttribute("aria-checked")).toBe("true");
    $$(sw, "button")[1]!.click();
    await tick();
    expect(segs(editor)[0]!.source).toBe("");
    const cbx = $(seged, ".seginline aivi-entity-combobox") as HTMLElement & {
      onSelect(id: string | null): void;
    };
    cbx.onSelect("sensor.wash_remaining");
    await tick();
    expect(segs(editor)[0]!.source).toBe("sensor.wash_remaining");
    // The size field becomes the fallback, with a live-source hint.
    expect($$(seged, ".seginline .ctl .k").map(text)).toContain("Fallback");
    expect($$(seged, ".seginline .fhint").map(text).join(" ")).toContain(
      "Live from sensor.wash_remaining",
    );
    // Back to Literal clears every source marker.
    $$(srcSwitch(seged), "button")[0]!.click();
    await tick();
    expect(segs(editor)[0]!.source).toBeUndefined();
  });

  it("stores attribute picks and template text with auto-detected watched ids", async () => {
    const { editor, seged } = await openSeeded();
    $$(srcSwitch(seged), "button")[2]!.click(); // Attribute
    await tick();
    expect(segs(editor)[0]!.source__attribute).toBe("");
    expect($$(seged, ".seginline .fhint").map(text).join(" ")).toContain("Pick an entity first");
    const cbx = $(seged, ".seginline aivi-entity-combobox") as HTMLElement & {
      onSelect(id: string | null): void;
    };
    cbx.onSelect("sensor.wash_remaining");
    await tick();
    const select = $$(seged, ".seginline select").find((s) =>
      s.getAttribute("aria-label")?.includes("attribute"),
    )!;
    setSelect(select, "remaining");
    expect(segs(editor)[0]!.source__attribute).toBe("remaining");

    // Template mode: text lands in the segment, watched ids auto-detect.
    $$(srcSwitch(seged), "button")[3]!.click();
    await tick();
    expect(segs(editor)[0]!.source__template).toBe("");
    setInput($(seged, ".seginline textarea"), "{{ states('sensor.wash_remaining') | float }}");
    await tick();
    expect(segs(editor)[0]!.source__watched).toEqual(["sensor.wash_remaining"]);
    // What it updates on and its result come with the preview's answer,
    // the result saying the phase's share of the bar.
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["segments.0.source"]?.status === "ok",
      "segment result",
    );
    await tick();
    expect($$(seged, ".seginline .tchips .chip").map(text)).toEqual(["sensor.wash_remaining"]);
    expect(text($(seged, ".seginline .tres .tkind"))).toMatch(/^number, \d+% of the bar$/);
  });

  it("renders sourced capsules dashed at their resolved share and locks the boundary", async () => {
    const { editor, seged } = await openSeeded();
    editor.editorState.bindings["segments"] = [
      { value: 0.5, fill_color: "cyan", source: "sensor.wash_remaining" },
      { value: 0.5, fill_color: "gray" },
    ];
    // The preview resolved the source to 3x the literal weight.
    editor.editorState.preview = {
      progress: {
        value: 0.62,
        segments: [
          { value: 0.75, fill_color: "cyan" },
          { value: 0.25, fill_color: "gray" },
        ],
      },
    };
    rerender(seged);
    await tick();
    // The bar renders the resolved fractions, not the stored weights.
    const caps = $$(seged, ".segcap");
    expect(css(caps[0]!)).toContain("flex:0.75");
    expect(caps[0]!.classList.contains("src")).toBe(true);
    expect(caps[1]!.classList.contains("src")).toBe(false);
    expect(caps[0]!.getAttribute("aria-label")).toBe(
      "Phase 1: 75% of the bar, live from sensor.wash_remaining",
    );
    // The adjacent boundary is a locked slider: visible, focusable,
    // aria-disabled with an explanation, inert to slider keys and drags.
    const handle = $(seged, ".seghandle");
    expect(handle.classList.contains("locked")).toBe(true);
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(handle.getAttribute("aria-valuenow")).toBe("75");
    expect(handle.getAttribute("title")).toContain("follows a live source");
    const noteId = handle.getAttribute("aria-describedby")!;
    expect(text($(seged, `#${noteId}`))).toContain("follows a live source");
    key(handle, "ArrowRight");
    // A press on the locked seam (resolved 75% -> x=157.5) never starts a
    // drag: the hit layer resolves it, sees the lock, and only focuses.
    sizeBar(seged);
    pressBar(seged, "pointerdown", 157);
    pressBar(seged, "pointermove", 60);
    pressBar(seged, "pointerup", 60);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    expect(seged.querySelector(".seghandle.dragging")).toBeNull();
  });

  it("prunes empty source markers from the saved bindings", async () => {
    const { editor, seged } = await openSeeded();
    $$(srcSwitch(seged), "button")[1]!.click(); // Entity, never filled
    await tick();
    expect(segs(editor)[0]!.source).toBe("");
    const pruned = editor.prunedBindings()["segments"] as SegmentBinding[];
    expect(pruned[0]).toEqual({ value: 0.5, fill_color: "blue" });
  });
});

describe("inline feedback for sourced weights", () => {
  const feedback = (editor: AiviEditor, status: string) => () =>
    editor.editorState.fieldFeedback?.["segments.0.source"]?.status === status;

  it("surfaces a broken weight template inline without blocking Save", async () => {
    const { editor, seged } = await openSeeded();
    // Bind the required field so only the segment note could block.
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    $$(srcSwitch(seged), "button")[3]!.click(); // Template
    await tick();
    setInput($(seged, ".seginline textarea"), "{% broken");
    editor.schedulePreview(0);
    // The error waits for typing to pause; leaving the box shows it.
    $(seged, ".seginline textarea").dispatchEvent(new Event("blur"));
    await until(feedback(editor, "error"), "segment error feedback");
    await tick();
    // The error note under the textarea: its line, the backend's
    // message, plus the fallback size that applies instead, tied via
    // aria-describedby and spoken politely, like the scalar rows'.
    const note = $(seged, ".seginline .tnote.error");
    expect(text(note)).toContain("Line 1:");
    expect(text(note)).toContain("TemplateSyntaxError");
    expect(text(note)).toContain("The fallback size (50%) is in use.");
    expect(note.getAttribute("role")).toBe("status");
    expect($(seged, ".seginline textarea").getAttribute("aria-describedby")).toBe(
      $(seged, ".seginline .tfb").id,
    );
    // The sourced capsule's dashed ring picks up the error tint.
    expect($$(seged, ".segcap")[0]!.classList.contains("srcerr")).toBe(true);
    // Unlike a required scalar's broken template, Save stays enabled: the
    // fallback weight keeps the payload valid.
    const save = $(sr(editor.panel), ".topbar .btn.primary");
    expect(save.hasAttribute("disabled")).toBe(false);

    // Renders-to-nothing is the gentler warning, not the error style.
    setInput($(seged, ".seginline textarea"), "{{ states('sensor.nope') }}");
    editor.schedulePreview(0);
    await until(feedback(editor, "empty"), "segment empty feedback");
    await tick();
    const warn = $(seged, ".seginline .tnote.warn");
    expect(text(warn)).toContain("renders to nothing");
    expect(text(warn)).toContain("fallback size (50%)");
    expect($$(seged, ".segcap")[0]!.classList.contains("srcerr")).toBe(false);
  });

  it("notes when an entity source leaves the fallback weight in effect", async () => {
    const { editor, seged } = await openSeeded();
    $$(srcSwitch(seged), "button")[1]!.click(); // Entity
    await tick();
    const cbx = $(seged, ".seginline aivi-entity-combobox") as HTMLElement & {
      onSelect(id: string | null): void;
    };
    // "off" is no usable weight: the stored literal stays in effect, and
    // the note states that, phrased as unavailability, not a template error.
    cbx.onSelect("binary_sensor.garage");
    editor.schedulePreview(0);
    await until(feedback(editor, "fallback"), "segment fallback feedback");
    await tick();
    const note = $(seged, ".seginline .tnote.warn");
    expect(text(note)).toBe(
      "This source doesn't resolve to a usable size right now; the fallback size (50%) is in use.",
    );
    expect(note.getAttribute("role")).toBe("status");
    expect(seged.querySelector(".tnote.error")).toBeNull();
    expect($$(seged, ".segcap")[0]!.classList.contains("srcerr")).toBe(false);
    // The note describes the source combobox.
    expect($(seged, ".seginline .cbx input").getAttribute("aria-describedby")).toBe(note.id);

    // A source that resolves to a usable weight clears the note.
    cbx.onSelect("sensor.wash_remaining");
    editor.schedulePreview(0);
    await until(feedback(editor, "ok"), "segment ok feedback");
    await tick();
    expect(seged.querySelector(".tnote")).toBeNull();
  });
});

/** Three phases, the last one following a sensor. The stored weights are
 * 0.3 / 0.3 / 0.4, but the sensor reads 0.6, so the bar shows 25 / 25 /
 * 50: display space and stored space differ, and the boundary between the
 * two literal phases stays draggable. The shares set here are exactly
 * what the integration resolves for these bindings, so a debounced
 * preview landing mid-test changes nothing. */
async function openSourced(): Promise<{
  editor: AiviEditor;
  seged: HTMLElement;
}> {
  const { editor, seged } = await openSeeded();
  // Without its required value the template previews to nothing.
  editor.editorState.bindings["progress"] = "input_number.washer_progress";
  editor.editorState.bindings["segments"] = [
    { value: 0.3, fill_color: "cyan" },
    { value: 0.3, fill_color: "gray" },
    { value: 0.4, fill_color: "teal", source: "sensor.wash_remaining" },
  ];
  editor.editorState.preview = {
    progress: {
      value: 0,
      segments: [
        { value: 0.25, fill_color: "cyan" },
        { value: 0.25, fill_color: "gray" },
        { value: 0.5, fill_color: "teal" },
      ],
    },
  };
  rerender(seged);
  await tick();
  return { editor, seged };
}

describe("the bar works from what it just stored until the preview catches up", () => {
  it("moves the boundary on every one of five quick key presses beside a sourced phase", async () => {
    // Each press starts from the position just stored, not the last
    // previewed one, so five presses inside one debounce move five steps.
    const { editor, seged } = await openSourced();
    const handle = $$(seged, ".seghandle")[0]!;
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    for (let i = 0; i < 5; i++) key(handle, "ArrowRight");
    await tick();
    // 25% -> 30% on the bar; the literal pair's stored 0.6 is re-divided
    // 3:2 and the sourced fallback is untouched.
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuenow")).toBe("30");
    expect(segs(editor).map((s) => s.value)).toEqual([0.36, 0.24, 0.4]);
  });

  it("speaks, names and sizes the phases in the shares the bar shows", async () => {
    // The announcement, the capsule name, the slider text and Size all
    // give the shown share, never the stored weight.
    const { seged } = await openSourced();
    key($$(seged, ".seghandle")[0]!, "ArrowRight");
    await tick();
    expect(text($(seged, ".sr-only[role=status]"))).toBe("Phase 1 26%, Phase 2 24%");
    expect(capsuleNames(seged).slice(0, 2)).toEqual([
      "Phase 1: 26% of the bar",
      "Phase 2: 24% of the bar",
    ]);
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuetext")).toBe("26%");
    expect(($(seged, ".seginline input.pct") as HTMLInputElement).value).toBe("26");
  });

  it("sizes a literal phase by its shown share and a sourced one by its stored fallback", async () => {
    const { editor, seged } = await openSourced();
    // Phase 1 shows 25%: typing 30 makes the capsule read 30.
    setInput($(seged, ".seginline input.pct"), "30");
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.36, 0.24, 0.4]);
    expect(capsuleNames(seged)[0]).toBe("Phase 1: 30% of the bar");
    // The sourced phase's field is the stored figure, and is named so.
    $$(seged, ".segcap")[2]!.click();
    await tick();
    const fallback = $(seged, ".seginline input.pct") as HTMLInputElement;
    expect(fallback.getAttribute("aria-label")).toBe("Fallback size percent for Phase 3");
    expect(fallback.value).toBe("40");
  });

  it("leaves a dropped boundary where it was dropped", async () => {
    // The handle does not jump back to the previewed position for the
    // second or so the next preview takes.
    const { editor, seged } = await openSourced();
    sizeBar(seged); // 3 segments: seam 0 (25%) at x=53
    pressBar(seged, "pointerdown", 53);
    pressBar(seged, "pointermove", 83); // threshold (83-3)/200 = 0.4
    pressBar(seged, "pointerup", 83);
    await tick();
    // The stale preview still says 25%; the bar shows the drop.
    expect(editor.editorState.preview?.progress?.segments?.[0]?.value).toBe(0.25);
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuenow")).toBe("40");
    expect(css($$(seged, ".segcap")[0]!)).toContain("flex:0.4");
    expect(segs(editor).map((s) => s.value)).toEqual([0.48, 0.12, 0.4]);
  });

  it("ignores a preview that was asked before the edit, and follows one asked after", async () => {
    const { editor, seged } = await openSourced();
    // A preview of the bindings as they stand, held back in flight.
    const api = editor.panel.api;
    const real = api.preview.bind(api);
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(api, "preview").mockImplementationOnce(async (req) => {
      const out = await real(req);
      await gate;
      return out;
    });
    editor.schedulePreview(0);
    await tick();
    const asked = editor.previewRequested;
    key($$(seged, ".seghandle")[0]!, "ArrowRight", { shiftKey: true }); // 25% -> 30%
    release();
    await until(() => editor.previewLanded === asked, "the older preview");
    await tick();
    // It answered for the old weights; the boundary does not go back.
    expect(editor.editorState.preview?.progress?.segments?.[0]?.value).toBe(0.25);
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuenow")).toBe("30");
    // A preview asked after the edit takes over from the held shares.
    editor.schedulePreview(0);
    await until(() => editor.previewLanded > asked, "the newer preview");
    await tick();
    expect(editor.editorState.preview?.progress?.segments?.[0]?.value).toBeCloseTo(0.3, 2);
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuenow")).toBe("30");
    // From here the bar follows the preview again: whatever it resolves shows.
    editor.editorState.preview = {
      progress: {
        value: 0,
        segments: [
          { value: 0.1, fill_color: "cyan" },
          { value: 0.1, fill_color: "gray" },
          { value: 0.8, fill_color: "teal" },
        ],
      },
    };
    rerender(seged);
    await tick();
    expect($$(seged, ".seghandle")[0]!.getAttribute("aria-valuenow")).toBe("10");
  });
});
