// The hub's accounts panel, behind the bar's gear: how it closes, and
// where it is anchored.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviPanel } from "../src/aivi-panel";
import { $, $$, focused, key, mountPanel, rule, sr, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the accounts panel", () => {
  async function opened(): Promise<{
    panel: AiviPanel;
    gear: HTMLElement;
    pop: HTMLDialogElement;
  }> {
    const panel = await mountPanel();
    const gear = $(sr(panel), ".acctbtn");
    gear.click();
    await tick();
    const pop = $(sr(panel), "dialog.acctpop") as HTMLDialogElement;
    expect(pop.open).toBe(true);
    return { panel, gear, pop };
  }

  it("closes on Escape and hands focus back to the gear", async () => {
    // A non-modal dialog never fires `cancel`, so Escape is handled
    // by the panel itself.
    const { panel, gear, pop } = await opened();
    key($(pop, "a"), "Escape");
    await tick();
    expect(pop.open).toBe(false);
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(focused(panel)).toBe(gear);
  });

  it("closes when focus moves out of it, and stays for focus within it", async () => {
    // Tabbing past the last link must not leave it open behind focus.
    const { panel, pop } = await opened();
    const links = $$(pop, "a");
    links[0]!.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: links[1]! }),
    );
    await tick();
    expect(pop.open).toBe(true);
    links[1]!.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: $(sr(panel), ".hubbar input"),
      }),
    );
    await tick();
    expect(pop.open).toBe(false);
  });

  it("is anchored to the gear, not to the viewport", async () => {
    // The wrapper they share is the positioning context, so the
    // panel sits under the gear at any width and scrolls with the bar.
    const { gear, pop } = await opened();
    expect(pop.parentElement).toBe(gear.parentElement);
    expect(pop.parentElement?.className).toBe("acctwrap");
    expect(rule("hub", ".acctwrap")).toContain("position: relative");
    expect(rule("hub", "dialog.acctpop")).toContain("position: absolute");
    expect(rule("hub", "dialog.acctpop")).toContain("right: 0");
  });
});
