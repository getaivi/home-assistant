// The rows field (list rows / battery devices): one ordered list of the
// picked rows, an entity picker that adds to it (filtered by the field),
// removing, reordering (buttons, keyboard, drag), and the per-row options.

import type { LitElement } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import type { AiviPanel } from "../src/aivi-panel";
import { DRAG_THRESHOLD } from "../src/reorder";
import { responsiveStyles } from "../src/styles/responsive";
import { segmentsStyles } from "../src/styles/segments";
import {
  $,
  $$,
  mountPanel,
  openColor,
  openWidgetEditor,
  previewSettled,
  setInput,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

/** The picker that adds a row. */
function adder(root: ParentNode): AiviEntityCombobox {
  return $(root, "aivi-entity-combobox.rowadd") as AiviEntityCombobox;
}

/** Add a row through the picker, or remove it with its row's button. */
function toggle(root: ParentNode, id: string, on: boolean): void {
  if (on) {
    adder(root).onSelect(id);
    return;
  }
  const at = [...root.querySelectorAll<HTMLElement>(".ordrow")].find(
    (row) => row.dataset["id"] === id,
  );
  if (!at) throw new Error(`no row ${id}`);
  $(at, ".rm").click();
}

/** A battery editor with the lock and vacuum sensors selected, in order. */
async function selectTwo(): Promise<{
  panel: AiviPanel;
  editor: AiviEditor;
  checks: HTMLElement;
}> {
  const panel = await mountPanel();
  const editor = await openWidgetEditor(panel, "batteries");
  const checks = $(sr(panel), "aivi-rows-checklist");
  toggle(checks, "sensor.lock_battery", true);
  await tick();
  toggle(checks, "sensor.vacuum_battery", true);
  await tick();
  return { panel, editor, checks };
}

describe("aivi-rows-checklist", () => {
  it("stops at eight rows, Aivi's cap", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    const filler = Array.from({ length: 7 }, (_, i) => `sensor.other_${i}`);
    editor.editorState.bindings["devices"] = filler;
    editor.updateValidation();
    await tick();
    const checks = $(sr(panel), "aivi-rows-checklist") as LitElement;
    checks.requestUpdate();
    await tick();
    expect(text($(checks, ".count"))).toBe("7 of 8");
    toggle(checks, "sensor.lock_battery", true);
    await tick();
    expect(editor.editorState.bindings["devices"]).toHaveLength(8);
    // Full: the reason replaces the picker, and the count reads 8 of 8.
    expect(checks.querySelector("aivi-entity-combobox.rowadd")).toBeNull();
    expect(text($(checks, ".rowfull"))).toBe("That's all 8. Remove one to add another.");
    expect(text($(checks, ".count"))).toBe("8 of 8");
    // Removing one brings the picker back.
    $($$(checks, ".ordrow")[0]!, ".rm").click();
    await tick();
    expect(editor.editorState.bindings["devices"]).toHaveLength(7);
    expect(adder(checks)).toBeTruthy();
  });

  it("warns when a stored selection is over the cap", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    editor.editorState.bindings["devices"] = Array.from(
      { length: 9 },
      (_, i) => `sensor.other_${i}`,
    );
    const checks = $(sr(panel), "aivi-rows-checklist") as LitElement;
    checks.requestUpdate();
    await tick();
    expect(text($(checks, ".tnote.warn"))).toBe("Only the first 8 are sent. Remove the rest.");
  });

  it("offers only entities matching the field filter", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "batteries");
    const checks = $(sr(panel), "aivi-rows-checklist");
    // The battery template's devices field filters on device_class=battery.
    expect(adder(checks).options).toHaveLength(4);
    expect(text($(checks, ".count"))).toBe("0 of 8");
    expect($(adder(checks), "input").getAttribute("placeholder")).toBe("Add an entity…");
  });

  it("adds through the picker, which keeps offering what is left", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    const checks = $(sr(panel), "aivi-rows-checklist");
    const input = $(adder(checks), "input") as HTMLInputElement;
    input.dispatchEvent(new Event("focus"));
    await tick();
    const options = (): HTMLElement[] => $$(adder(checks), ".cbx-pop .opt");
    expect(options()).toHaveLength(4);
    const first = text($(options()[0]!, ".eid"));
    options()[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([first]);
    // The pick became a row; the picker cleared and stays open on the rest.
    expect($$(checks, ".ordrow")).toHaveLength(1);
    expect(input.value).toBe("");
    expect(options()).toHaveLength(3);
    expect(options().map((o) => text($(o, ".eid")))).not.toContain(first);
    expect($(adder(checks), "input").getAttribute("placeholder")).toBe("Add another…");
  });

  it("refreshes the host row's required badge as the selection changes", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "batteries");
    const badge = (): string => text($(sr(panel), '.field[data-key="devices"] .freq'));
    expect(badge()).toBe("required");
    const checks = $(sr(panel), "aivi-rows-checklist");
    toggle(checks, "sensor.lock_battery", true);
    await tick();
    // The badge renders in the parent field row, not the checklist, so
    // storing a selection must nudge the row too. Otherwise Save enables
    // while the field still shows "required".
    expect(badge()).toBe(""); // the done badge is the mdi check icon, no text
    toggle(checks, "sensor.lock_battery", false);
    await tick();
    expect(badge()).toBe("required");
  });

  it("keeps the selection ordered and supports reordering", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    const checks = $(sr(panel), "aivi-rows-checklist");
    toggle(checks, "sensor.lock_battery", true);
    await tick();
    toggle(checks, "sensor.vacuum_battery", true);
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.lock_battery",
      "sensor.vacuum_battery",
    ]);
    expect($$(checks, ".ordrow .n").map(text)).toEqual([
      "Door lock battery",
      "Robot vacuum battery",
    ]);
    expect($$(checks, ".ordrow .mv").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Move Door lock battery up",
      "Move Door lock battery down",
      "Remove Door lock battery",
      "Move Robot vacuum battery up",
      "Move Robot vacuum battery down",
      "Remove Robot vacuum battery",
    ]);
    $($$(checks, ".ordrow")[0]!, 'button[title="Move down"]').click();
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
    ]);
    expect(text($(checks, ".count"))).toBe("2 of 8");

    // Removing takes a row out of the order; the empty set deletes the
    // binding.
    toggle(checks, "sensor.vacuum_battery", false);
    await tick();
    toggle(checks, "sensor.lock_battery", false);
    await tick();
    expect(editor.editorState.bindings["devices"]).toBeUndefined();
  });

  it("moves the focused row with Alt+Arrow and announces it", async () => {
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
      }),
    );
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
    ]);
    // The move is spoken through the polite live region (swatch pattern).
    expect(text($(checks, ".sr-only"))).toBe("Door lock battery moved to position 2 of 2");
    // The roving tab stop follows the moved row.
    expect($$(checks, ".grip").map((g) => g.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    // At the edge the move is a no-op.
    $$(checks, ".grip")[1]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
      }),
    );
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
    ]);
  });

  it("roves grip focus with plain arrows (one tab stop)", async () => {
    const { checks } = await selectTwo();
    expect($$(checks, ".grip").map((g) => g.getAttribute("tabindex"))).toEqual(["0", "-1"]);
    $$(checks, ".grip")[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await tick();
    expect($$(checks, ".grip").map((g) => g.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  });

  it("reorders by dragging the grip", async () => {
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    // happy-dom rects are all zero, so any positive Y targets the last row.
    grip.dispatchEvent(new MouseEvent("pointermove", { clientY: 50, bubbles: true }));
    grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
    ]);
  });

  it("shows a lifted ghost, origin placeholder, and drop line mid-drag", async () => {
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(new MouseEvent("pointerdown", { clientY: 10, bubbles: true }));
    await tick();
    // A press alone lifts nothing: it is not a drag until the pointer
    // has traveled.
    expect(checks.querySelector(".draglift")).toBeNull();
    expect(checks.querySelector(".dragslot")).toBeNull();
    grip.dispatchEvent(new MouseEvent("pointermove", { clientY: 50, bubbles: true }));
    await tick();
    expect($$(checks, ".ordrow")[0]!.className).toContain("draglift");
    // The ghost follows the pointer through a transform (no reflow) ...
    expect($$(checks, ".ordrow")[0]!.getAttribute("style")).toContain("translateY(40px)");
    // ... and the target gap carries the accent line. Both artifacts are
    // purely visual: hidden from the accessibility tree.
    const slot = $(checks, ".dragslot");
    const line = $(checks, ".dragline");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(line.getAttribute("aria-hidden")).toBe("true");
    grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await tick();
    // Release applies the move and clears every drag artifact.
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
    ]);
    expect(checks.querySelector(".draglift")).toBeNull();
    expect(checks.querySelector(".dragslot")).toBeNull();
    expect(checks.querySelector(".dragline")).toBeNull();
  });

  it("stores per-row options behind the disclosure and prunes orphans", async () => {
    const { editor, checks } = await selectTwo();
    // Closed by default: defaults apply unless opened.
    expect(checks.querySelector(".rowopts")).toBeNull();
    const toggleBtn = $$(checks, ".rowtoggle")[0]!;
    expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
    toggleBtn.click();
    await tick();
    expect($$(checks, ".rowtoggle")[0]!.getAttribute("aria-expanded")).toBe("true");
    // Battery rows support icon + color, but no label override.
    const body = $(checks, ".rowopts");
    expect(body.querySelector('input[aria-label^="Label"]')).toBeNull();
    setInput($(body, 'input[aria-label^="Icon"]'), "lock.fill");
    $$(await openColor(body), ".swatches .sw")[1]!.click(); // orange in the palette order
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toEqual({
      "sensor.lock_battery": { icon: "lock.fill", color: "orange" },
    });
    // The toggle marks the row as customized.
    expect($$(checks, ".rowtoggle")[0]!.className).toContain("has");
    // Clearing every option removes the row's entry, and the binding key.
    setInput($(body, 'input[aria-label^="Icon"]'), "");
    $$(await openColor(body), ".swatches .sw")[1]!.click();
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toBeUndefined();
    // Options never outlive their row: set one, deselect the row.
    setInput($($(checks, ".rowopts"), 'input[aria-label^="Icon"]'), "bolt");
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toEqual({
      "sensor.lock_battery": { icon: "bolt" },
    });
    toggle(checks, "sensor.lock_battery", false);
    await tick();
    expect(editor.editorState.bindings["devices__options"]).toBeUndefined();
  });

  it("offers the label override on list rows", async () => {
    const panel = await mountPanel();
    // The mock account carries no list widget; a minimal remote-widget stub
    // opens the bind editor for one (no fixture data is duplicated).
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    panel.openEditor(acc, { slug: "home", name: "Home", template: "list", supported: true }, null);
    await tick();
    const editor = $(sr(panel), "aivi-editor") as AiviEditor;
    const checks = $(sr(panel), "aivi-rows-checklist");
    toggle(checks, "sensor.living_temp", true);
    await tick();
    $$(checks, ".rowtoggle")[0]!.click();
    await tick();
    setInput($(checks, '.rowopts input[aria-label^="Label"]'), "Inside");
    await tick();
    expect(editor.editorState.bindings["rows__options"]).toEqual({
      "sensor.living_temp": { label: "Inside" },
    });
  });

  it("says how many options a row has set, on its header", async () => {
    const { checks } = await selectTwo();
    const head = (): HTMLElement => $$(checks, ".ordrow .rowtoggle")[0]!;
    expect(head().querySelector(".rsum")).toBeNull();
    head().click();
    await tick();
    setInput($(checks, '.rowopts input[aria-label^="Icon"]'), "lock.fill");
    await tick();
    expect(text($(head(), ".rsum"))).toBe("1 set");
    // The whole name is the target, and it carries the expanded state.
    expect(head().getAttribute("aria-expanded")).toBe("true");
    expect(text($(head(), ".n"))).toBe("Door lock battery");
  });
});

