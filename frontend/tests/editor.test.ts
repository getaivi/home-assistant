// Editor behavior: Save gating on required fields, binding pruning,
// watched/bound entity collection, the save round-trip back to the hub,
// and the live preview pane (including its memoization contract).

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { Bindings } from "../src/types/bindings";
import type { Meta } from "../src/types/meta";
import {
  $,
  $$,
  makeHass,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  previewSettled,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("save gating", () => {
  it("disables Save while required fields are unbound and lists them", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    await previewSettled(editor);
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(text($(sr(panel), ".missing"))).toBe("To save, set Progress.");
    // Unresolvable preview: the pane draws the widget's skeleton, every
    // region a labeled placeholder that leads to its fields.
    const stage = $(sr(panel), ".pv-stage.is-skeleton");
    expect(text($(stage, ".pv-hint"))).toContain("Nothing to show yet");
    expect($$(stage, ".pv-canvas [data-slot]").length).toBeGreaterThan(1);
    expect(sr(panel).querySelector("details.payload")).toBeNull();
    $(stage, '.pv-canvas [data-slot="bar"]').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect($(sr(panel), '.field[data-key="progress"]').classList.contains("flash")).toBe(true);

    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "preview render",
    );
    expect(save.disabled).toBe(false);
    expect(text($(sr(panel), ".missing"))).toBe("");
  });

  it("treats an empty template marker as unbound, a filled one as bound", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress__template"] = "";
    editor.updateValidation();
    await tick();
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    editor.editorState.bindings["progress__template"] = "{{ 42 }}";
    editor.updateValidation();
    await tick();
    expect(save.disabled).toBe(false);
  });

  it("requires entity and attribute in attribute mode", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "climate.living_room";
    editor.editorState.bindings["progress__attribute"] = "";
    editor.updateValidation();
    await tick();
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
    editor.editorState.bindings["progress__attribute"] = "current_temperature";
    editor.updateValidation();
    await tick();
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks Save on a hard template error in a required field", async () => {
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
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(text($(sr(panel), ".missing.blocked"))).toBe(
      "Fix the template error in Progress to save.",
    );
    // The guard holds even if the click somehow lands.
    const spy = vi.spyOn(panel.api, "save");
    await (editor as unknown as { _save(): Promise<void> })._save();
    expect(spy).not.toHaveBeenCalled();

    // Fixing the template re-enables Save once the preview lands.
    editor.editorState.bindings["progress__template"] =
      "{{ states('input_number.washer_progress') }}";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["progress"]?.status === "ok",
      "ok feedback",
    );
    await tick();
    expect(save.disabled).toBe(false);
    // The blocked line is a pre-existing live region: always in the DOM
    // (a region added on the fly misses its first announcement), empty
    // when nothing blocks.
    expect(text($(sr(panel), ".missing.blocked"))).toBe("");
  });

  it("never blocks Save on warnings or on optional-field errors", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    // Renders-to-nothing on a required field: bound, only a warning.
    editor.editorState.bindings["progress__template"] = "{{ states('sensor.nope') }}";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["progress"]?.status === "empty",
      "empty feedback",
    );
    await tick();
    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    // A hard error on an optional field doesn't block either.
    editor.editorState.bindings["state__template"] = "{% broken";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => editor.editorState.fieldFeedback?.["state"]?.status === "error",
      "optional error feedback",
    );
    await tick();
    expect(save.disabled).toBe(false);
    // The blocked line is a pre-existing live region: always in the DOM
    // (a region added on the fly misses its first announcement), empty
    // when nothing blocks.
    expect(text($(sr(panel), ".missing.blocked"))).toBe("");
  });

  it("requires a non-empty selection for rows fields", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "batteries");
    await previewSettled(editor);
    expect(text($(sr(panel), ".missing"))).toBe("To save, set Battery sensors.");
    editor.editorState.bindings["devices"] = ["sensor.vacuum_battery"];
    editor.updateValidation();
    await tick();
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("prunedBindings", () => {
  it("drops empty strings, empty arrays, and null-ish leftovers", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings = {
      progress: "input_number.washer_progress",
      state: "",
      state__template: "",
      rows: [],
      accent: "cyan",
      min_value: 0,
    } as Bindings;
    expect(editor.prunedBindings()).toEqual({
      progress: "input_number.washer_progress",
      accent: "cyan",
      min_value: 0,
    });
  });
});

describe("prunedBindings keeps hidden state words", () => {
  it('keeps a row\'s "" state word (Hide) while dropping other empties', async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "livingroom");
    editor.editorState.bindings = {
      actions: ["cover.garage", "light.porch"],
      actions__options: {
        "cover.garage": { state_text_off: "", label: "" },
        "light.porch": { label: "" },
      },
    } as Bindings;
    expect(editor.prunedBindings()).toEqual({
      actions: ["cover.garage", "light.porch"],
      actions__options: { "cover.garage": { state_text_off: "" } },
    });
  });
});

