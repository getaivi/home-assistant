// What a template box says under it: the result and its kind, what Home
// Assistant re-renders it on, errors with their place in plain words
// (shown once typing pauses), "did you mean" for an entity id Home
// Assistant does not have, and a box that grows with its text.

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import { fitTemplateBox } from "../src/code-editor/element";
import { ERROR_SETTLE_MS } from "../src/editor-preview";
import {
  errorPlain,
  errorWhere,
  kindText,
  LISTED_ENTITIES,
  listensLine,
  replaceEntity,
  templateFeedback,
} from "../src/template-feedback";
import type { FieldFeedback, TemplateListens } from "../src/types/content";
import {
  $,
  $$,
  fieldRow,
  mountPanel,
  openWidgetEditor,
  rule,
  STATES,
  setInput,
  setSelect,
  sourceMenu,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function shown(result: unknown): HTMLElement {
  const host = document.createElement("div");
  render(result, host);
  document.body.append(host);
  return host;
}

const NONE: TemplateListens = { entities: [], domains: [], all: false, time: false };

describe("the result's kind", () => {
  it("words each kind", () => {
    expect(kindText({ status: "ok", kind: "text" })).toBe("text");
    expect(kindText({ status: "ok", kind: "number" })).toBe("number");
    expect(kindText({ status: "ok", kind: "bool" })).toBe("true or false");
    expect(kindText({ status: "empty", kind: "nothing" })).toBe("nothing");
    expect(kindText({ status: "ok", kind: "list", items: 1 })).toBe("list of 1 item");
    expect(kindText({ status: "ok", kind: "list", items: 3 })).toBe("list of 3 items");
    expect(kindText({ status: "ok", kind: "list", items: 24, range: [0.11, 0.25] })).toBe(
      "list of 24 numbers, 0.11 to 0.25",
    );
    expect(kindText({ status: "ok", kind: "list", items: 2, range: [4, 4] })).toBe(
      "list of 2 numbers, 4",
    );
  });

  it("shows the value in full, then its kind and what the caller adds", () => {
    const long = "word ".repeat(80).trim();
    const host = shown(
      templateFeedback({
        feedback: { status: "ok", value: long, kind: "text", listens: NONE },
        stale: false,
        id: "x",
        note: null,
        resultExtra: "52% of the bar",
        onFix: () => {},
      }),
    );
    expect(text($(host, ".tval"))).toBe(long);
    expect(text($(host, ".tkind"))).toBe("text, 52% of the bar");
    expect($(host, ".tfb").id).toBe("x");
    // An empty render has no value to show, only its kind.
    render(
      templateFeedback({
        feedback: { status: "empty", value: "", kind: "nothing", listens: NONE },
        stale: true,
        id: "x",
        note: null,
        onFix: () => {},
      }),
      host,
    );
    expect(host.querySelector(".tval")).toBeNull();
    expect(text($(host, ".tkind"))).toBe("nothing");
    expect($(host, ".tfb").classList.contains("stale")).toBe(true);
  });

  it("the value is never cut short by its style", () => {
    const tval = rule("form", ".tres .tval");
    expect(tval).toContain("white-space: pre-wrap");
    expect(tval).toContain("overflow-wrap: anywhere");
    expect(tval).not.toContain("ellipsis");
  });
});

describe("what it updates on", () => {
  it("lists the entities, then counts the rest", () => {
    const ids = Array.from({ length: LISTED_ENTITIES + 2 }, (_, i) => `sensor.s${i}`);
    const host = shown(listensLine({ ...NONE, entities: ids }));
    expect($$(host, ".chip").map(text)).toEqual(ids.slice(0, LISTED_ENTITIES));
    expect(text(host)).toContain("and 2 more");
  });

  it("says when it follows the clock, a domain or every state", () => {
    expect(text(shown(listensLine({ ...NONE, time: true })))).toBe(
      "Updates onthe start of every minute",
    );
    const domain = shown(listensLine({ ...NONE, domains: ["light"], rate_limit: 1 }));
    expect($$(domain, ".chip").map(text)).toEqual(["any light entity"]);
    expect(text(domain)).toContain("at most once a second");
    const all = shown(listensLine({ ...NONE, all: true, rate_limit: 60 }));
    expect($$(all, ".chip").map(text)).toEqual(["any state change"]);
    expect(text(all)).toContain("at most once every 60 seconds");
  });

  it("warns only when nothing it reads can change", () => {
    const host = shown(listensLine(NONE));
    expect(text($(host, ".tnote.never"))).toBe(
      "Nothing it reads can change, so it never updates on its own.",
    );
    expect(shown(listensLine({ ...NONE, time: true })).querySelector(".tnote.never")).toBeNull();
  });
});

describe("errors", () => {
  const err = (more: Partial<FieldFeedback>): FieldFeedback => ({
    status: "error",
    error: "TemplateSyntaxError: x",
    ...more,
  });

  it("names the line, and the column where Jinja gives one", () => {
    expect(errorWhere(err({}))).toBe("Template error:");
    expect(errorWhere(err({ line: 2 }))).toBe("Line 2:");
    expect(errorWhere(err({ line: 2, column: 6 }))).toBe("Line 2, column 6:");
  });

  it("words the common ones plainly", () => {
    const cases: [Partial<FieldFeedback>, string][] = [
      [{ reason: "unclosed" }, "Check that every {{ … }} and {% … %} is complete."],
      [
        { reason: "unclosed_block", params: { tag: "if" } },
        "The {% if %} block is never closed. Add {% endif %} where it ends.",
      ],
      [
        { reason: "stray_end", params: { tag: "endif" } },
        "{% endif %} closes a block that was never opened.",
      ],
      [
        { reason: "no_default", params: { function: "float", value: "x" } },
        "Give it one, like float(0).",
      ],
      [{ reason: "type" }, "like | float(0)."],
      [{ reason: "bad_char", params: { char: "!" } }, "The character “!” can't be used here."],
      [{ reason: "division_by_zero" }, "This divides by zero."],
    ];
    // Jinja's tokens never break across lines: their spaces are
    // unbreakable.
    for (const [more, words] of cases)
      expect(errorPlain(err(more))?.replaceAll(" ", " ")).toContain(words);
    expect(errorPlain(err({ reason: "stray_end", params: { tag: "endif" } }))).toContain(
      "{% endif %}",
    );
    // A message the panel has no words for, or a reason newer than this
    // bundle, keeps the raw message alone.
    expect(errorPlain(err({}))).toBeNull();
    expect(errorPlain(err({ reason: "from_the_future" }))).toBeNull();
  });

  it("puts the plain words over Home Assistant's message", () => {
    const host = shown(
      templateFeedback({
        feedback: err({ line: 1, column: 6, reason: "bad_char", params: { char: "!" } }),
        stale: false,
        id: "x",
        note: null,
        errorExtra: "The fallback size (50%) is in use.",
        onFix: () => {},
      }),
    );
    const note = $(host, ".tnote.error");
    expect(text($(note, ".k"))).toBe("Line 1, column 6:");
    expect(text($(note, ".traw"))).toBe("TemplateSyntaxError: x");
    // Home Assistant's own message waits behind Details, closed.
    const details = $(note, "details.tdetails") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(text($(details, "summary"))).toBe("Details");
    expect(text(note)).toContain("The character “!” can't be used here.");
    expect(text(note)).toContain("The fallback size (50%) is in use.");
    expect(host.querySelector(".tres, .tchips")).toBeNull();
  });
});

describe("did you mean", () => {
  it("replaces whole entity ids only", () => {
    expect(
      replaceEntity(
        "{{ states('sensor.livingroom_temp') }} {{ states.sensor.livingroom_temp.state }} sensor.livingroom_temp_2",
        "sensor.livingroom_temp",
        "sensor.living_temp",
      ),
    ).toBe(
      "{{ states('sensor.living_temp') }} {{ states.sensor.living_temp.state }} sensor.livingroom_temp_2",
    );
  });

  it("offers the closest ids and puts the one picked in the template", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    setSelect(sourceMenu(r), "template");
    await tick();
    setInput($(r, "textarea"), "{{ states('sensor.livingroom_temp') }}");
    await until(() => !!editor.editorState.fieldFeedback?.["state"]?.unknown, "unknown ids");
    await tick();
    const note = $(r, ".tunknown");
    expect(text(note)).toContain("Home Assistant has no sensor.livingroom_temp.");
    expect(text(note)).toContain("Did you mean:");
    const fix = $(note, "button.tfix");
    expect(text(fix)).toBe("sensor.living_temp");
    expect(fix.getAttribute("aria-label")).toBe("Use sensor.living_temp");
    fix.click();
    await tick();
    expect(editor.editorState.bindings["state__template"]).toBe(
      "{{ states('sensor.living_temp') }}",
    );
    expect(($(r, "textarea") as HTMLTextAreaElement).value).toBe(
      "{{ states('sensor.living_temp') }}",
    );
    await until(() => editor.previewedTemplate("state")?.includes("living_temp") === true, "fix");
    await until(() => r.querySelector(".tunknown") === null, "note gone");
    expect(text($(r, ".tres .tval"))).toBe(STATES["sensor.living_temp"]!.state);
  });
});

