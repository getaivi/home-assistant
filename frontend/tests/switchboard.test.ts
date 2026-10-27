// Switchboard tiles in the panel: the client-side mirror of Aivi's rules
// (picture URLs, gradients, action colors), the tile options editor, and
// the Save gate for content Aivi would refuse or never receive.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviEntityCombobox } from "../src/aivi-entity-combobox";
import type { AiviPanel } from "../src/aivi-panel";
import {
  actionColor,
  budgetProblem,
  budgetText,
  forwardablePicture,
  imageUrlProblem,
  parseGradient,
  pressKey,
  rowProblems,
} from "../src/switchboard";
import {
  $,
  $$,
  META,
  mountPanel,
  openColor,
  openWidgetEditor,
  previewSettled,
  setInput,
  setSelect,
  sr,
  text,
  tick,
  until,
} from "./harness";

const NAMES = META.colors as string[];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("switchboard rules", () => {
  it("checks picture URLs like Aivi does", () => {
    expect(imageUrlProblem("https://example.com/a.png")).toBeNull();
    expect(imageUrlProblem("https://cdn.example.com")).toBeNull();
    expect(imageUrlProblem("http://example.com/a.png")).toBe("switchboard.image-https");
    expect(imageUrlProblem("/api/image/serve/x/512x512")).toBe("switchboard.image-https");
    expect(imageUrlProblem("https:///a.png")).toBe("switchboard.image-host");
    expect(imageUrlProblem("https://e.com/a b.png")).toBe("switchboard.image-space");
    expect(imageUrlProblem(`https://e.com/${"a".repeat(2034)}`)).toBeNull();
    expect(imageUrlProblem(`https://e.com/${"a".repeat(2035)}`)).toBe("switchboard.image-long");
  });

  it("reads action colors and gradients", () => {
    expect(actionColor("#3d3dff", NAMES)).toBe("#3D3DFF");
    expect(actionColor(" Teal ", NAMES)).toBe("teal");
    expect(actionColor("#fff", NAMES)).toBeNull();
    expect(actionColor("chartreuse", NAMES)).toBeNull();
    expect(parseGradient("", NAMES)).toEqual({ stops: [], problem: null });
    expect(parseGradient("None", NAMES)).toEqual({ stops: [], problem: null });
    expect(parseGradient("#ffd27a, #FF8A4C", NAMES)).toEqual({
      stops: ["#FFD27A", "#FF8A4C"],
      problem: null,
    });
    expect(parseGradient("red, orange, yellow", NAMES).problem).toBeNull();
    expect(parseGradient("red", NAMES).problem).toBe("switchboard.gradient-count");
    expect(parseGradient("red,orange,yellow,green", NAMES).problem).toBe(
      "switchboard.gradient-count",
    );
    expect(parseGradient("red, #12", NAMES).problem).toBe("switchboard.gradient-color");
  });

  it("forwards only absolute https entity pictures", () => {
    expect(forwardablePicture("https://img.example.com/a.png")).toBe(
      "https://img.example.com/a.png",
    );
    expect(forwardablePicture("/api/media_player_proxy/x?token=abc")).toBeNull();
    expect(forwardablePicture(undefined)).toBeNull();
  });

  it("lists the tile options a push would drop, by option", () => {
    expect(rowProblems({}, NAMES)).toEqual({});
    const junk = { image: "http://x", gradient: "red", color: "#12345" };
    expect(rowProblems(junk, NAMES)).toEqual({
      image: "switchboard.image-https",
      gradient: "switchboard.gradient-count",
      color: "switchboard.color-invalid",
    });
    // These checks apply to tiles only: other rows are not held to them.
    expect(rowProblems(junk, NAMES, false)).toEqual({});
  });

  it("takes a budget as the integration does: an amount above 0", () => {
    for (const fine of ["250", "99.50", ".5", "5.", "+3", "1e3", "1_000", undefined, "", "  "])
      expect(budgetProblem(fine)).toBeNull();
    // The backend's money slot drops these, so the row would push no
    // budget at all.
    for (const junk of ["abc", "-5", "0", "0.00", "1,5", "1e-400", "12 kr", "1.2.3"])
      expect(budgetProblem(junk)).toBe("checklist.budget-invalid");
    expect(rowProblems({ budget: "-1" }, NAMES, false)).toEqual({
      budget: "checklist.budget-invalid",
    });
  });

  it("reads a lone decimal comma as the decimal point", () => {
    expect(budgetText(" 1,5 ")).toBe("1.5");
    expect(budgetText(",75")).toBe(".75");
    expect(budgetText("250")).toBe("250");
    // Not a decimal: left as typed, for the check to refuse.
    expect(budgetText("1,2,3")).toBe("1,2,3");
    expect(budgetText("1.000,5")).toBe("1.000,5");
    expect(budgetText("abc")).toBe("abc");
  });
});

