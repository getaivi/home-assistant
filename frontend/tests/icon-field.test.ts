// The icon picker: Apple's symbol index, searched by name and keyword,
// narrowed by category, any name accepted as typed.

import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-icon-field";
import type { AiviIconField } from "../src/aivi-icon-field";
import { loadSymbols, resetSymbols, searchSymbols, symbolsUrl } from "../src/sf-symbols";
import { $, $$, mountPanel, openWidgetEditor, setInput, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  resetSymbols();
});

async function mount(
  value: string | null = null,
): Promise<{ el: AiviIconField; onChange: ReturnType<typeof vi.fn> }> {
  const el = document.createElement("aivi-icon-field") as AiviIconField;
  const onChange = vi.fn();
  el.value = value;
  el.label = "Icon";
  el.onChange = onChange;
  document.body.append(el);
  await tick();
  return { el, onChange };
}

function key(el: HTMLElement, name: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

describe("the symbol index", () => {
  it("is Apple's: thousands of well-formed names with the iOS version each needs", async () => {
    const index = await loadSymbols();
    expect(index.symbols.length).toBeGreaterThan(5000);
    expect(index.categories).toContain("home");
    for (const s of index.symbols.slice(0, 500)) {
      expect(s.name).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)*$/);
      expect(s.ios).toMatch(/^\d+\.\d+$/);
    }
    // Trademark-restricted and localized variants are left out.
    expect(index.symbols.find((s) => s.name === "xmark.icloud.fill")).toBeUndefined();
    expect(index.symbols.find((s) => s.name.endsWith(".ar"))).toBeUndefined();
    // Loaded once.
    expect(await loadSymbols()).toBe(index);
    expect(symbolsUrl()).toContain("sf-symbols.json?v=");
  });

  it("searches by name first, then by keyword, within a category", async () => {
    const index = await loadSymbols();
    const names = (q: string, cat = -1): string[] =>
      searchSymbols(index, q, cat, 8).map((s) => s.name);
    expect(names("washer")[0]).toBe("washer");
    expect(names("washer")).toContain("washer.fill");
    // A keyword Apple attached, not part of the name: "light" finds the
    // chandelier.
    const byTerm = searchSymbols(index, "light", -1, 200);
    expect(byTerm.some((s) => s.name === "chandelier")).toBe(true);
    const home = index.categories.indexOf("home");
    expect(searchSymbols(index, "", home, 20).every((s) => s.categories.includes(home))).toBe(true);
    expect(names("zzzz")).toEqual([]);
  });
});