describe("kinds from the integration", () => {
  it("a trend's points template says it got a list of numbers", async () => {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no mock account");
    panel.openEditor(
      acc,
      { slug: "indoor", name: "Indoor", template: "trend", supported: true },
      null,
    );
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "trend editor");
    const editor = $(sr(panel), "aivi-editor") as AiviEditor;
    const points = (): HTMLElement => fieldRow(sr(panel), "points");
    setSelect($(points(), ".fsrc > select.srcsel"), "template");
    await tick();
    setInput($(points(), "textarea"), "{{ state_attr('sensor.nordpool', 'today') }}");
    await until(
      () => editor.editorState.fieldFeedback?.["points"]?.kind === "list",
      "list feedback",
    );
    await tick();
    expect(text($(points(), ".tres .tkind"))).toMatch(/^list of \d+ numbers, [\d.]+ to [\d.]+$/);
    expect($$(points(), ".tchips .chip").map(text)).toEqual(["sensor.nordpool"]);
  });

  it("true or false", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    setSelect(sourceMenu(r), "template");
    await tick();
    setInput($(r, "textarea"), "{{ is_state('sensor.living_temp', '21.4') }}");
    await until(() => editor.editorState.fieldFeedback?.["state"]?.kind === "bool", "bool");
    await tick();
    expect(text($(r, ".tres .tkind"))).toBe("true or false");
  });
});

