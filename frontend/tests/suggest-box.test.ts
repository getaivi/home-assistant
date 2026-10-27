// Suggest (AI-assisted binding): a suggestion pre-fills the form and
// is never a save; unusable model output is shown as a problem turn in
// the transcript and changes no state. The canned suggestions come from the harness mock.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviPanel } from "../src/aivi-panel";
import { diffSuggestion, revertTurn } from "../src/aivi-suggest-box";
import type { SuggestState } from "../src/api";
import type { Bindings } from "../src/types/bindings";
import {
  $,
  $$,
  makeHass,
  mountPanel,
  openWidgetEditor,
  setInput,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A panel whose backend reports the given Suggest readiness. */
async function mountPanelWithSuggest(state: SuggestState): Promise<AiviPanel> {
  const hass = makeHass();
  const orig = hass.callWS.bind(hass);
  hass.callWS = async (msg: object): Promise<unknown> => {
    const res = await orig(msg);
    if ((msg as { type: string }).type === "aivi/config")
      return { ...(res as object), suggest_state: state };
    return res;
  };
  return mountPanel(hass);
}

/** The chat lives in the sidebar: open it (once) and hand back the box. */
async function openSuggest(panel: AiviPanel): Promise<HTMLElement> {
  const root = sr(panel);
  if (!root.querySelector("aside.aiside")) {
    $(root, ".edbar .aibtn").click();
    await tick();
  }
  return $(root, "aivi-suggest-box");
}

describe("aivi-suggest-box", () => {
  it("applies the suggested bindings and records the history", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const box = await openSuggest(panel);
    // The default mock backend is ready: live box, no disabled chrome.
    expect(box.classList.contains("off")).toBe(false);
    expect(box.querySelector(".why")).toBeNull();
    setInput($(box, "textarea"), "washer progress with a cyan accent");
    vi.useFakeTimers();
    $(box, ".srow button").click();
    await Promise.resolve();
    await Promise.resolve();
    // The first ask sits at the top from the moment it is sent: the
    // centered intro is gone, so nothing jumps when the reply lands.
    expect(box.querySelector(".intro")).toBeNull();
    // While the model thinks, the transcript shows that and the send button
    // is a Stop; the ask has left the composer, so a next one typed
    // meanwhile is kept.
    expect(text($(box, ".thinking"))).toBe("Thinking…");
    expect($(box, ".srow button").getAttribute("aria-label")).toBe("Stop");
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe("");
    setInput($(box, "textarea"), "and an orange accent");
    await vi.advanceTimersByTimeAsync(700);
    vi.useRealTimers();
    await until(() => editor.editorState.chat.length > 0, "suggestion");
    // The mock's canned progress suggestion, applied verbatim.
    expect(editor.editorState.bindings).toEqual({
      progress: "input_number.washer_progress",
      state: "input_text.washer_state",
      icon: "washer.fill",
      accent: "cyan",
    });
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual([
      "washer progress with a cyan accent",
    ]);
    // The form was rebuilt around the suggestion: Save is now enabled, and
    // the exchange is in the transcript: the ask, then what it did.
    await until(
      () => !($(sr(panel), ".topbar .btn.primary") as HTMLButtonElement).disabled,
      "save enabled",
    );
    const refreshed = $(sr(panel), "aivi-suggest-box");
    expect($$(refreshed, ".msg.user .bubble").map(text)).toEqual([
      "washer progress with a cyan accent",
    ]);
    expect($$(refreshed, ".msg.bot .rchanges .chip").length).toBeGreaterThan(0);
    expect($(refreshed, ".srow button").getAttribute("aria-label")).toBe("Send");
    expect(($(refreshed, "textarea") as HTMLInputElement).value).toBe("and an orange accent");
  });

  it("keeps a failed ask in the transcript with what went wrong, and Retry sends it again", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi
      .spyOn(panel.api, "suggest")
      .mockRejectedValueOnce(
        Object.assign(new Error("KeyError: 'type'"), { code: "suggest_failed" }),
      )
      .mockResolvedValueOnce({ bindings: { progress: "input_number.washer_progress" } });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "washer progress");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "the failed turn");
    await tick();
    // The ask and the reason stay readable; nothing was applied.
    expect($$(box, ".msg.user .bubble").map(text)).toEqual(["washer progress"]);
    expect(text($(box, ".msg.problem .rtext"))).toBe("That did not work: KeyError: 'type'");
    expect(box.querySelector(".msg.problem .undo")).toBeNull();
    expect(sr(panel).querySelector(".toast")).toBeNull();
    $(box, ".retry").click();
    await until(() => editor.editorState.chat.some((turn) => !turn.problem), "the retried turn");
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual(["washer progress"]);
    expect(editor.editorState.bindings["progress"]).toBe("input_number.washer_progress");
    // A turn that applied nothing is not part of what the model is told.
    expect(suggest.mock.calls[1]?.[0].history).toBeUndefined();
  });

  it("sends the pruned current state along when refining", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi
      .spyOn(panel.api, "suggest")
      .mockResolvedValue({ bindings: { progress: "input_number.washer_progress" } });
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    editor.editorState.bindings["state"] = "";
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "keep it");
    // Enter in the input runs the ask, same as the button.
    $(box, "textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => suggest.mock.calls.length > 0, "suggest call");
    expect(suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "progress",
        kind: "widget",
        description: "keep it",
        bindings: { progress: "input_number.washer_progress" },
      }),
    );
  });

  it("leaves the form untouched when the model returns nothing usable, and keeps the ask", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    vi.spyOn(panel.api, "suggest").mockResolvedValue({ bindings: {} });
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "gibberish");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "the turn");
    await tick();
    expect(text($(box, ".msg.problem .rtext"))).toContain("returned nothing it could use");
    expect($$(box, ".msg.user .bubble").map(text)).toEqual(["gibberish"]);
    expect(editor.editorState.bindings).toEqual({
      progress: "input_number.washer_progress",
    });
  });

  it("shows a question back as a reply, with the form untouched", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: {},
      reply: "Which dryer do you mean? There are two.",
    });
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "and the dryer");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "the turn");
    expect(editor.editorState.bindings).toEqual({ progress: "input_number.washer_progress" });
    expect(text($(box, ".msg.bot .rtext"))).toBe("Which dryer do you mean? There are two.");
    expect(box.querySelector(".rchanges")).toBeNull();
    // The next ask carries the exchange, reply included.
    setInput($(box, "textarea"), "the one in the garage");
    $(box, ".srow button").click();
    await until(() => suggest.mock.calls.length === 2, "the second call");
    expect(suggest.mock.calls[1]?.[0]).toMatchObject({
      description: "the one in the garage",
      history: [{ ask: "and the dryer", reply: "Which dryer do you mean? There are two." }],
    });
  });

  it("says under a reply what the server did not apply", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings["progress"] = "input_number.washer_progress";
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: { progress: "input_number.washer_progress" },
      reply: "I've changed the progress to input_number.dryer_progress.",
      rejected: [
        { key: "progress", value: "input_number.dryer_progress", reason: "no_entity" },
        { key: "accent", value: "hotpink", reason: "not_a_color" },
        { key: "state", value: "x", reason: "a_reason_from_the_future" },
      ],
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "use the dryer instead");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "the turn");
    await tick();
    // The model's reply stands, corrected by what was not applied.
    expect(text($(box, ".rrejected"))).toBe(
      "Not applied: Progress: there is no entity input_number.dryer_progress; " +
        "Accent color: hotpink is not one of the colors; State: x can't be used",
    );
    expect(box.querySelector(".rchanges")).toBeNull();
    expect(editor.editorState.bindings).toEqual({ progress: "input_number.washer_progress" });
  });

  it("does not apply a suggestion that lands after the form was edited, and keeps the ask", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    let answer: (v: { bindings: Bindings }) => void = () => {};
    vi.spyOn(panel.api, "suggest").mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "washer");
    $(box, ".srow button").click();
    await tick();
    editor.editorState.bindings["accent"] = "red"; // a hand edit while thinking
    answer({ bindings: { accent: "cyan" } });
    await until(() => editor.editorState.chat.length === 1, "the turn");
    await tick();
    expect(text($(box, ".msg.problem .rtext"))).toContain("wasn't applied");
    expect(editor.editorState.bindings["accent"]).toBe("red");
    expect($(box, ".retry")).toBeTruthy();
  });

  it("drops a suggestion that lands after the editor closed", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    let answer: (v: { bindings: Bindings }) => void = () => {};
    vi.spyOn(panel.api, "suggest").mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "washer");
    $(box, ".srow button").click();
    await tick();
    panel.closeEditor();
    answer({ bindings: { accent: "cyan" } });
    await tick();
    expect(panel.editorState).toBeNull();
    expect(sr(panel).querySelector(".toast")).toBeNull();
  });

  it("does nothing on an empty description", async () => {
    const panel = await mountPanel();
    await openWidgetEditor(panel, "laundry");
    const suggest = vi.spyOn(panel.api, "suggest");
    const box = await openSuggest(panel);
    // The composer starts empty, and empty sends nothing.
    expect(($(box, "textarea") as HTMLInputElement).value).toBe("");
    $(box, ".srow button").click();
    await tick();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("explains and links to Integrations when AI Task is not loaded", async () => {
    const panel = await mountPanelWithSuggest("not_loaded");
    const editor = await openWidgetEditor(panel, "laundry");
    const box = await openSuggest(panel);
    expect(box.classList.contains("off")).toBe(true);
    // No dead controls: nothing to type into and nothing to press.
    expect(box.querySelector("input")).toBeNull();
    expect(box.querySelector("button")).toBeNull();
    const why = $(box, "#suggest-off-why");
    expect(text(why)).toContain("this form fills in");
    expect(text(why)).toContain("None provides AI Task yet");
    expect($(why, "a").getAttribute("href")).toBe("/_my_redirect/integrations");
    // Out of the form: in the sidebar behind the bar's Suggest button.
    expect(sr(panel).querySelector(".formcol aivi-suggest-box")).toBeNull();
    expect(box.parentElement?.classList.contains("aiside")).toBe(true);
    expect(text($(sr(panel), "#aivi-ai-title"))).toBe("AI suggestions");
    expect(editor.editorState.chat).toEqual([]);
  });

  it("docks beside the form from the bar's Suggest button, as a third column", async () => {
    const panel = await mountPanelWithSuggest("ready");
    await openWidgetEditor(panel, "laundry");
    const root = sr(panel);
    const button = $(root, ".edbar .aibtn");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector("aside.aiside")).toBeNull();
    button.click();
    await tick();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const side = $(root, "aside.aiside");
    expect(text($(side, "#aivi-ai-title"))).toBe("Suggest a setup");
    expect($(side, "aivi-suggest-box textarea")).toBeTruthy();
    // Docked: the editor grid grows a column; the form stays in use.
    expect($(root, ".edwrap").classList.contains("ai")).toBe(true);
    expect(root.querySelector(".formcol input")).toBeTruthy();
    $(side, ".dclose").click();
    await tick();
    expect(root.querySelector("aside.aiside")).toBeNull();
    expect($(root, ".edwrap").classList.contains("ai")).toBe(false);
  });

  it("points at AI preferences when no entity is chosen", async () => {
    const panel = await mountPanelWithSuggest("no_entity");
    await openWidgetEditor(panel, "laundry");
    const box = await openSuggest(panel);
    expect(box.classList.contains("off")).toBe(true);
    const why = $(box, "#suggest-off-why");
    expect(text(why)).toContain("no model provides data generation");
    expect($(why, "a").getAttribute("href")).toBe("/_my_redirect/config_ai_task");
  });

  it("says when a suggestion replaced a field's live source with a fixed value", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings = {
      state: "input_text.washer_state",
      accent: "orange",
      accent__template: "{{ 'red' }}",
    };
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: { state: "input_text.washer_state", accent: "purple" },
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "purple accent");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length > 0, "suggestion");
    const round = $(sr(panel), "aivi-suggest-box .msg.bot");
    expect($$(round, ".chip").map((c) => text(c))).toEqual([
      "Accent color stopped following live state",
    ]);
    expect($(round, ".chip.unsourced")).toBeTruthy();
  });

  it("summarizes set/changed/cleared per field, and undo restores the exact pre-turn state", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    // Hand-edited state before the round: an essential field plus two
    // advanced fields (icon, accent). The round changes one and silently
    // drops the other (the complete-config contract's "omit to clear").
    editor.editorState.bindings = {
      state: "input_text.washer_state",
      icon: "custom.symbol",
      accent: "orange",
    };
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: {
        progress: "input_number.washer_progress", // set
        state: "input_text.washer_state", // unchanged: no chip
        accent: "cyan", // changed
        // icon omitted -> cleared
      },
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "progress too, cyan accent");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length > 0, "suggestion");
    const round = $(sr(panel), "aivi-suggest-box .msg.bot");
    // The transcript is a polite live region, so the outcome is announced.
    expect($(sr(panel), "aivi-suggest-box .chat").getAttribute("aria-live")).toBe("polite");
    expect($$(round, ".chip").map((c) => text(c))).toEqual([
      "set Progress",
      "changed Accent color",
      "cleared Icon",
    ]);
    // The trust-critical clear carries its own class (danger ink).
    expect($(round, ".chip.cleared")).toBeTruthy();
    // The bindings really did change (icon is gone) before the undo.
    expect(editor.editorState.bindings["icon"]).toBeUndefined();

    // Undo: a real button (keyboard accessible by construction) with an
    // accessible name; one click restores the snapshot exactly.
    const undo = $(round, "button.undo");
    expect(undo.getAttribute("aria-label")).toBe("Undo “progress too, cyan accent”");
    undo.click();
    await tick();
    expect(editor.editorState.bindings).toEqual({
      state: "input_text.washer_state",
      icon: "custom.symbol",
      accent: "orange",
    });
    // The turn never happened: it left the transcript, the panel is back
    // to its first-ask state, and the revert is announced.
    expect(editor.editorState.chat).toEqual([]);
    const refreshed = $(sr(panel), "aivi-suggest-box");
    expect(refreshed.querySelector(".msg")).toBeNull();
    expect(($(refreshed, "textarea") as HTMLInputElement).value).toBe("");
    expect($$(refreshed, ".starter")).toHaveLength(3);
    expect($$(sr(panel), ".toast").map((el) => text(el))).toContain(
      "Undone: the form is back to how it was.",
    );
  });

  it("undoes from any turn: that turn and everything after it", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi.spyOn(panel.api, "suggest");
    await openSuggest(panel);
    const box = (): HTMLElement => $(sr(panel), "aivi-suggest-box");
    const say = async (ask: string, turns: number): Promise<void> => {
      setInput($(box(), "textarea"), ask);
      $(box(), ".srow button").click();
      await until(() => editor.editorState.chat.length === turns, `turn ${turns}`);
      await tick();
    };
    suggest.mockResolvedValueOnce({
      bindings: { progress: "input_number.washer_progress" },
      reply: "Bound the washer's progress.",
    });
    await say("washer progress", 1);
    suggest.mockResolvedValueOnce({
      bindings: { progress: "input_number.washer_progress", accent: "cyan" },
      reply: "Made the accent cyan.",
    });
    await say("cyan accent", 2);
    suggest.mockResolvedValueOnce({
      bindings: { progress: "input_number.washer_progress", accent: "cyan", icon: "washer.fill" },
    });
    await say("a washer icon", 3);
    expect($$(box(), ".msg.bot .rtext").map(text)).toEqual([
      "Bound the washer's progress.",
      "Made the accent cyan.",
      "Done.",
    ]);
    // Only the last turn offers a plain Undo; an earlier one says how
    // many go with it.
    expect($$(box(), ".msg.bot .undo").map(text)).toEqual([
      "Undo this and 2 after it",
      "Undo this and 1 after it",
      "Undo",
    ]);
    // An edit made by hand since the last turn.
    editor.editorState.bindings["tap_url"] = "https://example.com/by-hand";
    $$(box(), ".msg.bot .undo")[1]!.click();
    await tick();
    // Back to after turn 1: turns 2 and 3 are gone with their changes,
    // and the hand edit is kept.
    expect(editor.editorState.bindings).toEqual({
      progress: "input_number.washer_progress",
      tap_url: "https://example.com/by-hand",
    });
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual(["washer progress"]);
    expect($$(sr(panel), "aivi-suggest-box .msg.user .bubble").map(text)).toEqual([
      "washer progress",
    ]);
    expect(text($(sr(panel), ".toast"))).toContain("changed by hand since was kept");
    // Redo brings the turns and their changes back.
    expect(text($(box(), ".redo span"))).toBe("2 undone.");
    $(box(), ".redobtn").click();
    await tick();
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual([
      "washer progress",
      "cyan accent",
      "a washer icon",
    ]);
    expect(editor.editorState.bindings).toEqual({
      progress: "input_number.washer_progress",
      accent: "cyan",
      icon: "washer.fill",
      tap_url: "https://example.com/by-hand",
    });
    expect(box().querySelector(".redo")).toBeNull();
  });

  it("navigates the setup deep link in place, HA-style", async () => {
    const before = location.href;
    const panel = await mountPanelWithSuggest("not_loaded");
    await openWidgetEditor(panel, "laundry");
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("location-changed", () => resolve(), {
        once: true,
      }),
    );
    $(await openSuggest(panel), ".why a").click();
    await moved;
    expect(location.pathname).toBe("/_my_redirect/integrations");
    history.pushState(null, "", before);
  });
});

