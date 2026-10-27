// The Live Activity editor under the bind-only model: the identity
// (slug/name/template) is fixed by the remote activity, while the
// lifecycle (active entity) card still gates Save.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import { $, $$, makeHass, mountPanel, openActivityEditor, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("activity editor", () => {
  it("binds a listed activity: identity from the remote, Save gated on the active entity and required fields", async () => {
    const panel = await mountPanel();
    // "grill" is listed by aivi/activities but not bound in the fixture.
    await openActivityEditor(panel, "grill");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: null,
      slug: "grill",
      name: "Grill",
      template: "monitor",
      active: null,
      bindings: {},
    });
    expect(text($(sr(panel), ".title"))).toBe("Grill");
    expect(text($(sr(panel), ".topbar .subtitle"))).toBe("Live Activity · Monitor · grill");

    const save = $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(text($(sr(panel), ".missing"))).toBe("To save, set Right column value, Active entity.");

    ($(sr(panel), ".setup aivi-entity-combobox") as AiviEntityCombobox).onSelect(
      "input_boolean.front_door",
    );
    await tick();
    expect(panel.editorState?.active).toBe("input_boolean.front_door");
    expect(save.disabled).toBe(true); // right_value still unbound

    if (panel.editorState) panel.editorState.bindings["right_value"] = "sensor.living_temp";
    const editor = $(sr(panel), "aivi-editor") as unknown as {
      updateValidation(): void;
    };
    editor.updateValidation();
    await tick();
    expect(save.disabled).toBe(false);

    const saveSpy = vi.spyOn(panel.api, "save").mockResolvedValue({ subentry_id: "a2" });
    save.click();
    await until(() => saveSpy.mock.calls.length > 0, "save call");
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "activity",
        slug: "grill",
        name: "Grill",
        template: "monitor",
        active: "input_boolean.front_door",
        bindings: { right_value: "sensor.living_temp" },
      }),
    );
  });

  it("has no create flow: no template switch, no slug or name inputs", async () => {
    const panel = await mountPanel();
    await openActivityEditor(panel, "grill");
    const setup = $(sr(panel), ".setup");
    // The lifecycle card carries only the active-entity combobox; the
    // identity comes from the remote activity and is not editable.
    expect(setup.querySelector(".seg")).toBeNull();
    const inputs = $$(setup, "input[type='text']");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.getAttribute("role")).toBe("combobox");
    expect(panel.editorState?.template).toBe("monitor");
  });

  it("previews the demo activity through the activity template pool", async () => {
    // Default fixture, real activity META: the editor's live preview must
    // resolve activity-only fields (header_left) and render the
    // lock-screen banner mock, not a widget canvas.
    const panel = await mountPanel();
    await openActivityEditor(panel, "washer");
    await until(() => panel.editorState?.preview != null, "activity preview");
    expect(panel.editorState?.preview).toMatchObject({
      progress: { value: 0.62 },
      header_left: { value: "Washing" },
    });
    await tick();
    expect(sr(panel).querySelector(".pv-banner")).not.toBeNull();
    expect(sr(panel).querySelector(".pv-canvas")).toBeNull();
  });

  it("pre-fills editor state from a bound activity", async () => {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.activities?.[0];
    if (!acc || !bound) throw new Error("no demo activity fixture");
    await openActivityEditor(panel, "washer");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: bound.subentry_id,
      slug: bound.slug,
      name: bound.name,
      template: bound.template,
      active: bound.active,
      bindings: bound.bindings,
    });
    expect(text($(sr(panel), ".title"))).toBe("Washer");
  });

  it("edits a bound activity whose remote counterpart vanished", async () => {
    // A bound activity deleted in the Aivi app is not in the remote list;
    // the editor still opens from the binding alone.
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/activities")
        (res as { activities: unknown[] }).activities = [];
      return res;
    };
    const panel = await mountPanel(hass);
    const acc = panel.accounts[0];
    const bound = acc?.activities?.[0];
    if (!acc || !bound) throw new Error("no demo activity fixture");
    panel.openActivityEditor(acc, null, bound);
    await until(() => !!sr(panel).querySelector(".setup"), "lifecycle card");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: bound.subentry_id,
      slug: "washer",
      template: "progress",
      active: "input_boolean.front_door",
    });
  });
});