/** A battery editor with three rows: lock, vacuum, doorbell. */
async function selectThree(): Promise<{
  panel: AiviPanel;
  editor: AiviEditor;
  checks: HTMLElement;
}> {
  const made = await selectTwo();
  toggle(made.checks, "sensor.doorbell_battery", true);
  await tick();
  return made;
}

/** What holds focus, inside the panel's shadow root. */
function active(panel: AiviPanel): Element | null {
  return sr(panel).activeElement;
}

function altArrow(key: "ArrowUp" | "ArrowDown"): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, altKey: true, bubbles: true });
}

function pointer(type: string, clientY = 0): MouseEvent {
  return new MouseEvent(type, { clientY, bubbles: true });
}

function row(checks: HTMLElement, id: string): HTMLElement {
  const at = $$(checks, ".ordrow").find((r) => r.dataset["id"] === id);
  if (!at) throw new Error(`no row ${id}`);
  return at;
}

describe("row list: dragging", () => {
  it("does not reorder on a press that barely moves", async () => {
    // A tap on the grip that wobbles, or a thumb that slips a pixel, is
    // not a drag: nothing lifts and nothing moves.
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(pointer("pointerdown", 10));
    grip.dispatchEvent(pointer("pointermove", 10 + DRAG_THRESHOLD - 1));
    await tick();
    expect(checks.querySelector(".draglift")).toBeNull();
    grip.dispatchEvent(pointer("pointerup", 10 + DRAG_THRESHOLD - 1));
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.lock_battery",
      "sensor.vacuum_battery",
    ]);
  });

  it("cancels a drag on Escape, so the release moves nothing", async () => {
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(pointer("pointerdown"));
    grip.dispatchEvent(pointer("pointermove", 50));
    await tick();
    expect(checks.querySelector(".draglift")).not.toBeNull();
    // Escape is caught wherever focus is: a pressed grip does not take
    // focus in every browser.
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(esc);
    await tick();
    expect(esc.defaultPrevented).toBe(true);
    expect(checks.querySelector(".draglift")).toBeNull();
    expect(checks.querySelector(".dragline")).toBeNull();
    grip.dispatchEvent(pointer("pointerup", 50));
    await tick();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.lock_battery",
      "sensor.vacuum_battery",
    ]);
  });

  it("leaves Escape alone when no drag is live", async () => {
    // The drag takes Escape only while it lasts: afterwards the key
    // reaches whatever else wants it (a popover, the leave dialog).
    const { checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(pointer("pointerdown"));
    grip.dispatchEvent(pointer("pointermove", 50));
    grip.dispatchEvent(pointer("pointerup", 50));
    await tick();
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
  });

  it("moves nothing when the browser cancels the pointer", async () => {
    // A canceled pointer (the system took the touch) is not a drop.
    const { editor, checks } = await selectTwo();
    const grip = $$(checks, ".grip")[0]!;
    grip.dispatchEvent(pointer("pointerdown"));
    grip.dispatchEvent(pointer("pointermove", 50));
    grip.dispatchEvent(pointer("pointercancel", 50));
    await tick();
    expect(checks.querySelector(".draglift")).toBeNull();
    expect(editor.editorState.bindings["devices"]).toEqual([
      "sensor.lock_battery",
      "sensor.vacuum_battery",
    ]);
  });
});

