// Automations that feed what the panel feeds: shown on the card and in the
// editor, and turned off only by a press.

import { afterEach, describe, expect, it, vi } from "vitest";
import { automationPath } from "../src/aivi-feeder-warning";
import type { Feeder } from "../src/types/accounts";
import { $, $$, mountPanel, openWidgetEditor, rule, sr, text, until } from "./harness";

afterEach(() => {
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function card(root: ParentNode, name: string): HTMLElement {
  const found = $$(root, "aivi-widget-card").find((c) => text($(c, ".nm")) === name);
  if (!found) throw new Error(`no card named ${name}`);
  return found;
}

describe("automations feeding the same slug", () => {
  it("says nothing when no automation feeds anything", async () => {
    const panel = await mountPanel();
    expect(sr(panel).querySelector(".fwbtn")).toBeNull();
    expect(sr(panel).querySelector(".fedby")).toBeNull();
  });

  /** Press a card's warning mark and hand back its open popup. */
  async function openWarning(
    panel: Awaited<ReturnType<typeof mountPanel>>,
    name: string,
  ): Promise<HTMLDialogElement> {
    $(card(sr(panel), name), ".fwbtn").click();
    await until(() => !!card(sr(panel), name).querySelector("dialog.fwpop[open]"), "the popup");
    return $(card(sr(panel), name), "dialog.fwpop") as HTMLDialogElement;
  }

  it("marks a fed card, and only notes it on one that is not fed", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const front = card(sr(panel), "Front door");
    // The card shows only a mark beside the name; the notice opens from it.
    const mark = $(front, ".head .fwbtn");
    expect(mark.getAttribute("aria-label")).toBe("Also fed by an automation");
    expect(mark.getAttribute("aria-expanded")).toBe("false");
    expect(($(front, "dialog.fwpop") as HTMLDialogElement).open).toBe(false);

    const open = vi.spyOn(panel, "openEditor");
    const pop = await openWarning(panel, "Front door");
    expect(mark.getAttribute("aria-expanded")).toBe("true");
    expect(text(pop)).toContain(
      "An automation also feeds this: Front door status. The two overwrite each other.",
    );
    expect($(pop, "a.flink").getAttribute("href")).toBe("/config/automation/edit/1719000000001");
    expect(text($(pop, "button"))).toBe("Turn off the automation");
    // Opening the notice is not opening the card.
    expect(open).not.toHaveBeenCalled();

    const laundry = card(sr(panel), "Laundry");
    expect(laundry.querySelector(".fwbtn")).toBeNull();
    expect(text($(laundry, ".fedby"))).toBe("Fed by an automation: Laundry widget");
    expect(laundry.querySelector(".fedby button")).toBeNull();
  });

  it("closes the popup on Escape and on a press outside", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const pop = await openWarning(panel, "Front door");
    pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => !pop.open, "closed by Escape");
    await openWarning(panel, "Front door");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await until(() => !pop.open, "closed by a press outside");
  });

  it("turns the automation off on the press, and the mark goes", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const turnOff = vi.spyOn(panel.api, "turnOffAutomations");
    $(await openWarning(panel, "Front door"), "button").click();
    await until(() => !card(sr(panel), "Front door").querySelector(".fwbtn"), "the mark gone");
    expect(turnOff).toHaveBeenCalledWith(["automation.front_door_status"]);
    // The other automation was not touched.
    expect(text($(card(sr(panel), "Laundry"), ".fedby"))).toContain("Laundry widget");
  });

  it("leaves alone an automation that feeds other widgets, and says why", async () => {
    history.replaceState(null, "", "/?feeders=kept");
    const panel = await mountPanel();
    const turnOff = vi.spyOn(panel.api, "turnOffAutomations");
    const pop = await openWarning(panel, "Front door");
    expect(text(pop)).toContain(
      "Automations also feed this: Front door status, All widgets. They and this panel overwrite each other.",
    );
    expect(text($(pop, ".fkeep"))).toBe(
      "All widgets feeds other widgets too, so it is not turned off from here.",
    );
    expect($$(pop, "a.flink").map((a) => a.getAttribute("href"))).toEqual([
      "/config/automation/edit/1719000000001",
      "/config/automation/dashboard",
    ]);
    // With several, the button names the one it turns off.
    expect(text($(pop, "button"))).toBe("Turn off Front door status");
    $(pop, "button").click();
    await until(() => turnOff.mock.calls.length > 0, "the call");
    expect(turnOff).toHaveBeenCalledWith(["automation.front_door_status"]);
    await until(
      () =>
        !$$(card(sr(panel), "Front door"), "dialog.fwpop a").some(
          (a) => text(a) === "Front door status",
        ),
      "the turned-off one gone",
    );
    // What it will not turn off stays marked, without a button.
    const left = $(card(sr(panel), "Front door"), "dialog.fwpop");
    expect(text(left)).toContain("All widgets");
    expect(left.querySelector("button")).toBeNull();
  });

  it("warns above the editor's form too", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const notice = $(editor, ":scope > .edpage > .feeders");
    expect(text(notice)).toContain("Front door status");
    // A section banner, boxed, with room before the form.
    expect(notice.matches(".banner.warn")).toBe(true);
    expect(rule("hub", ".banner")).toContain("margin-bottom");
  });

  it("turns several off with one short button", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const [front] = panel.feedersOf("widget", "frontdoor");
    if (!front) throw new Error("no feeder");
    const second = { ...front, entity_id: "automation.porch", name: "Porch status" };
    vi.spyOn(panel, "feedersOf").mockImplementation((_kind, slug) =>
      slug === "frontdoor" ? [front, second] : [],
    );
    const turnOff = vi.spyOn(panel.api, "turnOffAutomations");
    const editor = await openWidgetEditor(panel, "frontdoor");
    const notice = $(editor, ":scope > .edpage > .feeders");
    expect(text(notice)).toContain(
      "Automations also feed this: Front door status, Porch status. They and this panel overwrite each other.",
    );
    expect(text($(notice, "button"))).toBe("Turn them off");
    $(notice, "button").click();
    await until(() => turnOff.mock.calls.length > 0, "the call");
    expect(turnOff).toHaveBeenCalledWith(["automation.front_door_status", "automation.porch"]);
  });

  it("says a failed turn-off instead of pretending", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    vi.spyOn(panel.api, "turnOffAutomations").mockRejectedValue(new Error("Not allowed"));
    const toast = vi.spyOn(panel, "toast");
    $(await openWarning(panel, "Front door"), "button").click();
    await until(() => toast.mock.calls.length > 0, "the toast");
    expect(toast).toHaveBeenCalledWith("Not allowed");
    expect(card(sr(panel), "Front door").querySelector(".fwbtn")).not.toBeNull();
  });

  it("opens an automation where Home Assistant edits it", () => {
    const feeder = (config_id: string | null): Feeder => ({
      kind: "widget",
      slug: "s",
      entity_id: "automation.x",
      name: "X",
      enabled: true,
      config_id,
      blueprint: false,
      keep: null,
    });
    expect(automationPath(feeder("a b"))).toBe("/config/automation/edit/a%20b");
    expect(automationPath(feeder(null))).toBe("/config/automation/dashboard");
  });
});

describe("in the editor", () => {
  it("turns the automation off and drops the warning", async () => {
    history.replaceState(null, "", "/?feeders=1");
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    $(editor, ":scope > .edpage > .feeders button").click();
    await until(() => !editor.querySelector(":scope > .edpage > .feeders"), "the warning gone");
  });
});
