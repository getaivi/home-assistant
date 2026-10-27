// The one-time first-bind banner: an inline dismissible banner on the
// hub, there when the editor is left after the first save.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviPanel } from "../src/aivi-panel";
import { $, $$, mountPanel, openWidgetEditor, sr, text, tick, unboundHass, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

async function bindLaundry(panel: AiviPanel): Promise<void> {
  const editor = await openWidgetEditor(panel, "laundry");
  editor.editorState.bindings["progress"] = "input_number.washer_progress";
  editor.updateValidation();
  await tick();
  await saveAndLeave(panel);
}

/** Save, then Back to the hub: the editor stays open after a save. */
async function saveAndLeave(panel: AiviPanel): Promise<void> {
  $(sr(panel), ".topbar .btn.primary").click();
  await until(() => panel.editorState?.saving === false, "saved");
  $(sr(panel), ".backbtn").click();
  await until(() => panel.view === "home", "back on the hub");
  await tick();
}

describe("first-bind banner", () => {
  it("celebrates the 0 -> 1 save with an inline banner on the hub", async () => {
    const panel = await mountPanel(unboundHass());
    await bindLaundry(panel);
    const banner = $(sr(panel), ".banner.ok");
    expect(text(banner)).toContain("Your first widget is live");
    expect(text(banner)).toContain("Laundry now updates whenever the entities that feed it change");
  });

  it("is dismissible, and only ever shows once", async () => {
    const panel = await mountPanel(unboundHass());
    await bindLaundry(panel);
    $(sr(panel), ".banner.ok button").click();
    await tick();
    expect(sr(panel).querySelector(".banner.ok")).toBeNull();

    // The second binding is not a first bind: toast, no banner.
    const editor = await openWidgetEditor(panel, "thermostat");
    editor.editorState.bindings["value"] = "sensor.living_temp";
    editor.updateValidation();
    await tick();
    await saveAndLeave(panel);
    // The toast comes once the hub is read again, after the first save's.
    await until(
      () =>
        !!$$(sr(panel), ".toast").some(
          (el) => text(el) === "Thermostat is now fed by Home Assistant",
        ),
      "its toast",
    );
    expect(sr(panel).querySelector(".banner.ok")).toBeNull();
  });

  it("goes when the binding it celebrates is unbound", async () => {
    // The banner's claim that Laundry updates would be false over a
    // Laundry that nothing feeds.
    const panel = await mountPanel(unboundHass());
    await bindLaundry(panel);
    expect(sr(panel).querySelector(".banner.ok")).not.toBeNull();
    const acc = panel.accounts[0]!;
    await panel.api.delete(acc.entry_id, acc.widgets[0]!.subentry_id);
    await panel.refresh();
    await tick();
    expect(sr(panel).querySelector(".banner.ok")).toBeNull();
  });

  it("keeps focus in the hub when Got it takes the banner away", async () => {
    // The pressed button is removed with its banner; focus
    // must not fall to the page.
    const panel = await mountPanel(unboundHass());
    await bindLaundry(panel);
    const dismiss = $(sr(panel), ".banner.ok button");
    dismiss.focus();
    dismiss.click();
    await until(() => !sr(panel).querySelector(".banner.ok"), "banner gone");
    await tick();
    expect(sr(panel).activeElement).toBe($(sr(panel), ".fchip.on"));
  });

  it("does not fire when editing an existing binding", async () => {
    // The default fixture account already has Front door bound.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    editor.updateValidation();
    await tick();
    await saveAndLeave(panel);
    expect(sr(panel).querySelector(".banner.ok")).toBeNull();
    expect(text($(sr(panel), ".toast"))).toBe("Front door is now fed by Home Assistant");
  });
});
