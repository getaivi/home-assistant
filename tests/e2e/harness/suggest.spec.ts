import { expect, test } from "./fixtures";

test.describe("suggest", () => {
  // Without a working AI Task backend the bar's button opens an
  // explanation with a my-redirect setup link.
  test("disabled, it explains the setup", async ({ page, snapshots }) => {
    await page.goto("index.html?suggest=not_loaded#/widget/frontdoor");
    await page.locator(".edbar .aibtn").click();
    await expect(page.locator(".suggest.off .why")).toBeVisible();
    await expect(page.locator(".suggest.off .why a")).toHaveAttribute(
      "href",
      "/_my_redirect/integrations",
    );
    await snapshots.shot("editor-suggest-off");
  });

  // The box flips to Refine with the ask chip, and the changed-fields
  // summary sits next to the one-step Undo.
  test("an applied suggestion can be undone", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/laundry", "Laundry");
    await page.locator(".edbar .aibtn").click();
    const ask = page.locator(".suggest textarea");
    await ask.click();
    await ask.fill("washer progress and its state, cyan accent");
    await page.locator(".suggest .srow .sendbtn").click();
    const answer = page.locator(".suggest .msg.bot");
    await expect(answer).toBeVisible();
    await panel.previewReady();
    await snapshots.shot("editor-suggest-applied");

    // Undo restores the form from before the suggestion, so Save is
    // disabled again (the required field emptied with the rest).
    await page.getByRole("button", { name: /^Undo “/ }).click();
    await expect(answer).toHaveCount(0);
    await expect(page.locator(".suggest .srow .sendbtn:not(.stop)")).toBeVisible();
    await expect(panel.save).toBeDisabled();
  });
});
