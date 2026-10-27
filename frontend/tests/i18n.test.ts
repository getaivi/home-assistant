// Localization: catalog parity with strings.json, t() lookup/interpolation
// and per-key fallback, the boot-time catalog load, locale-aware countdown
// formatting, and an end-to-end smoke test that a non-en catalog
// switches rendered strings (via a tiny test-only "sv" fixture, so the
// test does not depend on a shipped translation's wording).

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18nLocale, loadCatalog, resetCatalog, setCatalog, t, tOpt, tSplit } from "../src/i18n";
import { en } from "../src/translations/en";
import type { HassLike } from "../src/types/hass";
import { countdownHero } from "../src/util";
import { $, makeHass, mountPanel, sr, text, until } from "./harness";

afterEach(() => {
  resetCatalog();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function flatten(node: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value as Record<string, unknown>, path));
  }
  return out;
}

// The en catalog is generated from the config_panel section HA serves
// (make catalog); this fails when strings.json changed without it.
describe("catalog parity", () => {
  it("matches the config_panel section of strings.json exactly", () => {
    // npm scripts run from the repo root (happy-dom rewrites
    // import.meta.url to an http scheme, so relative-to-cwd it is).
    const raw = JSON.parse(readFileSync("custom_components/aivi/strings.json", "utf8")) as {
      config_panel?: Record<string, unknown>;
    };
    expect(raw.config_panel, "strings.json needs a config_panel section").toBeDefined();
    expect(flatten(raw.config_panel ?? {})).toEqual({ ...en });
  });
});

describe("t", () => {
  it("returns the en string with {placeholder} interpolation", () => {
    expect(t("common.retry")).toBe("Retry");
    expect(t("hub.unbound-toast", { name: "Washer" })).toBe("Stopped feeding Washer");
    expect(t("events.button", { state: "connected" })).toBe("Events: connected");
  });

  it("leaves unknown placeholders intact", () => {
    expect(t("hub.unbound-toast", { other: "x" })).toBe("Stopped feeding {name}");
  });

  it("falls back to en per key when the catalog misses one", () => {
    setCatalog({ "common.retry": "Försök igen" }, "sv");
    expect(t("common.retry")).toBe("Försök igen");
    expect(t("common.edit")).toBe("Edit"); // not in the sv fixture
    expect(i18nLocale()).toBe("sv");
  });
});

describe("tOpt", () => {
  it("resolves dynamic template/field keys and misses to undefined", () => {
    expect(tOpt("template.status.label")).toBe("Status");
    expect(tOpt("template.aurora.label")).toBeUndefined();
  });
});

describe("tSplit", () => {
  it("splits around the placeholder so callers can wrap it in markup", () => {
    expect(tSplit("hub.fed-by", "sources")).toEqual(["Fed by ", ""]);
    expect(tSplit("preview.missing", "fields")).toEqual(["To save, set ", "."]);
  });

  it("returns the whole string when the placeholder is absent", () => {
    expect(tSplit("common.retry", "nope")).toEqual(["Retry", ""]);
  });
});

const SV_RESOURCES = {
  "component.aivi.config_panel.hub.widgets": "Dina widgetar",
  "component.other.config_panel.hub.bind": "ignored",
};

function svHass(): HassLike {
  const hass = makeHass();
  hass.language = "sv";
  const orig = hass.callWS.bind(hass);
  hass.callWS = (msg: object): Promise<unknown> =>
    (msg as { type: string }).type === "frontend/get_translations"
      ? Promise.resolve({ resources: SV_RESOURCES })
      : orig(msg);
  return hass;
}

describe("loadCatalog", () => {
  it("skips the fetch for en", async () => {
    const hass = makeHass();
    const spy = vi.fn(hass.callWS.bind(hass));
    hass.callWS = spy;
    await loadCatalog(hass);
    expect(spy).not.toHaveBeenCalled();
    expect(t("common.retry")).toBe("Retry");
  });

  it("installs the fetched language, stripping the wire prefix", async () => {
    await loadCatalog(svHass());
    expect(t("hub.widgets")).toBe("Dina widgetar");
    expect(t("hub.bind")).toBe("Set up"); // other components' keys ignored
    expect(i18nLocale()).toBe("sv");
  });

  it("prefers hass.locale.language over hass.language", async () => {
    const hass = svHass();
    hass.locale = { language: "en" };
    const spy = vi.fn(hass.callWS.bind(hass));
    hass.callWS = spy;
    await loadCatalog(hass);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the en catalog but the user's locale when the fetch fails", async () => {
    const hass = makeHass();
    hass.language = "sv";
    hass.callWS = () => Promise.reject(new Error("boom"));
    await loadCatalog(hass);
    expect(t("common.retry")).toBe("Retry");
    expect(i18nLocale()).toBe("sv");
  });
});

describe("countdownHero locale", () => {
  it("renders Intl unit words in the active locale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
    setCatalog({}, "sv");
    expect(countdownHero("2026-07-30T07:00:00Z")).toBe("2 dygn, 19 tim");
    resetCatalog();
    expect(countdownHero("2026-07-30T07:00:00Z")).toBe("2 days, 19 hr");
  });
});

// End to end: the boot path localizes the first render.
describe("localized panel", () => {
  it("boots in the user's language with per-key en fallback", async () => {
    const panel = await mountPanel(svHass());
    // Translated: the hub's widgets section header.
    await until(() => sr(panel).textContent?.includes("Dina widgetar") ?? false, "sv eyebrow");
    expect(text($(sr(panel), ".eyebrow"))).toBe("Dina widgetar");
    // Untranslated keys fall back to English, not blanks.
    expect(sr(panel).textContent).toContain("Live Activities");
  });
});