describe("preview ordering", () => {
  it("never lets a slow, older preview overwrite a newer one", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "livingroom");
    await previewSettled(editor);
    const answers: Array<(v: unknown) => void> = [];
    vi.spyOn(panel.api, "preview").mockImplementation(
      () => new Promise((resolve) => answers.push(resolve as (v: unknown) => void)),
    );
    editor.schedulePreview(0);
    await until(() => answers.length === 1, "first request");
    editor.schedulePreview(0);
    await until(() => answers.length === 2, "second request");
    answers[1]?.({ content: {}, fields: {}, size: { bytes: 100, limit: 4096 } });
    await tick();
    answers[0]?.({ content: {}, fields: {}, size: { bytes: 9000, limit: 4096 } });
    await tick();
    expect(editor.editorState.size).toEqual({ bytes: 100, limit: 4096 });
    expect(editor.tooBig()).toBeNull();
  });
});

describe("boundEntityIds", () => {
  it("collects entity bindings, watched template ids, and known array members", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings = {
      progress: "input_number.washer_progress",
      state: "not-an-entity",
      tap_url__watched: ["sensor.living_temp", "sensor.not_in_states"],
      rows: ["sensor.humidity", "sensor.ghost"],
    } as Bindings;
    expect(editor.boundEntityIds().sort()).toEqual([
      "input_number.washer_progress",
      "sensor.humidity",
      "sensor.living_temp",
      "sensor.not_in_states", // watched ids are trusted as typed
    ]);
  });
});

describe("saving", () => {
  it("saves, stays in the editor on the saved binding, and toasts", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.editorState.bindings["state"] = ""; // pruned on save
    editor.updateValidation();
    await tick();
    $(sr(panel), ".topbar .btn.primary").click();
    await until(() => !!sr(panel).querySelector(".toast"), "the toast");
    expect(text($(sr(panel), ".toast"))).toBe("Laundry is now fed by Home Assistant");
    expect(panel.view).toBe("editor");
    const saved = panel.accounts[0]?.widgets.find((w) => w.slug === "laundry");
    expect(saved?.bindings).toEqual({
      progress: "input_number.washer_progress",
    });
    // The editor is now on that binding, with nothing unsaved: Back
    // leaves at once, and the hub card is bound.
    expect(editor.editorState.subentryId).toBe(saved?.subentry_id);
    $(sr(panel), ".backbtn").click();
    await until(() => panel.view === "home", "back on the hub");
    await tick();
    expect(sr(panel).querySelector<HTMLDialogElement>("dialog.leavedlg")?.open ?? false).toBe(
      false,
    );
    const cards = $$(sr(panel), "aivi-widget-card");
    const laundry = cards.find((c) => text($(c, ".nm")) === "Laundry");
    expect(text($(laundry!, ".sum"))).toContain("Fed by Washer progress");
  });

  it("stays in the editor and toasts when saving fails", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    vi.spyOn(panel.api, "save").mockRejectedValue(new Error("db down"));
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.updateValidation();
    await tick();
    $(sr(panel), ".topbar .btn.primary").click();
    await until(() => !!sr(panel).querySelector(".toast"), "failure toast");
    expect(panel.view).toBe("editor");
    expect(editor.editorState.saving).toBe(false);
    expect(text($(sr(panel), ".toast"))).toBe("Couldn't save: db down");
  });
});

