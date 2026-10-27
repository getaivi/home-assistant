import { pickEntity } from "../panel";
import { expect, test } from "./fixtures";
import { laundryPushWith } from "./mock-aivi";

test.describe("widgets", () => {
  // The money path, and the routing contract against real Home Assistant
  // (the harness only covers it with its own host): the editor is a real
  // URL, a full reload there restores it, and the save returns to /aivi.
  test("binding Laundry in the panel pushes it", async ({ ha, mock, page, panel }, testInfo) => {
    // Unique per attempt, so the assertion can't match a stale push.
    const value = 41 + testInfo.retry;
    await ha.setWasherProgress(value);

    await panel.open(panel.laundryCard);
    await panel.edit(panel.laundryCard);
    await expect(page).toHaveURL(/\/aivi\/widget\/laundry$/);

    // A hard reload goes through Home Assistant's full boot; the panel
    // must restore the same editor from the URL.
    await page.reload();
    await expect(page.locator(".topbar .title", { hasText: "Laundry" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/\/aivi\/widget\/laundry$/);

    await pickEntity(
      page,
      page.locator('.field[data-key="progress"] input[type="text"]'),
      "washer progress",
      "input_number.washer_progress",
    );
    // The click waits for Save to enable (all required fields bound).
    await panel.saveAndLeave();

    await expect
      .poll(() => mock.findPush(laundryPushWith(value)), {
        message: `the mock receives the laundry push with progress ${value}`,
        timeout: 30_000,
      })
      .toBeDefined();
  });

  test("a state change alone pushes a live update", async ({ ha, mock }, testInfo) => {
    const value = 71 + testInfo.retry;
    await ha.setWasherProgress(value);
    await expect
      .poll(() => mock.findPush(laundryPushWith(value)), {
        message: `the state change is pushed (progress ${value})`,
        timeout: 30_000,
      })
      .toBeDefined();
  });

  // A new binding starts on the QA price sensor, found by its timeline
  // attributes; the push carries the timeline (today's 24 hours at least)
  // and the staleness threshold picked under Delivery.
  test("binding Electricity pushes its timeline with the staleness threshold", async ({
    mock,
    page,
    panel,
  }) => {
    const card = page.locator(".wcard", { hasText: "Electricity" });
    await panel.open(card);
    await panel.edit(card);
    await expect(page).toHaveURL(/\/aivi\/widget\/electricity$/);
    await expect(page.locator('.field[data-key="entries"] .cbx input')).toHaveValue(
      "Electricity price",
      { timeout: 60_000 },
    );
    await page.locator(".field.delivery select").selectOption("3600");
    await panel.saveAndLeave();
    await expect
      .poll(
        () =>
          mock.findPush(
            (push) =>
              push.slug === "electricity" &&
              push.stale_after === 3600 &&
              (push.content?.entries?.length ?? 0) >= 24,
          ),
        {
          message: "the mock receives the electricity timeline with stale_after 3600",
          timeout: 30_000,
        },
      )
      .toBeDefined();
  });
});
