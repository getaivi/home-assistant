import type { Locator, Page } from "@playwright/test";
import { expect, type Panel, TEMPLATE_BOX, test } from "./fixtures";

// The template code editor (frontend/src/code-editor/): highlighting,
// completion of entities, attributes and functions, errors underlined in
// place, and a keyboard that never traps focus. Typed with real key
// presses, so bracket closing and the {{ }} padding are part of what is
// checked.

const HIGHLIGHTED = [
  "{# Warmer or colder inside #}",
  "{% set inside = states('sensor.living_temp') | float(0) %}",
  "{% if inside > 21 and is_state('climate.living_room', 'heat') %}",
  "  {{ inside | round(1) }}° and heating",
  "{% else %}",
  "  {{ state_attr('climate.living_room', 'hvac_action') }}",
  "{% endif %}",
].join("\n");

/** The Front door widget with its State field switched to a template,
 * the code editor in place, emptied (it starts from the field's entity). */
async function templateField(panel: Panel, url = "index.html"): Promise<Locator> {
  await panel.openEditor(`${url}#/widget/frontdoor`, "Front door");
  await panel.previewReady();
  const state = panel.field("state");
  await state.locator(".fsrc select.srcsel").selectOption("template");
  const box = state.locator(TEMPLATE_BOX);
  await expect(box).toHaveText("{{ states('input_boolean.front_door') }}");
  await box.fill("");
  return state;
}

const list = (page: Page): Locator => page.locator(".cm-tooltip-autocomplete");
const option = (page: Page, label: string): Locator =>
  list(page).locator("li", {
    has: page.locator(".cm-completionLabel", {
      hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    }),
  });

