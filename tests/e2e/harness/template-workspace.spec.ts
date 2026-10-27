import type { Locator, Page } from "@playwright/test";
import { center, expect, type Panel, TEMPLATE_BOX, test } from "./fixtures";

// The template workspace (frontend/src/aivi-template-workspace.ts): a
// template box's own page at its own address, opened from the field's
// Expand and left with Back (the header's, Escape, the browser's). The
// Insert rail, the editor and the output share the panel's width; Save in
// the header saves the widget. Typed with real key presses.

const LONG = [
  "{% set inside = states('sensor.living_temp') | float(0) %}",
  "{% set outside = states('sensor.outdoor_temp') | float(0) %}",
  "{% if inside - outside > 5 %}",
  "  {{ (inside - outside) | round(1) }}° warmer inside",
  "{% elif inside < outside %}",
  "  Colder inside",
  "{% else %}",
  "  About even",
  "{% endif %}",
].join("\n");

/** The same, with a tag Jinja does not know on its last line. */
const BROKEN = LONG.replace("{% endif %}", "{% endfi %}");

async function templateField(panel: Panel, url = "index.html", text = LONG): Promise<Locator> {
  await panel.openEditor(`${url}#/widget/frontdoor`, "Front door");
  await panel.previewReady();
  const state = panel.field("state");
  await state.locator(".fsrc select.srcsel").selectOption("template");
  await state.locator(TEMPLATE_BOX).fill(text);
  return state;
}

const workspace = (page: Page): Locator => page.locator("aivi-template-workspace");
const wsBox = (page: Page): Locator => workspace(page).locator(TEMPLATE_BOX);
const rail = (page: Page): Locator => workspace(page).locator(".wsrail");

/** Put `text` in the workspace's editor over all it holds, as typing
 * does. (Filling a content-editable carries the formatting of what it
 * replaces, the first character's color, onto the line.) */
async function setText(page: Page, text: string): Promise<void> {
  await wsBox(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await expect(wsBox(page)).toHaveText(text);
}

/** Where `text` is drawn in the workspace's editor. */
async function textBox(
  page: Page,
  text: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return workspace(page)
    .locator(".cm-content")
    .evaluate((root, wanted) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(wanted) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }
      throw new Error(`no ${wanted} in the editor`);
    }, text);
}