describe("diffSuggestion", () => {
  it("classifies per base field, folds modifier keys in, ignores __watched", () => {
    expect(
      diffSuggestion(
        {
          state: "input_text.washer_state",
          state__color: "red",
          tap_url: "https://x",
          progress__template: "{{ 1 }}",
          progress__watched: ["sensor.a"],
        },
        {
          state: "input_text.washer_state",
          state__color: "cyan", // a modifier change is a change of State
          icon: "washer.fill",
          progress__template: "{{ 1 }}",
          progress__watched: ["sensor.b"], // derived server-side: ignored
          // tap_url omitted -> cleared
        },
      ),
    ).toEqual([
      // The value is the same; its color is what changed.
      { key: "state", kind: "changed", detail: "color" },
      { key: "icon", kind: "set" },
      { key: "tap_url", kind: "cleared" },
    ]);
  });

  it("says where inside a list the change is", () => {
    const names: Record<string, string> = { "light.porch": "Porch light" };
    expect(
      diffSuggestion(
        {
          actions: ["light.porch", "scene.movie", "light.desk"],
          actions__options: { "light.porch": { label: "Porch" } },
        },
        {
          actions: ["light.desk", "light.porch", "switch.fountain"],
          actions__options: { "light.porch": { label: "Veranda", color: "yellow" } },
        },
        (id) => names[id] ?? id,
      ),
    ).toEqual([
      { key: "actions", kind: "changed", detail: "1 added, 1 removed, reordered, Porch light" },
    ]);
  });

  it("reverts only what the conversation changed", () => {
    const base = { progress: "sensor.a", accent: "cyan", icon: "washer.fill" };
    const target = { progress: "sensor.a" };
    expect(revertTurn({ ...base, accent: "red", tap_url: "https://x" }, base, target)).toEqual({
      bindings: { progress: "sensor.a", accent: "red", tap_url: "https://x" },
      kept: true,
    });
    expect(revertTurn(base, base, target)).toEqual({ bindings: target, kept: false });
  });

  it("says when a field that followed live state now holds a fixed value", () => {
    expect(
      diffSuggestion(
        {
          accent: "blue",
          accent__template: "{{ 'red' }}",
          icon: "bolt",
          icon__entity: "input_text.icon",
          state: "sensor.a",
          state__color: "red",
        },
        {
          accent: "purple", // the template went with the new literal
          icon: "bolt",
          icon__entity: "input_text.icon", // untouched source: unchanged
          state: "sensor.b",
          state__color: "red", // a bare entity change is a plain change
        },
      ),
    ).toEqual([
      { key: "accent", kind: "unsourced" },
      { key: "state", kind: "changed" },
    ]);
  });

  it("is indifferent to object key order and empty for identical states", () => {
    const segments = (flip: boolean) => ({
      segments: [flip ? { label: "Wash", value: 0.5 } : { value: 0.5, label: "Wash" }],
    });
    expect(diffSuggestion(segments(true), segments(false))).toEqual([]);
    expect(diffSuggestion({}, {})).toEqual([]);
  });
});

