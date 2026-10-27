import { expect, test } from "./fixtures";

test.describe("hub", () => {
  test("dark theme", async ({ panel, snapshots }) => {
    await panel.openHub("index.html");
    await snapshots.shot("hub-dark");
  });

  test("light theme", async ({ panel, snapshots }) => {
    await panel.openHub("light.html");
    await snapshots.shot("hub-light");
  });

  // A non-default user theme (green accent, 16px cards): the chrome must
  // follow the theme tokens. Brand blue appearing anywhere here means a
  // color is hardcoded.
  test("user theme", async ({ panel, snapshots }) => {
    await panel.openHub("theme.html");
    await snapshots.shot("hub-themed");
  });

  test("search filters the grid without moving focus", async ({ page, panel, snapshots }) => {
    await panel.openHub();
    const search = page.locator('.hubbar input[type="search"]');
    await search.click();
    await search.pressSequentially("laundry");
    const cards = page.locator("aivi-widget-card");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Laundry");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("laundry");
    await snapshots.shot("hub-search");

    await test.step("Escape restores the full grid", async () => {
      await search.press("Escape");
      await panel.hubReady();
    });
  });

  // The mock rejects aivi/widgets with ?offline=1.
  test("unreachable banner", async ({ page, snapshots }) => {
    await page.goto("index.html?offline=1");
    await expect(page.locator(".banner", { hasText: "aivi is unreachable" })).toBeVisible();
    await snapshots.shot("hub-offline");
  });

  // Clicking the connect action would navigate the harness away, so its
  // target is asserted instead: a real anchor at Home Assistant's
  // in-instance my-redirect.
  test("onboarding card links to the config flow", async ({ page, snapshots }) => {
    await page.goto("index.html?noaccount=1");
    await expect(
      page.locator(".hero-empty", { hasText: "Connect your aivi account" }),
    ).toBeVisible();
    await expect(page.locator(".hero-empty a.btn")).toHaveAttribute(
      "href",
      "/_my_redirect/config_flow_start?domain=aivi",
    );
    await snapshots.shot("hub-onboarding");
  });

  // Connected but nothing on the account yet: the steps, from the app to
  // Refresh to Set up.
  for (const theme of ["index.html", "light.html"]) {
    const light = theme === "light.html";
    test(`empty account explains the steps${light ? ", light" : ""}`, async ({
      page,
      snapshots,
    }) => {
      await page.goto(`${theme}?nowidgets=1`);
      const card = page.locator(".acct-empty");
      await expect(card.locator("h2")).toHaveText("No widgets or Live Activities yet");
      await expect(card.locator("ol.steps li")).toHaveCount(3);
      await expect(card.locator("a.btn", { hasText: "Open the aivi app" })).toBeVisible();
      await expect(card.locator("button", { hasText: "Refresh" })).toBeVisible();
      await snapshots.shot(light ? "hub-empty-light" : "hub-empty");
    });
  }

  // Of two accounts, the empty one says so in its own section; one with
  // only Live Activities has a line where its widgets would be.
  test("an empty second account, and a note for a missing kind", async ({ page, snapshots }) => {
    await page.goto("index.html?accounts=2&nowidgets=acc2");
    await expect(page.locator(".acct-empty.in-section")).toBeVisible();
    await page.locator(".acct-empty").scrollIntoViewIfNeeded();
    await snapshots.shot("hub-empty-account");

    await page.goto("index.html?activitiesonly=1");
    await expect(page.locator(".empty-note", { hasText: "No widgets yet" })).toBeVisible();
    await snapshots.shot("hub-empty-note");
  });

  // From a nothing-bound account, binding Laundry and going back finds the
  // one-time inline banner on the hub.
  test("first bind shows a banner that can be dismissed", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html?unbound=1#/widget/laundry", "Laundry");
    await panel.pickEntity(
      page.locator('.field[data-key="progress"] input[type="text"]'),
      "washer",
      "input_number.washer_progress",
    );
    await page.locator(".topbar button.btn.primary", { hasText: "Save" }).click();
    await expect(
      page.locator(".toast", { hasText: "Laundry is now fed by Home Assistant" }),
    ).toBeVisible();
    await page.locator(".edbar .backbtn").click();
    const banner = page.locator(".banner.ok");
    await expect(banner.filter({ hasText: "Your first widget is live" })).toBeVisible();
    await snapshots.shot("hub-first-bind");
    await banner.locator("button", { hasText: "Got it" }).click();
    await expect(banner).toHaveCount(0);
  });
});
