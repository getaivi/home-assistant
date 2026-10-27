// The editor form as rendered: grouped into the same sections in the
// same order, and nothing hidden behind a fold.

import { afterEach, describe, expect, it } from "vitest";
import {
  $$,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  previewSettled,
  sr,
  text,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the form", () => {
  it("shows every field with no group to open", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    const root = sr(panel);
    // compact_value is `advanced: true`, and still shown.
    expect(root.querySelector("aivi-field-row[data-key='compact_value']")).toBeTruthy();
    expect(root.querySelector(".form details.group")).toBeNull();
  });

  it("heads each surface group on an activity", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "washer");
    await previewSettled(editor);
    expect($$(sr(panel), ".form .fsecth").map(text)).toEqual([
      "Lock Screen",
      "Dynamic Island",
      "Appearance",
      "Behavior",
    ]);
  });

  it("heads the same groups on every widget, in the same order", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    expect($$(sr(panel), ".form .fsecth").map(text)).toEqual([
      "What it shows",
      "Appearance",
      "Behavior",
    ]);
    // Each group is its own card holding its fields; delivery closes the
    // behavior group.
    const keys = (id: string): (string | undefined)[] =>
      $$(sr(panel), `.fsect[data-section="${id}"] aivi-field-row`).map((row) => row.dataset["key"]);
    expect(keys("content")).toEqual(["state", "value"]);
    expect(keys("look")).toEqual(["icon", "accent"]);
    expect(keys("behavior")).toEqual(["tap_url"]);
    expect(
      sr(panel).querySelector('.fsect[data-section="behavior"] .field.delivery select'),
    ).toBeTruthy();
  });
});