describe("the Suggest sidebar", () => {
  it("closes on Escape inside it, stays through presses elsewhere, and keeps its state across editors", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const root = sr(panel);
    const open = (): boolean => !!root.querySelector("aside.aiside");
    $(root, ".edbar .aibtn").click();
    await tick();
    expect(open()).toBe(true);
    // Docked: a press on the form is using the form, not dismissing.
    $(root, ".formcol").dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await tick();
    expect(open()).toBe(true);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(open()).toBe(true);
    $(root, "aside.aiside textarea").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    await tick();
    expect(open()).toBe(false);
    // Left open, it is open in the next editor too.
    $(root, ".edbar .aibtn").click();
    await tick();
    expect(open()).toBe(true);
    panel.closeEditor();
    await tick();
    await openWidgetEditor(panel, "frontdoor");
    expect(open()).toBe(true);
    $(sr(panel), "aside.aiside .dclose").click();
    await tick();
    expect(open()).toBe(false);
  });

  it("shows the ask the moment it is sent, and asks the picked model", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    let resolve: (v: { bindings: Bindings }) => void = () => {};
    const suggest = vi
      .spyOn(panel.api, "suggest")
      .mockImplementation(() => new Promise((r) => (resolve = r)));
    const box = await openSuggest(panel);
    // Two models: a picker in the composer's toolbar, the preferred first.
    const picker = $(box, "select.modelsel") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Local model", "Cloud model"]);
    picker.value = "ai_task.cloud";
    picker.dispatchEvent(new Event("change"));
    setInput($(box, "textarea"), "washer progress");
    $(box, ".srow button").click();
    await tick();
    // The ask is in the transcript before any answer, above the shimmer.
    expect($$(box, ".msg.user .bubble").map(text)).toEqual(["washer progress"]);
    expect($(box, ".thinking")).toBeTruthy();
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ entity_id: "ai_task.cloud" }));
    resolve({ bindings: { progress: "input_number.washer_progress" } });
    await until(() => editor.editorState.chat.length > 0, "turn");
    expect($$(box, ".msg.user .bubble").map(text)).toEqual(["washer progress"]);
    expect(box.querySelector(".thinking")).toBeNull();
  });

  it("keeps the draft while the sidebar is closed, and dims Send with nothing to send", async () => {
    const panel = await mountPanelWithSuggest("ready");
    await openWidgetEditor(panel, "laundry");
    let box = await openSuggest(panel);
    // A fresh conversation starts with nothing typed.
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe("");
    setInput($(box, "textarea"), "half a thought");
    $(sr(panel), "aside.aiside .dclose").click();
    await tick();
    box = await openSuggest(panel);
    await tick();
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe("half a thought");
    setInput($(box, "textarea"), "   ");
    await tick();
    expect($(box, ".sendbtn").getAttribute("aria-disabled")).toBe("true");
    expect(($(box, "textarea") as HTMLTextAreaElement).maxLength).toBe(2000);
  });

  it("starts a blank form from a starter that sets it up in one press", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi.spyOn(panel.api, "suggest");
    const box = await openSuggest(panel);
    // Nothing bound yet: the starters offer a whole setup, named after
    // the widget, and the composer stays empty.
    expect($$(box, ".starter").map(text)).toEqual([
      "Set it up for me",
      "Make it colorful",
      "Keep it minimal",
    ]);
    $$(box, ".starter")[1]!.click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    // Sent as said, and shown as the user's own message: nothing a
    // person would not type. The starters leave with the intro.
    expect(suggest.mock.calls[0]![0].description).toBe("Make it colorful");
    expect(text($(box, ".msg.user .bubble"))).toBe("Make it colorful");
    expect(box.querySelector(".starter")).toBeNull();
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("offers what the answer offers, one press each, in place of the generic hints", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const suggest = vi.spyOn(panel.api, "suggest").mockResolvedValueOnce({
      bindings: structuredClone(editor.editorState.bindings),
      match: "none",
      reply: "Nothing here is about a pool. What should it show?",
      options: ["The outside temperature", "The washer", "  "],
      rejected: [],
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "pool temperature");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    // The question, then its answers as choices; no generic hints beside them.
    expect($$(box, ".hint.opt").map(text)).toEqual(["The outside temperature", "The washer"]);
    expect($$(box, ".hint:not(.opt)")).toHaveLength(0);
    expect($(box, ".hints.opts").getAttribute("aria-label")).toBe("Suggested replies");
    // One press sends it as the user's next message.
    $$(box, ".hint.opt")[0]!.click();
    await until(() => editor.editorState.chat.length === 2, "second turn");
    await tick();
    expect(suggest.mock.calls[1]![0].description).toBe("The outside temperature");
    expect($$(box, ".msg.user .bubble").map(text)).toEqual([
      "pool temperature",
      "The outside temperature",
    ]);
    // The newest answer offered nothing: the generic hints are back.
    expect($$(box, ".hint.opt")).toHaveLength(0);
    expect($$(box, ".hint").length).toBeGreaterThan(0);
  });

  it("asks back about a request it did not understand, with nothing to undo", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const before = structuredClone(editor.editorState.bindings);
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: {},
      match: "none",
      reply: "I did not understand that. What should it show?",
      options: ["The washer's progress"],
      rejected: [],
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "asdasd");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    // The question and its examples; the form as it was, and no claim
    // that anything was applied or can be undone.
    expect(text($(box, ".msg.bot .rtext"))).toBe("I did not understand that. What should it show?");
    expect($$(box, ".hint.opt").map(text)).toEqual(["The washer's progress"]);
    expect(editor.editorState.bindings).toEqual(before);
    expect(box.querySelector(".msg.bot .rchanges")).toBeNull();
    expect(box.querySelector(".msg.bot .rsame")).toBeNull();
    expect(box.querySelector(".msg.bot .undo")).toBeNull();
    expect(box.querySelector(".msg.bot .retry")).toBeNull();
  });

  it("says nothing changed under a reply that reports work the form does not show", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: structuredClone(editor.editorState.bindings),
      match: "clear",
      reply: "I've made sure all available fields are included.",
      rejected: [],
    });
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "populate all slots");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    // The model's reply stays, and the panel's own note sits under it.
    expect(text($(box, ".msg.bot .rtext"))).toBe(
      "I've made sure all available fields are included.",
    );
    expect(text($(box, ".msg.bot .rsame"))).toBe("Nothing changed.");

    // An answer to a question changes nothing by design: no note.
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: structuredClone(editor.editorState.bindings),
      match: "answer",
      reply: "Five more.",
      rejected: [],
    });
    setInput($(box, "textarea"), "how many can I still add");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 2, "second turn");
    await tick();
    expect($$(box, ".msg.bot .rsame")).toHaveLength(1);
  });

  it("offers no Undo under a reply that changed nothing", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: structuredClone(editor.editorState.bindings),
      reply: "Which entities are the grill's?",
      rejected: [],
    });
    const box = await openSuggest(panel);
    $$(box, ".starter")[0]!.click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    expect(text($(box, ".msg.bot .rtext"))).toBe("Which entities are the grill's?");
    expect(box.querySelector(".undo")).toBeNull();
  });

  it("offers what the home has that the name points at, after the catch-all", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const starters = vi
      .spyOn(panel.api, "suggestStarters")
      .mockResolvedValue({ starters: ["Washer progress", "Washer state", " "] });
    const suggest = vi.spyOn(panel.api, "suggest");
    const box = await openSuggest(panel);
    await until(
      () =>
        $$(box, ".starter").length === 3 && text($$(box, ".starter")[1]!) !== "Make it colorful",
      "home starters",
    );
    expect(starters).toHaveBeenCalledWith("progress", "widget", "Laundry");
    expect($$(box, ".starter").map(text)).toEqual([
      "Set it up for me",
      "Washer progress",
      "Washer state",
    ]);
    $$(box, ".starter")[1]!.click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    expect(suggest.mock.calls[0]![0].description).toBe("Washer progress");
    // Asked once per editor, not on every open.
    $(sr(panel), "aside.aiside .dclose").click();
    await tick();
    await openSuggest(panel);
    await tick();
    expect(starters).toHaveBeenCalledTimes(1);
  });

  it("keeps the generic starters when the backend has none to offer", async () => {
    const panel = await mountPanelWithSuggest("ready");
    await openWidgetEditor(panel, "laundry");
    vi.spyOn(panel.api, "suggestStarters").mockRejectedValue(new Error("unknown_command"));
    const box = await openSuggest(panel);
    await tick();
    expect($$(box, ".starter").map(text)).toEqual([
      "Set it up for me",
      "Make it colorful",
      "Keep it minimal",
    ]);
  });

  it("offers a form that already shows something a restyle instead", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    editor.editorState.bindings = { progress: "input_number.washer_progress" };
    const box = await openSuggest(panel);
    expect($$(box, ".starter").map(text)).toEqual([
      "Give it a fresh look",
      "Make it colorful",
      "Simplify it",
    ]);
  });

  it("offers hints from what the template has, and adds one after a draft", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "washer progress");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    await tick();
    // A progress widget: its bar and its accent, never a tile.
    expect($$(box, ".hint").map(text)).toEqual([
      "Split the bar into phases",
      "Make the accent orange",
      "Keep it simpler",
    ]);
    // They hold their place while the model thinks (idle), so the
    // transcript above them does not move.
    let land: (v: { bindings: Bindings }) => void = () => {};
    vi.spyOn(panel.api, "suggest").mockImplementation(() => new Promise((r) => (land = r)));
    setInput($(box, "textarea"), "again");
    $(box, ".srow button").click();
    await tick();
    expect($$(box, ".hint")).toHaveLength(3);
    expect($$(box, ".hint").every((h) => (h as HTMLButtonElement).disabled)).toBe(true);
    land({ bindings: {} });
    await until(() => editor.editorState.chat.length === 2, "second turn");
    await tick();
    setInput($(box, "textarea"), "use the dryer.");
    $$(box, ".hint")[1]!.click();
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe(
      "use the dryer. Make the accent orange",
    );
  });

  it("continues the conversation of a widget after a save, not after a discard", async () => {
    const panel = await mountPanelWithSuggest("ready");
    let editor = await openWidgetEditor(panel, "frontdoor");
    let box = await openSuggest(panel);
    vi.spyOn(panel.api, "suggest").mockResolvedValue({
      bindings: { state: "input_boolean.front_door", accent: "cyan" },
      reply: "Cyan now.",
    });
    setInput($(box, "textarea"), "cyan accent");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 1, "turn");
    $(sr(panel), ".edbar .btn.primary").click();
    await until(() => panel.editorState?.saving === false, "saved");
    $(sr(panel), ".backbtn").click();
    await until(() => panel.editorState === null, "closed");
    editor = await openWidgetEditor(panel, "frontdoor");
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual(["cyan accent"]);
    // A second turn, then leaving without saving: only the saved one stays.
    box = await openSuggest(panel);
    setInput($(box, "textarea"), "and again");
    $(box, ".srow button").click();
    await until(() => editor.editorState.chat.length === 2, "second turn");
    panel.closeEditor();
    await tick();
    editor = await openWidgetEditor(panel, "frontdoor");
    expect(editor.editorState.chat.map((turn) => turn.ask)).toEqual(["cyan accent"]);
  });

  it("Stop drops the answer of the round in flight", async () => {
    const panel = await mountPanelWithSuggest("ready");
    const editor = await openWidgetEditor(panel, "laundry");
    let resolve: (v: { bindings: Bindings }) => void = () => {};
    vi.spyOn(panel.api, "suggest").mockImplementation(() => new Promise((r) => (resolve = r)));
    $(sr(panel), ".edbar .aibtn").click();
    await tick();
    const box = await openSuggest(panel);
    setInput($(box, "textarea"), "washer progress");
    $(box, ".srow button").click();
    await tick();
    expect($(box, ".thinking")).toBeTruthy();
    $(box, ".srow button.stop").click();
    await tick();
    expect(box.querySelector(".thinking")).toBeNull();
    expect($(box, ".srow button").getAttribute("aria-label")).toBe("Send");
    // The stopped ask is back in the composer, to change or send again.
    expect(($(box, "textarea") as HTMLTextAreaElement).value).toBe("washer progress");
    resolve({ bindings: { progress: "input_number.washer_progress" } });
    await tick();
    await tick();
    expect(editor.editorState.chat).toEqual([]);
    expect(editor.editorState.bindings["progress"]).toBeUndefined();
  });
});
