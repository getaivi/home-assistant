// The editor's sticky bar: what counts as an unsaved change, the chip
// that counts what Save is waiting for and leads to it, and Save itself.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import {
  $,
  focused,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  setInput,
  setSelect,
  sheet,
  sr,
  takeBacks,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  takeBacks();
});

describe("unsaved changes", () => {
  it("does not count picking the shown default throttle as a change", async () => {
    // An unset throttle shows as the default; choosing another value
    // and then the default again is back where it started.
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "grill");
    const select = $(sr(panel), ".delivery select");
    expect($(select, "option[selected]").getAttribute("value")).toBe("60"); // shown, not stored
    setSelect(select, "30");
    expect(editor.isDirty()).toBe(true);
    setSelect(select, "60");
    expect(editor.isDirty()).toBe(false);
  });
});

describe("the bar's chip", () => {
  it("lands its target below the sticky bar, scrolling after the focus", async () => {
    // Focusing a picker scrolls by itself; the row's own scroll comes
    // last so it is the one that stays, and its scroll-margin-top keeps
    // the row clear of the bar.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const root = sr(panel);
    const row = $(root, '.field[data-key="progress"]');
    const calls: { options: unknown; focusInside: boolean }[] = [];
    row.scrollIntoView = (options?: unknown): void => {
      calls.push({ options, focusInside: row.contains(root.activeElement) });
    };
    $(root, ".edbar .needchip").click();
    await tick();
    expect(calls).toEqual([{ options: { block: "start" }, focusInside: true }]);
    expect(sheet("editor")).toMatch(
      /\.field, \.form \.tnote, \.form > \.banner \{ scroll-margin-top: \d+px; \}/,
    );
  });

  it("counts a template error, which blocks Save without anything missing", async () => {
    // A disabled Save has a chip that states why, also while the preview
    // is collapsed.
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress__template"] = "{% broken";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["progress"]?.status === "error",
      "error feedback",
    );
    await tick();
    const root = sr(panel);
    expect(($(root, ".edbar .savebtn") as HTMLButtonElement).disabled).toBe(true);
    const chip = $(root, ".edbar .needchip");
    expect(text(chip)).toBe("1 to fix");
    expect(chip.getAttribute("title")).toBe("Fix the template error in Progress to save.");
    // And it leads to the field.
    chip.click();
    await tick();
    expect($(root, '.field[data-key="progress"]').contains(root.activeElement)).toBe(true);
  });

  it("counts a bad URL, on the bar and on the phone's preview toggle", async () => {
    const panel = await mountPanel();
    panel.narrow = true;
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    expect(root.querySelector(".edbar .needchip")).toBeNull();
    setInput($(root, 'aivi-field-row[data-key="tap_url"] input'), "example.com/door");
    await tick();
    expect(text($(root, ".edbar .needchip"))).toBe("1 to fix");
    expect(text($(root, ".pvtoggle .n"))).toBe("1 to fix");
    $(root, ".edbar .needchip").click();
    await tick();
    expect($(root, '.field[data-key="tap_url"]').contains(root.activeElement)).toBe(true);
  });

  it("counts an activity's missing lifecycle entity with its missing fields", async () => {
    // One number for everything Save waits for.
    const panel = await mountPanel();
    await openActivityEditor(panel, "grill");
    const root = sr(panel);
    const chip = $(root, ".edbar .needchip");
    expect(text(chip)).toMatch(/^\d+ to set$/);
    expect(chip.getAttribute("title")).toContain("Active entity");
    // The first blocker in form order is the lifecycle card's.
    chip.click();
    await tick();
    expect($(root, ".setup .field").contains(root.activeElement)).toBe(true);
  });
});

describe("Save", () => {
  async function ready(): Promise<{
    panel: AiviPanel;
    editor: AiviEditor;
    save: HTMLButtonElement;
  }> {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.updateValidation();
    await tick();
    return { panel, editor, save: $(sr(panel), ".edbar .savebtn") as HTMLButtonElement };
  }

  it("leaves a failed save's error by the button, with focus on it, until the next edit", async () => {
    // The toast is gone in three seconds; the line stays.
    const { panel, editor, save } = await ready();
    vi.spyOn(panel.api, "save").mockRejectedValue(new Error("db down"));
    save.click();
    const line = $(sr(panel), ".edbar .saveerr");
    await until(() => text(line) !== "", "the error line");
    expect(line.getAttribute("role")).toBe("alert");
    expect(text(line)).toBe("Couldn't save: db down");
    expect(save.getAttribute("aria-describedby")).toBe(line.id);
    await tick();
    expect(focused(panel)).toBe(save);
    expect(save.disabled).toBe(false);
    // A preview landing is not an edit: the line holds.
    editor.updateValidation();
    await tick();
    expect(text(line)).toBe("Couldn't save: db down");
    // An edit clears it.
    editor.editorState.staleAfter = 3600;
    editor.updateValidation();
    await tick();
    expect(text(line)).toBe("");
  });

  it("clears the error line when saving again", async () => {
    const { panel, save } = await ready();
    const spy = vi.spyOn(panel.api, "save").mockRejectedValueOnce(new Error("db down"));
    save.click();
    const line = $(sr(panel), ".edbar .saveerr");
    await until(() => text(line) !== "", "the error line");
    spy.mockRestore();
    save.click();
    await tick();
    expect(text(line)).toBe("");
    await until(() => !!sr(panel).querySelector(".toast"), "saved");
  });

  it("holds the form and Back still while a save is in flight", async () => {
    // An edit made during a slow save would vanish with the editor,
    // and Back then Discard would race the save.
    const { panel, editor, save } = await ready();
    let finish: (value: { subentry_id: string }) => void = () => {};
    const spy = vi.spyOn(panel.api, "save").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    save.click();
    await tick();
    const root = sr(panel);
    expect($(root, ".edwrap").hasAttribute("inert")).toBe(true);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(text(save)).toBe("Saving…");
    // Back, a second Save and a browser back are all ignored.
    $(root, ".backbtn").click();
    save.click();
    panel.route = { prefix: "/aivi", path: "" };
    await tick();
    expect(panel.view).toBe("editor");
    expect(($(root, "dialog.leavedlg") as HTMLDialogElement).open).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(editor.editorState.saving).toBe(true);
    finish({ subentry_id: "w9" });
    await until(() => !editor.editorState.saving, "saved");
    expect(panel.view).toBe("editor");
    expect($(root, ".edwrap").hasAttribute("inert")).toBe(false);
  });

  it("says saved even when the refresh after it fails", async () => {
    // The save went through; a failed re-read is not an unhandled
    // error (vitest fails the run on one) and not a failed save.
    const { panel, save } = await ready();
    vi.spyOn(panel, "refresh").mockRejectedValue(new Error("offline"));
    save.click();
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(panel.view).toBe("editor");
    expect(text($(sr(panel), ".toast"))).toBe("Laundry is now fed by Home Assistant");
  });

  it("stays on the editor's page, and Back then goes to the hub it came from", async () => {
    // Saving navigates nowhere; Back afterwards is the one step back.
    const { panel, save } = await ready();
    takeBacks();
    const pushed = vi.spyOn(history, "pushState");
    save.click();
    await until(() => !!sr(panel).querySelector(".toast"), "saved");
    expect(takeBacks()).toBe(0);
    expect(pushed).not.toHaveBeenCalled();
    $(sr(panel), ".backbtn").click();
    await until(() => panel.view === "home", "back on the hub");
    expect(takeBacks()).toBe(1);
    expect(pushed).not.toHaveBeenCalled();
  });
});
