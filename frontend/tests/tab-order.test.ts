// Tab order per view: everything reachable, in reading order. A snapshot
// of the focusable sequence: when it changes, the keyboard path changed.

import { afterEach, describe, expect, it } from "vitest";
import { $, mountPanel, openWidgetEditor, sr, text } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Focusable elements in DOM order, described by their accessible handle. */
function tabOrder(root: ParentNode): string[] {
  const els = [
    ...root.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, summary, [tabindex]",
    ),
  ];
  return els
    .filter(
      (el) =>
        el.getAttribute("tabindex") !== "-1" &&
        !(el as HTMLButtonElement).disabled &&
        // A closed dialog's contents are not rendered, so not reachable.
        !el.closest("dialog:not([open])"),
    )
    .map((el) => {
      // Approximate the accessible name: aria-label, else the visible
      // text minus aria-hidden decorations, else placeholder/title.
      const clone = el.cloneNode(true) as HTMLElement;
      for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
      const name =
        el.getAttribute("aria-label") ??
        (text(clone) || el.getAttribute("placeholder") || el.getAttribute("title") || "");
      return `${el.tagName.toLowerCase()}:${name}`;
    });
}

describe("tab order", () => {
  it("hub: search, filter chips, then each card's actions", async () => {
    const panel = await mountPanel();
    expect(tabOrder(sr(panel))).toEqual([
      // The bar: the Log, Events, Refresh (ask Aivi again), then the gear
      // for accounts.
      "button:Open the log",
      "button:Events: not listening",
      "button:Refresh",
      "button:Accounts",
      "input:Search widgets and Live Activities by name or template",
      "button:All9",
      "button:Fed2",
      "button:Not fed6",
      "button:Unsupported1",
      "button:Set up",
      "button:Edit",
      "button:Stop feeding",
      "button:Set up",
      "button:Set up",
      "button:Set up",
      "button:Set up",
      // The unsupported Weather card offers no action; then the bound
      // washer activity (Edit / Stop feeding) and the unbound grill.
      "button:Edit",
      "button:Stop feeding",
      "button:Set up",
    ]);
  });

  it("editor: back, save, then the form fields in reading order", async () => {
    const panel = await mountPanel();
    // The bound widget: Save is enabled, so it is in the tab sequence.
    await openWidgetEditor(panel, "frontdoor");
    const order = tabOrder(sr(panel));
    expect(order[0]).toBe("button:Back");
    expect(order[1]).toBe("button:Suggest");
    expect(order[2]).toBe("button:Save");
    // The first field reads as it looks: its control, then its source
    // menu at the trailing edge.
    const at = order.indexOf("input:State");
    expect(at).toBeGreaterThan(1);
    const menuAt = order.indexOf("select:State source");
    expect(menuAt).toBeGreaterThan(at);
    // What unfolds below the row comes after the row itself.
    expect(order.slice(at, menuAt).some((d) => d.startsWith("summary:"))).toBe(false);
    expect(order[menuAt + 1]).toBe("summary:Text color & format");
    // No focus traps: the preview toggle and payload disclosure are in
    // the sequence.
    expect(order).toContain("button:Live preview");
    expect(order.some((d) => d.startsWith("summary:"))).toBe(true);
    expect(
      [...sr(panel).querySelectorAll("[tabindex]")].every(
        (el) => Number(el.getAttribute("tabindex")) <= 0,
      ),
    ).toBe(true);
  });

  it("editor (unbound): Save is disabled, not a focus stop, until bindable", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(tabOrder(sr(panel))).not.toContain("button:Save");
  });
});
