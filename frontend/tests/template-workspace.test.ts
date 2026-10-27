// The template workspace (aivi-template-workspace.ts): a template box's
// own page, at its own address (router.ts, panel-router.ts), and what
// it puts in at the caret: an entity or its attribute or a recipe from
// the Insert list (template-recipes.test.ts has the recipes themselves),
// a key of the phone's key row. Its layout by width, Insert's toggle and its memory, the keys,
// Escape, the leave guard and Save. The editor chunk does not load here,
// so the boxes are textareas, except where the last tests load it: one
// undo history across the box and the workspace, the editor's keys, and
// inserts that open nothing.

import { completionStatus } from "@codemirror/autocomplete";
import { undoDepth } from "@codemirror/commands";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { TEMPLATED } from "../harness/mock-hass.js";
import type { AiviEditor } from "../src/aivi-editor";
import { browserMatches, entitiesIn } from "../src/aivi-insert-list";
import type { AiviPanel } from "../src/aivi-panel";
import { isExpandShortcut } from "../src/aivi-template-box";
import { type AiviTemplateWorkspace, isInsertShortcut } from "../src/aivi-template-workspace";
import { mountCodeEditor } from "../src/code-editor/editor";
import { setEditorLoader } from "../src/code-editor/loader";
import { tOpt } from "../src/i18n";
import { isEntityId, listensLine } from "../src/template-feedback";
import { entityInsert, inTag, keyTitle, TEMPLATE_KEYS, withCaret } from "../src/template-inserts";
import { findTemplateSlot, slotNames, type TemplateSlot } from "../src/template-slots";
import { EDITOR_MIN, OUTPUT_WIDTH, RAIL_WIDTH, workspaceLayout } from "../src/workspace-layout";
import {
  $,
  $$,
  fieldRow,
  key,
  META,
  makeHass,
  mountRouted,
  openWidgetEditor,
  STATES,
  setInput,
  setSelect,
  sourceMenu,
  sr,
  takeBacks,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("what goes in at the caret", () => {
  it("knows whether the caret is in a tag", () => {
    expect(inTag("", 0)).toBe(false);
    expect(inTag("{{ 1 }} x", 8)).toBe(false);
    expect(inTag("{{ 1 + }}", 7)).toBe(true);
    expect(inTag("{% if x %}", 6)).toBe(true);
  });

  it("puts an entity's state or attribute in, in {{ }} outside a tag", () => {
    expect(entityInsert("sensor.living_temp", null, "Now ", 4)).toEqual({
      text: "{{ states('sensor.living_temp') }}",
      caret: 34,
    });
    expect(entityInsert("climate.living_room", "hvac_action", "{{  }}", 3)).toEqual({
      text: "state_attr('climate.living_room', 'hvac_action')",
      caret: 48,
    });
  });

  it("puts the id alone where a call already asks for one", () => {
    expect(entityInsert("light.porch", null, "{{ states() }}", 10)).toEqual({
      text: "'light.porch'",
      caret: 13,
    });
    expect(entityInsert("light.porch", null, "{{ is_state('', 'on') }}", 13)).toEqual({
      text: "light.porch",
      caret: 11,
    });
    // An attribute, or a selection, goes in whole.
    expect(entityInsert("light.porch", "x", "{{ states() }}", 10).text).toBe(
      "state_attr('light.porch', 'x')",
    );
  });

  it("keeps an insert apart from a word beside it", () => {
    // After "1" inside a tag: a space, not {{ 1states(…) }}.
    expect(entityInsert("sensor.a", null, "{{ 1 }}", 4)).toEqual({
      text: " states('sensor.a')",
      caret: 19,
    });
    // Before a word: a space after it.
    expect(entityInsert("sensor.a", null, "Now", 0).text).toBe("{{ states('sensor.a') }} ");
    // Over a selection, what is around it counts.
    expect(entityInsert("sensor.a", null, "a XX b", 2, 4).text).toBe("{{ states('sensor.a') }}");
    expect(entityInsert("sensor.a", null, "aXXb", 1, 3).text).toBe(" {{ states('sensor.a') }} ");
    // Next to punctuation or a space, nothing is added.
    expect(entityInsert("sensor.a", null, "{{ states('x') }}", 17).text).toBe(
      "{{ states('sensor.a') }}",
    );
  });

  it("starts a new line after a block tag that ends its line", () => {
    expect(entityInsert("sensor.a", null, "{% set v = 1 %}  \n{{ v }}", 17).text).toBe(
      "\n{{ states('sensor.a') }}",
    );
    // Not when the line goes on, nor after an expression.
    expect(entityInsert("sensor.a", null, "{% if x %}On", 10).text).toBe(
      "{{ states('sensor.a') }} ",
    );
    expect(entityInsert("sensor.a", null, "{{ x }}", 7).text).toBe("{{ states('sensor.a') }}");
  });

  it("types the keys a phone's keyboard hides, {{ }} with the caret inside", () => {
    const keys = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k.id, withCaret(k.text)]));
    expect(keys["output"]).toEqual({ text: "{{  }}", caret: 3 });
    expect(keys["statement"]).toEqual({ text: "{%  %}", caret: 3 });
    expect(keys["quote"]).toEqual({ text: "'", caret: 1 });
    expect(TEMPLATE_KEYS.map((k) => k.label)).toEqual(["{{ }}", "{% %}", "|", "'"]);
    for (const k of TEMPLATE_KEYS) expect(tOpt(keyTitle(k)), k.id).toBeTruthy();
    expect(withCaret("plain")).toEqual({ text: "plain", caret: 5 });
  });
});

