import { expect, test } from "./fixtures";

// Nothing the integration sent broke the API's schema: the mock answers
// such a request 400/422 as the real API would and lists it at
// /refusals.json. Checked on both sides of the outage, which restarts the
// mock and clears the list.
test.describe("contract and outage", () => {
  test("the mock refused no request in the journeys before", async ({ mock }) => {
    expect(await mock.refusals()).toEqual([]);
  });

  test.describe("with the mock down", () => {
    test.afterEach(({ mock }) => {
      mock.start();
    });

    test("the panel shows the unreachable banner, and Retry recovers", async ({ mock, panel }) => {
      mock.stop();
      await panel.open(panel.unreachableBanner);
      mock.start();
      await expect(async () => {
        await mock.pushes();
      }, "the mock accepts requests again").toPass({ timeout: 60_000 });

      // Home Assistant reaches the container again a moment after the
      // start (its DNS entry returns), so Retry is pressed until the hub
      // is back.
      const retry = panel.unreachableBanner.getByRole("button", { name: "Retry" });
      await expect(async () => {
        if (await retry.isVisible()) await retry.click({ timeout: 1_500 });
        await expect(panel.laundryCard).toBeVisible({ timeout: 1_500 });
      }, "Retry brings the widget hub back").toPass({ timeout: 60_000 });
    });
  });

  test("the mock refused no request after the outage", async ({ mock }) => {
    expect(await mock.refusals()).toEqual([]);
  });
});