describe("row list: focus after an action", () => {
  it("keeps focus on the move button of the row that moved", async () => {
    const { panel, checks } = await selectThree();
    $(row(checks, "sensor.lock_battery"), 'button[title="Move down"]').click();
    await tick();
    // The moved row is re-inserted, which drops focus: it is put back on
    // the same button, so the row can be moved again.
    expect(active(panel)).toBe($(row(checks, "sensor.lock_battery"), 'button[title="Move down"]'));
  });

  it("moves focus to the row's grip when its move button is now disabled", async () => {
    const { panel, checks } = await selectTwo();
    $(row(checks, "sensor.lock_battery"), 'button[title="Move down"]').click();
    await tick();
    // In last place Move down is disabled and cannot hold focus.
    const moved = row(checks, "sensor.lock_battery");
    expect(($(moved, 'button[title="Move down"]') as HTMLButtonElement).disabled).toBe(true);
    expect(active(panel)).toBe($(moved, ".grip"));
  });

  it("keeps focus on the grip through Alt+Arrow, down and up", async () => {
    const { panel, checks } = await selectThree();
    const grip = (): HTMLElement => $(row(checks, "sensor.lock_battery"), ".grip");
    grip().focus();
    grip().dispatchEvent(altArrow("ArrowDown"));
    await tick();
    expect(active(panel)).toBe(grip());
    grip().dispatchEvent(altArrow("ArrowUp"));
    await tick();
    expect(active(panel)).toBe(grip());
  });

  it("puts focus on the dragged row's grip after the drop", async () => {
    const { panel, checks } = await selectTwo();
    const grip = $(row(checks, "sensor.lock_battery"), ".grip");
    grip.dispatchEvent(pointer("pointerdown"));
    grip.dispatchEvent(pointer("pointermove", 50));
    grip.dispatchEvent(pointer("pointerup", 50));
    await tick();
    expect(active(panel)).toBe($(row(checks, "sensor.lock_battery"), ".grip"));
  });

  it("moves focus to a neighbor's Remove, then to the picker when the list is empty", async () => {
    const { panel, checks } = await selectThree();
    // The row that takes the removed one's place ...
    $(row(checks, "sensor.lock_battery"), ".rm").click();
    await tick();
    expect(active(panel)).toBe($(row(checks, "sensor.vacuum_battery"), ".rm"));
    // ... the one before it when the last row goes ...
    $(row(checks, "sensor.doorbell_battery"), ".rm").click();
    await tick();
    expect(active(panel)).toBe($(row(checks, "sensor.vacuum_battery"), ".rm"));
    // ... and the picker when none is left.
    $(row(checks, "sensor.vacuum_battery"), ".rm").click();
    await tick();
    expect(active(panel)).toBe($(adder(checks), "input"));
  });

  it("moves focus to the last row when the cap takes the picker away", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    editor.editorState.bindings["devices"] = Array.from(
      { length: 7 },
      (_, i) => `sensor.other_${i}`,
    );
    editor.updateValidation();
    const checks = $(sr(panel), "aivi-rows-checklist") as LitElement;
    checks.requestUpdate();
    await tick();
    $(adder(checks), "input").focus();
    adder(checks).onSelect("sensor.lock_battery");
    await tick();
    expect(checks.querySelector("aivi-entity-combobox.rowadd")).toBeNull();
    const last = $$(checks, ".ordrow").at(-1)!;
    expect(last.dataset["id"]).toBe("sensor.lock_battery");
    expect(active(panel)).toBe($(last, ".grip"));
    // The grip is the list's tab stop, so Tab continues from there.
    expect($(last, ".grip").getAttribute("tabindex")).toBe("0");
  });
});

