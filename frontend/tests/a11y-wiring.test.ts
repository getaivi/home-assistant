// ARIA wiring in the mounted panel: the hub's live regions, the inline
// Jinja feedback tied to its textarea via aria-describedby, and the narrow
// preview sheet toggle that controls the pane it expands.

import { afterEach, describe, expect, it } from "vitest";
import { $, mountPanel, openWidgetEditor, setInput, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hub live regions", () => {
  it("announces the filtered result count once typing settles", async () => {
    const panel = await mountPanel();
    const root = sr(panel);
    const region = (): string => text($(root, '.hubbar .sr-only[role="status"]'));
    expect(region()).toBe("");
    setInput($(root, '.hubbar input[type="search"]'), "laundry");
    await until(() => region() !== "", "result announcement");
    expect(region()).toBe("1 match shown");
    // Clearing the filter empties the region rather than announcing.
    setInput($(root, '.hubbar input[type="search"]'), "");
    await until(() => region() === "", "cleared announcement");
  });

  it("announces the armed state of the two-step unbind", async () => {
    const panel = await mountPanel();
    const unbind = $(sr(panel), "aivi-unbind-button button");
    expect(unbind.getAttribute("aria-live")).toBe("polite");
    expect(text(unbind)).toBe("Stop feeding");
    unbind.click();
    await tick();
    expect(text($(sr(panel), "aivi-unbind-button button"))).toBe("Stop feeding?");
  });
});

describe("template feedback wiring", () => {
  it("links the error note to the textarea and speaks it politely", async () => {
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
    const row = $(sr(panel), '.field[data-key="progress"]');
    const area = $(row, "textarea");
    const note = $(row, ".tnote.error");
    expect(note.getAttribute("role")).toBe("status");
    // The box is described by everything under it, the error included.
    const region = $(row, ".tfb");
    expect(area.getAttribute("aria-describedby")).toBe(region.id);
    expect(region.contains(note)).toBe(true);
    expect(area.getAttribute("aria-label")).toBe("Progress template");
  });

  it("wires a sourced segment weight's note the same way", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["segments"] = [
      { value: 1, fill_color: "cyan", source__template: "{% broken" },
    ];
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["segments.0.source"]?.status === "error",
      "segment error feedback",
    );
    await tick();
    const seged = $(sr(panel), "aivi-segments-editor");
    $(seged, ".segcap").click(); // open the segment's inline editor
    await tick();
    const area = $(seged, ".seginline textarea");
    const note = $(seged, ".seginline .tnote.error");
    expect(note.getAttribute("role")).toBe("status");
    const region = $(seged, ".seginline .tfb");
    expect(area.getAttribute("aria-describedby")).toBe(region.id);
    expect(region.contains(note)).toBe(true);
  });
});

describe("preview sheet toggle", () => {
  it("carries aria-expanded and aria-controls for the pane", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const toggle = $(sr(panel), ".pvtoggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("aivi-side-body");
    expect($(sr(panel), ".sidebody").id).toBe("aivi-side-body");
    expect($(sr(panel), ".sidebody aivi-preview-pane")).toBeTruthy();
    toggle.click();
    await tick();
    expect($(sr(panel), ".pvtoggle").getAttribute("aria-expanded")).toBe("true");
  });
});
