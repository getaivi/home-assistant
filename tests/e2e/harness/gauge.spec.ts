import { expect, test } from "./fixtures";

test.describe("gauge ring", () => {
  test("a ramp is placed in the gauge's units, reversed, and reduced to one color", async ({
    page,
    panel,
    snapshots,
  }) => {
    // An unset ring lands in Ramp mode showing the built-in fallback the
    // dial actually paints, with the preset gallery in front.
    await page.goto("index.html#/widget/thermostat");
    await expect(page.locator(".ramp .rpresets")).toBeVisible();
    await page.locator(".ramp").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-ring-empty");

    // Give the gauge a reading and a real range, so the ring can show where
    // each stop lands in the user's own units rather than in 0..1.
    await panel.pickEntity(
      panel.field("value").locator(".cbx input"),
      "living",
      "sensor.living_temp",
    );
    await panel.field("min_value").locator("input").fill("10");
    await panel.field("max_value").locator("input").fill("30");
    await panel.field("unit").locator("input").fill("°C");
    // Wait for the range to be stored, not merely typed: the rows pick it
    // up on the next validation nudge, so clicking a preset before then
    // would read stops against the 0..1 default.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bindings = window.__panel.editorState?.bindings ?? {};
          return [bindings["min_value"], bindings["max_value"], bindings["unit"]];
        }),
      )
      .toEqual([10, 30, "°C"]);
    await panel.previewReady();

    // A preset writes the whole ramp in one press. The labels are matched
    // without the degree sign: the assertion is that the stop is placed at
    // 20 in the gauge's own scale, not that a particular glyph survived
    // the round trip.
    await test.step("a preset's stops are labeled in gauge units", async () => {
      await page.getByRole("button", { name: "Good to bad" }).click();
      await expect(page.locator(".ramp .rwhere")).toHaveText([
        /^\s*at 10/,
        /^\s*at 20.*C\s*$/,
        /^\s*at 30/,
      ]);
    });

    await test.step("Reverse flips the ramp", async () => {
      await page.getByRole("button", { name: "Reverse" }).click();
      await expect
        .poll(async () => (await panel.payload()).gradient)
        .toEqual(["red", expect.any(String), "green"]);
      await snapshots.shot("editor-ring-ramp");
    });

    // The wire key matches the mode on screen: it never flips as a side
    // effect of how many dots are picked. The mode switch is an APG
    // radiogroup, so its segments are radios.
    await test.step("One color keeps a single color on the wire", async () => {
      await page.locator('.ramp .seg[role="radiogroup"] button', { hasText: "One color" }).click();
      await expect
        .poll(async () => {
          const { gradient, color } = await panel.payload();
          return { gradient: gradient ?? null, color };
        })
        .toEqual({ gradient: null, color: "red" });
    });
  });

  // The ring as one color by the band the reading is in, drawn on the
  // dial's own span; "Preview as" shows each band on the dial.
  for (const theme of ["dark", "light"] as const) {
    test(`one color by value, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
      ] as const) {
        await page.goto("about:blank");
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        await page.goto(`${url}#/widget/thermostat`);
        await panel.pickEntity(
          panel.field("value").locator(".cbx input"),
          "living",
          "sensor.living_temp",
        );
        await panel.field("min_value").locator("input").fill("10");
        await panel.field("max_value").locator("input").fill("30");
        await panel.field("unit").locator("input").fill("°C");
        // The range is stored as it is typed: the ring's stops say so.
        await expect(page.locator(".ramp .rwhere").last()).toContainText("30");
        const ring = page.locator(".ramp");
        await ring.locator('.seg[role="radiogroup"] button', { hasText: "By value" }).click();
        await expect(ring.locator(".bnow")).toHaveText("Now 21.4 °C, so Orange");
        await expect(ring.locator(".btick")).toHaveText(["10", "17", "23", "30"]);
        await expect
          .poll(async () => {
            const { gradient, color } = await panel.payload();
            return { gradient: gradient ?? null, color };
          })
          .toEqual({ gradient: null, color: "orange" });
        await ring.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await snapshots.shot(`gauge-by-value-${name}-${theme}`);
        await page.locator(".pvas .fchip", { hasText: "Below 17" }).click();
        await expect.poll(async () => (await panel.payload()).color).toBe("red");
        await snapshots.shot(`gauge-by-value-preview-as-${name}-${theme}`);
      }
    });
  }
});