describe("row list: the picker and the cap", () => {
  it("says there is nothing left to add instead of offering an empty picker", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "batteries");
    const checks = $(sr(panel), "aivi-rows-checklist");
    const ids = adder(checks).options.map((o) => o.id);
    expect(ids).toHaveLength(4);
    for (const id of ids) {
      adder(checks).onSelect(id);
      await tick();
    }
    // Under the cap, but every battery sensor is a row: no "Add another…"
    // that can only answer "No matching entities".
    expect(text($(checks, ".count"))).toBe("4 of 8");
    expect(checks.querySelector("aivi-entity-combobox.rowadd")).toBeNull();
    expect(text($(checks, ".rowfull"))).toBe(
      "Nothing left to add: every entity that fits is in use.",
    );
    expect(active(panel)).toBe($($$(checks, ".ordrow").at(-1)!, ".grip"));
    // Removing a row brings the picker back.
    $($$(checks, ".ordrow")[0]!, ".rm").click();
    await tick();
    expect(adder(checks).options).toHaveLength(1);
  });

  it("says one thing over the cap: the extra rows are not sent", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    editor.editorState.bindings["devices"] = Array.from(
      { length: 9 },
      (_, i) => `sensor.other_${i}`,
    );
    const checks = $(sr(panel), "aivi-rows-checklist") as LitElement;
    checks.requestUpdate();
    await tick();
    // "That's all 8" beside "9 of 8" would contradict the warning under it.
    expect(text(checks)).not.toContain("That's all 8");
    expect($$(checks, ".rowfull")).toHaveLength(1);
    expect(text($(checks, ".rowfoot .rowfull"))).toBe(
      "Only the first 8 are sent. Remove the rest.",
    );
    expect(text($(checks, ".count"))).toBe("9 of 8");
  });
});

