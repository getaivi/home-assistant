// The panel's client-side rules, checked against what the Python
// implementation answers for the same inputs (tests/fixtures/rules.json,
// written by scripts/refresh_fixtures.py; `make fixtures` regenerates it
// after a Python change).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BandsBinding, parseBands, pickBand } from "../src/bands";
import { ROWS_MAX, TAP_URL_MAX, urlProblem } from "../src/editor-validation";
import type { TranslationKey } from "../src/i18n";
import {
  actionColor,
  budgetProblem,
  forwardablePicture,
  IMAGE_ALT_MAX,
  IMAGE_URL_MAX,
  imageUrlProblem,
  parseGradient,
  pressKey,
  tileKind,
} from "../src/switchboard";
import type { Bindings } from "../src/types/bindings";
import { type ReadSource, readSource, type SlotBare } from "../src/value-source";
import { META } from "./harness";

interface Rules {
  colors: string[];
  image_url: [string, boolean][];
  tap_url: [string, boolean][];
  action_color: [string, string | null][];
  user_gradient: [string, string[] | null][];
  money: [string, string | null][];
  press: [string, "toggle" | "button", [string, string]][];
  limits: { image_url: number; label: number; tap_url: number; rows: number };
  sources: [Bindings, string, SlotBare, ReadSource | null][];
  bands: [unknown, BandsBinding | null, [string, string | null][] | null][];
}

const RULES = JSON.parse(readFileSync("frontend/tests/fixtures/rules.json", "utf8")) as Rules;

/** The sentence the panel shows for a press, by the service it calls. A
 * button that turns its entity on names what that does for scenes and
 * scripts, so those two are told apart by domain. */
function pressSentence(entityId: string, kind: string, service: string): TranslationKey {
  const domain = entityId.split(".")[0];
  switch (service) {
    case "cover.open_cover":
    case "valve.open_valve":
      return "switchboard.press-open";
    case "lock.lock":
      return "switchboard.press-lock";
    case "climate.turn_on":
      return "switchboard.press-toggle";
    case "button.press":
    case "input_button.press":
      return "switchboard.press-button";
    case "homeassistant.turn_on":
      if (kind === "toggle") return "switchboard.press-toggle";
      if (domain === "scene") return "switchboard.press-scene";
      if (domain === "script") return "switchboard.press-script";
      return "switchboard.press-on";
  }
  throw new Error(`no sentence for ${service}`);
}

describe("panel rules match the integration", () => {
  it("uses the same palette", () => {
    expect(META.colors).toEqual(RULES.colors);
  });

  it.each(RULES.image_url)("picture URL %j accepted: %s", (url, ok) => {
    expect(imageUrlProblem(url) === null).toBe(ok);
    expect(forwardablePicture(url)).toBe(ok ? url : null);
  });

  it.each(RULES.tap_url)("tap URL %j accepted: %s", (url, ok) => {
    expect(urlProblem(url) === null).toBe(ok);
  });

  it.each(RULES.action_color)("action color %j -> %j", (value, out) => {
    expect(actionColor(value, RULES.colors)).toBe(out);
  });

  it.each(RULES.user_gradient)("gradient %j -> %j", (raw, out) => {
    const parsed = parseGradient(raw, RULES.colors);
    if (out === null) expect(parsed.problem !== null || parsed.stops.length < 2).toBe(true);
    else expect(parsed).toEqual({ stops: out, problem: null });
  });

  // An empty budget is no budget, not a problem; the push drops it either way.
  it.each(RULES.money)("budget %j kept as %j", (raw, out) => {
    expect(budgetProblem(raw) === null).toBe(out !== null || raw.trim() === "");
  });

  it.each(RULES.press)("a press on %j (%s) calls %j", (entityId, kind, [domain, service]) => {
    const meta = META.templates["switchboard"]?.fields.find((f) => f.key === "actions")?.state_text;
    expect(meta).toBeDefined();
    if (!meta) return;
    expect(tileKind(entityId, meta)).toBe(kind);
    expect(pressKey(entityId, meta)).toBe(pressSentence(entityId, kind, `${domain}.${service}`));
  });

  it.each(RULES.sources)("in %j, %j (%s) reads %j", (scope, addr, bare, out) => {
    expect(readSource(scope, addr, bare)).toEqual(out);
  });

  it.each(RULES.bands)("reads bands %j as %j, and places readings in them", (raw, out, picks) => {
    const bands = parseBands(raw);
    expect(bands).toEqual(out);
    if (!bands) return;
    for (const [reading, value] of picks ?? [])
      expect(pickBand(bands, reading), reading).toBe(value);
  });

  it("caps text and rows where Aivi does", () => {
    expect(IMAGE_URL_MAX).toBe(RULES.limits.image_url);
    expect(IMAGE_ALT_MAX).toBe(RULES.limits.label);
    expect(TAP_URL_MAX).toBe(RULES.limits.tap_url);
    expect(ROWS_MAX).toBe(RULES.limits.rows);
  });
});
