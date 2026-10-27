import { expect, test } from "./fixtures";

// Runs once per device project (iphone14, pixel7). Verification on a real
// device can't run here, so these emulate the companion app's WebView.
test.describe("touch device", () => {
  test("the hub", async ({ panel, snapshots }, testInfo) => {
    await panel.openHub();
    await snapshots.shot(`hub-${testInfo.project.name}`);
  });

  test("the editor has touch-size swatches and a bounded picker", async ({
    page,
    panel,
    snapshots,
  }, testInfo) => {
    const profile = testInfo.project.name;
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    await snapshots.shot(`editor-${profile}`);

    const style = page.locator("details.style").first();

    // The dot stays 21 px but a pseudo-element must extend the hit area to
    // at least 44 px under pointer: coarse. Measured from the computed
    // ::after box, not assumed from the stylesheet.
    await test.step("a color swatch has a 44 px hit area", async () => {
      if ((await style.getAttribute("open")) === null) {
        await style.locator("summary").click();
      }
      await style.locator(".cfbtn").first().click();
      const swatch = page.locator(".cfpop .swatches .sw").first();
      await expect(swatch).toBeVisible();
      const geometry = await swatch.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const after = getComputedStyle(el, "::after");
        const inset = (value: string): number => parseFloat(value) || 0;
        return {
          dot: Math.round(rect.width),
          hitWidth: rect.width - inset(after.left) - inset(after.right),
          hitHeight: rect.height - inset(after.top) - inset(after.bottom),
        };
      });
      expect(geometry.dot).toBe(21);
      expect(geometry.hitWidth).toBeGreaterThanOrEqual(44);
      expect(geometry.hitHeight).toBeGreaterThanOrEqual(44);
      if (profile === "iphone14") {
        // The palette popover itself, for review of the mobile layout.
        await snapshots.crop(page.locator(".cfpop"), "swatches-iphone14");
      }
      await page.keyboard.press("Escape");
      // Fold the disclosure back so the picker step runs with it closed.
      await style.locator("summary").click();
    });

    // A stand-in for the on-screen keyboard, which can't be emulated
    // headlessly: tapping a combobox must scroll the field into view and
    // open a popup whose height is bounded by the viewport, with its own
    // scroll.
    await test.step("a tapped picker stays in view with a bounded popup", async () => {
      const input = page.locator(".cbx input").first();
      const popup = page.locator(".cbx-pop").first();
      await input.tap();
      await expect(popup).toBeVisible();
      const top = (el: Element): number => el.getBoundingClientRect().top;
      const viewport = await page.evaluate(() => window.innerHeight);
      const pop = await popup.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { bottom: rect.bottom, height: rect.height };
      });
      expect(await input.evaluate(top)).toBeGreaterThanOrEqual(0);
      expect(pop.height).toBeLessThanOrEqual(0.45 * viewport);
      expect(pop.bottom).toBeLessThanOrEqual(viewport);
    });
  });
});
