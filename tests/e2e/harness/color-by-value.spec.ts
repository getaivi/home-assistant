import type { Locator, Page } from "@playwright/test";
import { expect, type Panel, test } from "./fixtures";

// A color by value: the accent follows the phone's battery in bands,
// "Preview as" draws the widget inside each band, and the bands go to a
// template as the same thing.

/** The front door's widget showing the phone's battery, its accent by
 * value. */
async function accentByValue(panel: Panel, url: string): Promise<Locator> {
  await panel.openEditor(`${url}#/widget/frontdoor`, "Front door");
  await panel.previewReady();
  await panel.pickEntity(
    panel.field("state").locator(".cbx input"),
    "phone",
    "sensor.phone_battery",
  );
  // An icon, whose chip takes the accent.
  const icon = panel.field("icon").locator('.fmain input[type="text"]').first();
  await icon.fill("battery.100percent");
  await icon.press("Escape");
  const accent = panel.field("accent");
  await accent.locator(".fsrc select.srcsel").selectOption("bands");
  await expect(accent.locator(".bnow")).toHaveText("Now 81, so Green");
  return accent;
}

const chips = (page: Page): Locator => page.locator(".pvas .fchip");

test.describe("a color by value", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`at every width, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
      ] as const) {
        await page.goto("about:blank");
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        const accent = await accentByValue(panel, url);
        await expect.poll(async () => (await panel.payload()).accent).toBe("green");
        await accent.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await snapshots.shot(`style-by-value-${name}-${theme}`);

        // The widget inside the lowest band, then back to now.
        await chips(page).filter({ hasText: "Below 20" }).click();
        await expect.poll(async () => (await panel.payload()).accent).toBe("red");
        await expect(chips(page).filter({ hasText: "Below 20" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await snapshots.shot(`style-by-value-preview-as-${name}-${theme}`);
        await chips(page).filter({ hasText: "Now" }).click();
        await expect.poll(async () => (await panel.payload()).accent).toBe("green");
      }
    });
  }

  test("edits its bands, says when color alone carries it, and goes to a template", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const accent = await accentByValue(panel, "index.html");
    const limits = accent.locator("input.blimit");
    await limits.first().fill("30");
    await expect(accent.locator(".btick")).toContainText(["0", "30", "50", "100"]);
    await limits.first().fill("70");
    await expect(accent.locator(".brow .tnote.error")).toBeVisible();
    await limits.first().press("Tab");
    await expect(limits.first()).toHaveValue("30");
    await accent.getByRole("button", { name: "Add a band" }).click();
    await expect(accent.locator(".brow")).toHaveCount(4);

    // The text color of the state by the same reading, in its fold.
    const state = panel.field("state");
    await state.locator("details.style summary").click();
    const color = state.locator("details.style .orow", { hasText: "Color" });
    await color.locator("select.srcsel").selectOption("bands");
    await expect(color.locator(".bnow")).toHaveText("Now 81, so Green");
    await expect
      .poll(async () => (await panel.payload()) as Record<string, unknown>)
      .toMatchObject({ state: { value: "81", text_color: "green" } });
    await state.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await snapshots.shot("style-by-value-text-color");

    // Following a reading the widget does not show: color alone says it.
    await panel.pickEntity(
      accent.locator("aivi-bands-field .cbx input"),
      "humidity",
      "sensor.humidity",
    );
    await panel.pickEntity(
      state.locator(".cbx input").first(),
      "front",
      "input_boolean.front_door",
    );
    await expect(accent.locator("aivi-bands-field")).toContainText(
      "Colors don't show on the Lock Screen",
    );
    await expect
      .poll(async () => (await panel.payload()) as Record<string, unknown>)
      .toMatchObject({ state: { value: "on" }, accent: "green" });
    await accent.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("style-by-value-lock-hint");

    await accent.getByRole("button", { name: "Write as template" }).click();
    await expect(accent.locator(".fsrc select.srcsel")).toHaveValue("template");
    await expect(accent.locator(".tres .tval")).toHaveText("green");
    await snapshots.shot("style-by-value-as-template");
  });
});
