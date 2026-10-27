// The searchable entity combobox: filtering by name and id, keyboard
// navigation, picking, clearing, and popup dismissal. Options are derived
// from the harness fixture states.

import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-entity-combobox";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import type { EntityOption } from "../src/types/hass";
import { $, $$, mountPanel, openWidgetEditor, STATES, setInput, sr, text, tick } from "./harness";

const OPTIONS: EntityOption[] = Object.entries(STATES).map(([id, st]) => ({
  id,
  name: st.attributes.friendly_name ?? id,
}));

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(value: string | null = null): Promise<{
  cbx: AiviEntityCombobox;
  input: HTMLInputElement;
  onSelect: ReturnType<typeof vi.fn>;
}> {
  const cbx = document.createElement("aivi-entity-combobox") as AiviEntityCombobox;
  const onSelect = vi.fn();
  cbx.options = OPTIONS;
  cbx.value = value;
  cbx.onSelect = onSelect as unknown as (id: string | null) => void;
  document.body.append(cbx);
  await tick();
  return { cbx, input: $(cbx, "input") as HTMLInputElement, onSelect };
}

function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

/** A pointer press on `el`, as the document's listeners see it. */
function press(el: HTMLElement): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
}

describe("aivi-entity-combobox", () => {
  it("scrolls the arrow-key highlight into view", async () => {
    const { cbx, input } = await mount();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    const seen: string[] = [];
    for (const opt of $$(cbx, ".cbx-pop .opt")) opt.scrollIntoView = () => void seen.push(opt.id);
    key(input, "ArrowDown");
    await tick();
    key(input, "ArrowDown");
    await tick();
    expect(seen.at(-1)).toBe(input.getAttribute("aria-activedescendant"));
    expect(seen.at(-1)).toMatch(/-opt-2$/);
  });

  it("puts the picked entity back when typed text is abandoned", async () => {
    const { cbx, input, onSelect } = await mount("sensor.living_temp");
    setInput(input, "half-typed");
    input.dispatchEvent(new Event("blur"));
    await tick();
    expect(input.value).toBe("Living room temperature");
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clears the pick when the field is emptied and left", async () => {
    const { input, onSelect } = await mount("sensor.living_temp");
    setInput(input, "");
    input.dispatchEvent(new Event("blur"));
    await tick();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("prefills the input with the selected option's name", async () => {
    const { input } = await mount("sensor.living_temp");
    expect(input.value).toBe("Living room temperature");
  });

  it("opens on focus with the full list, filters as you type", async () => {
    const { cbx, input } = await mount();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    expect($$(cbx, ".cbx-pop .opt")).toHaveLength(OPTIONS.length);
    setInput(input, "battery");
    await tick();
    const opts = $$(cbx, ".cbx-pop .opt");
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => text($(o, ".eid")))).toEqual([
      "sensor.vacuum_battery",
      "sensor.lock_battery",
      "sensor.doorbell_battery",
      "sensor.phone_battery",
    ]);
  });

  it("also matches on the entity id", async () => {
    const { cbx, input } = await mount();
    setInput(input, "input_number");
    await tick();
    const opts = $$(cbx, ".cbx-pop .opt");
    expect(opts).toHaveLength(1);
    expect(text(opts[0]!)).toContain("Washer progress");
  });

  it("says so when nothing matches", async () => {
    const { cbx, input } = await mount();
    setInput(input, "zzz-nothing");
    await tick();
    expect(text($(cbx, ".cbx-pop .none"))).toBe("No matching entities");
  });

  it("navigates with arrows and picks with Enter", async () => {
    const { cbx, input, onSelect } = await mount();
    setInput(input, "battery");
    await tick();
    key(input, "ArrowDown");
    key(input, "Enter");
    await tick();
    expect(onSelect).toHaveBeenCalledWith("sensor.lock_battery");
    expect(input.value).toBe("Door lock battery");
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
  });

  it("picks on mousedown without stealing focus", async () => {
    const { cbx, input, onSelect } = await mount();
    setInput(input, "vacuum");
    await tick();
    $(cbx, ".cbx-pop .opt").dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    await tick();
    expect(onSelect).toHaveBeenCalledWith("sensor.vacuum_battery");
  });

  it("Escape and outside presses close the popup", async () => {
    const { cbx, input } = await mount();
    setInput(input, "b");
    await tick();
    key(input, "Escape");
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    expect(cbx.querySelector(".cbx-pop")).not.toBeNull();
    press(document.body);
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
  });

  it("stays open for a press inside it when the panel is a shadow root", async () => {
    // The document sees a press inside a shadow root retargeted to the
    // host, so "is the target inside me" cannot go by the event target: a
    // mouse or touch pick must not close the list a `picker` keeps open.
    const host = document.createElement("div");
    document.body.append(host);
    const cbx = document.createElement("aivi-entity-combobox") as AiviEntityCombobox;
    const onSelect = vi.fn();
    cbx.options = OPTIONS;
    cbx.picker = true;
    cbx.onSelect = onSelect as unknown as (id: string | null) => void;
    host.attachShadow({ mode: "open" }).append(cbx);
    await tick();
    $(cbx, "input").dispatchEvent(new Event("focus"));
    await tick();
    const option = $(cbx, ".cbx-pop .opt");
    press(option);
    option.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true }),
    );
    await tick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(cbx.querySelector(".cbx-pop")).not.toBeNull();
    // A press elsewhere in the same shadow root is still outside.
    const other = document.createElement("button");
    host.shadowRoot!.append(other);
    press(other);
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
  });

  it("a row list's add picker stays open after a pointer pick", async () => {
    // The same, through the real panel: pick a battery with the mouse and
    // the picker keeps offering the rest.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    const adder = $(sr(panel), "aivi-entity-combobox.rowadd");
    $(adder, "input").dispatchEvent(new Event("focus"));
    await tick();
    const option = $(adder, ".cbx-pop .opt");
    press(option);
    option.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true }),
    );
    await tick();
    expect(editor.editorState.bindings["devices"]).toHaveLength(1);
    expect($$(adder, ".cbx-pop .opt")).toHaveLength(3);
  });

  it("reopens on a press when it already has focus", async () => {
    // After a pick or Escape the input keeps focus, so no focus event
    // comes: a press opens the list again, as typing or ArrowDown do.
    const { cbx, input } = await mount("sensor.living_temp");
    input.dispatchEvent(new Event("focus"));
    await tick();
    key(input, "Escape");
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
    input.click();
    await tick();
    // Everything is offered: the text is the picked name, not a search.
    expect($$(cbx, ".cbx-pop .opt")).toHaveLength(OPTIONS.length);
  });

  it("ArrowDown on a closed list offers everything, not just the pick", async () => {
    // The input's text is the picked entity's name; filtering by it would
    // leave one option, the one already picked.
    const { cbx, input } = await mount("sensor.living_temp");
    key(input, "ArrowDown");
    await tick();
    expect($$(cbx, ".cbx-pop .opt")).toHaveLength(OPTIONS.length);
  });

  it("matches every typed word, in any order, ignoring stray spaces", async () => {
    const { cbx, input } = await mount();
    const ids = (): string[] => $$(cbx, ".cbx-pop .opt").map((o) => text($(o, ".eid")));
    setInput(input, "battery lock");
    await tick();
    expect(ids()).toEqual(["sensor.lock_battery"]);
    // A word can match the name and another the id.
    setInput(input, "  door   sensor.lock ");
    await tick();
    expect(ids()).toEqual(["sensor.lock_battery"]);
    setInput(input, " ");
    await tick();
    expect(ids()).toHaveLength(OPTIONS.length);
  });

  it("says so when the list is cut short", async () => {
    const { cbx, input } = await mount();
    cbx.options = Array.from({ length: 100 }, (_, i) => ({
      id: `sensor.s${i}`,
      name: `Sensor ${i}`,
    }));
    input.dispatchEvent(new Event("focus"));
    await tick();
    expect($$(cbx, ".cbx-pop .opt")).toHaveLength(60);
    // Outside the listbox, which may only hold options.
    expect(text($(cbx, ".cbx-pop > .more"))).toBe("Showing 60 of 100. Type to narrow the list.");
    setInput(input, "sensor 9");
    await tick();
    expect(cbx.querySelector(".cbx-pop .more")).toBeNull();
  });

  it("opens from the trailing edge, or upwards, when it would leave the view", async () => {
    // Inside a fold the input is short and the list wider than it.
    const { cbx, input } = await mount();
    const rect = (r: Partial<DOMRect>): DOMRect => ({ ...new DOMRect(), ...r }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("cbx-pop")
        ? rect({ height: 240, width: 280, right: window.innerWidth + 40 })
        : rect({
            top: window.innerHeight - 60,
            bottom: window.innerHeight - 20,
            right: window.innerWidth - 10,
          });
    });
    input.dispatchEvent(new Event("focus"));
    await tick();
    const pop = $(cbx, ".cbx-pop");
    expect(pop.classList.contains("end")).toBe(true);
    expect(pop.classList.contains("up")).toBe(true);
    vi.restoreAllMocks();
  });

  it("ArrowDown reopens a closed popup and ArrowUp walks back up", async () => {
    const { cbx, input, onSelect } = await mount();
    setInput(input, "battery");
    await tick();
    key(input, "Escape");
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
    key(input, "ArrowDown");
    await tick();
    expect(cbx.querySelector(".cbx-pop")).not.toBeNull();
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    key(input, "ArrowUp");
    key(input, "Enter");
    await tick();
    expect(onSelect).toHaveBeenCalledWith("sensor.lock_battery");
  });

  it("Enter with no matches picks nothing", async () => {
    const { input, onSelect } = await mount();
    setInput(input, "zzz-nothing");
    await tick();
    key(input, "Enter");
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clears the selection and reopens for a new search", async () => {
    const { cbx, input, onSelect } = await mount("sensor.living_temp");
    $(cbx, "button.clear").click();
    await tick();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(input.value).toBe("");
    expect(cbx.querySelector(".cbx-pop")).not.toBeNull();
  });
});
