import { expect, TEMPLATE_BOX, test } from "./fixtures";

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

// Runs in the `phone` project: a 390 px wide viewport.
test.describe("phone viewport", () => {
  // An empty account's steps keep the width for their text, and both
  // ways on fit.
  test("an empty account on a phone", async ({ page, snapshots }) => {
    await page.goto("index.html?nowidgets=1");
    const card = page.locator(".acct-empty");
    await expect(card.locator("ol.steps li")).toHaveCount(3);
    await expect(card.locator(".actions")).toBeInViewport({ ratio: 1 });
    await snapshots.shot("hub-mobile-empty");
  });

  // The harness derives `narrow` from the viewport the way Home
  // Assistant's host does, so the panel must carry the reflected attribute.
  // The result and an error sit right under the box, without the
  // preview sheet.
  test("a template's result and error stay next to the box", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const state = panel.field("state");
    await state.locator(".fsrc select.srcsel").selectOption("template");
    const box = state.locator(TEMPLATE_BOX);
    await box.fill("{{ states('sensor.living_temp') | round(1) }} °C");
    await expect(state.locator(".tres .tval")).toHaveText("21.4 °C");
    await expect(page.locator(".side.open")).toHaveCount(0);
    await expect(state.locator(".tres")).toBeInViewport();
    await snapshots.shot("editor-mobile-template");
    await box.fill("{{ states('sensor.living_temp') | round(1) }");
    await expect(state.locator(".tnote.error")).toContainText("Line 1:");
    await expect(state.locator(".tnote.error")).toBeInViewport();
    await snapshots.shot("editor-mobile-template-error");
  });

  // The completion list fits the narrow screen and stays under the box.
  test("a template's completion list on a phone", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const state = panel.field("state");
    await state.locator(".fsrc select.srcsel").selectOption("template");
    const box = state.locator(TEMPLATE_BOX);
    // It starts from the field's entity; this one is written anew.
    await box.fill("");
    await box.click();
    await page.keyboard.type("{{ state_attr('climate.living_room', '");
    const list = page.locator(".cm-tooltip-autocomplete");
    await expect(list.getByText("hvac_action")).toBeVisible();
    await expect(list).toBeInViewport({ ratio: 1 });
    await snapshots.shot("editor-mobile-template-complete");
    await list.getByText("hvac_action").click();
    await expect(box).toHaveText("{{ state_attr('climate.living_room', 'hvac_action') }}");
  });

  // The template workspace takes the screen: a line for the result at
  // the top (it opens to the small widget), the editor, and a row of the
  // keys the on-screen keyboard hides, with Insert as a sheet over the
  // lower half.
  for (const theme of ["index.html", "light.html"]) {
    const light = theme === "light.html";
    const suffix = light ? "-light" : "";
    test(`the template workspace on a phone${light ? ", light" : ""}`, async ({
      page,
      panel,
      snapshots,
    }) => {
      await panel.openEditor(`${theme}#/widget/frontdoor`, "Front door");
      await panel.previewReady();
      const state = panel.field("state");
      await state.locator(".fsrc select.srcsel").selectOption("template");
      await state.locator(TEMPLATE_BOX).fill(LONG);
      await state.locator(".texpand").click();
      const ws = page.locator("aivi-template-workspace .ws.phone");
      const box = ws.locator(TEMPLATE_BOX);
      await expect(box).toBeFocused();
      await expect(page).toHaveURL(/#\/widget\/frontdoor\/state\/template$/);
      const size = await ws.boundingBox();
      expect(size?.width).toBe(390);
      const strip = ws.locator(".wsstripbtn");
      await expect(strip).toContainText("6.6° warmer inside");
      const keys = ws.getByRole("group", { name: "Template keys" });
      await expect(keys).toBeInViewport({ ratio: 1 });
      // Every key a finger's size.
      for (const key of await keys.locator(".wskey").all()) {
        const at = await key.boundingBox();
        expect(at?.height).toBeGreaterThanOrEqual(44);
        expect(at?.width).toBeGreaterThanOrEqual(44);
      }
      await snapshots.shot(`template-workspace-phone${suffix}`);
      // With the keyboard up the screen is shorter: the keys stay above it.
      await page.setViewportSize({ width: 390, height: 844 - 336 });
      await expect(keys).toBeInViewport({ ratio: 1 });
      await snapshots.shot(`template-workspace-phone-keyboard${suffix}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await strip.click();
      await expect(ws.locator(".wsstripbody .wsmini .pv-scale")).toBeVisible();
      await snapshots.shot(`template-workspace-phone-result${suffix}`);
      await strip.click();
      if (light) return;

      // Keys type at the caret, the box keeps the focus; the caret keys
      // and Undo work.
      await box.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await keys.getByRole("button", { name: "Expression" }).click();
      await expect(box).toContainText("{% endif %}{{  }}");
      await expect(box).toBeFocused();
      await page.keyboard.type("states");
      await page.keyboard.type("(");
      await keys.getByRole("button", { name: "Quote" }).click();
      await page.keyboard.type("x");
      await keys.getByRole("button", { name: "Move left" }).click();
      await keys.getByRole("button", { name: "Move right" }).click();
      await keys.getByRole("button", { name: "Undo" }).click();
      await expect(box).toBeFocused();
      // Insert, in the header, opens the sheet; a pick goes in at the
      // caret and closes it.
      await ws.locator(".wshead").getByRole("button", { name: "Insert" }).click();
      const sheet = ws.locator(".wssheet");
      await expect(sheet).toBeVisible();
      await snapshots.shot("template-workspace-phone-insert");
      await sheet.getByRole("combobox").fill("porch");
      await sheet.getByRole("option", { name: /Porch/ }).first().click();
      await expect(sheet).toHaveCount(0);
      await expect(box).toBeFocused();
      // The caret was in states(…): the id alone went in.
      await expect(box).toContainText("{% endif %}{{ states('light.porch') }}");
      // A recipe in the sheet: its entity next, what it writes under it.
      await ws.locator(".wshead").getByRole("button", { name: "Insert" }).click();
      await sheet.getByRole("option", { name: /Words for on and off/ }).click();
      await expect(sheet.locator(".insstep")).toBeVisible();
      await expect(sheet.locator(".insprev code")).toContainText("is_state('light.porch', 'on')");
      await expect(strip).toContainText(/6\.6° warmer inside\s+on/);
      await snapshots.shot("template-workspace-phone-recipe");
      await sheet.locator(".insopt.active").click();
      await expect(sheet).toHaveCount(0);
      await expect(box).toContainText("is_state('light.porch', 'on')");
      // Back to the form, the edit kept.
      await ws.getByRole("button", { name: "Back" }).click();
      await expect(page.locator("aivi-template-workspace")).toHaveCount(0);
      await expect(state.locator(TEMPLATE_BOX)).toContainText("light.porch");
    });
  }

  test("the hub is narrow", async ({ page, panel, snapshots }) => {
    await panel.openHub();
    await expect(page.locator("aivi-panel")).toHaveAttribute("narrow");
    await snapshots.shot("hub-mobile");
  });

  // The Log page on a phone: the two selects stacked over the full
  // width, a row's content open.
  test("the log on a phone", async ({ page, snapshots }) => {
    await page.goto("index.html?switchboard=1#/log");
    const log = page.locator("aivi-activity-log");
    await expect(log.locator(".topbar .title")).toHaveText("Log");
    const rows = log.locator(".loglist .arow");
    await expect(rows).toHaveCount(11);
    await rows.first().locator("details.abody summary").click();
    await expect(rows.first().locator("details.abody pre")).toBeVisible();
    await snapshots.shot("activity-log-mobile");
    await log.locator('select[aria-label="Show"]').selectOption("problems");
    await expect(rows).toHaveCount(5);
    await expect(log.locator(".logcount")).toContainText("5 of 11 entries");
    await snapshots.shot("activity-log-mobile-problems");
  });

  test("the editor stacks, with the preview and the chat as sheets", async ({
    page,
    panel,
    snapshots,
  }) => {
    const toggle = page.locator(".pvtoggle");
    // Activated programmatically: a real tap would focus the button itself.
    const toggleSheet = () => toggle.evaluate((el: HTMLElement) => el.click());

    // One stacked column with the collapsed mini-preview bar pinned to
    // the bottom.
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    await expect(toggle).toBeVisible();
    await snapshots.shot("editor-mobile");

    // With an input focused and the page scrolled, toggling the sheet must
    // neither move focus nor shift the form's scroll position.
    await test.step("expanding the preview keeps focus and scroll", async () => {
      const icon = page.locator('input[placeholder="e.g. washer.fill"]');
      await icon.click();
      // The symbol index loads on the first pick; the capture below shows
      // the picker with it.
      await expect(page.locator(".icpop .iclist")).toBeVisible();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await toggleSheet();
      await expect(page.locator(".side.open aivi-preview-pane.pcard")).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      await expect(icon).toBeFocused();
      // The "what will be pushed" JSON stays reachable from the sheet.
      await expect(page.locator("details.payload summary")).toBeVisible();
      await snapshots.shot("editor-mobile-preview");
    });

    // A sheet over the lower screen, the preview sheet stepping aside
    // while it is open.
    await test.step("the chat opens as a sheet and closes", async () => {
      await toggleSheet();
      await page.locator(".edbar .aibtn").click();
      await expect(page.locator(".aiside .suggest textarea")).toBeVisible();
      await snapshots.shot("editor-mobile-suggest");
      await page.locator(".aiside .dclose").click();
      await expect(page.locator(".aiside")).toHaveCount(0);
    });
  });

  // One stacked column, the lifecycle card first, the mini-preview bar
  // pinned to the bottom.
  test("the Live Activity editor stacks", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/activity/washer", "Washer");
    await panel.previewReady();
    await expect(page.locator(".pvtoggle")).toBeVisible();
    await snapshots.shot("editor-activity-mobile");
  });
  // An icon's second color from a template: its menu and its box fit
  // the width, the box under the label.
  test("an icon's colors on a phone", async ({ panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const icon = panel.field("icon");
    await icon.locator("details.style summary").click();
    const second = icon.locator("details.style .orow", { hasText: "Second color" });
    await second.locator("select.srcsel").selectOption("template");
    await second.locator(TEMPLATE_BOX).fill("{{ 'orange' }}");
    await expect(second.locator(".tres .tval")).toHaveText("orange");
    await second.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("style-icon-colors-mobile");
  });

  // A color by value on a phone: its bands fit the width, and "Preview
  // as" sits in the preview sheet.
  test("a color by value on a phone", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    await panel.pickEntity(
      panel.field("state").locator(".cbx input"),
      "phone",
      "sensor.phone_battery",
    );
    const icon = panel.field("icon").locator('.fmain input[type="text"]').first();
    await icon.fill("battery.100percent");
    await icon.press("Escape");
    const accent = panel.field("accent");
    await accent.locator(".fsrc select.srcsel").selectOption("bands");
    await expect(accent.locator(".bnow")).toHaveText("Now 81, so Green");
    await accent.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await snapshots.shot("style-by-value-mobile");
    await page.locator(".pvtoggle").evaluate((el: HTMLElement) => el.click());
    await page.locator(".pvas .fchip", { hasText: "Below 20" }).click();
    await expect.poll(async () => (await panel.payload()).accent).toBe("red");
    await snapshots.shot("style-by-value-mobile-preview");
  });

  // A showcase on a phone: its form, and the widget in the preview sheet.
  test("a showcase on a phone", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html?more=1#/widget/car", "Car");
    await panel.previewReady();
    await snapshots.shot("showcase-mobile");
    await page.locator(".pvtoggle").evaluate((el: HTMLElement) => el.click());
    const img = page.locator(".side.open .pv-stage .pv-showcase-img").first();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    await snapshots.shot("showcase-mobile-preview");
  });

  // A remote on a phone: its form, and the widget in the preview sheet.
  test("a remote on a phone", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html?more=1#/widget/carremote", "Car remote");
    await panel.previewReady();
    await snapshots.shot("remote-mobile");
    await page.locator(".pvtoggle").evaluate((el: HTMLElement) => el.click());
    const img = page.locator(".side.open .pv-stage .pv-showcase-img").first();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    await snapshots.shot("remote-mobile-preview");
  });

  // The ring by value on a phone: the bands under the mode switch.
  test("a gauge ring by value on a phone", async ({ page, panel, snapshots }) => {
    await page.goto("index.html#/widget/thermostat");
    await panel.pickEntity(
      panel.field("value").locator(".cbx input"),
      "living",
      "sensor.living_temp",
    );
    await panel.field("min_value").locator("input").fill("10");
    await panel.field("max_value").locator("input").fill("30");
    // The range is stored as it is typed: the ring's stops say so.
    await expect(page.locator(".ramp .rwhere").last()).toContainText("30");
    const ring = page.locator(".ramp");
    await ring.locator('.seg[role="radiogroup"] button', { hasText: "By value" }).click();
    await expect(ring.locator(".btick")).toHaveText(["10", "17", "23", "30"]);
    // The ring's row under the editor's bar, its mode switch in view.
    await panel.field("ring").evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      window.scrollBy(0, -72);
    });
    await snapshots.shot("gauge-by-value-mobile");
  });
});
