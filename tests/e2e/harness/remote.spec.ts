import type { Locator, Page } from "@playwright/test";
import { expect, type Panel, test } from "./fixtures";

// The Remote widget (?more=1 binds the Car remote and the Garage door):
// its editor at every width, the preview with a cut-out, a photo, no
// picture, plain buttons and buttons drawn as tiles, and its card on the
// hub. The sample pictures come from frontend/harness/pictures/.

const widget = (page: Page): Locator => page.locator(".pv-stage:not(.is-skeleton) .pv-scale");

async function open(panel: Panel, url: string, slug: string, title: string): Promise<void> {
  await panel.openEditor(`${url}?more=1#/widget/${slug}`, title);
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

test.describe("the remote widget", () => {
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
        await open(panel, url, "carremote", "Car remote");
        await expect(page.locator(".pv-stage .pv-remote-button")).toHaveCount(2);
        await pictureLoaded(page);
        await snapshots.shot(`remote-editor-${name}-${theme}`);
      }
    });
  }

  test("its preview with plain buttons, a cut-out and a photo", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(panel, "index.html", "carremote", "Car remote");
    // What the integration pushes: the charge with its unit, the range,
    // the lock and the climate as toggles, and the report time.
    await expect.poll(async () => JSON.stringify(await panel.payload())).toContain('"78%"');
    const payload = (await panel.payload()) as Record<string, unknown>;
    expect(payload["value"]).toEqual({ value: "78%" });
    expect(payload["stats"]).toEqual([{ label: "Range", value: { value: "312" }, unit: "km" }]);
    expect(
      (payload["actions"] as { id: string; kind: string; on: boolean }[]).map((a) => [
        a.id,
        a.kind,
        a.on,
      ]),
    ).toEqual([
      ["lock_my_car", "toggle", true],
      ["climate_my_car", "toggle", false],
    ]);
    expect(payload["reported_at"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    await expect(page.locator(".pv-stage .pv-showcase-meta")).toHaveText(/^\d+m ago$/);
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "remote-medium-cutout");
    await panel.previewSize("Small");
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "remote-small-cutout");

    // A photo: the vacuum on its floor.
    await panel.previewSize("Medium");
    const image = panel.field("image").locator('.fmain input[type="text"]').first();
    await image.fill("https://pictures.example.com/vacuum.jpg");
    await panel.field("image_fit").locator("select").selectOption("cover");
    await expect.poll(async () => JSON.stringify(await panel.payload())).toContain('"cover"');
    await expect(page.locator(".pv-stage .pv-showcase-photo.is-bled")).toBeVisible();
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "remote-medium-photo");
    await panel.previewSize("Small");
    await pictureLoaded(page);
    await snapshots.crop(widget(page), "remote-small-photo");
  });

  // The garage door: no picture, so its icon stands in, and the porch
  // light's own gradient draws every button as a tile.
  test("its preview with no picture and buttons drawn as tiles", async ({
    page,
    panel,
    snapshots,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(panel, "index.html", "garagedoor", "Garage door");
    await expect(page.locator(".pv-stage .pv-showcase-cutout.is-icon")).toBeVisible();
    await expect(
      page.locator(".pv-stage .pv-remote-buttons.is-marked .pv-switchboard-tile"),
    ).toHaveCount(2);
    await snapshots.crop(widget(page), "remote-medium-tiles");
    await panel.previewSize("Small");
    await snapshots.crop(widget(page), "remote-small-tiles");
  });

  test("its buttons in the form, and its card on the hub", async ({ page, panel, snapshots }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(panel, "index.html", "carremote", "Car remote");
    const buttons = panel.field("actions");
    await expect(buttons.locator(".flabel")).toHaveText("Buttons");
    await buttons.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("remote-editor-buttons");

    await page.goto("index.html?more=1");
    await panel.hubReady();
    const card = page.locator(".wcard", { hasText: "Car remote" });
    await expect(card).toContainText("Remote");
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("remote-hub");
  });
});