describe("the entity browser", () => {
  const options = [
    { id: "sensor.living_temp", name: "Living room temperature" },
    { id: "climate.living_room", name: "Living room thermostat" },
    { id: "light.porch", name: "Porch" },
  ];

  it("finds entities by name or id, those in the template apart", () => {
    expect(browserMatches(options, "living", []).map((o) => o.id)).toEqual([
      "sensor.living_temp",
      "climate.living_room",
    ]);
    expect(browserMatches(options, "room thermo", []).map((o) => o.id)).toEqual([
      "climate.living_room",
    ]);
    expect(browserMatches(options, "porch", []).map((o) => o.id)).toEqual(["light.porch"]);
    expect(browserMatches(options, "", ["light.porch"]).map((o) => o.id)).not.toContain(
      "light.porch",
    );
  });

  it("lists the entities a template names that Home Assistant has", () => {
    const hass = makeHass();
    expect(
      entitiesIn(
        "{{ states('sensor.living_temp') }} {{ states('sensor.nope') }} sensor.living_temp",
        hass,
      ),
    ).toEqual(["sensor.living_temp"]);
  });
});

describe("Updates on", () => {
  it("knows an entity id from text that is not one yet", () => {
    expect(isEntityId("sensor.living_temp")).toBe(true);
    expect(isEntityId("living")).toBe(false);
    expect(isEntityId("sensor.")).toBe(false);
    expect(isEntityId("Sensor.x")).toBe(false);
    expect(isEntityId("sensor._x")).toBe(false);
    expect(isEntityId("sensor.a__b")).toBe(false);
  });

  it("shows no chip for half typed text, and no warning for it either", () => {
    const listens = { entities: ["living"], domains: [], all: false, time: false };
    const host = document.createElement("div");
    document.body.append(host);
    render(listensLine(listens), host);
    expect(host.querySelector(".chip")).toBeNull();
    expect(text(host)).toBe("");
    render(listensLine({ ...listens, entities: ["living", "sensor.living_temp"] }), host);
    expect($$(host, ".chip").map(text)).toEqual(["sensor.living_temp"]);
    // An id Home Assistant does not have is still an id: its chip stays
    // (and "did you mean" names it).
    render(listensLine({ ...listens, entities: ["sensor.livingroom_temp"] }), host);
    expect($$(host, ".chip").map(text)).toEqual(["sensor.livingroom_temp"]);
  });
});

describe("the workspace's shortcuts", () => {
  it("expands with Ctrl or Cmd+Shift+E and toggles Insert with Ctrl or Cmd+I", () => {
    const down = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", init);
    expect(isExpandShortcut(down({ key: "E", shiftKey: true, ctrlKey: true }))).toBe(true);
    expect(isExpandShortcut(down({ key: "E", shiftKey: true, metaKey: true }))).toBe(true);
    expect(isExpandShortcut(down({ key: "E", shiftKey: true }))).toBe(false);
    expect(isExpandShortcut(down({ key: "E", shiftKey: true, ctrlKey: true, altKey: true }))).toBe(
      false,
    );
    expect(isInsertShortcut(down({ key: "i", ctrlKey: true }))).toBe(true);
    expect(isInsertShortcut(down({ key: "i", metaKey: true }))).toBe(true);
    expect(isInsertShortcut(down({ key: "I", metaKey: true, shiftKey: true }))).toBe(false);
    expect(isInsertShortcut(down({ key: "i" }))).toBe(false);
  });
});

describe("the template workspace's layout", () => {
  it("docks three zones, then lays the rail over the editor, then folds the output", () => {
    const docked = RAIL_WIDTH + EDITOR_MIN + OUTPUT_WIDTH;
    expect(workspaceLayout(1760, false)).toBe("docked");
    expect(workspaceLayout(docked, false)).toBe("docked");
    expect(workspaceLayout(docked - 1, false)).toBe("overlay");
    expect(workspaceLayout(EDITOR_MIN + OUTPUT_WIDTH, false)).toBe("overlay");
    expect(workspaceLayout(EDITOR_MIN + OUTPUT_WIDTH - 1, false)).toBe("strip");
    expect(workspaceLayout(400, false)).toBe("strip");
    // A phone is a phone at any width.
    expect(workspaceLayout(1760, true)).toBe("phone");
    // The widths it is checked at: 1440 and up docks (20 px gutters), a
    // 1280 window with Home Assistant's sidebar open (1024) keeps the
    // output docked.
    expect(workspaceLayout(1440 - 40, false)).toBe("docked");
    expect(workspaceLayout(1280 - 256 - 40, false)).toBe("overlay");
  });
});