describe("row list: a battery row's charging option", () => {
  type OptionsMap = Record<string, Record<string, string>>;
  async function chargingRow(): Promise<{
    body: HTMLElement;
    stored: () => Record<string, string> | undefined;
  }> {
    const { editor, checks } = await selectTwo();
    $$(checks, ".rowtoggle")[0]!.click();
    await tick();
    return {
      body: $(checks, ".rowopts"),
      stored: () =>
        (editor.editorState.bindings["devices__options"] as OptionsMap | undefined)?.[
          "sensor.lock_battery"
        ],
    };
  }
  const picker = (body: HTMLElement): AiviEntityCombobox =>
    $(body, "aivi-entity-combobox") as AiviEntityCombobox;

  it("offers what can say charging, not every sensor", async () => {
    const { body } = await chargingRow();
    const offered = picker(body).options.map((o) => o.id);
    // A binary sensor, and a sensor that reads as a word.
    expect(offered).toContain("binary_sensor.garage");
    expect(offered).toContain("sensor.phone_charging");
    // Not the row's own battery sensor, nor a measurement.
    expect(offered).not.toContain("sensor.lock_battery");
    expect(offered).not.toContain("sensor.vacuum_battery");
    expect(offered).not.toContain("sensor.living_temp");
    expect(offered).not.toContain("sensor.monthly_spent");
  });

  it("brings the picked sensor back when No charging bolt is unticked", async () => {
    const { body, stored } = await chargingRow();
    picker(body).onSelect("sensor.phone_charging");
    await tick();
    expect(stored()).toEqual({ charging__entity: "sensor.phone_charging" });
    const off = (): HTMLInputElement =>
      $(body, 'input[aria-label^="No charging bolt"]') as HTMLInputElement;
    off().checked = true;
    off().dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    // Off is all that is stored: a sensor left beside it would win.
    expect(stored()).toEqual({ charging: "off" });
    off().checked = false;
    off().dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(stored()).toEqual({ charging__entity: "sensor.phone_charging" });
    expect(picker(body).value).toBe("sensor.phone_charging");
  });
});