function toggle(root: ParentNode, id: string): void {
  ($(root, "aivi-entity-combobox.rowadd") as AiviEntityCombobox).onSelect(id);
}

/** The living-room switchboard with the given entities picked and the
 * first row's options open. */
async function tiles(...ids: string[]): Promise<{
  panel: AiviPanel;
  editor: AiviEditor;
  checks: HTMLElement;
  body: HTMLElement;
}> {
  const panel = await mountPanel();
  const editor = await openWidgetEditor(panel, "livingroom");
  const checks = $(sr(panel), "aivi-rows-checklist");
  for (const id of ids) {
    toggle(checks, id);
    await tick();
  }
  $$(checks, ".rowtoggle")[0]!.click();
  await tick();
  return { panel, editor, checks, body: $(checks, ".rowopts") };
}

function options(editor: AiviEditor): Record<string, Record<string, string>> {
  return (editor.editorState.bindings["actions__options"] ?? {}) as Record<
    string,
    Record<string, string>
  >;
}

function save(panel: AiviPanel): HTMLButtonElement {
  return $(sr(panel), ".topbar .btn.primary") as HTMLButtonElement;
}

describe("switchboard tile options", () => {
  it("opens to the basics, with the rest folded and a light on its automatic gradient", async () => {
    const { editor, body } = await tiles("light.porch");
    // The row states what a press does; it is not left to the entity's type.
    expect(text($(body, ".pressline"))).toContain("Turns Porch light on or off");
    // The folds are closed until something is set in them, and a closed
    // fold still shows what it holds.
    const folds = $$(body, "details.fold") as HTMLDetailsElement[];
    expect(folds.map((f) => text($(f, ".ft")))).toEqual(["Gradient", "Picture", "State words"]);
    expect(folds.every((f) => !f.open)).toBe(true);
    expect(text($(folds[0]!, ".fsum"))).toBe("Automatic");
    expect(folds[1]!.querySelector(".fsum")).toBeNull();
    const gradient = $(body, "aivi-gradient-field");
    const modes = (): HTMLElement[] => $$(gradient, '[role="radio"]');
    expect(modes().map(text)).toEqual(["Automatic", "None", "Custom"]);
    expect(modes()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(text(body)).toContain("at most 256 KB");

    // The second line is one control; its text box shows for Custom only.
    const second = (): HTMLElement => $(body, 'select[aria-label^="What the second line"]');
    expect(body.querySelector('input[aria-label^="Custom second line"]')).toBeNull();
    setSelect(second(), "state");
    setSelect(second(), "custom");
    await tick();
    setInput($(body, 'input[aria-label^="Custom second line"]'), "Porch");

    // Custom starts from two stops; each is a color field taking hex.
    modes()[2]!.click();
    await tick();
    const stops = (): HTMLElement[] => $$(gradient, ".gstop aivi-color-field");
    expect(stops()).toHaveLength(2);
    $(await openColor(stops()[1]!), 'button[title="Orange"]').click();
    await tick();
    // The tile's own color takes hex too.
    const color = $(body, ".ctl > aivi-color-field");
    setInput($(await openColor(color), 'input[aria-label$="hex code"]'), "#ff8800");
    await tick();
    expect(editor.editorState.bindings["actions__options"]).toEqual({
      // Custom replaced State: the mode it replaced is not kept stored.
      "light.porch": {
        subtitle: "Porch",
        gradient: "#FFD27A, orange",
        // Stored in Aivi's own form, however it was typed.
        color: "#FF8800",
      },
    });
    expect(text($(color, ".cfname"))).toBe("#FF8800");
    // The gradient shows a strip of itself, and its fold says Custom.
    expect($(gradient, ".gradsw").getAttribute("style")).toContain("#FFD27A");
    expect(text($(folds[0]!, ".fsum"))).toBe("Custom");
    // A third stop can be added, and then removed again.
    $(gradient, ".gstops > .btn").click();
    await tick();
    expect(stops()).toHaveLength(3);
    expect(gradient.querySelector(".gstops > .btn")).toBeNull();
    $$(gradient, ".gstop .rm")[2]!.click();
    await tick();
    expect(stops()).toHaveLength(2);
    // None turns a light's own gradient off; Custom comes back as it was.
    modes()[1]!.click();
    await tick();
    expect(options(editor)["light.porch"]?.["gradient"]).toBe("none");
    modes()[2]!.click();
    await tick();
    expect(options(editor)["light.porch"]?.["gradient"]).toBe("#FFD27A, orange");
    modes()[0]!.click();
    await tick();
    expect(options(editor)["light.porch"]?.["gradient"]).toBeUndefined();
    // Back to the room: neither the mode nor the custom text is stored.
    setSelect(second(), "area");
    await tick();
    expect(options(editor)["light.porch"]?.["subtitle_mode"]).toBeUndefined();
    expect(options(editor)["light.porch"]?.["subtitle"]).toBeUndefined();
  });

  it("says what a press does for each kind of entity", async () => {
    const { body } = await tiles("scene.movie");
    expect(text($(body, ".pressline"))).toContain("Activates Movie night");
    // Nothing follows a scene's color, so its gradient is None or Custom.
    expect($$($(body, "aivi-gradient-field"), '[role="radio"]').map(text)).toEqual([
      "None",
      "Custom",
    ]);
    const meta = META.templates["switchboard"]?.fields.find((f) => f.key === "actions")?.state_text;
    expect(pressKey("cover.garage", meta)).toBe("switchboard.press-open");
    expect(pressKey("valve.garden", meta)).toBe("switchboard.press-open");
    expect(pressKey("lock.front", meta)).toBe("switchboard.press-lock");
    expect(pressKey("script.bedtime", meta)).toBe("switchboard.press-script");
    expect(pressKey("input_button.bell", meta)).toBe("switchboard.press-button");
    expect(pressKey("fan.ceiling", meta)).toBe("switchboard.press-toggle");
    expect(pressKey("camera.door", meta)).toBe("switchboard.press-on");
  });

  it("holds Save while a picture URL or a color would be dropped", async () => {
    const { panel, editor, checks } = await tiles("scene.movie");
    await previewSettled(editor);
    expect(save(panel).disabled).toBe(false);
    const body = (): HTMLElement => $(checks, ".rowopts");
    setInput($(body(), 'input[aria-label^="Picture URL"]'), "http://example.com/a.png");
    await tick();
    expect(text(body())).toContain("The URL must start with https://.");
    expect(save(panel).disabled).toBe(true);
    expect(text($(sr(panel), ".form"))).toContain(
      "Fix the options marked in red to save: Movie night.",
    );
    setInput($(body(), 'input[aria-label^="Picture URL"]'), "https://example.com/a.png");
    await tick();
    expect(save(panel).disabled).toBe(false);
    // The picture fold now says where the picture comes from.
    expect(text($($$(body(), "details.fold")[1]!, ".fsum"))).toBe("From a URL");
    // A gradient stop that is not a color.
    const gradient = (): HTMLElement => $(body(), "aivi-gradient-field");
    $$(gradient(), '[role="radio"]')[1]!.click();
    await tick();
    const stop = $(gradient(), ".gstop aivi-color-field");
    setInput($(await openColor(stop), 'input[aria-label$="hex code"]'), "#12");
    await tick();
    // The stop shows the error itself, once: the gradient doesn't repeat it.
    expect(text(stop)).toContain("Use a hex code like #FFD27A.");
    expect($$(gradient(), '[role="alert"]')).toHaveLength(1);
    expect(text(gradient())).not.toContain("One of the stops is not a color");
    expect(save(panel).disabled).toBe(true);
    $$(gradient(), '[role="radio"]')[0]!.click();
    await tick();
    expect(save(panel).disabled).toBe(false);
    // A stored gradient with one stop (typed by hand, not made by the builder).
    const map = editor.editorState.bindings["actions__options"] as Record<
      string,
      Record<string, string>
    >;
    map["scene.movie"] = { ...map["scene.movie"], gradient: "red" };
    (checks as unknown as { requestUpdate(): void }).requestUpdate();
    editor.updateValidation();
    await tick();
    expect(text(body())).toContain("A gradient needs 2 or 3 colors.");
    expect(save(panel).disabled).toBe(true);
    $(gradient(), ".gstops > .btn").click();
    await tick();
    expect(save(panel).disabled).toBe(false);
    // The tile's own color.
    const color = $(body(), ".ctl > aivi-color-field");
    setInput($(await openColor(color), 'input[aria-label$="hex code"]'), "#12");
    await tick();
    expect(text(color)).toContain("Use a hex code like #FFD27A.");
    expect(save(panel).disabled).toBe(true);
  });

  it("stores Custom text in place of the mode it replaces", async () => {
    const { editor, body } = await tiles("light.porch");
    const second = (): HTMLSelectElement =>
      $(body, 'select[aria-label^="What the second line"]') as HTMLSelectElement;
    setSelect(second(), "state");
    await tick();
    expect(options(editor)["light.porch"]).toEqual({ subtitle_mode: "state" });
    // Custom with nothing typed yet stores nothing: State left stored
    // would still be what the tile shows.
    setSelect(second(), "custom");
    await tick();
    expect(options(editor)["light.porch"]).toBeUndefined();
    const custom = (): HTMLElement => $(body, 'input[aria-label^="Custom second line"]');
    setInput(custom(), "Upstairs");
    await tick();
    expect(options(editor)["light.porch"]).toEqual({ subtitle: "Upstairs" });
    // Emptied, it does not fall back to State, and stays on Custom.
    setInput(custom(), "");
    await tick();
    expect(options(editor)["light.porch"]).toBeUndefined();
    expect(second().value).toBe("custom");
    expect(body.querySelector('input[aria-label^="Custom second line"]')).not.toBeNull();
  });

  it("marks the fold and the row header for a problem that is out of sight", async () => {
    const { panel, checks } = await tiles("scene.movie");
    const body = (): HTMLElement => $(checks, ".rowopts");
    const picture = (): HTMLDetailsElement => $$(body(), "details.fold")[1] as HTMLDetailsElement;
    const head = (): HTMLElement => $(checks, ".rowtoggle");
    expect(picture().className).not.toContain("bad");
    expect(head().hasAttribute("aria-invalid")).toBe(false);
    setInput($(body(), 'input[aria-label^="Picture URL"]'), "http://example.com/a.png");
    await tick();
    expect(save(panel).disabled).toBe(true);
    // The fold's summary line shows the problem; it is all a closed fold shows.
    picture().open = false;
    picture().dispatchEvent(new Event("toggle"));
    await tick();
    expect(picture().open).toBe(false);
    expect(picture().className).toContain("bad");
    expect($(picture(), "summary").getAttribute("aria-invalid")).toBe("true");
    expect(text($(picture(), ".fsum"))).toBe("Fix needed");
    // The gradient fold has nothing wrong in it.
    const gradient = $$(body(), "details.fold")[0]!;
    expect(gradient.className).not.toContain("bad");
    expect($(gradient, "summary").hasAttribute("aria-invalid")).toBe(false);
    // With the row's options shut, its header still carries the mark.
    head().click();
    await tick();
    expect(checks.querySelector(".rowopts")).toBeNull();
    expect(head().className).toContain("bad");
    expect(head().getAttribute("aria-invalid")).toBe("true");
    expect(head().hasAttribute("aria-label")).toBe(false);
    expect(text(head())).toBe("Movie night Fix needed");
    expect(text($(head(), ".rsum.bad"))).toBe("Fix needed");
    // Fixed, the marks go and the summaries say what is set again.
    head().click();
    await tick();
    setInput($(body(), 'input[aria-label^="Picture URL"]'), "https://example.com/a.png");
    await tick();
    expect(picture().className).not.toContain("bad");
    expect(text($(picture(), ".fsum"))).toBe("From a URL");
    expect(head().hasAttribute("aria-invalid")).toBe(false);
    expect(text($(head(), ".rsum"))).toBe("1 set");
  });

  it("marks the gradient fold and a bad color on the row header", async () => {
    const { editor, checks } = await tiles("scene.movie");
    const map = (): Record<string, Record<string, string>> =>
      editor.editorState.bindings["actions__options"] as Record<string, Record<string, string>>;
    // Stored by hand, not by the builder: one stop, and a color that is
    // neither a palette name nor a hex code.
    editor.editorState.bindings["actions__options"] = { "scene.movie": { gradient: "red" } };
    (checks as unknown as { requestUpdate(): void }).requestUpdate();
    await tick();
    const gradient = $$($(checks, ".rowopts"), "details.fold")[0]!;
    expect(gradient.className).toContain("bad");
    expect(text($(gradient, ".fsum"))).toBe("Fix needed");
    map()["scene.movie"] = { color: "#12" };
    (checks as unknown as { requestUpdate(): void }).requestUpdate();
    await tick();
    expect($(checks, ".rowtoggle").className).toContain("bad");
  });

  it("leaves Alt+Down on the Second line select to the select", async () => {
    const { editor, body } = await tiles("light.porch", "scene.movie");
    // Alt+Down opens a select; it must not move the row instead.
    const key = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    $(body, 'select[aria-label^="What the second line"]').dispatchEvent(key);
    await tick();
    expect(key.defaultPrevented).toBe(false);
    expect(editor.editorState.bindings["actions"]).toEqual(["light.porch", "scene.movie"]);
  });

  it("stores a picture's description only while there is a picture", async () => {
    const { editor, checks, body } = await tiles("switch.fountain");
    const alt = (): HTMLInputElement =>
      $(body, 'input[aria-label^="Picture description"]') as HTMLInputElement;
    const url = (): HTMLInputElement =>
      $(body, 'input[aria-label^="Picture URL"]') as HTMLInputElement;
    const own = (): HTMLInputElement => $(body, ".chk input") as HTMLInputElement;
    const tick_ = async (on: boolean): Promise<void> => {
      own().checked = on;
      own().dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    };
    // No picture, nothing to describe.
    expect(alt().disabled).toBe(true);
    await tick_(true);
    expect(alt().disabled).toBe(false);
    setInput(alt(), "A fountain");
    await tick();
    expect(options(editor)["switch.fountain"]).toEqual({
      image_source: "entity_picture",
      image_alt: "A fountain",
    });
    // A URL wins over the entity's picture, so only the URL is stored;
    // the box is unticked and disabled while it is.
    setInput(url(), "https://example.com/a.png");
    await tick();
    expect(options(editor)["switch.fountain"]).toEqual({
      image: "https://example.com/a.png",
      image_alt: "A fountain",
    });
    expect(own().checked).toBe(false);
    expect(own().disabled).toBe(true);
    // Emptying the URL goes back to the entity's picture.
    setInput(url(), "");
    await tick();
    expect(options(editor)["switch.fountain"]).toEqual({
      image_source: "entity_picture",
      image_alt: "A fountain",
    });
    expect(own().checked).toBe(true);
    // No picture at all: the description is not stored, nor counted on
    // the row, but it is still there when a picture comes back.
    await tick_(false);
    expect(options(editor)["switch.fountain"]).toBeUndefined();
    expect($(checks, ".rowtoggle").querySelector(".rsum")).toBeNull();
    expect(alt().disabled).toBe(true);
    await tick_(true);
    expect(options(editor)["switch.fountain"]).toEqual({
      image_source: "entity_picture",
      image_alt: "A fountain",
    });
  });

  it("does not count a stored description that has no picture", async () => {
    const { editor, checks } = await tiles("scene.movie");
    // A stored description with no picture stored beside it.
    editor.editorState.bindings["actions__options"] = {
      "scene.movie": { image_alt: "Popcorn", icon: "film" },
    };
    (checks as unknown as { requestUpdate(): void }).requestUpdate();
    await tick();
    expect(text($(checks, ".rowtoggle .rsum"))).toBe("1 set");
  });

  it("offers the entity picture only when the phone could fetch it", async () => {
    // The movie scene's picture is a Home Assistant path: never offered.
    const movie = await tiles("scene.movie");
    expect(movie.body.querySelector(".chk")).toBeNull();
    expect(text(movie.body)).toContain("can't fetch");
    document.body.innerHTML = "";
    // The fountain's is an absolute https URL: offered, with a warning.
    const { editor, body } = await tiles("switch.fountain");
    const box = $(body, ".chk input") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(editor.editorState.bindings["actions__options"]).toEqual({
      "switch.fountain": { image_source: "entity_picture" },
    });
    expect(text($(body, ".tnote.warn"))).toContain("public and stable");
    await previewSettled(editor);
    await until(
      () =>
        !!editor.editorState.preview?.actions?.[0]?.image &&
        editor.editorState.preview.actions[0].image.url ===
          "https://images.example.com/fountain.png",
      "the picture in the preview",
    );
  });

  it("says when the content is over the 4 KiB cap, and holds Save", async () => {
    const { panel, editor, checks } = await tiles(
      "light.porch",
      "switch.fountain",
      "scene.movie",
      "script.bedtime",
    );
    const long = `https://images.example.com/${"p".repeat(1100)}.png`;
    for (let i = 0; i < 4; i++) {
      if (i > 0) {
        $$(checks, ".rowtoggle")[i]!.click();
        await tick();
      }
      const body = $$(checks, ".rowopts")[i]!;
      setInput($(body, 'input[aria-label^="Picture URL"]'), long);
      await tick();
    }
    editor.schedulePreview(0);
    await until(() => (editor.editorState.size?.bytes ?? 0) > 4096, "the size");
    await tick();
    expect(text($(sr(panel), ".form > .banner.error"))).toMatch(
      /Too big for Aivi: \d+ of 4096 bytes/,
    );
    expect(save(panel).disabled).toBe(true);
    // Announced once: a later preview with a new byte count leaves the
    // alert's text alone.
    const alert = $(sr(panel), 'aivi-editor > .sr-only[role="alert"]');
    const said = text(alert);
    expect(said).toMatch(/Too big for Aivi/);
    setInput($($$(checks, ".rowopts")[0]!, 'input[aria-label^="Picture URL"]'), `${long}x`);
    editor.schedulePreview(0);
    const before = editor.editorState.size?.bytes;
    await until(() => editor.editorState.size?.bytes !== before, "a new size");
    await tick();
    expect(text(alert)).toBe(said);
  });
});

describe("switchboard state words", () => {
  type OptionsMap = Record<string, Record<string, string>>;
  const words = (editor: AiviEditor, id: string): Record<string, string> | undefined =>
    (editor.editorState.bindings["actions__options"] as OptionsMap | undefined)?.[id];

  it("shows a garage door's automatic words and stores the user's", async () => {
    const { editor, checks } = await tiles("cover.garage");
    const body = (): HTMLElement => $(checks, ".rowopts");
    const input = (state: string): HTMLInputElement =>
      $(body(), `input[aria-label="${state} word for Garage door"]`) as HTMLInputElement;
    const hide = (state: string): HTMLInputElement =>
      $(body(), `input[aria-label="Hide the ${state} word for Garage door"]`) as HTMLInputElement;
    // A toggle's five words; the cover's own ones are the placeholders.
    expect($$(body(), ".wordrow .wk").map(text)).toEqual([
      "On",
      "Off",
      "Turning on",
      "Turning off",
      "No response",
    ]);
    expect(input("On").placeholder).toBe("Open");
    expect(input("Off").placeholder).toBe("Closed");
    expect(input("Turning on").placeholder).toBe("Opening");
    expect(input("No response").placeholder).toBe("No response");
    expect(input("On").maxLength).toBe(24);

    setInput(input("On"), "  Up ");
    hide("Off").checked = true;
    hide("Off").dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    // "" is stored: the word is hidden, not back to the default.
    expect(words(editor, "cover.garage")).toEqual({ state_text_on: "Up", state_text_off: "" });
    expect(input("Off").disabled).toBe(true);
    expect(input("Off").placeholder).toBe("Hidden");

    // Unhiding and clearing both go back to the automatic word.
    hide("Off").checked = false;
    hide("Off").dispatchEvent(new Event("change", { bubbles: true }));
    setInput(input("On"), "");
    await tick();
    expect(words(editor, "cover.garage")).toBeUndefined();
  });

  it("brings a typed word back when it is unhidden", async () => {
    const { editor, checks } = await tiles("cover.garage");
    const body = (): HTMLElement => $(checks, ".rowopts");
    const input = (): HTMLInputElement =>
      $(body(), 'input[aria-label="On word for Garage door"]') as HTMLInputElement;
    const hide = (): HTMLInputElement =>
      $(body(), 'input[aria-label="Hide the On word for Garage door"]') as HTMLInputElement;
    setInput(input(), "Up");
    hide().checked = true;
    hide().dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(words(editor, "cover.garage")).toEqual({ state_text_on: "" });
    // Hiding is not deleting: unticking shows the word that was typed.
    hide().checked = false;
    hide().dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(words(editor, "cover.garage")).toEqual({ state_text_on: "Up" });
    expect(input().value).toBe("Up");
    expect(input().disabled).toBe(false);
  });

  it("offers a button its own three words", async () => {
    const { checks } = await tiles("scene.movie");
    const body = $(checks, ".rowopts");
    expect($$(body, ".wordrow .wk").map(text)).toEqual(["Idle", "Active", "Sent"]);
    const idle = $(body, 'input[aria-label="Idle word for Movie night"]') as HTMLInputElement;
    expect(idle.placeholder).toBe("No word");
  });

  it("previews a garage door with its words, as the integration resolves them", async () => {
    // (The grid shows the first four tiles; the words' rendering is
    // covered in preview-render.test.ts.)
    const { editor } = await tiles("cover.garage");
    const garage = (): { state_text?: unknown } | undefined =>
      ((editor.editorState.preview?.actions ?? []) as { id?: string; state_text?: unknown }[]).find(
        (a) => a.id === "cover_garage",
      );
    await until(() => garage() !== undefined, "the garage door in the preview");
    expect(garage()?.state_text).toEqual({
      on: "Open",
      off: "Closed",
      turning_on: "Opening",
      turning_off: "Closing",
    });
  });
});