describe("error timing", () => {
  it("holds an error back while typing, and shows it once typing pauses", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "frontdoor");
    const r = fieldRow(sr(panel), "state");
    setSelect(sourceMenu(r), "template");
    await tick();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const bar = (): string => text($(sr(panel), ".topbar"));

    setInput($(r, "textarea"), "{% broken");
    // The preview answers after its 250 ms debounce; the error waits.
    await vi.advanceTimersByTimeAsync(300);
    expect(r.querySelector(".tnote.error")).toBeNull();
    expect(bar()).not.toContain("to fix");
    await vi.advanceTimersByTimeAsync(ERROR_SETTLE_MS);
    expect(text($(r, ".tnote.error"))).toContain("Line 1:");
    expect(bar()).toContain("to fix");

    // A result shows at once, and replaces the error.
    setInput($(r, "textarea"), "{{ 42 }}");
    await vi.advanceTimersByTimeAsync(0);
    expect(r.querySelector(".tfb.stale .tnote.error")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(r.querySelector(".tnote.error")).toBeNull();
    expect(text($(r, ".tres .tval"))).toBe("42");

    // Breaking it again mid-typing keeps the last result, dimmed, until
    // the pause.
    setInput($(r, "textarea"), "{% broken");
    await vi.advanceTimersByTimeAsync(300);
    expect(r.querySelector(".tnote.error")).toBeNull();
    expect(r.querySelector(".tfb.stale .tres")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(ERROR_SETTLE_MS);
    expect(r.querySelector(".tnote.error")).not.toBeNull();
    expect(r.querySelector(".tfb.stale")).toBeNull();
  });
});

describe("the box grows with its text", () => {
  it("sizes itself where the browser cannot", () => {
    const box = document.createElement("textarea");
    Object.defineProperty(box, "scrollHeight", { value: 120 });
    Object.defineProperty(box, "offsetHeight", { value: 62 });
    Object.defineProperty(box, "clientHeight", { value: 60 });
    let sizes = false;
    vi.stubGlobal("CSS", { supports: () => sizes });
    try {
      fitTemplateBox(box);
      expect(box.style.height).toBe("122px");
      // A browser with field-sizing does it itself.
      sizes = true;
      box.style.height = "";
      fitTemplateBox(box);
      expect(box.style.height).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("from three lines to ten, then scrolls", () => {
    const box = rule("form", "textarea.tmpl");
    expect(box).toContain("field-sizing: content");
    expect(box).toContain("min-height: calc(3lh + 18px)");
    expect(box).toContain("max-height: calc(10lh + 18px)");
    expect(box).toContain("overflow-y: auto");
  });
});
