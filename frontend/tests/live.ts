// A mock hass whose aivi/inputs/subscribe the test feeds itself, and a
// press row to feed it, shared by the tests of everything that follows
// the subscription (the bar's Events, the editor's Log, the Log page).

import type { InputsUpdate, PressRow } from "../src/types/accounts";
import type { HassLike } from "../src/types/hass";
import { makeHass } from "./harness";

/** The mock hass, with a subscription the test pushes updates into. */
export function liveHass(): {
  hass: HassLike;
  push: (update: InputsUpdate) => void;
  unsubscribed: () => boolean;
} {
  const hass = makeHass();
  let callback: ((update: InputsUpdate) => void) | null = null;
  let unsubscribed = false;
  const real = hass.connection!;
  hass.connection = {
    async subscribeMessage<T>(cb: (message: T) => void, msg: object) {
      callback = cb as unknown as (update: InputsUpdate) => void;
      await real.subscribeMessage(cb, msg);
      return async () => {
        unsubscribed = true;
      };
    },
  };
  return {
    hass,
    push: (update) => callback?.(update),
    unsubscribed: () => unsubscribed,
  };
}

/** A played press on the Living room switchboard, `n` seconds ago. */
export function press(n: number, changes: Partial<PressRow> = {}): PressRow {
  const time = new Date(Date.now() - n * 1000).toISOString();
  return {
    id: `evt_${n}`,
    time,
    received_at: time,
    kind: "widget",
    slug: "livingroom",
    subentry_id: "w-sb",
    event_type: "pressed",
    entity_id: "scene.movie",
    label: "Movie night",
    value: null,
    outcome: "played",
    error: null,
    recorded: true,
    count: 1,
    ...changes,
  };
}
