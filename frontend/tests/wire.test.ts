// The harness mock answers the panel's account, listing and event stream
// commands by hand; the integration's answers are recorded in
// tests/fixtures/wire.json (keys and value types, written by
// tests/test_wire.py through `make fixtures`). Each mock answer must fit
// them: no key the integration does not send, no type it does not send.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { makeHass } from "./harness";

interface Shape {
  /** The JSON types seen, joined by "|"; "any" takes anything. */
  type: string;
  keys?: Record<string, Shape>;
  items?: Shape;
  /** An object keyed by id: the shape of each of its values. */
  values?: Shape;
}

const WIRE = JSON.parse(readFileSync("frontend/tests/fixtures/wire.json", "utf8")) as Record<
  string,
  Shape
>;

/** Keys the panel takes as absent from an older integration, which the
 * mock leaves out of its own fixtures. */
const OMITTED = new Set(["accounts[].widgets[].stale_after", "accounts[].activities[].throttle"]);

/** Lists the recording has no item of: its test Home Assistant has no AI
 * Task entity. */
const UNRECORDED = new Set(["suggest_models"]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Where `value` does not fit `shape`, one line per problem. */
function misfits(value: unknown, shape: Shape, path: string): string[] {
  const allowed = shape.type.split("|");
  if (allowed.includes("any")) return [];
  const type = typeOf(value);
  if (!allowed.includes(type)) return [`${path}: ${type}, the integration sends ${shape.type}`];
  if (type === "array" && Array.isArray(value)) {
    if (!shape.items)
      return value.length && !UNRECORDED.has(path) ? [`${path}: no recorded item`] : [];
    const items = shape.items;
    return value.flatMap((item) => misfits(item, items, `${path}[]`));
  }
  if (type === "object" && shape.values) {
    const values = shape.values;
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      misfits(item, values, `${path}{${key}}`),
    );
  }
  if (type === "object" && shape.keys) {
    const keys = shape.keys;
    const object = value as Record<string, unknown>;
    const at = (key: string): string => (path ? `${path}.${key}` : key);
    return [
      ...Object.keys(object)
        .filter((key) => !(key in keys))
        .map((key) => `${at(key)}: not sent by the integration`),
      ...Object.keys(keys)
        .filter((key) => !(key in object) && !OMITTED.has(at(key)))
        .map((key) => `${at(key)}: missing`),
      ...Object.entries(object)
        .filter(([key]) => key in keys)
        .flatMap(([key, item]) => misfits(item, keys[key] as Shape, at(key))),
    ];
  }
  return [];
}

function shapeOf(command: string): Shape {
  const shape = WIRE[command];
  if (!shape) throw new Error(`wire.json has no ${command}; run \`make fixtures\``);
  return shape;
}

async function answer(flags: string, msg: { type: string; [key: string]: unknown }) {
  history.replaceState(null, "", `/${flags}`);
  return makeHass().callWS(msg);
}

async function update(flags: string): Promise<unknown> {
  history.replaceState(null, "", `/${flags}`);
  const hass = makeHass();
  return new Promise((resolve) => {
    void hass.connection!.subscribeMessage(resolve, {
      type: "aivi/inputs/subscribe",
      entry_id: "acc1",
    });
  });
}

afterEach(() => {
  history.replaceState(null, "", "/");
});

const CONFIG_FLAGS = [
  "",
  "?more=1",
  "?models=1",
  "?feeders=kept",
  "?switchboard=1",
  "?switchboard=1&stream=reconnecting",
  "?switchboard=1&stream=stopped",
  "?switchboard=1&inactive=1",
  "?nowidgets=1",
  "?accounts=2&nowidgets=acc2",
  "?noactivities=1",
  "?activitiesonly=1",
];

describe("the harness mock answers as the integration does", () => {
  it.each(CONFIG_FLAGS)("aivi/config with %j", async (flags) => {
    const result = await answer(flags, { type: "aivi/config" });
    expect(misfits(result, shapeOf("aivi/config"), "")).toEqual([]);
  });

  it.each([
    ["aivi/widgets", ""],
    ["aivi/widgets", "?more=1"],
    ["aivi/activities", ""],
  ])("%s with %j", async (type, flags) => {
    const result = await answer(flags, { type, entry_id: "acc1" });
    expect(misfits(result, shapeOf(type), "")).toEqual([]);
  });

  it.each([
    "?switchboard=1",
    "?switchboard=1&stream=reconnecting",
    "?switchboard=1&stream=stopped",
    "?switchboard=1&inactive=1",
    "?waiting=1",
    "",
  ])("aivi/inputs/subscribe with %j", async (flags) => {
    const result = await update(flags);
    expect(misfits(result, shapeOf("aivi/inputs/subscribe"), "")).toEqual([]);
  });

  it("aivi/automations/turn_off", async () => {
    const result = await answer("?feeders=kept", {
      type: "aivi/automations/turn_off",
      entity_ids: [],
    });
    expect(misfits(result, shapeOf("aivi/automations/turn_off"), "")).toEqual([]);
  });

  it("holds each value of an object keyed by id", () => {
    const shape: Shape = {
      type: "object",
      values: { type: "object", keys: { a: { type: "string" } } },
    };
    expect(misfits({ x: { a: "1" }, y: { a: "2" } }, shape, "m")).toEqual([]);
    expect(misfits({ x: { a: 1 } }, shape, "m")).toEqual([
      "m{x}.a: number, the integration sends string",
    ]);
  });

  it("names what does not fit", () => {
    const shape: Shape = {
      type: "object",
      keys: { state: { type: "string" }, reason: { type: "null|string" } },
    };
    expect(misfits({ state: "connected", reason: null }, shape, "")).toEqual([]);
    expect(misfits({ state: 1, why: null }, shape, "")).toEqual([
      "why: not sent by the integration",
      "reason: missing",
      "state: number, the integration sends string",
    ]);
  });
});
