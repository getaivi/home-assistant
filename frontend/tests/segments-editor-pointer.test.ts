// The segments editor's hit layer: one overlay owns every pointer over
// the bar. Drags resolve the nearest seam from the shared geometry, a
// still press selects the capsule under it.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import {
  $,
  $$,
  css,
  focused,
  key,
  openSeeded,
  pressBar,
  pressedCapsules,
  rerender,
  segs,
  sizeBar,
  text,
  tick,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("boundary drags", () => {
  it("drags the boundary nearest the pointer, wherever the press lands", async () => {
    // The overlay resolves the nearest seam from the shared geometry, so
    // crowded boundaries can't steal each other's presses.
    const { editor, seged } = await openSeeded();
    $(seged, ".segadd").click(); // [0.5, 0.25, 0.25] -> seams at 50%, 75%
    await tick();
    sizeBar(seged); // seam 0 at x=103, seam 1 at x=159
    const hit = $(seged, ".seghit");
    hit.dispatchEvent(new MouseEvent("pointerdown", { clientX: 103, bubbles: true }));
    hit.dispatchEvent(new MouseEvent("pointermove", { clientX: 63, bubbles: true }));
    hit.dispatchEvent(new MouseEvent("pointerup", { clientX: 63, bubbles: true }));
    await tick();
    // Boundary 0 moved to 30%; boundary 1 (and weight 2) untouched.
    expect(segs(editor).map((s) => s.value)).toEqual([0.3, 0.45, 0.25]);
  });

  it("survives a zero-width pointer drag without committing garbage", async () => {
    const { editor, seged } = await openSeeded();
    // happy-dom rects are all zero: without a measurable frame the hit
    // layer stays inert (no drag, no tap, nothing committed).
    pressBar(seged, "pointerdown", 106);
    pressBar(seged, "pointermove", 120);
    pressBar(seged, "pointerup", 120);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    expect(seged.querySelector(".seghandle.dragging")).toBeNull();
  });

  it("drags every seam of a crowded bar through the one overlay", async () => {
    // Each seam of a 3-segment bar moves exactly its own pair.
    const { editor, seged } = await openSeeded();
    $(seged, ".segadd").click(); // [0.5, 0.25, 0.25], seams x=103 / x=159
    await tick();
    sizeBar(seged);
    pressBar(seged, "pointerdown", 103);
    pressBar(seged, "pointermove", 83); // threshold (83-3)/200 = 0.4
    pressBar(seged, "pointerup", 83);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.4, 0.35, 0.25]);
    // Seam 1 still sits at 200*0.75 + 6 + 3 = 159; drag it right.
    pressBar(seged, "pointerdown", 159);
    pressBar(seged, "pointermove", 180); // threshold (180-9)/200 = 0.855
    pressBar(seged, "pointerup", 180);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.4, 0.455, 0.145]);
  });

  it("renders the float draft mid-drag and quantizes once on release", async () => {
    const { editor, seged } = await openSeeded();
    sizeBar(seged); // 2 segments: usable 206, seam at x=106
    pressBar(seged, "pointerdown", 106);
    pressBar(seged, "pointermove", 141); // threshold (141-3)/206 = 0.66990...
    await tick();
    // Mid-drag: the capsules render the unquantized draft, the stored
    // weights are untouched, and the dragged seam carries its accent.
    const flex = css($$(seged, ".segcap")[0]!).match(/flex:([\d.]+)/)![1]!;
    expect(Number(flex)).toBeCloseTo((141 - 3) / 206, 10);
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    expect(seged.querySelector(".seghandle.dragging")).not.toBeNull();
    pressBar(seged, "pointerup", 141);
    await tick();
    // One commit, quantized to the 4-decimal store.
    expect(segs(editor).map((s) => s.value)).toEqual([0.6699, 0.3301]);
    expect(text($(seged, ".sr-only"))).toBe("Phase 1 67%, Phase 2 33%");
    expect(seged.querySelector(".seghandle.dragging")).toBeNull();
  });

  it("keeps committed weights stable across a grab-without-move (round-trip)", async () => {
    const { editor, seged } = await openSeeded();
    sizeBar(seged);
    pressBar(seged, "pointerdown", 106);
    pressBar(seged, "pointermove", 141);
    pressBar(seged, "pointerup", 141);
    await tick();
    const committed = segs(editor).map((s) => s.value);
    expect($(seged, ".seghandle").getAttribute("aria-valuenow")).toBe("67");
    // Grab the seam where it renders (206*0.6699 + 3 = 141.0) and
    // release without moving: nothing re-quantizes, nothing drifts.
    pressBar(seged, "pointerdown", 141);
    pressBar(seged, "pointerup", 141);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual(committed);
    expect($(seged, ".seghandle").getAttribute("aria-valuenow")).toBe("67");
  });

  it("selects the capsule under a still tap; a wandering press selects nothing", async () => {
    const { seged } = await openSeeded();
    sizeBar(seged);
    // Seeding selected capsule 0; a tap far right of the seam (x=180,
    // 74px away) resolves capsule 1 through the overlay.
    pressBar(seged, "pointerdown", 180);
    pressBar(seged, "pointerup", 180);
    await tick();
    const pressedNow = (): string[] =>
      $$(seged, ".segcap").map((c) => c.getAttribute("aria-pressed")!);
    expect(pressedNow()).toEqual(["false", "true"]);
    // A press that wanders past the tap slop is not a tap (nor a drag:
    // it started 74px from the seam): the selection stays put.
    pressBar(seged, "pointerdown", 180);
    pressBar(seged, "pointermove", 40);
    pressBar(seged, "pointerup", 40);
    await tick();
    expect(pressedNow()).toEqual(["false", "true"]);
  });

  it("grabs a seam from farther away for touch and pen pointers", async () => {
    const { editor, seged } = await openSeeded();
    sizeBar(seged); // seam at x=106
    // 18px off the seam: beyond the 12px mouse tolerance (a tap on
    // capsule 1)...
    pressBar(seged, "pointerdown", 124);
    pressBar(seged, "pointermove", 90);
    pressBar(seged, "pointerup", 90);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    // ...but within the 22px touch tolerance: the same press drags.
    pressBar(seged, "pointerdown", 124, "touch");
    pressBar(seged, "pointermove", 106, "touch"); // threshold (106-3)/206 = 0.5
    pressBar(seged, "pointermove", 85, "touch"); // threshold (85-3)/206
    pressBar(seged, "pointerup", 85, "touch");
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.3981, 0.6019]);
  });
});

