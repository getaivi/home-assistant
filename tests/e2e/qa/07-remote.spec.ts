import { addRow, pickEntity } from "../panel";
import { expect, test } from "./fixtures";
import type { Push } from "./mock-aivi";

const FOUNTAIN = "input_boolean.fountain";
// A button's action id is its entity id with the dot folded.
const BUTTON = "input_boolean_fountain";

/** Predicate for a fountain push whose button is in the given state. */
const fountainPushWith =
  (on: boolean) =>
  (push: Push): boolean =>
    push.slug === "fountain" &&
    (push.content?.actions ?? []).some(
      (action) => action.id === BUTTON && action.kind === "toggle" && action.on === on,
    );

test.describe("remote", () => {
  // A remote presses like a switchboard: its button pushes to the mock,
  // and a press injected into the mock's event stream turns the fountain
  // on, which pushes the lit button back. Idempotent: the fountain is
  // turned off first and a button that is already there is kept.
  test("binding Fountain pushes its reading and button, and a press plays back", async ({
    ha,
    mock,
    page,
    panel,
  }) => {
    await ha.callService("input_boolean", "turn_off", { entity_id: FOUNTAIN });
    await expect
      .poll(async () => (await ha.state(FOUNTAIN)).state, { timeout: 60_000 })
      .toBe("off");

    const card = page.locator(".wcard", { hasText: "Fountain" });
    await panel.open(card);
    await panel.edit(card);
    await expect(page).toHaveURL(/\/aivi\/widget\/fountain$/);
    const reading = page.locator('.field[data-key="value"] input[type="text"]').first();
    if (!(await reading.inputValue())) await pickEntity(page, reading, "garden fountain", FOUNTAIN);
    await addRow(page, "Garden fountain", '.field[data-key="actions"]');
    // The preview draws the button, off.
    await expect(page.locator(".pv-stage .pv-remote-button").first()).toBeVisible();
    await panel.saveAndLeave();
    await expect
      .poll(() => mock.findPush(fountainPushWith(false)), {
        message: "the mock receives the fountain push (fountain off)",
        timeout: 30_000,
      })
      .toBeDefined();

    await expect
      .poll(() => mock.pressTile("fountain", BUTTON, true), {
        message: "the integration's event stream is open on the mock",
        timeout: 30_000,
        intervals: [1_000],
      })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await ha.state(FOUNTAIN)).state, {
        message: "the fountain turns on from the injected press",
        timeout: 30_000,
      })
      .toBe("on");
    await expect
      .poll(() => mock.findPush(fountainPushWith(true)), {
        message: "the lit button pushes back to the mock",
        timeout: 30_000,
      })
      .toBeDefined();
  });
});