describe("row list: a category's budget", () => {
  async function category(): Promise<{
    panel: AiviPanel;
    checks: HTMLElement;
    input: () => HTMLInputElement;
    stored: () => string | undefined;
  }> {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    panel.openEditor(
      acc,
      { slug: "spending", name: "Spending", template: "budget", supported: true },
      null,
    );
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "the editor");
    const editor = $(sr(panel), "aivi-editor") as AiviEditor;
    await until(() => editor.editorState.bindings["currency"] === "USD", "defaults");
    editor.editorState.bindings["spent"] = "sensor.monthly_spent";
    editor.applySuggestion();
    await tick();
    const checks = $(editor, '.field[data-key="categories"] aivi-rows-checklist');
    toggle(checks, "sensor.food_spent", true);
    await tick();
    $(checks, ".rowtoggle").click();
    await tick();
    await previewSettled(editor);
    return {
      panel,
      checks,
      input: () => $(checks, 'input[aria-label^="Budget for"]') as HTMLInputElement,
      stored: () =>
        (
          editor.editorState.bindings["categories__options"] as
            | Record<string, Record<string, string>>
            | undefined
        )?.["sensor.food_spent"]?.["budget"],
    };
  }
  const save = (panel: AiviPanel): HTMLButtonElement =>
    $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;

  it("reads a decimal comma as a decimal", async () => {
    const { panel, input, stored } = await category();
    setInput(input(), "1,5");
    await tick();
    // Stored the way Aivi takes an amount; what was typed stays typed.
    expect(stored()).toBe("1.5");
    expect(input().value).toBe("1,5");
    expect(input().getAttribute("aria-invalid")).toBe("false");
    expect(save(panel).disabled).toBe(false);
  });

  it("holds Save and marks the budget, the row and the form for a value Aivi would drop", async () => {
    const { panel, checks, input } = await category();
    expect(save(panel).disabled).toBe(false);
    const name = text($(checks, ".rowtoggle .n"));
    for (const junk of ["abc", "-5", "0", "1,2,3"]) {
      setInput(input(), junk);
      await tick();
      // The control, with the reason under it ...
      expect(input().className).toContain("bad");
      expect(input().getAttribute("aria-invalid")).toBe("true");
      expect(text($(checks, '.rowopts .tnote.error[role="alert"]'))).toBe(
        "Use an amount above 0, like 250 or 99.50.",
      );
      // ... and Save, with the row named.
      expect(save(panel).disabled).toBe(true);
      expect(text($(sr(panel), ".form .rowfix"))).toBe(
        `Fix the options marked in red to save: ${name}.`,
      );
    }
    // The row's header carries the mark, so it shows with the options shut.
    $(checks, ".rowtoggle").click();
    await tick();
    expect(checks.querySelector(".rowopts")).toBeNull();
    const head = $(checks, ".rowtoggle");
    expect(head.className).toContain("bad");
    expect(head.getAttribute("aria-invalid")).toBe("true");
    expect(head.hasAttribute("aria-label")).toBe(false);
    expect(text(head)).toBe(`${name} Fix needed`);
    expect(text($(head, ".rsum.bad"))).toBe("Fix needed");
    // Fixed: every mark goes.
    head.click();
    await tick();
    setInput(input(), "250");
    await tick();
    expect(input().getAttribute("aria-invalid")).toBe("false");
    expect(checks.querySelector(".rowopts .tnote.error")).toBeNull();
    expect($(checks, ".rowtoggle").hasAttribute("aria-invalid")).toBe(false);
    expect(text($(checks, ".rowtoggle .rsum"))).toBe("1 set");
    expect(sr(panel).querySelector(".form .rowfix")).toBeNull();
    expect(save(panel).disabled).toBe(false);
  });
});

