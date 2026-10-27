// The entity combobox's accessibility contract: the APG editable-combobox
// pattern with aria-activedescendant.

import { afterEach, describe, expect, it } from "vitest";
import "../src/aivi-entity-combobox";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import type { EntityOption } from "../src/types/hass";
import { $, $$, key, STATES, setInput, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

const OPTIONS: EntityOption[] = Object.entries(STATES).map(([id, st]) => ({
  id,
  name: st.attributes.friendly_name ?? id,
}));

async function mountCbx(): Promise<{
  cbx: AiviEntityCombobox;
  input: HTMLInputElement;
}> {
  const cbx = document.createElement("aivi-entity-combobox") as AiviEntityCombobox;
  cbx.options = OPTIONS;
  cbx.label = "State";
  document.body.append(cbx);
  await tick();
  return { cbx, input: $(cbx, "input") as HTMLInputElement };
}

describe("combobox roles and states", () => {
  it("exposes the combobox role, name, and expanded state", async () => {
    const { cbx, input } = await mountCbx();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-label")).toBe("State");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    // aria-controls points at the popup's list, a named listbox of
    // options (the popup around it also holds the "more" line).
    const list = $(cbx, ".cbx-pop > [role=listbox]");
    expect(list.id).toBe(input.getAttribute("aria-controls"));
    expect(list.getAttribute("aria-label")).toBe("State");
    expect($$(cbx, ".cbx-pop .opt").every((o) => o.getAttribute("role") === "option" && o.id)).toBe(
      true,
    );
  });

  it("moves aria-activedescendant with the highlight, a page at a time too", async () => {
    const { cbx, input } = await mountCbx();
    setInput(input, "battery");
    await tick();
    const opts = $$(cbx, ".cbx-pop .opt");
    expect(input.getAttribute("aria-activedescendant")).toBe(opts[0]!.id);
    key(input, "ArrowDown");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBe($$(cbx, ".cbx-pop .opt")[1]!.id);
    key(input, "PageDown");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBe($$(cbx, ".cbx-pop .opt")[3]!.id);
    key(input, "PageUp");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBe($$(cbx, ".cbx-pop .opt")[0]!.id);
  });

  it("leaves Home and End to the text, where they move the caret", async () => {
    // APG: in an editable combobox these keys belong to the input. They
    // are not taken while the list is open, so the caret can move.
    const { cbx, input } = await mountCbx();
    setInput(input, "battery");
    await tick();
    key(input, "ArrowDown");
    await tick();
    const at = input.getAttribute("aria-activedescendant");
    for (const name of ["Home", "End"]) {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented, name).toBe(false);
    }
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBe(at);
    expect(cbx.querySelector(".cbx-pop")).not.toBeNull();
  });

  it("never points aria-activedescendant at an option that is not there", async () => {
    const { cbx, input } = await mountCbx();
    // ArrowUp over no matches names no option.
    setInput(input, "zzz-nothing");
    await tick();
    key(input, "ArrowUp");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    // The options can shrink under an open popup (a row list's picker
    // loses what was just picked).
    setInput(input, "battery");
    await tick();
    key(input, "PageDown");
    await tick();
    cbx.options = OPTIONS.filter((o) => o.id === "sensor.lock_battery");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("marks the bound option aria-selected", async () => {
    const { cbx, input } = await mountCbx();
    cbx.value = "sensor.lock_battery";
    setInput(input, "battery");
    await tick();
    const selected = $$(cbx, ".cbx-pop .opt").filter(
      (o) => o.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(text(selected[0]!)).toContain("sensor.lock_battery");
  });

  it("renders no-matches as a status line, never a childless listbox", async () => {
    const { cbx, input } = await mountCbx();
    setInput(input, "zzz-nothing");
    await tick();
    expect(cbx.querySelector(".cbx-pop [role=listbox]")).toBeNull();
    expect($(cbx, ".cbx-pop > [role=status]").id).toBe(input.getAttribute("aria-controls"));
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("closes the popup when Tab moves focus on", async () => {
    const { cbx, input } = await mountCbx();
    setInput(input, "battery");
    await tick();
    key(input, "Tab");
    await tick();
    expect(cbx.querySelector(".cbx-pop")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});
