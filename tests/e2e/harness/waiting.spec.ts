import { expect, test } from "./fixtures";

// Content that waits on a field with nothing to read (?waiting=1: the
// Washer's progress follows a sensor that reads unknown): the hub card's
// warning, the editor's field note, required mark and preview, and the
// Log's waiting and held rows.

test.describe("a push that waits", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`the editor says why nothing is sent, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      await panel.openEditor(`${url}?waiting=1#/activity/washer`, "Washer");
      const pane = page.locator("aivi-preview-pane").first();
      await expect(pane.locator(".missing").first()).toHaveText(
        "Nothing is sent while the progress value reads “unknown”.",
      );
      const row = page.locator('.field[data-key="progress"]');
      await expect(row.locator(".freq.warn")).toHaveAttribute(
        "aria-label",
        "Nothing to read right now",
      );
      await expect(row.locator(".tnote.warn")).toHaveText(
        "Reads “unknown” right now, so nothing is sent until it has a value.",
      );
      await snapshots.shot(`waiting-editor-${theme}`);
    });
  }

  for (const theme of ["dark", "light"] as const) {
    test(`the hub card says why nothing is sent, ${theme}`, async ({ page, panel, snapshots }) => {
      await panel.openHub(`${theme === "light" ? "light.html" : "index.html"}?waiting=1`);
      const washer = page.locator("aivi-activity-card", { hasText: "Washer" });
      await expect(washer.locator(".tnote.waiting")).toHaveText(
        "Nothing is sent while the progress value reads “unknown”.",
      );
      // Only the binding that waits says so.
      await expect(page.locator(".tnote.waiting")).toHaveCount(1);
      await snapshots.shot(`waiting-hub-${theme}`);
    });
  }

  test("the Log has its waiting and held rows", async ({ page, snapshots }) => {
    await page.goto("index.html?waiting=1#/log");
    const rows = page.locator("aivi-activity-log .loglist .arow");
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(0).locator(".pwarn")).toHaveText(
      "Nothing sent: the progress value reads “unknown”.",
    );
    await expect(rows.nth(1).locator(".fhint").first()).toContainText("Held until");
    // What the held change will send: the request, with the lifecycle
    // state beside the content.
    await rows.nth(1).locator("details.abody summary").click();
    await expect(rows.nth(1).locator("details.abody pre")).toContainText(
      "PATCH /activities/washer",
    );
    await expect(rows.nth(1).locator("details.abody pre")).toContainText('"state": "ONGOING"');
    await snapshots.shot("waiting-log");
  });
});