describe("pointer presses on the bar", () => {
  /** A 4% phase between two wide ones: on the 212px bar its capsule spans
   * x=109..117, wholly inside the grab zone of seams 0 (x=103) and 1
   * (x=117). */
  async function openNarrow(): Promise<{
    editor: AiviEditor;
    seged: HTMLElement;
  }> {
    const { editor, seged } = await openSeeded();
    editor.editorState.bindings["segments"] = [
      { value: 0.5, fill_color: "cyan" },
      { value: 0.04, fill_color: "teal" },
      { value: 0.46, fill_color: "gray" },
    ];
    rerender(seged);
    await tick();
    sizeBar(seged);
    return { editor, seged };
  }

  it("selects a narrow phase on a press that does not move", async () => {
    // A still press on it selects it instead of grabbing a boundary, so
    // its color, size and Remove stay in reach.
    const { editor, seged } = await openNarrow();
    pressBar(seged, "pointerdown", 110);
    pressBar(seged, "pointerup", 110);
    await tick();
    expect(pressedCapsules(seged)).toEqual(["false", "true", "false"]);
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.04, 0.46]);
    expect(seged.querySelector(".seghandle.dragging")).toBeNull();
  });

  it("counts a finger's wobble as a still press, wider than a mouse's", async () => {
    const { editor, seged } = await openNarrow();
    // 7px: past the mouse's 4px slop (a drag), within the finger's 8px.
    pressBar(seged, "pointerdown", 110, "touch");
    pressBar(seged, "pointermove", 117, "touch");
    pressBar(seged, "pointerup", 117, "touch");
    await tick();
    expect(pressedCapsules(seged)).toEqual(["false", "true", "false"]);
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.04, 0.46]);
  });

  it("still drags the boundary once the pointer moves past the slop", async () => {
    const { editor, seged } = await openNarrow();
    pressBar(seged, "pointerdown", 110); // seam 0 is the nearest (first of a tie)
    pressBar(seged, "pointermove", 90); // threshold (90-3)/200 = 0.435
    pressBar(seged, "pointerup", 90);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.435, 0.105, 0.46]);
    // A drag selects nothing.
    expect(pressedCapsules(seged)).toEqual(["true", "false", "false"]);
  });

  it("gives a locked boundary the focus on a press, and still selects the phase", async () => {
    // The press's default is prevented, so the handle keeps the focus.
    const { editor, seged } = await openSeeded();
    editor.editorState.bindings["segments"] = [
      { value: 0.5, fill_color: "cyan", source: "sensor.wash_remaining" },
      { value: 0.5, fill_color: "gray" },
    ];
    rerender(seged);
    await tick();
    sizeBar(seged); // the locked seam sits at x=106
    const down = new MouseEvent("pointerdown", {
      clientX: 110,
      bubbles: true,
      cancelable: true,
    });
    $(seged, ".seghit").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(focused(editor.panel)).toBe($(seged, ".seghandle.locked"));
    pressBar(seged, "pointerup", 110);
    await tick();
    expect(pressedCapsules(seged)).toEqual(["false", "true"]);
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
  });

  it("cancels a boundary drag on Escape", async () => {
    const { editor, seged } = await openSeeded();
    sizeBar(seged);
    pressBar(seged, "pointerdown", 106);
    pressBar(seged, "pointermove", 141);
    await tick();
    expect(css($$(seged, ".segcap")[0]!)).not.toContain("flex:0.5");
    key($(seged, ".seghandle"), "Escape");
    await tick();
    // The draft is gone and the release that follows commits nothing.
    expect(css($$(seged, ".segcap")[0]!)).toContain("flex:0.5");
    expect(seged.querySelector(".seghandle.dragging")).toBeNull();
    pressBar(seged, "pointerup", 141);
    await tick();
    expect(segs(editor).map((s) => s.value)).toEqual([0.5, 0.5]);
    expect(pressedCapsules(seged)).toEqual(["true", "false"]);
  });

  it("leaves Escape alone when no drag is in progress", async () => {
    // Outside a drag the key is left for whatever encloses the editor.
    const { seged } = await openSeeded();
    const e = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    $(seged, ".seghandle").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
