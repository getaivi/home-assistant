import { addRow } from "../panel";
import { expect, test } from "./fixtures";
import type { LogbookEntry } from "./home-assistant";
import type { Push } from "./mock-aivi";

const LIGHT = "input_boolean.porch_light";
// A tile's action id is its entity id with the dot folded.
const LIGHT_TILE = "input_boolean_porch_light";

/** Predicate for a porch push whose porch light tile is in the given state. */
const porchPushWith =
  (on: boolean) =>
  (push: Push): boolean =>
    push.slug === "porch" &&
    (push.content?.actions ?? []).some(
      (action) => action.id === LIGHT_TILE && action.kind === "toggle" && action.on === on,
    );

test.describe("switchboard", () => {
  // The loop closed both ways: the tiles push to the mock, and a tile
  // press injected into the mock's event stream turns the light on, which
  // pushes the lit tile back. Idempotent: the light is turned off first
  // and rows that are already there are kept.
  test("binding Porch pushes its tiles, and a tile press plays back", async ({
    ha,
    mock,
    page,
    panel,
  }) => {
    await ha.callService("input_boolean", "turn_off", { entity_id: LIGHT });
    await expect.poll(async () => (await ha.state(LIGHT)).state, { timeout: 60_000 }).toBe("off");

    const card = page.locator(".wcard", { hasText: "Porch" });
    await panel.open(card);
    await panel.edit(card);
    await expect(page).toHaveURL(/\/aivi\/widget\/porch$/);
    for (const name of ["Porch light", "Movie night"]) await addRow(page, name);
    // The preview draws the tiles: the light off, the scene a button.
    await expect(
      page.locator(".pv-switchboard-grid .pv-switchboard-tile.is-off").first(),
    ).toBeVisible();
    await panel.saveAndLeave();
    await expect
      .poll(() => mock.findPush(porchPushWith(false)), {
        message: "the mock receives the porch push (porch light off)",
        timeout: 30_000,
      })
      .toBeDefined();

    // Where the logbook is read from: before the press, with a margin for
    // clocks that disagree.
    const since = new Date(Date.now() - 60_000).toISOString();
    await test.step("a press on the mock turns the light on and pushes the lit tile", async () => {
      await expect
        .poll(() => mock.pressTile("porch", LIGHT_TILE, true), {
          message: "the integration's event stream is open on the mock",
          timeout: 30_000,
          intervals: [1_000],
        })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => (await ha.state(LIGHT)).state, {
          message: "the porch light turns on from the injected press",
          timeout: 30_000,
        })
        .toBe("on");
      await expect
        .poll(() => mock.findPush(porchPushWith(true)), {
          message: "the lit tile pushes back to the mock",
          timeout: 30_000,
        })
        .toBeDefined();
    });

    // Home Assistant credits the press: the binding's event entity fires
    // under the same context as the light's state change.
    await test.step("the press fires the Presses event entity under the light's context", async () => {
      const light = await ha.state(LIGHT);
      const presses = () =>
        ha.findState(
          (s) =>
            s.entity_id.startsWith("event.") && s.attributes["friendly_name"] === "Porch Presses",
        );
      await expect
        .poll(
          async () => {
            const state = await presses();
            return {
              event: state?.attributes["event_type"],
              context: state?.context.id,
            };
          },
          { message: "the Presses event entity fires for the press", timeout: 30_000 },
        )
        .toEqual({ event: "toggle_on", context: light.context.id });
      expect((await presses())?.attributes["entity_id"]).toBe(LIGHT);
    });

    // REST logbook entries carry no context ids, so the credit is read
    // from "triggered by".
    await test.step("the logbook has the press and credits it with the state change", async () => {
      const message = "Porch light turned on from the widget";
      await expect
        .poll(
          async () => {
            const entries = await ha.api<LogbookEntry[]>(
              "GET",
              `/api/logbook/${encodeURIComponent(since)}`,
            );
            return {
              line: entries.some(
                (e) =>
                  e.domain === "aivi" &&
                  e.name === "Porch" &&
                  e.message === message &&
                  e.entity_id === LIGHT,
              ),
              credited: entries.some(
                (e) =>
                  e.entity_id === LIGHT &&
                  e.state === "on" &&
                  e.context_event_type === "aivi_action" &&
                  e.context_message === message,
              ),
            };
          },
          { timeout: 30_000, intervals: [1_000] },
        )
        .toEqual({ line: true, credited: true });
    });

    await expect
      .poll(async () => (await ha.eventStream())?.state, {
        message: "the Event stream sensor is on",
        timeout: 60_000,
      })
      .toBe("on");
  });
});
