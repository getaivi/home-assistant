// Content that waits on a field with nothing to read (?waiting=1: the
// Washer's progress follows a sensor that reads unknown): what the editor
// says about it (the field's note, its required mark, the preview), the
// hub card's warning, and the Log's waiting and held rows.

import { readFileSync } from "node:fs";
import type { LitElement } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { heldText, timeText } from "../src/activity-rows";
import type { AiviPreviewPane } from "../src/aivi-preview-pane";
import { resetCatalog, setCatalog } from "../src/i18n";
import { fieldName } from "../src/layout";
import { slotsForField } from "../src/slots";
import type { BindingStatus } from "../src/types/accounts";
import { everyLabel } from "../src/util";
import {
  $,
  $$,
  fieldRow,
  hubCard,
  mountPanel,
  mountRouted,
  openActivityEditor,
  previewSettled,
  setSelect,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  resetCatalog();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

async function waitingWasher() {
  history.replaceState(null, "", "/?waiting=1");
  const panel = await mountPanel();
  const editor = await openActivityEditor(panel, "washer");
  return { panel, editor, root: sr(panel) };
}

describe("content that waits on a field", () => {
  it("says so on the field, its required mark and the preview", async () => {
    const { editor, root } = await waitingWasher();
    expect(editor.editorState.preview).toBeNull();
    expect(editor.editorState.waiting).toEqual({
      field: "progress",
      fields: ["progress"],
      entity_id: "sensor.dryer_progress",
      reading: "unknown",
    });
    const row = fieldRow(root, "progress");
    // A required field has no fallback: nothing is sent.
    expect(text($(row, ".tnote.warn"))).toBe(
      "Reads “unknown” right now, so nothing is sent until it has a value.",
    );
    // Filled in, so not "required"; not a check either.
    const mark = $(row, ".freq");
    expect(mark.classList.contains("warn")).toBe(true);
    expect(mark.getAttribute("aria-label")).toBe("Nothing to read right now");
    expect(mark.getAttribute("title")).toBe("Nothing to read right now");
    // The preview says why it is empty, and where to go.
    const pane = $(root, "aivi-preview-pane") as unknown as AiviPreviewPane;
    const line = $(pane, ".missing");
    expect(text(line)).toBe("Nothing is sent while the progress value reads “unknown”.");
    expect(text($(line, "b"))).toBe("the progress value");
    // The same note as a field's and a hub card's: the mark, then words.
    expect($(line, ".tnote.warn > svg.icon").getAttribute("aria-hidden")).toBe("true");
    expect(text($(pane, ".pv-hint"))).toBe("Press the preview to jump to the progress value.");
  });

  it("leads every press on the preview to the field it waits on", async () => {
    const { root } = await waitingWasher();
    const pane = $(root, "aivi-preview-pane") as unknown as AiviPreviewPane;
    const pressed = vi.fn();
    pane.onSlotPress = pressed;
    const progress = slotsForField("activity", "progress", "progress")[0]?.id;
    expect(progress).toBeTruthy();
    const other = $$(pane, "[data-slot]").find((el) => el.dataset["slot"] !== progress);
    other?.click();
    expect(pressed).toHaveBeenLastCalledWith(progress);
    other?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(pressed).toHaveBeenLastCalledWith(progress, true);
  });

  it("clears once the field has something to read", async () => {
    const { editor, root } = await waitingWasher();
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.schedulePreview(0);
    await until(() => editor.editorState.preview !== null, "the resolved preview");
    await previewSettled(editor);
    await tick();
    expect(editor.editorState.waiting).toBeNull();
    const row = fieldRow(root, "progress");
    expect($(row, ".freq").classList.contains("done")).toBe(true);
    expect(row.querySelector(".tnote.warn")).toBeNull();
    const pane = $(root, "aivi-preview-pane");
    expect(text($(pane, ".missing"))).toBe("");
    expect(text($(pane, ".pv-hint"))).toBe(
      "Press any part of the preview to jump to its settings.",
    );
  });

  it("says an optional field with no fallback is left out", async () => {
    const { editor, root } = await waitingWasher();
    editor.editorState.bindings["header_left"] = "sensor.dryer_progress";
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["header_left"]?.status === "fallback",
      "the field's feedback",
    );
    await tick();
    expect(text($(fieldRow(root, "header_left"), ".tnote.warn"))).toBe(
      "Nothing to read right now, so this is left out.",
    );
  });
});

const logRows = (root: ParentNode): HTMLElement[] => $$(root, "aivi-activity-log .loglist .arow");

