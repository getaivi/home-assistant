import { expect, test } from "./fixtures";

// The harness mounts the panel the way <ha-panel-custom> does, with the
// route path in the URL hash.
test.describe("routing", () => {
  test("an editor has a URL that survives a reload and steps back to the hub", async ({
    page,
    panel,
  }) => {
    await panel.openHub();
    await page
      .locator("aivi-widget-card", { hasText: "Front door" })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.locator(".editor")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#/widget/frontdoor");

    await page.reload();
    await panel.editorReady("Front door");

    // The host reflects popstate into a fresh `route` assignment.
    await page.goBack();
    await panel.hubReady();
  });

  // Here the unbound Laundry widget's bind editor.
  test("a deep link renders its editor once data loads", async ({ panel }) => {
    await panel.openEditor("index.html#/widget/laundry", "Laundry");
  });

  test("a vanished id lands on the hub with a toast", async ({ page, panel }) => {
    await panel.openHub("index.html#/widget/ghost");
    await expect(page.locator(".toast", { hasText: "wasn't found" })).toBeVisible();
  });
});