describe("the template workspace", () => {
  afterEach(() => {
    history.replaceState(null, "", "/");
    sessionStorage.clear();
    takeBacks();
  });

  const TEXT = "{{ states('sensor.living_temp') }}";

  /** The Front door editor, opened from the hub, its State a template. */
  async function templateState(narrow = false): Promise<{
    panel: AiviPanel;
    editor: AiviEditor;
    row: () => HTMLElement;
    root: ShadowRoot;
  }> {
    const panel = await mountRouted("");
    panel.narrow = narrow;
    const editor = await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const row = (): HTMLElement => fieldRow(root, "state");
    setSelect(sourceMenu(row()), "template");
    await tick();
    setInput($(row(), "textarea"), TEXT);
    await until(
      () => editor.previewedTemplate("state")?.includes("living_temp") === true,
      "result",
    );
    await tick();
    return { panel, editor, row, root };
  }

  const workspace = (root: ShadowRoot): AiviTemplateWorkspace | null =>
    root.querySelector("aivi-template-workspace");

  async function expand(row: () => HTMLElement, root: ShadowRoot): Promise<AiviTemplateWorkspace> {
    $(row(), ".texpand").click();
    await until(() => workspace(root) !== null, "the workspace");
    await tick();
    return workspace(root) as AiviTemplateWorkspace;
  }

  const box = (ws: HTMLElement): HTMLTextAreaElement =>
    $(ws, "aivi-code-editor.wsed textarea") as HTMLTextAreaElement;

  it("opens on its own address with the form kept under it, and Back returns to the field", async () => {
    const { panel, editor, row, root } = await templateState();
    const expandButton = $(row(), ".texpand");
    expect(expandButton.getAttribute("aria-label")).toBe("Expand the State template");
    expect(expandButton.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+E Meta+Shift+E");
    takeBacks();
    const ws = await expand(row, root);
    expect(panel.route).toEqual({ prefix: "/aivi", path: "/widget/frontdoor/state/template" });
    expect(location.pathname).toBe("/aivi/widget/frontdoor/state/template");
    // The workspace is the page; the form waits, hidden, as it was.
    expect($(root, ".edpage").hidden).toBe(true);
    expect(row().isConnected).toBe(true);
    expect($(root, ".wrap").classList.contains("ws")).toBe(true);
    expect(text($(ws, ".wshead h2"))).toBe("State template");
    expect(text($(ws, ".wshead .subtitle"))).toBe("Front door");
    expect(box(ws).value).toBe(TEXT);
    expect(root.activeElement).toBe(box(ws));
    // Its result, beside the editor.
    expect(text($(ws, ".wsout .tres .tval"))).toBe(STATES["sensor.living_temp"]!.state);
    // An edit there is the field's.
    setInput(box(ws), "{{ states('light.porch') }}");
    await tick();
    expect(editor.editorState.bindings["state__template"]).toBe("{{ states('light.porch') }}");
    $(ws, ".wshead .backbtn").click();
    await until(() => workspace(root) === null, "back");
    await tick();
    // Back to the form's own entry, which the host echoes.
    expect(takeBacks()).toBe(1);
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor" };
    expect($(root, ".edpage").hidden).toBe(false);
    expect($(root, ".wrap").classList.contains("ws")).toBe(false);
    const inline = $(row(), ".tbox textarea") as HTMLTextAreaElement;
    expect(inline.value).toBe("{{ states('light.porch') }}");
    expect(root.activeElement).toBe(inline);
  });

  it("goes between the form and the workspace with back and forward, never asking", async () => {
    const { panel, editor, row, root } = await templateState();
    await expand(row, root);
    expect(editor.isDirty()).toBe(true);
    // The browser's back: the host assigns the form's route.
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor" };
    await tick();
    expect(workspace(root)).toBeNull();
    expect(panel.view).toBe("editor");
    expect(root.querySelector("dialog.leavedlg")?.hasAttribute("open")).toBe(false);
    // And forward again.
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor/state/template" };
    await until(() => workspace(root) !== null, "forward");
    expect(panel.workspace).toBe("state");
    // Leaving the editor from the workspace asks, as from the form.
    panel.route = { prefix: "/aivi", path: "" };
    await tick();
    expect(panel.view).toBe("editor");
    expect(workspace(root)).not.toBeNull();
    expect($(root, "dialog.leavedlg").hasAttribute("open")).toBe(true);
    expect(location.pathname).toBe("/aivi/widget/frontdoor/state/template");
  });

  it("opens from a link or a reload where the box is, and lands on the form where it is not", async () => {
    history.replaceState(null, "", "/aivi?templated=1");
    const stored = await mountRouted("/widget/frontdoor/state/template");
    await until(() => workspace(sr(stored)) !== null, "the stored template's workspace");
    const ws = workspace(sr(stored)) as AiviTemplateWorkspace;
    expect(box(ws).value).toBe(TEMPLATED["state__template"]);
    // Back from a link: the form takes the workspace's entry.
    takeBacks();
    $(ws, ".wshead .backbtn").click();
    await until(() => workspace(sr(stored)) === null, "back");
    expect(takeBacks()).toBe(0);
    expect(location.pathname).toBe("/aivi/widget/frontdoor");
    document.body.innerHTML = "";

    // Without a template there, the form, at its own address.
    history.replaceState(null, "", "/aivi");
    for (const path of ["/widget/frontdoor/state/template", "/widget/frontdoor/nope/template"]) {
      const panel = await mountRouted(path);
      await until(() => panel.view === "editor", "the editor");
      await tick();
      expect(workspace(sr(panel))).toBeNull();
      expect(panel.route?.path).toBe("/widget/frontdoor");
      document.body.innerHTML = "";
    }
  });

  it("Escape empties the Insert search, then closes the rail, then goes back", async () => {
    const { panel, row, root } = await templateState();
    const ws = await expand(row, root);
    // Open the first time, docked.
    const search = $(ws, ".wsrail .inssearch") as HTMLInputElement;
    setInput(search, "porch");
    await tick();
    key(search, "Escape");
    await tick();
    expect(search.value).toBe("");
    expect(ws.querySelector(".wsrail")).not.toBeNull();
    key(search, "Escape");
    await tick();
    expect(ws.querySelector(".wsrail")).toBeNull();
    expect(workspace(root)).not.toBeNull();
    key(box(ws), "Escape");
    await until(() => workspace(root) === null, "back");
    expect(panel.view).toBe("editor");
  });

  it("toggles Insert with its button and Ctrl or Cmd+I, remembered for the session", async () => {
    const { row, root } = await templateState();
    let ws = await expand(row, root);
    const toggle = $(ws, ".wshead .wsinsert");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-keyshortcuts")).toBe("Control+I Meta+I");
    toggle.click();
    await tick();
    expect(ws.querySelector(".wsrail")).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(sessionStorage.getItem("aivi-insert-rail")).toBe("closed");
    // Mod+I from the editor opens it with the focus in its search, and
    // closes it again.
    key(box(ws), "i", { ctrlKey: true });
    await tick();
    expect(root.activeElement).toBe($(ws, ".wsrail .inssearch"));
    key($(ws, ".wsrail .inssearch"), "i", { metaKey: true });
    await tick();
    expect(ws.querySelector(".wsrail")).toBeNull();
    expect(root.activeElement).toBe(box(ws));
    // Closed it stays, the next time too.
    key(box(ws), "Escape");
    await until(() => workspace(root) === null, "back");
    ws = await expand(row, root);
    expect(ws.querySelector(".wsrail")).toBeNull();
  });

  it("lays the zones out by its width, the rail over the editor where three do not fit", async () => {
    const { panel, row, root } = await templateState();
    const ws = await expand(row, root);
    ws.fit(1400);
    await tick();
    expect(ws.layout).toBe("docked");
    expect($(ws, ".ws").classList.contains("docked")).toBe(true);
    expect(ws.querySelector(".wsrail")).not.toBeNull();
    expect(ws.querySelector(".wsout")).not.toBeNull();
    // Narrower: the rail closes (it would lie over the code), the output
    // stays.
    ws.fit(1000);
    await tick();
    expect(ws.layout).toBe("overlay");
    expect(ws.querySelector(".wsrail")).toBeNull();
    expect(ws.querySelector(".wsout")).not.toBeNull();
    $(ws, ".wsinsert").click();
    await tick();
    expect($(ws, ".ws").classList.contains("rail")).toBe(true);
    // Narrower still: the output is a line that opens.
    ws.fit(800);
    await tick();
    expect(ws.layout).toBe("strip");
    expect(ws.querySelector(".wsout")).toBeNull();
    const strip = $(ws, ".wsstripbtn");
    expect(text(strip)).toContain(STATES["sensor.living_temp"]!.state);
    expect(strip.getAttribute("aria-expanded")).toBe("false");
    strip.click();
    await tick();
    expect(ws.querySelector(".wsstripbody aivi-preview-pane")).not.toBeNull();
    // Open, the line names what it holds; the result is said once, below.
    expect(text($(ws, ".wsstripbtn"))).toBe("Preview and result");
    // Wide again: docked, the rail as it was left (open).
    ws.fit(1500);
    await tick();
    expect(ws.layout).toBe("docked");
    expect(ws.querySelector(".wsrail")).not.toBeNull();
    // A phone.
    panel.narrow = true;
    await tick();
    ws.requestUpdate();
    await tick();
    expect(ws.layout).toBe("phone");
  });

  it("puts an entity, an attribute or a recipe in at the caret, chosen with the keys", async () => {
    const { editor, row, root } = await templateState();
    const ws = await expand(row, root);
    const area = box(ws);
    area.setSelectionRange(area.value.length, area.value.length);
    const list = $(ws, ".wsrail aivi-insert-list");
    const template = (): unknown => editor.editorState.bindings["state__template"];
    // The template's own entities, the recipes, then all of them.
    expect($$(list, ".inshead").map(text)).toEqual(["In this template", "Recipes", "All entities"]);
    const search = (): HTMLElement => $(list, ".inssearch");
    expect(search().getAttribute("role")).toBe("combobox");
    expect(search().getAttribute("placeholder")).toBe("Search entities and recipes");
    setInput(search(), "porch");
    await tick();
    expect($$(list, ".inshead").map(text)).toEqual(["Matching entities"]);
    const first = $(list, ".insopt");
    expect(search().getAttribute("aria-activedescendant")).toBe(first.id);
    key(search(), "Enter");
    await tick();
    expect(template()).toBe(`${TEXT}{{ states('light.porch') }}`);
    // An attribute, inside a tag: Right shows the entity's recipes and
    // attributes, Left hides them.
    setInput(area, "{{  }}");
    area.setSelectionRange(3, 3);
    setInput(search(), "thermostat");
    await tick();
    key(search(), "ArrowRight");
    await tick();
    const rows = (): HTMLElement[] => $$(list, ".insopt");
    expect(rows().some((r) => r.matches(".recipe.sub"))).toBe(true);
    const hvac = rows().findIndex((r) => text(r).includes("hvac_action"));
    expect(hvac).toBeGreaterThan(0);
    for (let i = 0; i < hvac; i++) key(search(), "ArrowDown");
    await tick();
    expect(search().getAttribute("aria-activedescendant")).toBe(rows()[hvac]?.id);
    key(search(), "ArrowLeft");
    await tick();
    expect(rows().some((r) => text(r).includes("hvac_action"))).toBe(false);
    key(search(), "ArrowRight");
    await tick();
    for (let i = 0; i < hvac; i++) key(search(), "ArrowDown");
    await tick();
    key(search(), "Enter");
    await tick();
    expect(template()).toBe("{{ state_attr('climate.living_room', 'hvac_action') }}");
    expect(area.selectionStart).toBe(51);

    // A recipe asks for its entity, the template's first, and writes the
    // template whole for it, in place of the state it read.
    setInput(area, "{{ states('light.porch') }}");
    area.setSelectionRange(0, 0);
    setInput(search(), "on and off");
    await tick();
    key(search(), "Enter");
    await tick();
    expect(text($(list, ".insstep"))).toContain("Words for on and off");
    expect(search().getAttribute("placeholder")).toBe("Search entities");
    expect($$(list, ".inshead").map(text)).toEqual(["In this template", "Entities it fits", "Or"]);
    // Only entities with an on and an off.
    expect(rows().some((r) => text(r).includes("sensor.living_temp"))).toBe(false);
    expect(search().getAttribute("aria-activedescendant")).toBe($(list, ".insopt.active").id);
    expect(text($(list, ".insopt.active"))).toContain("light.porch");
    expect(text($(list, ".insprev code"))).toBe(
      "{{ 'On' if is_state('light.porch', 'on') else 'Off' }}",
    );
    key(search(), "Enter");
    await tick();
    expect(template()).toBe("{{ 'On' if is_state('light.porch', 'on') else 'Off' }}");
    expect(list.querySelector(".insstep")).toBeNull();
    // A screen reader hears what went in.
    expect(text($(ws, ".ws > .sr-only[role=status]"))).toBe(
      "Inserted Words for on and off, like Open and Closed",
    );
    // Escape goes back from the step, on the recipe; without an entity
    // the caret lands in the quotes to fill.
    setInput(area, "");
    setInput(search(), "rounded");
    await tick();
    key(search(), "Enter");
    await tick();
    key(search(), "Escape");
    await tick();
    expect(list.querySelector(".insstep")).toBeNull();
    expect(text($(list, ".insopt.active"))).toContain("A state rounded, with its unit");
    key(search(), "ArrowRight");
    await tick();
    rows().at(-1)?.click();
    await tick();
    expect(template()).toBe("{{ states('', rounded=True, with_unit=True) }}");
    expect(area.selectionStart).toBe(11);
    // Under an entity, a recipe goes in for it at once.
    setInput(area, "");
    setInput(search(), "porch");
    await tick();
    key(search(), "ArrowRight");
    await tick();
    $$(list, ".insopt.recipe.sub")
      .find((r) => text(r) === "Time since it changed")
      ?.click();
    await tick();
    expect(template()).toBe("{{ relative_time(states['light.porch'].last_changed) }}");
  });

  it("saves the widget from its header and stays in the workspace", async () => {
    const { panel, row, root } = await templateState();
    const ws = await expand(row, root);
    takeBacks();
    const save = $(ws, ".wshead .savebtn") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    await until(() => panel.editorState?.saving === false, "saved");
    expect(panel.view).toBe("editor");
    expect(panel.workspace).not.toBeNull();
    expect(takeBacks()).toBe(0);
  });

  it("says what a template gives in its header, for a field, a color and a phase", async () => {
    const { row, root } = await templateState();
    expect(text($(row(), ".fhint"))).toBe(tOpt("field-hint-template.state"));
    const ws = await expand(row, root);
    expect(text($(ws, ".wshead h2"))).toBe("State template");
    const meta = META.templates["progress"];
    const bindings = {
      bar_color__template: "{{ 'red' }}",
      segments: [{ value: 1 }, { value: 1, source__template: "{{ 2 }}" }],
    };
    expect(findTemplateSlot(meta, bindings, "bar_color")?.kind).toBe("slot");
    expect(findTemplateSlot(meta, bindings, "segments.1.source")).toMatchObject({
      kind: "segment",
      index: 1,
    });
    expect(findTemplateSlot(meta, bindings, "segments.0.source")).toBeNull();
    expect(findTemplateSlot(meta, bindings, "state")).toBeNull();
    const names = slotNames(
      findTemplateSlot(meta, bindings, "segments.1.source") as TemplateSlot,
      bindings,
    );
    expect(names).toEqual({ label: "Phase 2", parent: "Progress bar" });
    const status = META.templates["status"];
    const color = { value__color__template: "{{ 'red' }}" };
    expect(
      slotNames(findTemplateSlot(status, color, "value__color") as TemplateSlot, color),
    ).toEqual({ label: "Color", parent: tOpt("field-label.value") ?? "Value" });
    const second = { icon__secondary_color__template: "{{ 'red' }}" };
    expect(
      slotNames(findTemplateSlot(status, second, "icon__secondary_color") as TemplateSlot, second),
    ).toEqual({ label: "Second color", parent: "Icon" });
  });

  it("on a phone: a strip for the result, the key row, and Insert as a sheet", async () => {
    const { editor, row, root } = await templateState(true);
    const ws = await expand(row, root);
    expect(ws.layout).toBe("phone");
    expect(ws.querySelector(".wsrail, .wsout, .wsdocs")).toBeNull();
    const strip = $(ws, ".wsstripbtn");
    expect(text(strip)).toContain(STATES["sensor.living_temp"]!.state);
    strip.click();
    await tick();
    expect(ws.querySelector(".wsstripbody .wsmini .pv-scale")).not.toBeNull();
    const keys = $(ws, ".wskeys");
    expect(keys.getAttribute("aria-label")).toBe("Template keys");
    expect($$(keys, ".wskey").map((k) => k.getAttribute("aria-label"))).toEqual([
      "Move left",
      "Move right",
      "Expression",
      "Statement",
      "Filter",
      "Quote",
      "Undo",
    ]);
    const area = box(ws);
    setInput(area, "Now ");
    area.setSelectionRange(4, 4);
    const press = (name: string): void =>
      $$(keys, ".wskey")
        .find((k) => k.getAttribute("aria-label") === name)
        ?.click();
    press("Expression");
    await tick();
    expect(editor.editorState.bindings["state__template"]).toBe("Now {{  }}");
    expect(area.selectionStart).toBe(7);
    press("Move left");
    expect(area.selectionStart).toBe(6);
    press("Move right");
    expect(area.selectionStart).toBe(7);
    // Insert, in the header, opens the sheet; a pick closes it.
    const insert = $(ws, ".wshead .wsinsert");
    insert.click();
    await tick();
    expect(insert.getAttribute("aria-pressed")).toBe("true");
    const sheet = $(ws, ".wssheet");
    expect(insert.getAttribute("aria-controls")).toBe(sheet.id);
    expect(sheet.getAttribute("aria-label")).toBe("Insert");
    setInput($(sheet, ".inssearch"), "porch");
    await tick();
    $(sheet, ".insopt").click();
    await tick();
    expect(ws.querySelector(".wssheet")).toBeNull();
    expect(editor.editorState.bindings["state__template"]).toBe("Now {{ states('light.porch') }}");
  });
});

describe("the template workspace with the code editor in", () => {
  afterEach(() => {
    setEditorLoader(null);
    history.replaceState(null, "", "/");
    sessionStorage.clear();
  });

  const SEEDED = "{{ states('input_boolean.front_door') }}";

  async function codeState(): Promise<{
    editor: AiviEditor;
    row: () => HTMLElement;
    root: ShadowRoot;
  }> {
    setEditorLoader(() => Promise.resolve(mountCodeEditor));
    const panel = await mountRouted("");
    const editor = await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const row = (): HTMLElement => fieldRow(root, "state");
    setSelect(sourceMenu(row()), "template");
    await until(() => row().querySelector(".tbox .cm-editor") !== null, "the code editor");
    return { editor, row, root };
  }

  function viewIn(el: Element | null): EditorView {
    const view = EditorView.findFromDOM(el?.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("no editor");
    return view;
  }

  const typeAtEnd = (view: EditorView, text: string): void => {
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: "input.type",
    });
  };
  const press = (view: EditorView, key: string, init: KeyboardEventInit = {}): boolean =>
    runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...init }), "editor");

  async function expand(row: () => HTMLElement, root: ShadowRoot): Promise<HTMLElement> {
    $(row(), ".texpand").click();
    await until(
      () => root.querySelector("aivi-template-workspace .wsed .cm-editor") !== null,
      "the workspace editor",
    );
    return $(root, "aivi-template-workspace");
  }

  it("keeps one undo history across the box and the workspace", async () => {
    const { editor, row, root } = await codeState();
    const inline = viewIn(row().querySelector(".tbox"));
    expect(inline.state.doc.toString()).toBe(SEEDED);
    typeAtEnd(inline, " a");
    const ws = viewIn(await expand(row, root));
    // The workspace goes on from the box: its typing undoes there.
    expect(undoDepth(ws.state)).toBe(1);
    typeAtEnd(ws, "\nb");
    expect(editor.editorState.bindings["state__template"]).toBe(`${SEEDED} a\nb`);
    editor.closeTemplate();
    await until(() => root.querySelector("aivi-template-workspace") === null, "back");
    await tick();
    // Back in the box, both edits undo, one at a time, and redo.
    const box = viewIn(row().querySelector(".tbox"));
    expect(box.state.doc.toString()).toBe(`${SEEDED} a\nb`);
    press(box, "z", { ctrlKey: true });
    expect(box.state.doc.toString()).toBe(`${SEEDED} a`);
    press(box, "z", { ctrlKey: true });
    expect(box.state.doc.toString()).toBe(SEEDED);
    expect(editor.editorState.bindings["state__template"]).toBe(SEEDED);
    press(box, "y", { ctrlKey: true });
    expect(box.state.doc.toString()).toBe(`${SEEDED} a`);
    // Opened again, the workspace has it all.
    const again = viewIn(await expand(row, root));
    expect(again.state.doc.toString()).toBe(`${SEEDED} a`);
    press(again, "z", { ctrlKey: true });
    expect(again.state.doc.toString()).toBe(SEEDED);
  });

  it("indents with Tab, finds with Mod+F, comments with Mod+/, wraps with Alt+Z", async () => {
    const { editor, row, root } = await codeState();
    const el = await expand(row, root);
    const ws = viewIn(el);
    ws.dispatch({ selection: { anchor: 0 } });
    // Tab indents and Shift+Tab outdents; the inline box's Tab moves on.
    expect(press(ws, "Tab")).toBe(true);
    expect(ws.state.doc.toString()).toBe(`  ${SEEDED}`);
    expect(press(ws, "Tab", { shiftKey: true })).toBe(true);
    expect(ws.state.doc.toString()).toBe(SEEDED);
    // Ctrl+M (Shift+Alt+M on a Mac) lets Tab move the focus instead, and
    // back.
    const tabMoves = (): boolean =>
      (ws as unknown as { inputState: { tabFocusMode: number } }).inputState.tabFocusMode === 0;
    expect(tabMoves()).toBe(false);
    expect(press(ws, "m", { ctrlKey: true })).toBe(true);
    expect(tabMoves()).toBe(true);
    press(ws, "m", { ctrlKey: true });
    expect(tabMoves()).toBe(false);
    // Mod+/ comments the line out with {# #}, and back.
    expect(press(ws, "/", { ctrlKey: true })).toBe(true);
    expect(ws.state.doc.toString()).toBe(`{# ${SEEDED} #}`);
    press(ws, "/", { ctrlKey: true });
    expect(ws.state.doc.toString()).toBe(SEEDED);
    // Alt+Up and Alt+Down move lines.
    typeAtEnd(ws, "\nb");
    expect(press(ws, "ArrowUp", { altKey: true })).toBe(true);
    expect(ws.state.doc.toString()).toBe(`b\n${SEEDED}`);
    press(ws, "ArrowDown", { altKey: true });
    // Mod+F opens the find bar with the selection; Enter steps; Escape
    // closes it without leaving the workspace.
    // (happy-dom reports a focused editor's selection change while it is
    // being made; a browser does it after.)
    ws.contentDOM.blur();
    ws.dispatch({ selection: { anchor: 3, head: 9 } });
    expect(press(ws, "f", { ctrlKey: true })).toBe(true);
    await tick();
    const find = $(el, ".wsfind input") as HTMLInputElement;
    expect(find.value).toBe("states");
    expect(text($(el, ".wsfcount"))).toBe("1 of 1");
    expect(el.querySelectorAll(".cm-aivi-match").length).toBe(1);
    setInput(find, "o");
    await tick();
    expect(text($(el, ".wsfcount"))).toMatch(/^\d of \d$/);
    key(find, "Enter");
    await tick();
    expect(ws.state.sliceDoc(ws.state.selection.main.from, ws.state.selection.main.to)).toBe("o");
    key(find, "Escape");
    await tick();
    expect(el.querySelector(".wsfind")).toBeNull();
    expect(el.querySelectorAll(".cm-aivi-match").length).toBe(0);
    expect(root.querySelector("aivi-template-workspace")).not.toBeNull();
    // Alt+Z wraps long lines, and the status bar's Wrap says so.
    const wrap = $(el, ".wsstatus .wswrap");
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
    expect(ws.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    expect(press(ws, "z", { altKey: true })).toBe(true);
    await tick();
    expect(ws.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
    expect(sessionStorage.getItem("aivi-template-wrap")).toBe("on");
    // Where the caret is.
    ws.dispatch({ selection: { anchor: ws.state.doc.length } });
    await tick();
    expect(text($(el, ".wsstatus"))).toContain("Line 2, column 2");
    expect(editor.editorState.bindings["state__template"]).toBe(`${SEEDED}\nb`);
  });

  it("puts an insert in at the drawn caret, opening nothing", async () => {
    const { editor, row, root } = await codeState();
    const el = await expand(row, root);
    const ws = viewIn(el);
    expect(el.querySelector(".cm-editor.cm-aivi-keep .cm-cursorLayer")).not.toBeNull();
    ws.dispatch({ changes: { from: 0, to: ws.state.doc.length, insert: "" } });
    const search = $(el, ".inssearch");
    setInput(search, "rounded");
    await tick();
    key(search, "Enter");
    await tick();
    setInput(search, "living room temp");
    await tick();
    key(search, "Enter");
    await tick();
    await tick();
    const written = "{{ states('sensor.living_temp', rounded=True, with_unit=True) }}";
    expect(editor.editorState.bindings["state__template"]).toBe(written);
    // The entities the template reads come back on their own; their
    // preview is the one every run sends.
    await until(() => editor.editorState.bindings["state__watched"] !== undefined, "watched");
    expect(ws.state.selection.main.head).toBe(written.length);
    expect(completionStatus(ws.state)).toBeNull();
    expect(el.querySelector(".cm-tooltip-autocomplete")).toBeNull();
  });
  it("shows an entity's card where the caret rests, and fixes a result in one press", async () => {
    const { editor, row, root } = await codeState();
    const el = await expand(row, root);
    const ws = viewIn(el);
    // The caret moved onto an id: its card, after a moment.
    ws.focus();
    ws.dispatch({ selection: { anchor: 16 } });
    await until(() => el.querySelector(".entcard") !== null, "the entity card");
    expect(text($(el, ".entname"))).toBe("Front door open");
    expect(ws.contentDOM.getAttribute("aria-describedby")).toContain("aivi-ws-card");
    // Escape takes the card first, and only the card.
    key(ws.contentDOM, "Escape");
    await tick();
    expect(el.querySelector(".entcard")).toBeNull();
    expect(root.querySelector("aivi-template-workspace")).not.toBeNull();
    // Typing takes it too.
    ws.dispatch({ selection: { anchor: 17 } });
    await until(() => el.querySelector(".entcard") !== null, "the card again");
    typeAtEnd(ws, " ");
    await until(() => el.querySelector(".entcard") === null, "the card gone");

    // A reading with fifteen decimals: rounded with the hint's fix, as one
    // edit.
    ws.dispatch({
      changes: {
        from: 0,
        to: ws.state.doc.length,
        insert: "{{ states('sensor.living_temp') | float(0) / 3 }}",
      },
    });
    await until(
      () => el.querySelector(".wsout .wshint .wsfix:not([disabled])") !== null,
      "the hint",
    );
    expect(text($(el, ".wsout .wshint .wshtext"))).toBe("It shows 15 decimals.");
    $(el, ".wsout .wshint .wsfix").click();
    await tick();
    expect(editor.editorState.bindings["state__template"]).toBe(
      "{{ (states('sensor.living_temp') | float(0) / 3) | round(2) }}",
    );
    await until(() => el.querySelector(".wsout .wshint") === null, "the hint gone");
  });

  it("offers an icon's recipes, and puts a symbol Apple has in place of one it lacks", async () => {
    setEditorLoader(() => Promise.resolve(mountCodeEditor));
    const panel = await mountRouted("");
    const editor = await openWidgetEditor(panel, "frontdoor");
    const root = sr(panel);
    const row = (): HTMLElement => fieldRow(root, "icon");
    setSelect(sourceMenu(row()), "template");
    await until(() => row().querySelector(".tbox .cm-editor") !== null, "the code editor");
    const el = await expand(row, root);
    expect(text($(el, ".wshead h2"))).toBe("Icon template");
    const list = $(el, "aivi-insert-list");
    const titles = $$(list, ".insopt.recipe").map(text).join(" ");
    expect(titles).toContain("An icon for on and off");
    expect(titles).toContain("An icon by level");
    const ws = viewIn($(el, ".wsmain"));
    ws.dispatch({ changes: { from: 0, to: ws.state.doc.length, insert: "{{ 'lightbulb.fil' }}" } });
    await until(
      () => el.querySelector(".wsout .wshint .wsfix:not([disabled])") !== null,
      "the symbol hint",
    );
    expect(text($(el, ".wsout .wshint .wshtext"))).toBe(
      "“lightbulb.fil” is not in Apple's symbol list, so the device may show no icon.",
    );
    $(el, ".wsout .wshint .wsfix").click();
    await tick();
    expect(editor.editorState.bindings["icon__template"]).toBe("{{ 'lightbulb.fill' }}");
  });
});
