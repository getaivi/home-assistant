import type { Locator, Page } from "@playwright/test";
import { expect, type Panel, TEMPLATE_BOX, test } from "./fixtures";

// An icon's look: its symbol and all three of its colors take the same
// source menu as every other value, and an icon's template workspace
// offers icon recipes and checks a symbol name against Apple's list.

const workspace = (page: Page): Locator => page.locator("aivi-template-workspace");
const rail = (page: Page): Locator => workspace(page).locator(".wsrail");

/** The front door's icon row, with its symbol styling open and its
 * second color written as a template. */
async function styledIcon(panel: Panel, url: string): Promise<Locator> {
  await panel.openEditor(`${url}#/widget/frontdoor`, "Front door");
  await panel.previewReady();
  const icon = panel.field("icon");
  await icon.locator(".fmain").first().locator('input[type="text"]').fill("lightbulb.fill");
  await icon.locator(".fmain").first().locator('input[type="text"]').press("Escape");
  await icon.locator("details.style summary").click();
  const second = icon.locator("details.style .orow", { hasText: "Second color" });
  await second.locator("select.srcsel").selectOption("template");
  await second
    .locator(TEMPLATE_BOX)
    .fill("{{ 'orange' if is_state('light.porch', 'on') else 'gray' }}");
  await expect(second.locator(".tres .tval")).toHaveText("orange");
  await icon.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return icon;
}

test.describe("an icon's look", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`its colors and its template, ${theme}`, async ({ page, panel, snapshots }) => {
      const url = theme === "light" ? "light.html" : "index.html";
      for (const [width, name] of [
        [1280 - 256, "1280-sidebar"],
        [1440, "1440"],
        [1920, "1920"],
      ] as const) {
        await page.goto("about:blank");
        await page.setViewportSize({ width, height: width > 1440 ? 1080 : 900 });
        const icon = await styledIcon(panel, url);
        await expect(icon.locator("details.style .fsum")).toHaveText("1 set");
        await snapshots.shot(`style-icon-colors-${name}-${theme}`);

        // The symbol itself from a template: its recipes, and a name
        // Apple's list lacks put right in one press.
        await icon.locator(".fsrc select.srcsel").first().selectOption("template");
        await icon.locator(".fmain").first().locator(TEMPLATE_BOX).fill("{{ 'lightbulb.fil' }}");
        await icon.locator(".texpand").first().click();
        await expect(workspace(page).getByRole("heading", { name: "Icon template" })).toBeVisible();
        const hint = workspace(page).locator(".wsout .wshint");
        await expect(hint).toContainText("“lightbulb.fil” is not in Apple's symbol list");
        if ((await rail(page).count()) === 0) await page.keyboard.press("ControlOrMeta+i");
        await rail(page).getByRole("combobox").fill("an icon");
        await expect(rail(page).locator(".insopt.recipe")).toHaveCount(2);
        await snapshots.shot(`style-icon-workspace-${name}-${theme}`);
        await hint.getByRole("button", { name: "Use “lightbulb.fill”" }).click();
        await expect(workspace(page).locator(TEMPLATE_BOX)).toHaveText("{{ 'lightbulb.fill' }}");
        await expect(hint).toHaveCount(0);
        await page.evaluate(() => sessionStorage.clear());
      }
    });
  }
});
