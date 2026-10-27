import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The Log page (frontend/src/aivi-activity-log.ts): what went to Aivi
// and what the devices sent back, on one timeline with two selects; the
// bar's Events panel links to it; the editor's side column shows the
// binding's own slice of it.

const page_ = (page: Page): Locator => page.locator("aivi-activity-log");
const rows = (page: Page): Locator => page_(page).locator(".loglist .arow");
const show = (page: Page): Locator => page_(page).locator('select[aria-label="Show"]');
const forSelect = (page: Page): Locator => page_(page).locator('select[aria-label="For"]');

async function openLog(page: Page, url: string): Promise<void> {
  await page.goto(`${url}#/log`);
  await expect(page_(page).locator(".topbar .title")).toHaveText("Log");
  await expect(rows(page).first()).toBeVisible();
}

test.describe("the Log page", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`at every width, ${theme}`, async ({ page, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
      ] as const) {
        await page.goto("about:blank");
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        await openLog(page, `${url}?switchboard=1`);
        await expect(rows(page)).toHaveCount(11);
        // The first push's content, open.
        await rows(page).first().locator("details.abody summary").click();
        await expect(rows(page).first().locator("details.abody pre")).toContainText("accent");
        await snapshots.shot(`activity-log-${name}-${theme}`);
      }
    });
  }

  test("narrows by what to show and what it is for, and goes back to the hub", async ({
    page,
    panel,
    snapshots,
  }) => {
    await openLog(page, "index.html?switchboard=1");
    await expect(show(page).locator("option")).toHaveText([
      "Everything (11)",
      "Pushes to Aivi (6)",
      "Presses from your devices (5)",
      "Problems only (5)",
    ]);
    await show(page).selectOption("presses");
    await expect(rows(page)).toHaveCount(5);
    await expect(page_(page).locator(".logcount")).toContainText("5 of 11 entries");
    await show(page).selectOption("problems");
    await expect(rows(page)).toHaveCount(5);
    await forSelect(page).selectOption("widget:livingroom");
    await expect(rows(page)).toHaveCount(3);
    await forSelect(page).selectOption("widget:frontdoor");
    await expect(rows(page)).toHaveCount(1);
    await show(page).selectOption("presses");
    await expect(page_(page).locator(".evempty")).toContainText("Nothing matches");
    await snapshots.shot("activity-log-no-matches");
    await page_(page).locator(".evempty").getByRole("button", { name: "Show everything" }).click();
    await expect(rows(page)).toHaveCount(11);
    await expect(page_(page).locator(".logcount")).toHaveCount(0);
    // A row's name opens its editor; Back from the page lands on the hub.
    await rows(page).first().locator(".aname .evlink").click();
    await panel.editorReady("Front door");
    await page.goBack();
    await expect(page_(page).locator(".topbar .title")).toHaveText("Log");
    await page_(page).getByRole("button", { name: "Back" }).click();
    await panel.hubReady();
  });

  test("the account picker, and a kept log", async ({ page, snapshots }) => {
    await openLog(page, "index.html?accounts=2&keeplog=acc2");
    const accounts = page_(page).locator(".logaccts .fchip");
    await expect(accounts).toHaveText(["Home", "Cabin"]);
    await expect(page_(page).locator(".logfoot")).toContainText("Kept in memory");
    await accounts.filter({ hasText: "Cabin" }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page_(page).locator(".logfoot")).toContainText("Kept across restarts");
    await snapshots.shot("activity-log-accounts");
  });

  test("says when nothing was logged yet", async ({ page, snapshots }) => {
    await page.goto("index.html?nopushes=1#/log");
    await expect(page_(page).locator(".logcard .evempty")).toContainText("Nothing yet");
    await snapshots.shot("activity-log-empty");
  });

  test("the hub bar's Log button opens the page", async ({ page, panel }) => {
    await panel.openHub("index.html?switchboard=1");
    const log = page.getByRole("button", { name: "Open the log" });
    await log.focus();
    await page.keyboard.press("Enter");
    await expect(page_(page).locator(".topbar .title")).toHaveText("Log");
    expect(new URL(page.url()).hash).toBe("#/log");
    await expect(page_(page).locator('.logsel select[aria-label="Show"]')).toHaveValue("all");
  });

  test("the bar's Events panel lists the latest presses and links to the rest here", async ({
    page,
    panel,
    snapshots,
  }) => {
    await panel.openHub("index.html?switchboard=1");
    await page.locator("aivi-events .evbtn").click();
    const pop = page.locator("aivi-events dialog.evpop");
    await expect(pop.locator(".evlist .arow")).toHaveCount(5);
    await snapshots.shot("events-popover");
    await pop.getByRole("button", { name: "See all events" }).click();
    await expect(page_(page).locator(".topbar .title")).toHaveText("Log");
    expect(new URL(page.url()).hash).toBe("#/log");
    const show = page_(page).locator('.logsel select[aria-label="Show"]');
    await expect(show).toHaveValue("presses");
    await expect(show).toBeFocused();
  });

  test("the editor's Log shows the binding's pushes", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/frontdoor", "Front door");
    await panel.previewReady();
    const recent = page.locator("aivi-recent-activity");
    await expect(recent.locator(".phead h3")).toHaveText("Log");
    await expect(recent.locator(".arow")).toHaveCount(3);
    await recent.locator(".arow").first().locator("details.abody summary").click();
    await recent.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-recent-activity");
  });

  test("the editor's Log lists the latest few and opens the page on the binding", async ({
    page,
    panel,
    snapshots,
  }) => {
    await panel.openEditor("index.html?switchboard=1#/widget/livingroom", "Living room");
    await panel.previewReady();
    const recent = page.locator("aivi-recent-activity");
    await expect(recent.locator(".arow")).toHaveCount(5);
    const link = recent.getByRole("button", { name: "Open the log" });
    await link.scrollIntoViewIfNeeded();
    await snapshots.shot("editor-recent-activity-more");
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page_(page).locator(".topbar .title")).toHaveText("Log");
    expect(new URL(page.url()).hash).toBe("#/log");
    await expect(forSelect(page)).toHaveValue("widget:livingroom");
    await expect(forSelect(page)).toBeFocused();
    await expect(rows(page)).toHaveCount(6);
    await snapshots.shot("activity-log-from-editor");
  });
});
