import { expect, test } from "./fixtures";
import type { HomeAssistant } from "./home-assistant";

/** Connect through the config flow (the panel side of the loop is driven
 * through its UI in the later journeys). */
async function connect(ha: HomeAssistant): Promise<void> {
  const done = await ha.connectAccount();
  expect(
    done.type === "create_entry" || (done.type === "abort" && done.reason === "already_configured"),
    `the config flow finishes: ${JSON.stringify(done)}`,
  ).toBe(true);
  expect((await ha.aiviEntries()).map((entry) => entry.state)).toContain("loaded");
}

test.describe("account", () => {
  test("the config flow connects the account", async ({ ha }) => {
    await connect(ha);
  });

  // Removing the last account takes the panel out of the sidebar, as on a
  // fresh install; the deep link the panel's onboarding card uses must
  // still start the config flow through Home Assistant's my-redirect (`my`
  // ships in default_config).
  test("with no account, the onboarding deep link starts the config flow", async ({
    ha,
    page,
    panel,
  }) => {
    for (const entry of await ha.aiviEntries()) {
      await ha.api("DELETE", `/api/config/config_entries/entry/${entry.entry_id}`);
    }
    await panel.openPage(
      "/_my_redirect/config_flow_start?domain=aivi",
      page.locator("home-assistant"),
    );
    const panels = (): Promise<string[]> =>
      page.evaluate(() => {
        const root = document.querySelector<
          HTMLElement & { hass?: { panels?: Record<string, unknown> } }
        >("home-assistant");
        return Object.keys(root?.hass?.panels ?? {});
      });
    await expect(async () => {
      expect(await panels()).toContain("config");
    }, "Home Assistant's panel list loads").toPass({ timeout: 60_000 });
    expect(await panels()).not.toContain("aivi");

    // The my panel resolves the redirect onto the integrations dashboard,
    // guarded by its own confirmation for flow starts that come from
    // outside; OK opens the flow's token step.
    await expect(page).toHaveURL(/\/config\/integrations/, { timeout: 30_000 });
    await expect(page.getByText("Do you want to set up aivi?")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("API token").first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
  });

  test("the config flow connects the account again", async ({ ha }) => {
    await connect(ha);
  });
});
