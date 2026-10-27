import type { Page } from "@playwright/test";
import { expect, type Panel, test } from "./fixtures";

interface Template {
  slug: string;
  title: string;
  shot: string;
  /** What the binding needs before its preview is worth capturing. */
  setup(page: Page, panel: Panel): Promise<void>;
}

// New bindings (?more=1), each starting from what Home Assistant knows
// (aivi/defaults: the currency, the price sensor, the Energy dashboard), so
// the preview renders without a click. The trend binds its sensor to show
// the recorded-history sparkline; the budget gets two categories, each
// with a budget of its own (so Medium draws their rings).
const TEMPLATES: Template[] = [
  {
    slug: "spending",
    title: "Spending",
    shot: "editor-budget",
    async setup(page, panel) {
      const categories = page.locator('.field[data-key="categories"]');
      await panel.pickEntity(
        page.locator('.field[data-key="spent"] .cbx input'),
        "spent this month",
        "sensor.monthly_spent",
      );
      await page.locator('.field[data-key="budget"] input[inputmode="decimal"]').fill("1500");
      for (const id of ["sensor.food_spent", "sensor.car_spent"]) {
        await panel.addRow(id, '.field[data-key="categories"]');
      }
      for (const [index, amount] of ["300", "250"].entries()) {
        const toggle = categories.locator(".ordrow").nth(index).locator(".rowtoggle");
        await toggle.click();
        await categories.locator('input[aria-label^="Budget for"]').fill(amount);
        await toggle.click();
      }
      await expect(page.locator(".pv-stage .pv-budget-row svg").nth(1)).toBeVisible();
    },
  },
  {
    slug: "indoor",
    title: "Indoor",
    shot: "editor-trend",
    async setup(page, panel) {
      await panel.pickEntity(
        page.locator('.field[data-key="value"] .cbx input'),
        "living room",
        "sensor.living_temp",
      );
    },
  },
  {
    slug: "electricity",
    title: "Electricity",
    shot: "editor-prices",
    async setup(page) {
      await expect(page.locator('.field[data-key="entries"] .cbx input')).toBeVisible();
    },
  },
  {
    slug: "energy",
    title: "Energy",
    shot: "editor-energy",
    async setup(page) {
      await expect(page.locator('.field[data-key="sources"] .ordrow').first()).toBeVisible();
    },
  },
  // The bound list: four labeled rows at Medium, the values alone at Small.
  {
    slug: "home",
    title: "Home",
    shot: "editor-list",
    async setup(page) {
      await expect(
        page.locator(".pv-stage:not(.is-skeleton) .pv-canvas.is-medium .pv-list-row").nth(3),
      ).toBeVisible();
    },
  },
];

test.describe("templates with a medium layout", () => {
  for (const template of TEMPLATES) {
    // Each opens at Medium, its own layout at that size; Small follows.
    test(`${template.title} at both sizes`, async ({ page, panel, snapshots }) => {
      await panel.openEditor(`index.html?more=1#/widget/${template.slug}`, template.title);
      await template.setup(page, panel);
      await expect(
        page.locator(".pv-stage:not(.is-skeleton) .pv-canvas [data-slot]").first(),
      ).toBeVisible();
      await panel.previewReady();
      await snapshots.shotWithPreview(template.shot);
      await panel.previewSize("Small");
      await snapshots.shotWithPreview(`${template.shot}-small`);
    });
  }
});
