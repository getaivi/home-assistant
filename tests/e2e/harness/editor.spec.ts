import { expect, TEMPLATE_BOX, test } from "./fixtures";

test.describe("widget editor", () => {
  // The swatch hairline ring adapts to the theme's text color, so it needs
  // review on the light card too.
  test("light theme, with the color palette", async ({ page, panel, snapshots }) => {
    await panel.openEditor("light.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    await snapshots.shot("editor-light");

    const style = page.locator("details.style").first();
    if ((await style.getAttribute("open")) === null) {
      await style.locator("summary").click();
    }
    // The color field's popover holds the palette.
    await style.locator(".cfbtn").first().click();
    await expect(page.locator(".cfpop .swatches .sw").first()).toBeVisible();
    await snapshots.crop(page.locator(".cfpop"), "swatches-light");
  });

  test("typing keeps focus through preview refreshes", async ({ page, panel, snapshots }) => {
    await panel.openHub();
    // The widget card element specifically: the demo activity's summary
    // ("runs on Front door open") would also match a bare .wcard text filter.
    await page
      .locator("aivi-widget-card", { hasText: "Front door" })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.locator(".editor")).toBeVisible();
    await panel.previewReady();
    await snapshots.shot("editor-status");

    await test.step("the debounced preview refresh leaves the icon input alone", async () => {
      const icon = page.locator('input[placeholder="e.g. washer.fill"]');
      await icon.click();
      await icon.pressSequentially("washer.fill");
      await expect(panel.payloadText).toContainText("washer.fill");
      await expect(icon).toBeFocused();
      await expect(icon).toHaveValue("washer.fill");
    });

    // The tap_url suggestion chips re-derive on every editor state change,
    // re-rendering the row under a focused input mid-typing. The value is
    // attribute-bound, so the re-render must neither move focus nor rewrite
    // what was typed; the value attribute (only a row re-render sets it)
    // proves the re-render actually ran.
    await test.step("the re-derived suggestion row leaves the tap URL input alone", async () => {
      const url = "https://example.com/door";
      const tap = panel.field("tap_url").locator('input[type="text"]');
      // The icon picker's popup is still open and reaches over this row:
      // close it, as a press elsewhere would.
      await page.keyboard.press("Escape");
      await tap.click();
      await tap.pressSequentially(url);
      await expect(panel.payloadText).toContainText(url);
      await expect(tap).toBeFocused();
      await expect(tap).toHaveAttribute("aria-label", "Opens on tap");
      await expect(tap).toHaveValue(url);
      await expect(tap).toHaveAttribute("value", url);
    });
  });

  // A template with no medium layout of its own: the small render,
  // centered on the medium surface.
  test("a small-only template on the medium surface", async ({ panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    await panel.previewSize("Medium");
    await snapshots.shot("editor-status-medium");
  });

  test("a value sourced from a template keeps its literal as the fallback", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.goto("index.html#/widget/frontdoor");
    const accent = panel.field("accent");
    await expect(accent.locator(".vsrc")).toBeVisible();
    await accent.locator(".fsrc select.srcsel").selectOption("template");
    await accent
      .locator(TEMPLATE_BOX)
      .fill("{{ 'red' if is_state('input_boolean.front_door','on') else 'green' }}");
    await expect.poll(async () => (await panel.payload()).accent).toBe("red");
    // The swatch survives the switch and is presented as the fallback.
    await expect(accent.locator(".vsrc .fallback aivi-color-field")).not.toHaveCount(0);
    await snapshots.shot("editor-sourced-color");

    // A template rendering something outside the closed wire palette is a
    // warning, not an error: the fallback applies and the push stays valid.
    await test.step("an out-of-palette color falls back without blocking Save", async () => {
      await accent.locator(TEMPLATE_BOX).fill("{{ '#ff0000' }}");
      await expect(accent.locator(".tnote.warn:not(.never)")).toBeVisible();
      await expect.poll(async () => (await panel.payload()).accent).toBe("red");
      await expect(panel.save).toBeEnabled();
      await snapshots.shot("editor-sourced-fallback");
    });
  });

  // A countdown with a bound target and an unset subtitle: the hero and
  // the subtitle placeholder are the tightest vertical pair in any
  // template (2 pt apart on device), so this is where a highlight ring
  // drawn outside its region collides with the dashed edge below.
  test("a region's highlight ring clears the placeholder below it", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.goto("index.html#/widget/bins");
    await panel.pickEntity(panel.field("target").locator(".cbx input"), "bin", "sensor.next_bin");
    const hero = page.locator('.pv-stage [data-slot="hero"]');
    const ghost = page.locator('.pv-stage [data-ghost][data-slot="caption"]');
    await expect(hero).toBeVisible();
    await expect(ghost).toBeVisible();
    await hero.click();
    await expect(hero).toHaveAttribute("data-slot-on");

    const ghostTop = await ghost.evaluate((el) => el.getBoundingClientRect().top);
    const clearance = await hero.evaluate((el: HTMLElement, below) => {
      const style = getComputedStyle(el);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const box = el.getBoundingClientRect();
      // Both measured in the scaled canvas's pixels, so they compare directly.
      return below - box.bottom - ring * (box.height / el.offsetHeight);
    }, ghostTop);
    expect(clearance).toBeGreaterThan(0);
    await snapshots.shot("editor-countdown-ghost");
  });

  test("a battery row's charging options, and the delivery settings", async ({
    page,
    panel,
    snapshots,
  }) => {
    await panel.openEditor("index.html#/widget/batteries", "Home batteries");
    await panel.addRow("sensor.phone_battery", '.field[data-key="devices"]');
    await page.locator('.field[data-key="devices"] .ordrow .rowtoggle').first().click();
    await expect(
      page.locator(".pv-stage:not(.is-skeleton) .pv-canvas [data-slot]").first(),
    ).toBeVisible();
    await page.locator(".rowopts").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-battery-charging");

    const delivery = page.locator(".field.delivery");
    await delivery.locator("select").selectOption("3600");
    await delivery.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-delivery");
  });
});

