import { expect, test } from "./fixtures";

test.describe("Live Activity editor", () => {
  // The remote (?more=1 binds the Robot vacuum): the icon tile, the name
  // over its state, the reading, the bar and two labeled buttons, and the
  // island's glyph and value with its unit.
  for (const theme of ["dark", "light"] as const) {
    test(`the remote's card and island, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      await panel.openEditor(`${url}?more=1#/activity/vacuum`, "Robot vacuum");
      await panel.previewReady();
      const banner = page.locator(".pv-banner");
      await expect(banner).toContainText("Cleaning");
      await expect(banner.locator('[data-slot="actions"]')).toContainText("Dock");
      await expect(page.locator(".pv-island-pill").first()).toContainText("68%");
      await snapshots.shot(`editor-activity-remote-${theme}`);
      await snapshots.crop(
        page.locator(".pv-stage").first(),
        `editor-activity-remote-${theme}-preview`,
      );
    });
  }

  // The lifecycle card (the required active entity) sits above the field
  // form, and the preview stacks the collapsed Dynamic Island mock over
  // the lock-screen banner.
  test("the island carries the bound compact value", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/activity/washer", "Washer");
    await expect(page.locator(".setup")).toBeVisible();
    await panel.previewReady();
    await expect(page.locator(".pv-banner")).toBeVisible();
    // "Washing", from input_text.washer_state, in the compact-trailing slot.
    await expect(page.locator(".pv-island-pill").first()).toContainText("Washing");
    await snapshots.shot("editor-activity");
  });

  test("pressing a preview region flashes the rows that feed it", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.goto("index.html#/activity/washer");
    await expect(page.locator(".pv-banner")).toBeVisible();
    const rows = page.locator("aivi-field-row");
    const flashed = (): Promise<(string | undefined)[]> =>
      page
        .locator("aivi-field-row.flash")
        .evaluateAll((els: HTMLElement[]) => els.map((el) => el.dataset["key"]));

    // The banner bar is fed by `progress` and `segments`, so pressing it
    // must flash both rows without hiding any form rows.
    await test.step("the bar flashes progress and segments, and no row comes or goes", async () => {
      const before = await rows.count();
      await page.locator('.pv-stage [data-slot="bar"]').click();
      await expect.poll(flashed).toEqual(expect.arrayContaining(["progress", "segments"]));
      await expect(rows).toHaveCount(before);
    });

    // A region the payload doesn't fill keeps a dashed stand-in with its
    // field's label, so it is reachable before it is bound. The seeded
    // activity leaves both footnotes unset.
    await test.step("an unbound footnote holds its place and flashes its row", async () => {
      const ghosts = page.locator(".pv-stage [data-ghost]");
      expect((await ghosts.allTextContents()).map((text) => text.trim())).toContain("Footnote");
      await page.locator('.pv-stage [data-ghost][data-slot="footer-left"]').click();
      await expect(panel.field("footer_left")).toContainClass("flash");
      await snapshots.shot("editor-activity-slot");
    });
  });
});
