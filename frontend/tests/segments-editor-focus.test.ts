// Focus in the segments editor: an action that rebuilds part of the
// section puts the focus on the nearest control that survives it.

import { afterEach, describe, expect, it } from "vitest";
import {
  $,
  $$,
  focused,
  inlineButton,
  key,
  modeSwitch,
  openSeeded,
  segs,
  setInput,
  setSelect,
  tick,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focus survives the rebuilds", () => {
  it("moves to the absorbing neighbor after Remove", async () => {
    const { editor, seged } = await openSeeded();
    $(seged, ".segadd").click(); // 3 phases, the new third selected
    await tick();
    const remove = inlineButton(seged, "Remove");
    remove.focus();
    remove.click();
    await tick();
    // Phase 2 absorbed the space; Remove went with the inline editor.
    expect(focused(editor.panel)).toBe($$(seged, ".segcap")[1]!);
  });

  it("moves to the right neighbor when the first phase is removed", async () => {
    const { editor, seged } = await openSeeded(); // phase 1 selected
    inlineButton(seged, "Remove").click();
    await tick();
    expect(segs(editor)).toHaveLength(1);
    expect(focused(editor.panel)).toBe($$(seged, ".segcap")[0]!);
  });

  it("moves to the bar style once the last phase is removed", async () => {
    const { editor, seged } = await openSeeded();
    for (let i = 0; i < 2; i++) {
      const cap = $$(seged, ".segcap")[0]!;
      if (cap.getAttribute("aria-pressed") !== "true") {
        cap.click();
        await tick();
      }
      inlineButton(seged, "Remove").click();
      await tick();
    }
    // No phases is Solid: the checked style is the nearest control left.
    const solid = $$(modeSwitch(seged), "button")[0]!;
    expect(solid.getAttribute("aria-checked")).toBe("true");
    expect(focused(editor.panel)).toBe(solid);
  });

  it("moves to the new phase after Split", async () => {
    const { editor, seged } = await openSeeded();
    const split = inlineButton(seged, "Split");
    split.focus();
    split.click();
    await tick();
    const fresh = $$(seged, ".segcap")[1]!;
    expect(fresh.getAttribute("aria-pressed")).toBe("true");
    expect(focused(editor.panel)).toBe(fresh);
  });

  it('keeps the focus on "+" while it stays, and moves to the new phase at the cap', async () => {
    const { editor, seged } = await openSeeded();
    const add = $(seged, ".segadd");
    add.focus();
    add.click(); // 3 of 4: the button is still there
    await tick();
    expect(focused(editor.panel)).toBe(add);
    add.click(); // 4 of 4: the button is gone
    await tick();
    expect(seged.querySelector(".segadd")).toBeNull();
    expect(focused(editor.panel)).toBe($$(seged, ".segcap")[3]!);
  });

  it("drives the size-source switch with the arrow keys", async () => {
    // Each ArrowRight switches and keeps the focus in the switch, so the
    // next one works too.
    const { editor, seged } = await openSeeded();
    const sw = (): HTMLElement => $(seged, ".seginline .seg[role=radiogroup]");
    const first = $$(sw(), "button")[0]!;
    first.focus();
    key(first, "ArrowRight");
    await tick();
    const entity = focused(editor.panel) as HTMLElement;
    expect(entity).toBe($$(sw(), "button")[1]!);
    expect(entity.getAttribute("aria-checked")).toBe("true");
    expect(segs(editor)[0]!.source).toBe("");
    key(entity, "ArrowRight");
    await tick();
    const attribute = focused(editor.panel) as HTMLElement;
    expect(attribute).toBe($$(sw(), "button")[2]!);
    expect(attribute.getAttribute("tabindex")).toBe("0");
    expect(segs(editor)[0]!.source__attribute).toBe("");
  });

  it("keeps the focus in the entity field after a pick", async () => {
    const { editor, seged } = await openSeeded();
    $$($(seged, ".seginline .seg[role=radiogroup]"), "button")[1]!.click();
    await tick();
    const input = $(seged, ".seginline .cbx input");
    input.focus();
    setInput(input, "sensor.wash_remaining");
    await tick();
    key(input, "Enter");
    await tick();
    expect(segs(editor)[0]!.source).toBe("sensor.wash_remaining");
    // The same input, not a rebuilt one, and it still has the focus.
    expect($(seged, ".seginline .cbx input")).toBe(input);
    expect(focused(editor.panel)).toBe(input);
  });

  it("offers a fresh attribute list when the entity changes", async () => {
    // The entity pick does not rebuild the inline editor, so the
    // attribute select is keyed by the entity instead.
    const { editor, seged } = await openSeeded();
    $$($(seged, ".seginline .seg[role=radiogroup]"), "button")[2]!.click();
    await tick();
    const cbx = $(seged, ".seginline aivi-entity-combobox") as HTMLElement & {
      onSelect(id: string | null): void;
    };
    const attr = (): HTMLSelectElement =>
      $$(seged, ".seginline select").find((el) =>
        el.getAttribute("aria-label")?.includes("attribute"),
      ) as HTMLSelectElement;
    cbx.onSelect("sensor.wash_remaining");
    await tick();
    const before = attr();
    setSelect(before, "remaining");
    cbx.onSelect("binary_sensor.garage");
    await tick();
    // The old menu is gone with its pick: a fresh one for the new entity,
    // or (an entity with nothing to pick) the line that states that.
    expect(attr()).not.toBe(before);
    expect(attr()?.value ?? "").toBe("");
    expect(segs(editor)[0]!.source__attribute).toBe("");
  });
});
