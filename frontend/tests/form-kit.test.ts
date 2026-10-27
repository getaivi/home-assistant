// The form kit: the color field's popover (pick, reset, hex, keyboard,
// outside press) and the fold's remembered state. Colors come from the
// generated META palette.

import { readFileSync } from "node:fs";
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-color-field";
import "../src/aivi-swatches";
import type { AiviColorField } from "../src/aivi-color-field";
import { FoldState, fold, option } from "../src/form-kit";
import { $, $$, META, openColor, setInput, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

async function mount(
  props: Partial<AiviColorField> = {},
): Promise<{ el: AiviColorField; onChange: ReturnType<typeof vi.fn> }> {
  const el = document.createElement("aivi-color-field") as AiviColorField;
  const onChange = vi.fn();
  el.colors = META.colors;
  el.label = "Accent color";
  el.onChange = onChange;
  Object.assign(el, props);
  document.body.append(el);
  await tick();
  return { el, onChange };
}

function key(el: HTMLElement, name: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

describe("aivi-color-field", () => {
  it("is one button naming the pick; the palette waits in a popover", async () => {
    const { el } = await mount();
    const button = $(el, ".cfbtn");
    expect(text($(el, ".cfname"))).toBe("Default");
    expect(button.getAttribute("aria-label")).toBe("Accent color: Default");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".cfpop")).toBeNull();
    const pop = await openColor(el);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(pop.getAttribute("role")).toBe("dialog");
    expect($$(pop, "button.sw")).toHaveLength(META.colors.length);
    // No hex unless the field says Aivi takes it.
    expect(pop.querySelector(".cfhex")).toBeNull();
    // Opening moves focus into the popover: its first control...
    expect(document.activeElement).toBe($(pop, ".cfnone"));
    document.body.innerHTML = "";
    // ...or the picked dot, when there is one.
    const picked = await mount({ value: "teal" });
    const teal = $(await openColor(picked.el), 'button[title="Teal"]');
    expect(document.activeElement).toBe(teal);
  });

  it("picks, names the pick, closes and returns focus", async () => {
    const { el, onChange } = await mount();
    $(await openColor(el), 'button[title="Mint"]').click();
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("mint");
    expect(text($(el, ".cfname"))).toBe("Mint");
    expect(el.querySelector(".cfpop")).toBeNull();
    expect(document.activeElement).toBe($(el, ".cfbtn"));
    // Default resets it.
    $(await openColor(el), ".cfnone").click();
    await tick();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(text($(el, ".cfname"))).toBe("Default");
  });

  it("keeps a required color when its own dot is pressed again", async () => {
    const { el, onChange } = await mount({ value: "red", clearable: false });
    const pop = await openColor(el);
    expect(pop.querySelector(".cfnone")).toBeNull();
    $(pop, 'button[title="Red"]').click();
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(el.value).toBe("red");
    expect(el.querySelector(".cfpop")).toBeNull();
  });

  it("takes a hex color where Aivi does, and flags one that is not", async () => {
    const { el, onChange } = await mount({ hex: true });
    const hex = (pop: HTMLElement): HTMLElement => $(pop, 'input[aria-label$="hex code"]');
    setInput(hex(await openColor(el)), "#12");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("#12");
    expect(text(el)).toContain("Use a hex code like #FFD27A.");
    expect(hex($(el, ".cfpop")).getAttribute("aria-invalid")).toBe("true");
    setInput(hex($(el, ".cfpop")), "#ffd27a");
    await tick();
    // Typing keeps the popover open, and the button shows the color.
    expect(el.querySelector(".cfpop")).not.toBeNull();
    expect(text($(el, ".cfname"))).toBe("#FFD27A");
    expect(el.querySelector(".tnote")).toBeNull();
    // The picker writes the same form Aivi stores.
    const picker = $(el, 'input[type="color"]') as HTMLInputElement;
    picker.value = "#00ff00";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("#00FF00");
    // Emptied: back to the default.
    setInput(hex($(el, ".cfpop")), "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("closes on Escape (focus back) and on a press outside", async () => {
    const { el } = await mount();
    key(await openColor(el), "Escape");
    await tick();
    expect(el.querySelector(".cfpop")).toBeNull();
    expect(document.activeElement).toBe($(el, ".cfbtn"));
    await openColor(el);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await tick();
    expect(el.querySelector(".cfpop")).toBeNull();
    // A press inside the popover is not "outside".
    const pop = await openColor(el);
    pop.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await tick();
    expect(el.querySelector(".cfpop")).not.toBeNull();
    // The button toggles.
    $(el, ".cfbtn").click();
    await tick();
    expect(el.querySelector(".cfpop")).toBeNull();
  });
});

describe("aivi-color-field popover and hex box", () => {
  const hex = (el: HTMLElement): HTMLInputElement =>
    $(el, 'input[aria-label$="hex code"]') as HTMLInputElement;

  it("closes when focus moves out of it, so one popover is open at a time", async () => {
    // A press outside is not the only way to close it: Tab closes it too,
    // so opening the next field by keyboard never leaves two open at once.
    const a = (await mount()).el;
    const b = (await mount()).el;
    await openColor(a);
    $(b, ".cfbtn").focus();
    await tick();
    expect(a.querySelector(".cfpop")).toBeNull();
    $(b, ".cfbtn").click();
    await tick();
    expect(b.querySelector(".cfpop")).not.toBeNull();
    // Focus moving within the popover is not leaving.
    $$(b, ".cfpop .sw")[3]!.focus();
    await tick();
    expect(b.querySelector(".cfpop")).not.toBeNull();
  });

  it("opens a custom color on its picker, not on Default", async () => {
    // Focus must not land on the first button, Default: a second Enter,
    // the key that opened the popover, would clear the color.
    const { el } = await mount({ hex: true, value: "#FFD27A" });
    const pop = await openColor(el);
    expect(document.activeElement).toBe($(pop, 'input[type="color"]'));
    expect(document.activeElement).not.toBe($(pop, ".cfnone"));
  });

  it("opens text that is not a color on the box it can be fixed in", async () => {
    const { el } = await mount({ hex: true, value: "#12" });
    const box = hex(await openColor(el));
    expect(document.activeElement).toBe(box);
  });

  it("marks a value that is not a color on the button, popover closed", async () => {
    // The error shows outside the popover too: when it is closed, the
    // button carries the mark and the note that the color is not valid.
    const { el } = await mount({ hex: true, value: "#12" });
    const button = $(el, ".cfbtn");
    expect(button.classList.contains("bad")).toBe(true);
    const note = $(el, ".tnote.error");
    expect(text(note)).toBe("Use a hex code like #FFD27A.");
    expect(button.getAttribute("aria-describedby")).toBe(note.id);
    // Open, the one note moves into the popover, on the hex box.
    const pop = await openColor(el);
    expect($$(el, ".tnote.error")).toHaveLength(1);
    expect(hex(pop).getAttribute("aria-describedby")).toBe($(pop, ".tnote.error").id);
    // Fixed: unmarked.
    setInput(hex(pop), "#123456");
    await tick();
    expect($(el, ".cfbtn").classList.contains("bad")).toBe(false);
    expect(el.querySelector(".tnote")).toBeNull();
  });

  it("reads hex the way people type it, and stores Aivi's form", async () => {
    const { el, onChange } = await mount({ hex: true });
    const box = hex(await openColor(el));
    // No #, lowercase: the same color as a picked one.
    setInput(box, "ff8800");
    expect(onChange).toHaveBeenLastCalledWith("#FF8800");
    // Three digits are the six they stand for.
    setInput(box, "#abc");
    expect(onChange).toHaveBeenLastCalledWith("#AABBCC");
    await tick();
    // While the user is typing in the box, storing never rewrites it.
    expect(hex(el).value).toBe("#abc");
    expect(el.querySelector(".tnote")).toBeNull();
    // Done typing (the box's change event): it shows what was stored.
    hex(el).dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(hex(el).value).toBe("#AABBCC");
  });

  it("takes a palette name typed in the hex box without emptying it", async () => {
    const { el, onChange } = await mount({ hex: true });
    const box = hex(await openColor(el));
    setInput(box, "Teal");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("teal");
    expect(hex(el).value).toBe("Teal");
    expect($(el, 'button[title="Teal"]').classList.contains("sel")).toBe(true);
    expect(el.querySelector(".tnote")).toBeNull();
  });

  it("gives touch a 44px target for Default, the picker and the clear button", () => {
    // Without the rule a phone measures Default at 88x40, the color input
    // at 40x36 and the combobox's clear button at 42x38.
    const coarse = (file: string): string => {
      const css = readFileSync(`frontend/src/styles/${file}`, "utf8");
      return css.slice(css.indexOf("@media (pointer: coarse)"));
    };
    expect(coarse("kit.ts")).toMatch(/\.cfnone \{ min-height: 44px; \}/);
    expect(coarse("kit.ts")).toMatch(
      /\.cfhex input\[type=color\] \{ width: 44px; height: 44px; \}/,
    );
    expect(coarse("responsive.ts")).toMatch(
      /\.cbx \.clear \{[^}]*min-width: 44px; min-height: 44px;/,
    );
  });
});

describe("fold", () => {
  it("decides a fold's default once, then follows the user", () => {
    const state = new FoldState();
    expect(state.open("row:picture", () => true)).toBe(true);
    // A later render with another default doesn't change the first answer.
    expect(state.open("row:picture", () => false)).toBe(true);
    state.set("row:picture", false);
    expect(state.open("row:picture", () => true)).toBe(false);
    state.drop("row:");
    expect(state.open("row:picture", () => true)).toBe(true);
  });

  it("shows the title and, when something is set, a summary of it", () => {
    const onToggle = vi.fn();
    const draw = (summary: string | null): void => {
      render(
        fold({
          title: "Picture",
          summary,
          open: false,
          onToggle,
          body: option("Picture URL", html`<input type="text" />`, "A public address"),
        }),
        document.body,
      );
    };
    draw(null);
    const details = $(document.body, "details.fold") as HTMLDetailsElement;
    expect(text($(details, ".ft"))).toBe("Picture");
    expect(details.querySelector(".fsum")).toBeNull();
    expect(text($(details, ".ctl .k"))).toBe("Picture URL");
    expect(text($(details, ".ctl .fhint"))).toBe("A public address");
    draw("From a URL");
    expect(text($(details, ".fsum"))).toBe("From a URL");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });
});
