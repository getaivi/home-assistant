// The WebSocket client checks each response's top-level shape, so an
// integration that disagrees with this bundle fails at the boundary.

import { describe, expect, it } from "vitest";
import { AiviApi, WireShapeError } from "../src/api";
import type { HassLike } from "../src/types/hass";
import { makeHass } from "./harness";

function apiAnswering(answer: unknown): AiviApi {
  const hass: HassLike = { states: {}, callWS: () => Promise.resolve(answer) };
  return new AiviApi(() => hass);
}

describe("AiviApi response shapes", () => {
  it("passes the mock backend's answers through", async () => {
    const hass = makeHass();
    const api = new AiviApi(() => hass);
    const meta = await api.templates();
    expect(Object.keys(meta.templates)).toContain("switchboard");
    const config = await api.config();
    expect(config.accounts).toHaveLength(1);
    const preview = await api.preview({
      template: "status",
      bindings: { state: "input_boolean.front_door" },
      kind: "widget",
    });
    expect(preview.content).not.toBeNull();
  });

  it.each([
    ["config", (api: AiviApi) => api.config(), { accounts: null }],
    ["widgets", (api: AiviApi) => api.widgets("e"), { items: [] }],
    ["activities", (api: AiviApi) => api.activities("e"), {}],
    ["templates", (api: AiviApi) => api.templates(), { templates: {} }],
    [
      "preview",
      (api: AiviApi) => api.preview({ template: "t", bindings: {}, kind: "widget" }),
      { content: "nope" },
    ],
    [
      "save",
      (api: AiviApi) =>
        api.save({
          entry_id: "e",
          slug: "s",
          name: "n",
          template: "t",
          bindings: {},
          kind: "widget",
        }),
      { subentry_id: 7 },
    ],
    [
      "suggest",
      (api: AiviApi) => api.suggest({ template: "t", kind: "widget", name: "n", description: "d" }),
      { bindings: [] },
    ],
  ])("rejects a malformed %s answer", async (_name, call, answer) => {
    await expect(call(apiAnswering(answer))).rejects.toBeInstanceOf(WireShapeError);
  });

  it("checks each account, its subscription state included", async () => {
    const account = { entry_id: "e", title: "aivi", widgets: [] };
    // An integration older than the bundle sends no subscription state.
    await expect(apiAnswering({ accounts: [account] }).config()).resolves.toEqual({
      accounts: [account],
    });
    for (const bad of [
      { ...account, subscription: "lapsed" },
      { ...account, entry_id: 7 },
      { ...account, widgets: undefined },
      "acc1",
    ])
      await expect(apiAnswering({ accounts: [bad] }).config()).rejects.toThrow(
        'Unexpected aivi/config response: bad "accounts"',
      );
  });

  it("rejects a non-object answer", async () => {
    await expect(apiAnswering(null).config()).rejects.toThrow(
      "Unexpected aivi/config response: not an object",
    );
  });
});
