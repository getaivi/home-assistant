// The hub cards' two-step Stop feeding button: arming, disarming, and
// where the focus goes once the binding is gone.

import { afterEach, describe, expect, it, vi } from "vitest";
import { UNBIND_ARM_DELAY_MS } from "../src/aivi-hub";
import type { AiviPanel } from "../src/aivi-panel";
import { $, focused, hubCard, key, mountPanel, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const armDelay = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, UNBIND_ARM_DELAY_MS + 30));

const unbind = (panel: AiviPanel, name: string): HTMLElement =>
  $(hubCard(panel, name), "aivi-unbind-button button");

describe("Stop feeding", () => {
  it("keeps focus on the card once the binding is gone", async () => {
    // The pressed button leaves with the binding; the card's Set up
    // takes the focus instead of the page.
    const panel = await mountPanel();
    const btn = unbind(panel, "Front door");
    btn.focus();
    btn.click();
    await armDelay();
    btn.click();
    await until(() => !!sr(panel).querySelector(".toast"), "unbound toast");
    await until(() => focused(panel) !== null && focused(panel) !== btn, "focus placed");
    const next = focused(panel) as HTMLElement;
    expect(text(next)).toBe("Set up");
    expect(hubCard(panel, "Front door").contains(next)).toBe(true);
  });

  it("keeps focus on its button when it fails", async () => {
    // Busy is aria-disabled, never disabled, so focus is not dropped.
    const panel = await mountPanel();
    vi.spyOn(panel.api, "delete").mockRejectedValue(new Error("nope"));
    const btn = unbind(panel, "Front door");
    btn.focus();
    btn.click();
    await armDelay();
    btn.click();
    await tick();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await until(() => !!sr(panel).querySelector(".toast"), "failure toast");
    await tick();
    expect(focused(panel)).toBe(btn);
    expect(text(btn)).toBe("Stop feeding");
  });

  it("does not take the second half of a double-click as the confirmation", async () => {
    const panel = await mountPanel();
    const del = vi.spyOn(panel.api, "delete");
    const btn = unbind(panel, "Front door");
    btn.click();
    btn.click();
    await tick();
    expect(del).not.toHaveBeenCalled();
    expect(text(btn)).toBe("Stop feeding?"); // armed, waiting
  });

  it("is disarmed by Escape and by focus moving away", async () => {
    const panel = await mountPanel();
    const btn = unbind(panel, "Front door");
    btn.click();
    await tick();
    expect(text(btn)).toBe("Stop feeding?");
    key(btn, "Escape");
    await tick();
    expect(text(btn)).toBe("Stop feeding");

    btn.click();
    await tick();
    btn.dispatchEvent(new FocusEvent("blur"));
    await tick();
    expect(text(btn)).toBe("Stop feeding");
  });

  it("arms one card at a time", async () => {
    // A browser that does not focus a pressed button never blurs the
    // first one; arming the second disarms it all the same.
    const panel = await mountPanel();
    const first = unbind(panel, "Front door");
    const second = unbind(panel, "Washer");
    first.click();
    await tick();
    second.click();
    await tick();
    expect(text(first)).toBe("Stop feeding");
    expect(text(second)).toBe("Stop feeding?");
  });
});