describe("row list: styles", () => {
  it("shows a move that cannot happen as unavailable", () => {
    const css = segmentsStyles.cssText;
    expect(css).toMatch(/\.ordrow \.mv:disabled\s*\{[^}]*opacity:\s*\.35;[^}]*cursor:\s*default/);
    // And it does not light up under the pointer.
    expect(css).toContain(".ordrow .mv:hover:not(:disabled)");
  });

  it("gives a phone row's name a line of its own, and a 44 px header", () => {
    const css = responsiveStyles.cssText;
    // Beside the grip and three 44 px buttons the name would have 67 px.
    expect(css).toMatch(/:host\(\[narrow\]\) \.ordhead\s*\{\s*flex-wrap:\s*wrap/);
    expect(css).toMatch(/:host\(\[narrow\]\) \.ordhead \.rowacts\s*\{\s*margin-left:\s*auto/);
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toMatch(/\.ordhead \.rowtoggle\s*\{\s*min-height:\s*44px/);
  });
});

describe("row list: the label a row shows without one of its own", () => {
  /** Open the bind editor for `template`, add `ids` to its `key` field,
   * and read each row's label placeholder and its label in the preview. */
  async function labels(
    kind: "widget" | "activity",
    template: string,
    key: string,
    ids: string[],
  ): Promise<{ placeholders: string[]; previewed: string[] }> {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    const remote = { slug: "naming", name: "Naming", template, supported: true };
    if (kind === "widget") panel.openEditor(acc, remote, null);
    else panel.openActivityEditor(acc, remote, null);
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "the editor");
    const editor = $(sr(panel), "aivi-editor") as AiviEditor;
    const checks = $(editor, `.field[data-key="${key}"] aivi-rows-checklist`);
    for (const id of ids) {
      adder(checks).onSelect(id);
      await tick();
    }
    for (const row of $$(checks, ".rowtoggle")) row.click();
    await tick();
    const placeholders = $$(checks, '.rowopts input[aria-label^="Label"]').map(
      (input) => (input as HTMLInputElement).placeholder,
    );
    // A remote needs its reading before it previews.
    if (template === "remote") editor.editorState.bindings["value"] = "sensor.my_car_charge";
    editor.schedulePreview();
    await until(() => !!editor.editorState.preview, "the preview");
    const rows = editor.editorState.preview?.[key];
    const previewed = Array.isArray(rows)
      ? rows.map((row: { label?: unknown }) => String(row.label))
      : [];
    return { placeholders, previewed };
  }

  const CAR = ["lock.my_car", "climate.my_car", "light.porch"];

  it("names a remote's buttons by their own name, as the integration does", async () => {
    const { placeholders, previewed } = await labels("widget", "remote", "actions", CAR);
    // The car's lock by its own name; its main entity (no name of its
    // own) and the porch light (on no device) by their friendly names.
    expect(placeholders).toEqual(["Lock", "Car climate", "Porch light"]);
    expect(previewed).toEqual(placeholders);
  });

  it("names a Live Activity's buttons the same way", async () => {
    const { placeholders, previewed } = await labels("activity", "remote", "actions", CAR);
    expect(placeholders).toEqual(["Lock", "Car climate", "Porch light"]);
    expect(previewed).toEqual(placeholders);
  });

  it("names a showcase's stats by their own name", async () => {
    const { placeholders, previewed } = await labels("widget", "showcase", "stats", [
      "sensor.my_car_range",
      "sensor.living_temp",
    ]);
    expect(placeholders).toEqual(["Range", "Living room temperature"]);
    expect(previewed).toEqual(placeholders);
  });

  it("keeps the full name on a switchboard, which mixes devices", async () => {
    const { placeholders, previewed } = await labels("widget", "switchboard", "actions", CAR);
    expect(placeholders).toEqual(["Car lock", "Car climate", "Porch light"]);
    expect(previewed).toEqual(placeholders);
  });
});