async function expand(state: Locator): Promise<void> {
  const page = state.page();
  await state.locator(".texpand").click();
  await expect(workspace(page).locator(".ws")).toBeVisible();
  await expect(wsBox(page)).toBeFocused();
  await expect(page).toHaveURL(/#\/widget\/frontdoor\/state\/template$/);
}

test.describe("the template workspace", () => {
  test("opens from a field, takes an insert and an edit, and saves from its header", async ({
    page,
    panel,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await templateField(panel);
    await expect(state.locator(".tres .tval")).toHaveText("6.6° warmer inside");
    await expand(state);
    // A page of its own, as wide as the panel lets it be.
    await expect(page.locator(".edbar")).toBeHidden();
    await expect(workspace(page).getByRole("heading", { name: "State template" })).toBeVisible();
    const card = await workspace(page).locator(".wsbody").boundingBox();
    expect(card?.width).toBeGreaterThan(1300);
    await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("6.6° warmer inside");
    await expect(workspace(page).locator(".cm-lineNumbers")).toBeVisible();
    // Long lines do not wrap: one row per line.
    const lines = workspace(page).locator(".cm-line");
    await expect(lines).toHaveCount(9);
    const first = await lines.first().boundingBox();
    expect(first?.height).toBeLessThan(26);

    // An insert from the rail goes in at the caret, opening nothing.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    const search = rail(page).getByRole("combobox", { name: "Search entities and recipes" });
    await search.fill("porch");
    await page.keyboard.press("Enter");
    await expect(wsBox(page)).toBeFocused();
    await expect(wsBox(page)).toContainText("{% endif %}{{ states('light.porch') }}");
    await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
    // The preview beside it follows the edit, and stays live.
    await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText(
      /^6\.6° warmer inside\s+on$/,
    );
    await workspace(page).locator(".wsout").getByRole("radio", { name: "Medium" }).click();
    await expect(workspace(page).locator(".pv-canvas.is-medium")).toBeVisible();

    // Back keeps the edit, on the field it came from.
    await workspace(page).getByRole("button", { name: "Back" }).click();
    await expect(workspace(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/widget\/frontdoor$/);
    await expect(state.locator(TEMPLATE_BOX)).toBeFocused();
    await expect(state.locator(TEMPLATE_BOX)).toContainText("states('light.porch')");

    // Save in the workspace's header saves the widget and stays put.
    await expand(state);
    await workspace(page).getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".toast")).toContainText("Front door");
    await expect(workspace(page).locator(".ws")).toBeVisible();
    await expect(page).toHaveURL(/#\/widget\/frontdoor\/state\/template$/);
  });

  test("the browser's back and forward, Escape, a link and a reload", async ({ page, panel }) => {
    const state = await templateField(panel, "index.html", "{{ 1 }}");
    await expand(state);
    await page.goBack();
    await expect(workspace(page)).toHaveCount(0);
    await expect(page.locator(".leavedlg")).not.toBeVisible();
    await expect(state.locator(TEMPLATE_BOX)).toHaveText("{{ 1 }}");
    await page.goForward();
    await expect(workspace(page)).toBeVisible();
    // Escape with nothing open goes back too.
    await wsBox(page).click();
    await page.keyboard.press("Escape");
    await expect(workspace(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/widget\/frontdoor$/);

    // A saved template's workspace opens from its address, after a reload
    // too.
    await page.goto("index.html?templated=1#/widget/frontdoor/state/template");
    await expect(workspace(page)).toBeVisible();
    await expect(wsBox(page)).toContainText("warmer inside");
    await page.reload();
    await expect(workspace(page)).toBeVisible();
    await expect(wsBox(page)).toContainText("warmer inside");
    // Where there is no template box, the form.
    await page.goto("index.html#/widget/frontdoor/state/template");
    await panel.editorReady("Front door");
    await expect(workspace(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/widget\/frontdoor$/);
  });

  test("Tab indents, and the find, comment, wrap and Insert keys", async ({ page, panel }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const state = await templateField(panel, "index.html", "{{ 1 }}\n{{ 2 }}");
    await expand(state);
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Tab");
    await expect(wsBox(page)).toHaveText("  {{ 1 }}{{ 2 }}");
    await expect(wsBox(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(workspace(page).locator(".cm-line").first()).toHaveText("{{ 1 }}");
    // Mod+/ comments the line out.
    await page.keyboard.press("ControlOrMeta+/");
    await expect(workspace(page).locator(".cm-line").first()).toHaveText("{# {{ 1 }} #}");
    await page.keyboard.press("ControlOrMeta+/");
    // Mod+F finds; Escape closes the bar, not the workspace.
    await page.keyboard.press("ControlOrMeta+f");
    const find = workspace(page).getByRole("textbox", { name: "Find" });
    await expect(find).toBeFocused();
    await page.keyboard.type("{{");
    await expect(workspace(page).locator(".wsfcount")).toHaveText("1 of 2");
    await page.keyboard.press("Enter");
    await expect(workspace(page).locator(".wsfcount")).toHaveText("2 of 2");
    await expect(workspace(page).locator(".cm-aivi-match")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);
    await expect(wsBox(page)).toBeFocused();
    await expect(workspace(page)).toBeVisible();
    // Alt+Z wraps.
    await page.keyboard.press("Alt+z");
    await expect(workspace(page).getByRole("button", { name: "Wrap" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Alt+z");
    // Ctrl+M (Shift+Alt+M on a Mac) lets Tab move the focus on.
    await page.keyboard.press(process.platform === "darwin" ? "Shift+Alt+m" : "Control+m");
    await page.keyboard.press("Tab");
    await expect(wsBox(page)).not.toBeFocused();
    await wsBox(page).click();
    // Mod+I closes the rail, and the choice holds after a reload.
    await expect(rail(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(rail(page)).toHaveCount(0);
    await expect(wsBox(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(rail(page).getByRole("combobox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(rail(page)).toHaveCount(0);
    await page.goBack();
    await expand(state);
    await expect(rail(page)).toHaveCount(0);
  });

  // The quality bar's screens: 1280 with Home Assistant's sidebar open
  // (its 256 px taken off the window), 1440, 1920 and 2560, the Insert
  // rail open and closed, in both themes; then an error.
  for (const theme of ["dark", "light"] as const) {
    test(`at every width, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
        [2560, "2560"],
      ] as const) {
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        const state = await templateField(panel, url);
        await expand(state);
        await expect(workspace(page).locator(".tres .tval").first()).toHaveText(
          "6.6° warmer inside",
        );
        // The rail docks where three zones fit, else it opens over the
        // editor when asked.
        if (width < 1300) {
          await expect(rail(page)).toHaveCount(0);
          await snapshots.shot(`template-workspace-${name}-${theme}`);
          await page.keyboard.press("ControlOrMeta+i");
          await expect(rail(page)).toBeVisible();
          await snapshots.shot(`template-workspace-${name}-insert-${theme}`);
        } else {
          await expect(rail(page)).toBeVisible();
          await rail(page).getByRole("combobox").click();
          await page.keyboard.press("ArrowDown");
          await snapshots.shot(`template-workspace-${name}-insert-${theme}`);
          await page.keyboard.press("ControlOrMeta+i");
          await expect(rail(page)).toHaveCount(0);
          await snapshots.shot(`template-workspace-${name}-${theme}`);
          // Code width with the rail closed: 80 characters and more.
          const code = await workspace(page).locator(".cm-content").boundingBox();
          const glyph = await workspace(page)
            .locator(".cm-line")
            .first()
            .evaluate((el) => {
              const probe = document.createElement("span");
              probe.textContent = "0".repeat(10);
              el.append(probe);
              const w = probe.getBoundingClientRect().width / 10;
              probe.remove();
              return w;
            });
          expect((code?.width ?? 0) / glyph).toBeGreaterThan(80);
          await page.keyboard.press("ControlOrMeta+i");
        }
        await page.evaluate(() => sessionStorage.clear());
      }
      // An error, said under the result and marked in the text.
      await page.setViewportSize({ width: 1440, height: 900 });
      const state = await templateField(panel, url, BROKEN);
      await expand(state);
      await expect(workspace(page).locator(".wsout .tnote.error")).toContainText("Line 9");
      await expect(workspace(page).locator(".cm-aivi-error")).toBeVisible();
      await snapshots.shot(`template-workspace-error-${theme}`);
    });
  }

  for (const theme of ["dark", "light"] as const) {
    test(`recipes, hints and the entity card, ${theme}`, async ({ page, panel, snapshots }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const url = theme === "light" ? "light.html" : "index.html";
      const state = await templateField(panel, url, "{{ states('binary_sensor.garage') }}");
      await expand(state);
      await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("off");
      const search = rail(page).getByRole("combobox");

      // A recipe asks for its entity, the one in the template first, and
      // shows what it will put in.
      await search.fill("words");
      await page.keyboard.press("Enter");
      await expect(rail(page).locator(".insstep")).toContainText("Pick the entity it is for");
      await expect(rail(page).locator(".insopt.active")).toContainText("binary_sensor.garage");
      await expect(rail(page).locator(".insprev code")).toHaveText(
        "{{ 'On' if is_state('binary_sensor.garage', 'on') else 'Off' }}",
      );
      // A cover's words are its own, and so is the state it checks.
      await search.fill("blinds");
      await expect(rail(page).locator(".insprev code")).toHaveText(
        "{{ 'Open' if is_state('cover.blinds', 'open') else 'Closed' }}",
      );
      await search.fill("");
      await expect(rail(page).locator(".insopt.active")).toContainText("binary_sensor.garage");
      await snapshots.shot(`template-insert-recipe-${theme}`);
      // Picked, it takes the place of the plain state: a finished
      // template, and nothing opens.
      await page.keyboard.press("Enter");
      await expect(wsBox(page)).toBeFocused();
      await expect(wsBox(page)).toHaveText(
        "{{ 'On' if is_state('binary_sensor.garage', 'on') else 'Off' }}",
      );
      await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
      await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("Off");

      // An entity's recipes and attributes, under it.
      await search.fill("electricity");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowRight");
      await expect(rail(page).locator(".insopt.recipe.sub").first()).toBeVisible();
      await snapshots.shot(`template-insert-entity-${theme}`);
      await page.keyboard.press("Escape");

      // A reading with fifteen decimals: the hint rounds it to three
      // significant digits in one press.
      await setText(page, "{{ states('sensor.living_temp') | float(0) / 3 }} °C");
      const hint = workspace(page).locator(".wsout .wshint");
      const round = hint.filter({ hasText: "It shows 15 decimals." });
      // The widget cuts the long reading off too: said beside it.
      await expect(hint.filter({ hasText: "cuts it off" })).toBeVisible();
      await snapshots.shot(`template-hint-round-${theme}`);
      await round.getByRole("button", { name: "Round it" }).click();
      await expect(wsBox(page)).toHaveText(
        "{{ (states('sensor.living_temp') | float(0) / 3) | round(2) }} °C",
      );
      await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("7.13 °C");
      await expect(hint).toHaveCount(0);
      // A price's three decimals are its precision: nothing to say.
      await setText(page, "{{ states('sensor.nordpool') }} EUR");
      await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("0.151 EUR");
      await expect(hint).toHaveCount(0);

      // Resting on an id shows what the entity is now; Escape hides it.
      const id = await textBox(page, "sensor.nordpool");
      await page.mouse.move(id.x + 8, id.y + id.height / 2);
      const card = workspace(page).locator(".entcard");
      await expect(card).toContainText("Electricity price");
      await expect(card).toContainText("0.151 EUR/kWh");
      await expect(card).toContainText(/Changed \d+ minutes ago/);
      await snapshots.shot(`template-entity-card-${theme}`);
      await page.keyboard.press("Escape");
      await expect(card).toHaveCount(0);
      await expect(workspace(page)).toBeVisible();
      // From the keyboard: the caret moved onto an id.
      await page.mouse.move(0, 0);
      await page.keyboard.press("ControlOrMeta+Home");
      for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
      await expect(card).toContainText("Electricity price");
      await page.keyboard.type("x");
      await expect(card).toHaveCount(0);

      // An entity that is unavailable: say so, and offer words instead.
      await setText(page, "{{ states('sensor.travel_spent') }}");
      await expect(hint).toContainText("Travel is unavailable right now");
      await hint.getByRole("button", { name: "Show “No data” instead" }).click();
      await expect(wsBox(page)).toHaveText(
        "{{ states('sensor.travel_spent') if has_value('sensor.travel_spent') else 'No data' }}",
      );
      await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("No data");
    });
  }

  test("narrower: the output is a line that opens", async ({ page, panel, snapshots }) => {
    // A 1216 px window with Home Assistant's sidebar open.
    await page.setViewportSize({ width: 1216 - 256, height: 800 });
    const state = await templateField(panel);
    await expand(state);
    const strip = workspace(page).locator(".wsstripbtn");
    await expect(strip).toContainText("6.6° warmer inside");
    await expect(workspace(page).locator(".wsout")).toHaveCount(0);
    await snapshots.shot("template-workspace-strip");
    await strip.click();
    await expect(workspace(page).locator(".wsstripbody aivi-preview-pane")).toBeVisible();
    await snapshots.shot("template-workspace-strip-open");
  });

  test("a phase's size has a workspace of its own, at its own address", async ({ page, panel }) => {
    await panel.openEditor("index.html#/widget/laundry", "Laundry");
    await panel.pickEntity(
      page.locator('.field[data-key="progress"] input[type="text"]'),
      "washer",
      "input_number.washer_progress",
    );
    await panel.previewReady();
    await panel.barMode("Segmented").click();
    const capsule = await center(page.locator(".segcap").nth(1));
    await page.mouse.click(capsule.x, capsule.y);
    await page
      .locator(".seginline .seg[role='radiogroup'] button", { hasText: "Template" })
      .click();
    const inline = page.locator(".seginline aivi-code-editor .cm-content");
    await inline.fill("{{ states('sensor.wash_remaining') | float(0) }}");
    await page.locator(".seginline .texpand").click();
    await expect(page).toHaveURL(/#\/widget\/laundry\/segments\.1\.source\/template$/);
    await expect(workspace(page).getByRole("heading", { name: "Phase 2 template" })).toBeVisible();
    await expect(workspace(page).locator(".wshead .subtitle")).toHaveText("Laundry · Progress bar");
    await expect(workspace(page).locator(".wsout .tres .tval")).toHaveText("0.6");
    await expect(workspace(page).locator(".wsout .tres .tkind")).toHaveText(
      /^number, \d+% of the bar$/,
    );
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" * 2");
    await workspace(page).getByRole("button", { name: "Back" }).click();
    await expect(inline).toHaveText("{{ states('sensor.wash_remaining') | float(0) }} * 2");
  });
});
