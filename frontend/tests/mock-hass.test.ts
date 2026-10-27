// The harness mock keeps its own account: a save stores what the
// integration answers, a delete drops it. The suite replays the
// integration's recorded answers, and a request without one fails.

import { describe, expect, it } from "vitest";
import type { Account } from "../src/types/accounts";
import { makeHass, takeMissing } from "./harness";

describe("mock activity save/delete", () => {
  it("round-trips an activity subentry with its active entity", async () => {
    const hass = makeHass();
    const saved = (await hass.callWS({
      type: "aivi/save",
      entry_id: "acc1",
      kind: "activity",
      slug: "grill",
      name: "Grill",
      template: "monitor",
      active: "input_boolean.front_door",
      bindings: { right_value: "sensor.living_temp" },
    })) as { subentry_id: string };
    expect(saved.subentry_id).toMatch(/^a/);

    const cfg = (await hass.callWS({ type: "aivi/config" })) as {
      accounts: Account[];
    };
    const activities = cfg.accounts[0]?.activities ?? [];
    expect(activities.map((a) => a.slug)).toEqual(["washer", "grill"]);
    const grill = activities.find((a) => a.slug === "grill");
    expect(grill).toMatchObject({
      subentry_id: saved.subentry_id,
      active: "input_boolean.front_door",
      template: "monitor",
    });
    // Widgets were untouched by the activity save.
    expect(cfg.accounts[0]?.widgets.map((w) => w.slug)).toEqual(["frontdoor"]);

    await hass.callWS({
      type: "aivi/delete",
      entry_id: "acc1",
      subentry_id: saved.subentry_id,
    });
    const after = (await hass.callWS({ type: "aivi/config" })) as {
      accounts: Account[];
    };
    expect(after.accounts[0]?.activities?.map((a) => a.slug)).toEqual(["washer"]);
  });
});

describe("recorded engine answers", () => {
  // Skipped while recording, which would record it.
  it.skipIf(!!process.env["AIVI_ENGINE_RECORD"])(
    "fails a request that has no recorded answer",
    async () => {
      const msg = {
        type: "aivi/preview",
        template: "status",
        bindings: { state: "sensor.unrecorded" },
      };
      await expect(makeHass().callWS(msg)).rejects.toThrow(/run `make fixtures`/);
      // The harness's afterEach throws on these; taken here so this test passes.
      expect(takeMissing()).toEqual([
        '{"bindings":{"state":"sensor.unrecorded"},"template":"status","type":"aivi/preview"}',
      ]);
    },
  );
});
