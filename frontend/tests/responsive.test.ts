// Narrow-mode behavior: the panel reflects the host-assigned
// `narrow` property as an attribute (the stylesheet's structural signal),
// the editor's bottom mini-preview sheet expands/collapses in place
// without rebuilding the form or moving focus, and comboboxes scroll
// their field into view on narrow for the on-screen keyboard.

import { afterEach, describe, expect, it, vi } from "vitest";
import { $, mountPanel, openWidgetEditor, previewSettled, sr, text, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("narrow reflection", () => {
  it("reflects the narrow host property as a host attribute", async () => {
    const panel = await mountPanel();
    expect(panel.hasAttribute("narrow")).toBe(false);
    panel.narrow = true;
    await tick();
    expect(panel.hasAttribute("narrow")).toBe(true);
    panel.narrow = false;
    await tick();
    expect(panel.hasAttribute("narrow")).toBe(false);
  });
});

describe("mini-preview sheet", () => {
  it("starts collapsed and expands/collapses on the toggle", async () => {
    const panel = await mountPanel();
    panel.narrow = true;
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    const root = sr(panel);
    const toggle = $(root, ".pvtoggle");
    const side = $(root, ".side");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(side.classList.contains("open")).toBe(false);
    toggle.click();
    await tick();
    expect($(root, ".pvtoggle").getAttribute("aria-expanded")).toBe("true");
    expect($(root, ".side").classList.contains("open")).toBe(true);
    // The payload JSON stays reachable from the expanded sheet.
    expect(root.querySelector(".side details.payload")).not.toBeNull();
    $(root, ".pvtoggle").click();
    await tick();
    expect($(root, ".side").classList.contains("open")).toBe(false);
  });

  it("toggles in place: same pane node, focus untouched", async () => {
    const panel = await mountPanel();
    panel.narrow = true;
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    const root = sr(panel);
    const pane = $(root, "aivi-preview-pane");
    const input = $(root, ".form .cbx input");
    input.focus();
    expect(root.activeElement).toBe(input);
    $(root, ".pvtoggle").click();
    await tick();
    // The re-render updated the sheet in place: the pane element (and its
    // memoized preview DOM) survives, and focus never moved.
    expect($(root, "aivi-preview-pane")).toBe(pane);
    expect(root.activeElement).toBe(input);
  });

  it("shows how many required fields are left on the collapsed bar", async () => {
    const panel = await mountPanel();
    panel.narrow = true;
    // Laundry is unbound: its required progress field is not set yet.
    const editor = await openWidgetEditor(panel, "laundry");
    await previewSettled(editor);
    expect(text($(sr(panel), ".pvtoggle .n"))).toBe("1 to set");
    // Frontdoor is bound: nothing missing, no badge.
    panel.closeEditor();
    await tick();
    const ed2 = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(ed2);
    expect(sr(panel).querySelector(".pvtoggle .n")).toBeNull();
  });
});

describe("combobox on narrow", () => {
  it("scrolls the field into view on focus only in narrow mode", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    const root = sr(panel);
    const cbx = $(root, ".form aivi-entity-combobox");
    const spy = vi.fn();
    (cbx as { scrollIntoView: (o?: object) => void }).scrollIntoView = spy;
    const input = $(cbx, "input");
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    expect(spy).not.toHaveBeenCalled(); // wide: no keyboard to dodge
    panel.narrow = true;
    await tick();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    await tick();
    expect(spy).toHaveBeenCalledWith({ block: "start" });
  });
});