describe("the Log's waiting and held rows", () => {
  it("says why nothing went, and when a held change goes", async () => {
    history.replaceState(null, "", "/?waiting=1");
    const panel = await mountRouted("/log");
    const root = sr(panel);
    await until(() => logRows(root).length === 7, "the rows");
    const [waiting, held] = logRows(root) as [HTMLElement, HTMLElement];
    expect(text($(waiting, ".aout"))).toBe("Waiting");
    expect(text($(waiting, ".areq"))).toBe("To Aivi ×4");
    expect(text($(waiting, ".pwarn"))).toBe("Nothing sent: the progress value reads “unknown”.");
    // No "nothing resolved" line under it: the warning says it.
    expect(waiting.querySelector(".fhint")).toBeNull();
    expect(text($(held, ".aout"))).toBe("Held");
    const until_ = panel.pushesOf(panel.accounts[0]!)[1]!.held!.until;
    expect(text($(held, ".fhint"))).toBe(
      `Held until ${timeText(until_)}: this Live Activity updates at most every minute. Change it under “Update at most every” in Behavior.`,
    );
    expect(heldText({ until: until_, interval: 300 })).toContain("at most every 5 minutes");
    // What it holds has not gone out yet.
    expect(text($(held, "details.abody summary"))).toBe("What will be sent");

    // Waiting is a problem to look at; a held change is not.
    setSelect($(root, 'aivi-activity-log .logsel select[aria-label="Show"]'), "problems");
    await until(() => logRows(root).length === 3, "the problems");
    expect(logRows(root).map((row) => text($(row, ".outcome")))).toEqual([
      "Waiting",
      "Retrying",
      "Failed",
    ]);
  });
});

/** A shipped translation's panel strings, as the panel loads them. */
function catalogOf(lang: string): Record<string, string> {
  type Tree = { [key: string]: string | Tree };
  const tree = JSON.parse(
    readFileSync(`custom_components/aivi/translations/${lang}.json`, "utf8"),
  ) as { config_panel: Tree };
  const out: Record<string, string> = {};
  const walk = (node: Tree, prefix: string): void => {
    for (const [key, value] of Object.entries(node))
      if (typeof value === "string") out[`${prefix}${key}`] = value;
      else walk(value, `${prefix}${key}.`);
  };
  walk(tree.config_panel, "");
  return out;
}

describe("naming a field and an interval in a sentence", () => {
  it("names a field the way its form row reads", () => {
    // A short label inside its group: both, lower-cased mid-sentence.
    expect(fieldName("progress", "progress", "activity")).toBe("the progress value");
    expect(fieldName("right_value", "monitor", "activity")).toBe("the right column value");
    // A label that is already specific, or a field in no group: alone.
    expect(fieldName("compact_value", "progress", "activity")).toBe("Dynamic Island");
    expect(fieldName("state", "status", "widget")).toBe("State");
    // Another language combines and cases them its own way.
    setCatalog(catalogOf("de"), "de");
    expect(fieldName("progress", "progress", "activity")).toBe("„Fortschritt: Wert“");
  });

  it("says how often in words that fit a sentence", () => {
    expect(everyLabel(60)).toBe("every minute");
    expect(everyLabel(15)).toBe("every 15 seconds");
    expect(everyLabel(120)).toBe("every 2 minutes");
    expect(everyLabel(600)).toBe("every 10 minutes");
    expect(everyLabel(3600)).toBe("every hour");
    setCatalog(catalogOf("pl"), "pl");
    expect(everyLabel(60)).toBe("co minutę");
    expect(everyLabel(120)).toBe("co 2 minuty");
    expect(everyLabel(300)).toBe("co 5 minut");
  });
});

describe("a hub card whose content waits", () => {
  async function hub() {
    history.replaceState(null, "", "/?waiting=1");
    const panel = await mountPanel();
    await until(() => panel.statusOf(panel.accounts[0]!, "a1") !== null, "the binding status");
    await tick();
    return panel;
  }

  it("says what the Live Activity waits on, named as the editor names it", async () => {
    const panel = await hub();
    const washer = hubCard(panel, "Washer");
    const line = $(washer, ".tnote.waiting");
    expect(text(line)).toBe("Nothing is sent while the progress value reads “unknown”.");
    expect(text($(line, "b"))).toBe(fieldName("progress", "progress", "activity"));
    // Its running mark still says whether it runs.
    expect($(washer, ".dot").className).toContain("on");
    // A binding that does not wait says nothing.
    expect(hubCard(panel, "Front door").querySelector(".tnote.waiting")).toBeNull();
    expect($(hubCard(panel, "Front door"), ".dot").className).toContain("on");
  });

  it("marks a waiting widget, for a field with nothing to quote or a group", async () => {
    const panel = await hub();
    const card = hubCard(panel, "Front door") as unknown as LitElement & {
      status: BindingStatus | null;
    };
    card.status = {
      status: "waiting",
      waiting: { field: "state", fields: ["state"], entity_id: null, reading: null },
      held: null,
    };
    await card.updateComplete;
    expect(text($(card, ".tnote.waiting"))).toBe(
      `Nothing is sent while ${fieldName("state", "status", "widget")} has no value.`,
    );
    const mark = $(card, ".dot");
    expect(mark.className).toContain("warn");
    expect(mark.title).toBe("Waiting for a value");
    card.status = {
      status: "waiting",
      waiting: { field: null, fields: ["state", "icon"], entity_id: null, reading: null },
      held: null,
    };
    await card.updateComplete;
    expect(text($(card, ".tnote.waiting"))).toContain("Nothing is sent until one of");
    card.status = null;
    await card.updateComplete;
    expect(card.querySelector(".tnote.waiting")).toBeNull();
    expect($(card, ".dot").className).toContain("on");
  });

  it("says nothing without a status from the integration", async () => {
    history.replaceState(null, "", "/");
    const panel = await mountPanel();
    expect($$(sr(panel), ".tnote.waiting")).toEqual([]);
  });
});
