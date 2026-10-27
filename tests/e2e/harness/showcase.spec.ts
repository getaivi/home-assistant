import type { Locator, Page } from "@playwright/test";
import { expect, type Panel, test } from "./fixtures";

// The Showcase widget (?more=1 binds the Car): its editor at every width,
// the preview with a cut-out, a photo and no picture, and its card on the
// hub. The sample pictures come from frontend/harness/pictures/.

const widget = (page: Page): Locator => page.locator(".pv-stage:not(.is-skeleton) .pv-scale");

async function openCar(panel: Panel, url: string): Promise<void> {
  await panel.openEditor(`${url}?more=1#/widget/car`, "Car");
  await panel.previewReady();
}

/** The preview's picture has loaded (a cut-out or a photo). */
async function pictureLoaded(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator(".pv-stage .pv-showcase-img")
        .first()
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
}

test.describe("the showcase widget", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`its editor at every width, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
      ] as const) {
        await page.goto("about:blank");
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        await openCar(panel, url);
        await expect(page.locator(".pv-stage .pv-showcase-row")).toHaveCount(3);
        await pictureLoaded(page);
        await snapshots.shot(`showcase-editor-${name}-${theme}`);
      }
    });
  }

  test("its preview with a cut-out, a photo and no picture", async ({ page, panel, snapshots }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCar(panel, "index.html");
    // What the integration pushes: the picture, the doors as the mark,
    // three readings, the charge's gauge ceiling and its report time.
    await expect.poll(async () => JSON.stringify(await panel.payload())).toContain('"max":100');
    const payload = (await panel.payload()) as Record<string, unknown>;
    expect(payload["image"]).toEqual({
      url: "https://pictures.example.com/car.png",
      alt: "The car from the side",
    });
    expect(payload["reported_at"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    // 12 minutes before the harness server started, which can be a while
    // before this test runs.
    await expect(page.locator(".pv-stage .pv-showcase-meta")).toHaveText(/^\d+m ago$/);
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "showcase-medium-cutout");
    await panel.previewSize("Small");
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "showcase-small-cutout");

    // A photo: the vacuum on its floor.
    await panel.previewSize("Medium");
    const image = panel.field("image").locator('.fmain input[type="text"]').first();
    await image.fill("https://pictures.example.com/vacuum.jpg");
    await panel.field("image_fit").locator("select").selectOption("cover");
    await expect.poll(async () => JSON.stringify(await panel.payload())).toContain('"cover"');
    await expect(page.locator(".pv-stage .pv-showcase-photo")).toBeVisible();
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "showcase-medium-photo");
    await panel.previewSize("Small");
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "showcase-small-photo");

    // No picture: the widget's icon stands in.
    await panel.previewSize("Medium");
    await image.fill("");
    await expect(page.locator(".pv-stage .pv-showcase-cutout.is-icon")).toBeVisible();
    await snapshots.crop(widget(page), "showcase-medium-icon");

    // A picture URL that is not https holds Save, with the reason.
    await image.fill("http://pictures.example.com/car.png");
    await expect(panel.field("image").locator(".tnote.error")).toHaveText(
      "The URL must start with https://.",
    );
    await expect(panel.save).toBeDisabled();
  });

  test("a reading's options, and its card on the hub", async ({ page, panel, snapshots }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCar(panel, "index.html");
    const stats = panel.field("stats");
    await stats.getByRole("button", { name: /^Car charge\b/ }).click();
    await expect(stats.locator('input[aria-label="Gauge maximum for Car charge"]')).toHaveValue(
      "100",
    );
    await stats.locator(".rowopts").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("showcase-editor-reading");

    await page.goto("index.html?more=1");
    await panel.hubReady();
    const card = page.locator(".wcard", { hasText: "Car" }).filter({ hasText: "Showcase" });
    await expect(card).toContainText("Showcase");
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("showcase-hub");
  });
});
