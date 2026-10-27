import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { HA_URL, MOCK_URL } from "./env";
import { HomeAssistant, PASSWORD, USERNAME } from "./home-assistant";
import { MockAivi } from "./mock-aivi";

/** The Aivi panel inside Home Assistant's frontend. */
export class Panel {
  constructor(private readonly page: Page) {}

  get laundryCard(): Locator {
    return this.page.locator(".wcard", { hasText: "Laundry" });
  }

  get unreachableBanner(): Locator {
    return this.page.locator(".banner", { hasText: "aivi is unreachable" });
  }

  get subscriptionBanner(): Locator {
    return this.page.locator(".banner", { hasText: "subscription isn't active" });
  }

  get save(): Locator {
    return this.page.locator(".topbar button.btn.primary", { hasText: "Save" });
  }

  /** Save, which keeps the editor open with a toast, then Back to the hub. */
  async saveAndLeave(): Promise<void> {
    await this.save.click();
    await expect(
      this.page.locator(".toast", { hasText: "is now fed by Home Assistant" }),
    ).toBeVisible();
    await this.page.locator(".edbar .backbtn").click();
    await expect(this.page).toHaveURL(/\/aivi$/);
  }

  /** Open /aivi and wait until `ready` is visible. */
  open(ready: Locator): Promise<void> {
    return this.openPage("/aivi", ready);
  }

  /** Open a Home Assistant page and wait until `ready` is visible. The
   * journeys start logged in (global-setup.ts); should the stored login be
   * refused, the real form is filled in. */
  async openPage(path: string, ready: Locator): Promise<void> {
    // Home Assistant's frontend navigates by itself (auth redirects,
    // reconnects); a goto interrupted by one is fine, the wait below is
    // the real signal.
    await this.page.goto(path).catch((err: unknown) => {
      if (!String(err).includes("is interrupted by another navigation")) throw err;
    });
    const username = this.page.locator('input[name="username"]');
    let submitted = false;
    // After a login the frontend reloads the page once, so `ready` is
    // polled across documents instead of awaited on the first one.
    await expect(async () => {
      if (!submitted && (await username.isVisible())) {
        await username.fill(USERNAME, { timeout: 5_000 });
        await this.page.locator('input[name="password"]').fill(PASSWORD, { timeout: 5_000 });
        await this.page.getByRole("button", { name: "Log in" }).click({ timeout: 5_000 });
        submitted = true;
      }
      await expect(ready).toBeVisible({ timeout: 1_000 });
    }, `${path} renders (through the login form if shown)`).toPass({ timeout: 60_000 });
  }

  /** Open a hub card's editor: "Set up" on first sight, "Edit" when an
   * earlier attempt already bound it. */
  async edit(card: Locator): Promise<void> {
    await card.getByRole("button", { name: /^(Set up|Edit)$/ }).click();
  }
}

interface WorkerFixtures {
  ha: HomeAssistant;
  mock: MockAivi;
}

export const test = base.extend<{ panel: Panel }, WorkerFixtures>({
  // A retried journey runs in a new worker, so it also logs in again.
  ha: [
    async ({}, use) => {
      const ha = new HomeAssistant(HA_URL);
      await ha.login();
      await use(ha);
    },
    { scope: "worker" },
  ],
  mock: [
    async ({}, use) => {
      await use(new MockAivi(MOCK_URL));
    },
    { scope: "worker" },
  ],
  panel: async ({ page }, use) => {
    await use(new Panel(page));
  },
});

export { expect };