test.describe("template feedback", () => {
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

  test("the result, the error with its line, did you mean, and a clock", async ({
    panel,
    snapshots,
  }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const state = panel.field("state");
    await state.locator(".fsrc select.srcsel").selectOption("template");
    const box = state.locator(TEMPLATE_BOX);

    await test.step("a long template: the box grows, the result shows in full", async () => {
      await box.fill(LONG);
      await expect(state.locator(".tres .tval")).toHaveText("6.6° warmer inside");
      await expect(state.locator(".tres .tkind")).toHaveText("text");
      await expect(state.locator(".tchips .chip")).toHaveText([
        "sensor.living_temp",
        "sensor.outdoor_temp",
      ]);
      // Nine lines: the box grew past its three-line start (then
      // scrolls at ten).
      const height = await state
        .locator("aivi-code-editor .cm-editor")
        .evaluate((el) => el.clientHeight);
      const line = await box.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect(height).toBeGreaterThan(line * 9);
      await snapshots.shot("editor-template-result");
    });

    await test.step("a syntax error waits for a pause, then names its line", async () => {
      await box.fill("{% set t = states('sensor.living_temp') | float(0) %}\n{{ t | round(1) }");
      const note = state.locator(".tnote.error");
      await expect(note).toContainText("Line 2:");
      await expect(note).toContainText("Something is not closed.");
      await expect(note.locator(".traw")).toHaveText("TemplateSyntaxError: unexpected '}'");
      await expect(state.locator(".freq.err")).toBeVisible();
      await snapshots.shot("editor-template-error-line");
    });

    await test.step("a mistyped entity id gets a did you mean", async () => {
      await box.fill("{{ states('sensor.livingroom_temp') }} °C");
      const unknown = state.locator(".tunknown");
      await expect(unknown).toContainText("Home Assistant has no sensor.livingroom_temp.");
      await snapshots.shot("editor-template-unknown-entity");
      await unknown.getByRole("button", { name: "Use sensor.living_temp" }).click();
      await expect(box).toHaveText("{{ states('sensor.living_temp') }} °C");
      await expect(state.locator(".tres .tval")).toHaveText("21.4 °C");
      await expect(unknown).toHaveCount(0);
    });

    await test.step("a clock template updates every minute", async () => {
      await box.fill("{{ now().strftime('%H:%M') }}");
      await expect(state.locator(".tchips")).toContainText("the start of every minute");
      await expect(state.locator(".tnote.never")).toHaveCount(0);
      // The value changes by the minute: pin it so the capture is stable.
      await state.locator(".tres .tval").evaluate((el: HTMLElement) => {
        el.textContent = "12:00";
      });
      await snapshots.shot("editor-template-time");
    });
  });

  test("the light theme", async ({ panel, snapshots }) => {
    await panel.openEditor("light.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const state = panel.field("state");
    await state.locator(".fsrc select.srcsel").selectOption("template");
    await state.locator(TEMPLATE_BOX).fill(LONG);
    await expect(state.locator(".tres .tval")).toHaveText("6.6° warmer inside");
    await snapshots.shot("editor-template-light");
  });

  test("a trend's points say what list they got", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html?more=1#/widget/indoor", "Indoor");
    await panel.pickEntity(
      page.locator('.field[data-key="value"] .cbx input'),
      "living room",
      "sensor.living_temp",
    );
    await panel.previewReady();
    const points = panel.field("points");
    await points.locator(".fsrc select.srcsel").selectOption("template");
    await points
      .locator(TEMPLATE_BOX)
      .fill("{{ state_attr('sensor.nordpool', 'today') | map('round', 2) | list }}");
    await expect(points.locator(".tres .tkind")).toContainText(/^list of \d+ numbers, /);
    await points.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-template-points");
  });
});