describe("editor chrome", () => {
  it("Back returns to the hub at once when nothing was changed", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    expect(editor.isDirty()).toBe(false);
    $(sr(panel), ".backbtn").click();
    await tick();
    expect(panel.view).toBe("home");
    expect(panel.editorState).toBeNull();
  });

  it("asks before leaving with unsaved changes, and nothing is saved", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    expect(editor.isDirty()).toBe(true);
    const root = sr(panel);
    $(root, ".backbtn").click();
    await tick();
    // Still in the editor: a modal question, with focus on the safe answer.
    expect(panel.view).toBe("editor");
    const leave = $(root, "dialog.leavedlg") as HTMLDialogElement;
    expect(leave.open).toBe(true);
    expect(text($(leave, "h3"))).toBe("Discard your changes?");
    expect(text($(leave, "p"))).toBe("What you changed in Laundry will not be saved.");
    expect(root.activeElement ?? document.activeElement).toBe($(leave, ".keep"));
    $(leave, ".keep").click();
    await tick();
    expect(leave.open).toBe(false);
    expect(editor.editorState.bindings["progress"]).toBe("input_number.washer_progress");
    // The second time, Discard is pressed.
    $(root, ".backbtn").click();
    await tick();
    $(root, "dialog.leavedlg .discard").click();
    await tick();
    expect(panel.view).toBe("home");
    expect(panel.editorState).toBeNull();
    expect(panel.accounts[0]?.widgets.find((w) => w.slug === "laundry")).toBeUndefined();
  });

  it("asks on a route change too, and keeps the editor's URL", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    // Browser back: the host assigns the hub route.
    panel.route = { prefix: "/aivi", path: "" };
    await tick();
    expect(panel.view).toBe("editor");
    expect(panel.route?.path).toBe("/widget/laundry");
    expect(($(sr(panel), "dialog.leavedlg") as HTMLDialogElement).open).toBe(true);
  });

  it("does not count where a new binding starts as a change", async () => {
    // The defaults (a currency, a price sensor) are applied like a
    // suggestion; leaving right after is not a discard.
    const panel = await mountPanel();
    const acc = panel.accounts[0]!;
    panel.openEditor(
      acc,
      { slug: "spending", name: "Spending", template: "budget", supported: true },
      null,
    );
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "the editor");
    const editor = $(sr(panel), "aivi-editor") as AiviEditor;
    await until(() => editor.editorState.bindings["currency"] === "USD", "the defaults");
    await tick();
    expect(editor.isDirty()).toBe(false);
    editor.editorState.staleAfter = 3600;
    expect(editor.isDirty()).toBe(true);
  });

  it("keeps Save and what it waits for in the bar, and jumps to it", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const root = sr(panel);
    const chip = $(root, ".edbar .needchip");
    expect(text(chip)).toBe("1 to set");
    expect(chip.getAttribute("title")).toBe("To save, set Progress.");
    chip.click();
    await tick();
    const row = $(root, '.field[data-key="progress"]');
    expect(row.classList.contains("flash")).toBe(true);
    expect(row.contains(root.activeElement ?? document.activeElement)).toBe(true);
  });

  it("shows every field of a template, with no fold to open", async () => {
    // Fields are ordered by where they land on the device, with no fold
    // for "advanced" ones.
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    expect(root.querySelector(".form details.group")).toBeNull();
    const keys = $$(root, "aivi-field-row").map((r) => r.dataset["key"]);
    // `accent` and `tap_url` are both advanced: true.
    expect(keys).toEqual(["state", "value", "icon", "accent", "tap_url"]);
  });

  it("keeps the Suggest box discoverable, disabled, without AI Task", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/config")
        return { ...(res as object), suggest_state: "not_loaded" };
      return res;
    };
    const panel = await mountPanel(hass);
    await openWidgetEditor(panel, "laundry");
    // The bar's Suggest button stays, and the sidebar it opens explains.
    $(sr(panel), ".edbar .aibtn").click();
    await tick();
    const box = $(sr(panel), "aivi-suggest-box");
    expect(box.classList.contains("off")).toBe(true);
    expect(text($(box, ".why"))).toContain("Add one in Integrations");
  });
});

describe("preview pane", () => {
  it("renders the resolved widget and the push payload for a bound widget", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "preview widget",
    );
    expect(text($(sr(panel), ".pv-canvas .pv-hero"))).toBe("on");
    const payload = $(sr(panel), "details.payload pre");
    expect(JSON.parse(payload.textContent ?? "")).toMatchObject({
      state: { value: "on" },
      accent: "red",
    });
  });

  it("keeps normalized numbers noise-free in the payload pane", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress__template"] = "{{ 41 }}";
    editor.updateValidation();
    editor.schedulePreview(0);
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "preview widget",
    );
    const payload = $(sr(panel), "details.payload pre");
    // 41 * 0.01 is 0.41000000000000003 raw; wire_number() in blocks.py
    // rounds the noise away.
    expect(JSON.parse(payload.textContent ?? "").progress.value).toBe(0.41);
  });

  it("treats a failed preview call as unresolvable", async () => {
    const panel = await mountPanel();
    vi.spyOn(panel.api, "preview").mockRejectedValue(new Error("boom"));
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    expect(editor.editorState.preview).toBeNull();
    expect($(sr(panel), ".pv-stage.is-skeleton .pv-canvas")).toBeTruthy();
  });

  it("memoizes the preview DOM on payload identity across re-renders", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    await until(
      () => !!sr(panel).querySelector(".pv-stage:not(.is-skeleton) .pv-canvas"),
      "preview widget",
    );
    const before = sr(panel).querySelector(".pv-scale");
    editor.updateValidation();
    await tick();
    expect(sr(panel).querySelector(".pv-scale")).toBe(before);
  });
});

describe("activity editor", () => {
  it("opens a listed activity from the hub with the remote identity fixed", async () => {
    const panel = await mountPanel();
    await openActivityEditor(panel, "grill");
    expect(text($(sr(panel), ".title"))).toBe("Grill");
    expect(text($(sr(panel), ".topbar .subtitle"))).toBe("Live Activity · Monitor · grill");
    // The required field and the active entity are still missing.
    expect(($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled).toBe(true);
    // META carries the real activity registry, so the monitor activity's
    // form renders (no unknown-template error card).
    expect(sr(panel).querySelector(".hero-empty")).toBeNull();
    expect(sr(panel).querySelector('aivi-field-row[data-key="right_value"]')).not.toBeNull();
  });

  it("shows the unknown-template card when the backend lacks the template", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/templates") {
        const { activity_templates: _drop, ...rest } = res as Meta;
        return rest;
      }
      return res;
    };
    const panel = await mountPanel(hass);
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no account");
    const remote = panel.aiviActivities[acc.entry_id]?.find((a) => a.slug === "grill") ?? null;
    panel.openActivityEditor(acc, remote, null);
    await tick();
    expect(text($(sr(panel), ".hero-empty"))).toContain("Unknown template “monitor”");
  });
});
