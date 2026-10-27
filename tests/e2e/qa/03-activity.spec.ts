import { pickEntity } from "../panel";
import { expect, test } from "./fixtures";
import type { Push } from "./mock-aivi";

/** Predicate for a washer activity push with the given lifecycle state and
 * washer progress. The mock labels activity pushes "<slug> (activity)" and
 * appends the pushed state; the integration derives ONGOING/IDLE from the
 * active entity. */
const activityPushWith =
  (value: number, state: "IDLE" | "ONGOING") =>
  (push: Push): boolean =>
    push.slug === `washer (activity) · ${state}` &&
    Number(push.content?.progress?.value) === value / 100;

test.describe("Live Activity", () => {
  // The mock lists the activity (GET /activities); its identity is fixed
  // by the remote. Bound to the washer progress with the front door as the
  // lifecycle entity.
  test("binding Washer pushes IDLE, then ONGOING once its entity turns on", async ({
    ha,
    mock,
    page,
    panel,
  }, testInfo) => {
    const value = 56 + testInfo.retry;
    await ha.setWasherProgress(value);
    await ha.setFrontDoor(false);

    const card = page.locator("aivi-activity-card", { hasText: "Washer" });
    await panel.open(card);
    // The unbound Grill activity is listed too.
    await expect(page.locator("aivi-activity-card", { hasText: "Grill" })).toBeVisible();
    await panel.edit(card);
    await expect(page).toHaveURL(/\/aivi\/activity\/washer$/);

    // The lifecycle entity is the only setup field; identity is remote.
    await pickEntity(
      page,
      page.locator(".setup .cbx input"),
      "front door",
      "input_boolean.front_door",
    );
    await pickEntity(
      page,
      page.locator('.field[data-key="progress"] input[type="text"]'),
      "washer progress",
      "input_number.washer_progress",
    );
    await panel.saveAndLeave();
    await expect(card).toBeVisible();

    // The subentry reload pushes immediately; the door is off, so IDLE.
    await expect
      .poll(() => mock.findPush(activityPushWith(value, "IDLE")), {
        message: `the mock receives the washer activity push (IDLE, progress ${value})`,
        timeout: 30_000,
      })
      .toBeDefined();
    // The lifecycle entity flipping on drives an ONGOING push by itself.
    await ha.setFrontDoor(true);
    await expect
      .poll(() => mock.findPush(activityPushWith(value, "ONGOING")), {
        message: "the ONGOING activity push follows the door opening",
        timeout: 30_000,
      })
      .toBeDefined();
  });
});