test.describe("the template code editor", () => {
  test("highlights a template and grows with it", async ({ panel, snapshots }) => {
    const state = await templateField(panel);
    const box = state.locator(TEMPLATE_BOX);
    await box.fill(HIGHLIGHTED);
    await expect(state.locator(".tres .tval")).toHaveText("21.4° and heating");
    // The delimiters, keywords, strings and functions each get a color.
    const colors = await box.evaluate((el) => {
      const seen = new Set<string>();
      for (const span of el.querySelectorAll(".cm-line span"))
        seen.add(getComputedStyle(span).color);
      return seen.size;
    });
    expect(colors).toBeGreaterThanOrEqual(6);
    await box.blur();
    await snapshots.shot("editor-template-code");
  });

  test("completes entities, attributes and functions as they are typed", async ({
    page,
    panel,
    snapshots,
  }) => {
    const state = await templateField(panel);
    const box = state.locator(TEMPLATE_BOX);
    await box.click();

    await test.step("an entity inside states('…'), by name", async () => {
      // {{ closes itself and a space pads it; ( and ' close too.
      await page.keyboard.type("{{ states('living");
      await expect(box).toHaveText("{{ states('living') }}");
      await expect(option(page, "sensor.living_temp")).toBeVisible();
      await expect(option(page, "climate.living_room")).toBeVisible();
      await expect(list(page)).toContainText("Living room temperature");
      await snapshots.shot("editor-template-complete-entity");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(box).toHaveText("{{ states('sensor.living_temp') }}");
      await expect(list(page)).toHaveCount(0);
      await expect(state.locator(".tres .tval")).toHaveText("21.4");
    });

    await test.step("an attribute of the entity in state_attr", async () => {
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("{{ state_attr('climate.living_room', '");
      await expect(option(page, "hvac_action")).toBeVisible();
      await expect(option(page, "current_temperature")).toContainText("21.4");
      await snapshots.shot("editor-template-complete-attribute");
      await page.keyboard.type("hv");
      // Tab takes the highlighted option while the list is open.
      await page.keyboard.press("Tab");
      await expect(box).toHaveText("{{ state_attr('climate.living_room', 'hvac_action') }}");
      await expect(box).toBeFocused();
      await expect(state.locator(".tres .tval")).toHaveText("heating");
    });

    await test.step("a function with its hint, which opens the entity list", async () => {
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type("{{ is_s");
      await expect(option(page, "is_state")).toBeVisible();
      await expect(page.locator(".cm-completionInfo")).toHaveText(
        "Whether an entity is in a given state",
      );
      await snapshots.shot("editor-template-complete-function");
      await page.keyboard.press("Enter");
      await expect(box).toHaveText("{{ is_state('', '') }}");
      await expect(option(page, "binary_sensor.garage")).toBeVisible();
      await page.keyboard.type("porch");
      await expect(option(page, "light.porch")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(box).toHaveText("{{ is_state('light.porch', '') }}");
    });
  });

  test("Escape closes the list, Tab leaves the box, Ctrl+Space asks", async ({ page, panel }) => {
    const state = await templateField(panel);
    const box = state.locator(TEMPLATE_BOX);
    await box.click();
    await page.keyboard.type("{{ sta");
    await expect(list(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list(page)).toHaveCount(0);
    await expect(box).toBeFocused();
    // Escape stays in the box: the editor is still open, nothing else
    // closed.
    await expect(page.locator(".topbar .title", { hasText: "Front door" })).toBeVisible();

    await page.keyboard.press("Control+Space");
    await expect(option(page, "states")).toBeVisible();
    await page.keyboard.press("Escape");

    // With no list open, Tab moves on, and Shift+Tab comes back.
    await page.keyboard.press("Tab");
    await expect(box).not.toBeFocused();
    await expect(box).toHaveText("{{ sta }}");
    await page.keyboard.press("Shift+Tab");
    await expect(box).toBeFocused();

    // Undo and redo.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" °C");
    await expect(box).toHaveText("{{ sta }} °C");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(box).toHaveText("{{ sta }}");
    // Each platform's own redo key: Cmd+Shift+Z on a Mac, Ctrl+Y elsewhere.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+y");
    await expect(box).toHaveText("{{ sta }} °C");
  });

  test("a template typed key by key comes out exactly as typed", async ({ page, panel }) => {
    const state = await templateField(panel);
    const box = state.locator(TEMPLATE_BOX);
    await box.click();
    for (const typed of [
      "{{ 1 }}",
      "{{1}}",
      "{% if x %}",
      "{%if x%}",
      "{# a note #}",
      "{{ states('sensor.living_temp') | float(0) | round(1) }} °C",
      "{% if is_state('light.porch', 'on') %}On{% else %}Off{% endif %}",
    ]) {
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(typed);
      await page.keyboard.press("Escape");
      await expect(box, typed).toHaveText(typed);
    }
    // What it puts in, it shows; one Backspace takes a pairing back.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("{%");
    await expect(box).toHaveText("{%  %}");
    await page.keyboard.press("Backspace");
    await expect(box).toHaveText("{}");
    await page.keyboard.type("{ ");
    await expect(box).toHaveText("{{  }}");
    await page.keyboard.press("Backspace");
    await expect(box).toHaveText("{{}}");
  });

  test("underlines an error and an unknown entity id in place", async ({ panel, snapshots }) => {
    const state = await templateField(panel);
    const box = state.locator(TEMPLATE_BOX);
    await box.fill("{% set t = states('sensor.living_temp') | float(0) %}\n{{ t | round(1) }");
    await expect(state.locator(".tnote.error")).toContainText("Line 2:");
    const error = state.locator(".cm-aivi-error");
    await expect(error).toHaveText("{{ t | round(1) }");
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await box.blur();
    await snapshots.shot("editor-template-underline");

    await box.fill("{{ states('sensor.livingroom_temp') }} °C");
    await expect(state.locator(".cm-aivi-warning")).toHaveText("sensor.livingroom_temp");
    await expect(error).toHaveCount(0);
    await expect(box).not.toHaveAttribute("aria-invalid");
    // The words stay under the box only.
    await expect(state.locator(".tunknown")).toHaveCount(1);
  });

  test("the light theme", async ({ page, panel, snapshots }) => {
    const state = await templateField(panel, "light.html");
    const box = state.locator(TEMPLATE_BOX);
    await box.fill(HIGHLIGHTED);
    await expect(state.locator(".tres .tval")).toHaveText("21.4° and heating");
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n{{ states('sensor.");
    await expect(option(page, "sensor.living_temp")).toBeVisible();
    await snapshots.shot("editor-template-code-light");
  });
});