describe("aivi-icon-field", () => {
  it("opens the picker on focus, picks a symbol, and keeps any typed name", async () => {
    const { el, onChange } = await mount();
    const input = $(el, "input") as HTMLInputElement;
    expect(input.getAttribute("role")).toBe("combobox");
    input.dispatchEvent(new Event("focus"));
    await tick();
    expect(el.querySelector(".icpop")).toBeTruthy();
    await until(() => !!el.querySelector(".iclist"), "the index");
    setInput(input, "washer");
    await tick();
    const options = (): HTMLElement[] => $$(el, ".icopt");
    expect(text($(options()[0]!, ".icname"))).toBe("washer");
    expect(text($(options()[0]!, ".icios"))).toBe("iOS 16.0+");
    // Typing already holds the name; a pick replaces it with the symbol's.
    expect(onChange).toHaveBeenLastCalledWith("washer");
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    await tick();
    expect(input.getAttribute("aria-activedescendant")).toContain("-opt-1");
    key(input, "Enter");
    await tick();
    expect(el.value).toMatch(/^washer/);
    expect(onChange).toHaveBeenLastCalledWith(el.value);
    expect(el.querySelector(".icpop")).toBeNull();
    expect(input.value).toBe(el.value);
    // Any name is accepted as typed: Enter with nothing highlighted closes.
    setInput(input, "figure.surfing");
    await tick();
    key(input, "Enter");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("figure.surfing");
    expect(el.querySelector(".icpop")).toBeNull();
  });

  it("narrows by category, and says how the preview draws a symbol", async () => {
    const { el } = await mount();
    const input = $(el, "input");
    input.dispatchEvent(new Event("focus"));
    await until(() => !!el.querySelector(".iclist"), "the index");
    const chips = $$(el, ".iccats .fchip");
    expect(chips[0]!.textContent).toBe("All");
    const home = chips.find((c) => c.textContent === "Home")!;
    home.click();
    await tick();
    expect(home.getAttribute("aria-pressed")).toBe("true");
    expect($$(el, ".icopt").length).toBeGreaterThan(10);
    expect(text($(el, ".ichelp"))).toContain("a similar icon");
  });

  /** An icon field inside a shadow root, as it is in the panel, opened
   * with the index loaded. */
  async function opened(value: string | null = null): Promise<{
    el: AiviIconField;
    input: HTMLInputElement;
    onChange: ReturnType<typeof vi.fn>;
  }> {
    const host = document.createElement("div");
    document.body.append(host);
    const el = document.createElement("aivi-icon-field") as AiviIconField;
    const onChange = vi.fn();
    el.value = value;
    el.label = "Icon";
    el.onChange = onChange;
    host.attachShadow({ mode: "open" }).append(el);
    await tick();
    const input = $(el, "input") as HTMLInputElement;
    input.focus();
    await until(() => !!el.querySelector(".iclist"), "the index");
    return { el, input, onChange };
  }

  /** A pointer press and the click it ends in, as the document sees them. */
  function pressAndClick(el: HTMLElement): void {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, composed: true, cancelable: true }),
    );
    el.click();
  }

  it("a category chip narrows the list when pressed inside the panel", async () => {
    // The outside-press listener sees the press retargeted to the panel;
    // it must not take it for outside and remove the chip before its click.
    const { el } = await opened();
    const home = $$(el, ".iccats .fchip").find((c) => c.textContent === "Home")!;
    pressAndClick(home);
    await tick();
    expect(el.querySelector(".icpop")).not.toBeNull();
    expect(home.isConnected).toBe(true);
    expect(home.getAttribute("aria-pressed")).toBe("true");
    // A press outside the field still closes it.
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await tick();
    expect(el.querySelector(".icpop")).toBeNull();
  });

  it("stores the symbol the typed text names, the way the search reads it", async () => {
    // The search lowercases and dots what is typed, so "bolt fill" finds
    // bolt.fill; the binding stores that, as no phone can draw "bolt fill".
    const { el, input, onChange } = await opened();
    setInput(input, "bolt fill");
    expect(onChange).toHaveBeenLastCalledWith("bolt.fill");
    setInput(input, "Bolt");
    expect(onChange).toHaveBeenLastCalledWith("bolt");
    // The text stays as typed while the user types; it shows what was
    // stored once the picker closes.
    setInput(input, " Bolt  Fill ");
    expect(input.value).toBe(" Bolt  Fill ");
    key(input, "Enter");
    await tick();
    expect(el.value).toBe("bolt.fill");
    expect(input.value).toBe("bolt.fill");
  });

  it("reads text typed before the index arrived once it does", async () => {
    const { el, onChange } = await mount();
    const input = $(el, "input") as HTMLInputElement;
    setInput(input, "Bolt Fill");
    expect(onChange).toHaveBeenLastCalledWith("Bolt Fill");
    await until(() => !!el.querySelector(".iclist"), "the index");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("bolt.fill");
  });

  it("keeps a name no symbol has, and says it is not one of Apple's", async () => {
    // Free text is allowed (the index can be older than the phone), so
    // "doo" then Escape keeps the name, with a note that it is no symbol.
    const { el, input, onChange } = await opened();
    setInput(input, "doo");
    key(input, "Escape");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith("doo");
    const note = $(el, ".fhint");
    expect(text(note)).toBe("Not a name in Apple's symbol list. It is kept as typed.");
    expect(input.getAttribute("aria-describedby")).toBe(note.id);
    // A real symbol clears it.
    setInput(input, "door.left.hand.open");
    key(input, "Escape");
    await tick();
    expect(el.querySelector(".fhint")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("leaves a stored name alone until it is typed over", async () => {
    // Opening the picker must not rewrite what was saved (and make the
    // editor dirty): only typing stores.
    const { el, onChange } = await opened("Bolt");
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    expect(el.value).toBe("Bolt");
  });

  it("lets Tab into the chips and the list, and closes when focus leaves", async () => {
    // Tab does not close the popup, so the chips and the scrolling list
    // can be reached without a pointer.
    const { el, input } = await opened();
    key(input, "Tab");
    await tick();
    expect(el.querySelector(".icpop")).not.toBeNull();
    const chip = $(el, ".iccats .fchip");
    chip.focus();
    await tick();
    expect(el.querySelector(".icpop")).not.toBeNull();
    // Enter on a chip acts on the chip and never picks a symbol.
    key(chip, "Enter");
    await tick();
    expect(el.querySelector(".icpop")).not.toBeNull();
    const list = $(el, ".iclist");
    list.focus();
    await tick();
    // Tabbed into, the list has an option to act on, and says which.
    expect(list.getAttribute("aria-activedescendant")).toBe($$(el, ".icopt")[0]!.id);
    key(list, "ArrowDown");
    await tick();
    expect(list.getAttribute("aria-activedescendant")).toBe($$(el, ".icopt")[1]!.id);
    // Focus moving out of the field closes the popup.
    const next = document.createElement("button");
    el.getRootNode().appendChild(next);
    next.focus();
    await tick();
    expect(el.querySelector(".icpop")).toBeNull();
  });

  it("returns focus to the input on a pick or Escape from inside the popup", async () => {
    const { el, input, onChange } = await opened();
    const root = el.getRootNode() as ShadowRoot;
    const list = $(el, ".iclist");
    list.focus();
    await tick();
    const first = text($($$(el, ".icopt")[0]!, ".icname"));
    key(list, "Enter");
    await tick();
    expect(onChange).toHaveBeenLastCalledWith(first);
    // Focus is back in the input, and that did not open the popup again.
    expect(root.activeElement).toBe(input);
    expect(el.querySelector(".icpop")).toBeNull();
    // A press on the focused input opens it again.
    input.click();
    await tick();
    const chip = $(el, ".iccats .fchip");
    chip.focus();
    key(chip, "Escape");
    await tick();
    expect(root.activeElement).toBe(input);
    expect(el.querySelector(".icpop")).toBeNull();
  });

  it("tries the index again on the next open after a failed load", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    try {
      const { el } = await mount();
      const input = $(el, "input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));
      await until(
        () => !!el.querySelector(".icnote")?.textContent?.includes("couldn't be loaded"),
        "the failure",
      );
      // Typing while it is open doesn't hammer the server.
      const calls = vi.fn(() => Promise.reject(new Error("offline")));
      globalThis.fetch = calls as unknown as typeof fetch;
      setInput(input, "bolt");
      await tick();
      expect(calls).not.toHaveBeenCalled();
      key(input, "Escape");
      await tick();
      globalThis.fetch = real;
      input.click();
      await until(() => !!el.querySelector(".iclist"), "the index, second try");
      expect(el.querySelector(".icnote")).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });

  it("opens upwards when there is no room under the input", async () => {
    const { el } = await mount();
    const rect = (r: Partial<DOMRect>): DOMRect => ({ ...new DOMRect(), ...r }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("icpop")
        ? rect({ height: 400, width: 300, right: 300 })
        : rect({ top: window.innerHeight - 100, bottom: window.innerHeight - 60, right: 300 });
    });
    $(el, "input").dispatchEvent(new Event("focus"));
    await until(() => !!el.querySelector(".iclist"), "the index");
    expect($(el, ".icpop").classList.contains("up")).toBe(true);
    vi.restoreAllMocks();
  });

  it("is the icon control at the top level and in a row's options", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const field = $(editor, 'aivi-field-row[data-key="icon"] aivi-icon-field');
    setInput($(field, "input"), "door.left.hand.open");
    expect(editor.editorState.bindings["icon"]).toBe("door.left.hand.open");
    expect(sr(panel).querySelector("datalist")).toBeNull();
  });
});
