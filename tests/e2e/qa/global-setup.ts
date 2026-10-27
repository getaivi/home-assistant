import { chromium, expect } from "@playwright/test";
import { AUTH_STATE, HA_URL, MOCK_URL } from "./env";
import { HomeAssistant, PASSWORD, USERNAME } from "./home-assistant";
import { MockAivi } from "./mock-aivi";

/** Wait for the stack: Home Assistant answering and fully running, and the
 * mock up, with its switches and pushes reset. Then log in through the
 * real form once, for every journey to start from: a fresh login makes
 * the frontend reload the page, which would load the panel twice. */
export default async function globalSetup(): Promise<void> {
  const ha = new HomeAssistant(HA_URL);
  const mock = new MockAivi(MOCK_URL);

  await expect(async () => {
    expect((await fetch(`${HA_URL}/manifest.json`)).ok).toBe(true);
  }, `Home Assistant answers at ${HA_URL}`).toPass({ timeout: 180_000, intervals: [2_000] });
  await expect(async () => {
    await mock.pushes();
  }, `the mock Aivi answers at ${MOCK_URL}`).toPass({ timeout: 60_000 });
  await mock.reset();
  await ha.login();
  await expect(async () => {
    const config = await ha.api<{ state: string }>("GET", "/api/config");
    expect(config.state).toBe("RUNNING");
  }, "Home Assistant reaches the RUNNING state").toPass({
    timeout: 120_000,
    intervals: [2_000],
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: HA_URL });
    await page.goto("/");
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 60_000 });
    // "Keep me logged in" is on by default, so the tokens land in
    // localStorage, which the storage state carries. The frontend may
    // still reload once after the login; a read that the reload cuts off
    // counts as not there yet.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("hassTokens")).catch(() => null), {
        message: "the login stores its tokens",
        timeout: 60_000,
      })
      .not.toBeNull();
    await page.context().storageState({ path: AUTH_STATE });
  } finally {
    await browser.close();
  }
}
