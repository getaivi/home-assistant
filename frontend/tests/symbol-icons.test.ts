// The preview's approximate icons: SF Symbol -> Material Design Icon
// (symbol-icons.ts), checked against the real MDI set (the @mdi/svg
// devDependency), and the renderer drawing them through <ha-icon> only
// where Home Assistant defines it.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewActivity } from "../src/preview/activity";
import { previewWidget } from "../src/preview-render";
import { mdiFor, SYMBOL_ICON_TABLES } from "../src/symbol-icons";
import { $, text } from "./harness";

const inMdi = (name: string): boolean => existsSync(`node_modules/@mdi/svg/svg/${name}.svg`);

describe("mdiFor", () => {
  it("maps a symbol to its icon", () => {
    expect(mdiFor("washer")).toBe("washing-machine");
    expect(mdiFor("thermometer.medium")).toBe("thermometer");
    expect(mdiFor("door.garage.closed")).toBe("garage");
  });

  it("draws a plain symbol as an outline and its .fill filled", () => {
    expect(mdiFor("lock")).toBe("lock-outline");
    expect(mdiFor("lock.fill")).toBe("lock");
    expect(mdiFor("bolt.fill")).toBe("flash");
    expect(mdiFor("checkmark.circle.fill")).toBe("check-circle");
    // No outline in MDI: the same icon either way.
    expect(mdiFor("washer.fill")).toBe("washing-machine");
  });

  it("falls back to the base for restyling suffixes and badges", () => {
    expect(mdiFor("bolt.circle")).toBe("flash-outline");
    expect(mdiFor("bolt.circle.fill")).toBe("flash");
    expect(mdiFor("house.square")).toBe("home-outline");
    expect(mdiFor("bell.badge")).toBe("bell-outline");
    expect(mdiFor("bell.badge.fill")).toBe("bell");
    expect(mdiFor("lock.open.trianglebadge.exclamationmark")).toBe("lock-open-outline");
    // A name in the table wins over its base.
    expect(mdiFor("sun.max.trianglebadge.exclamationmark")).toBe("weather-sunny-alert");
  });

  it("strikes a .slash symbol through where MDI can", () => {
    expect(mdiFor("bell.slash")).toBe("bell-off-outline");
    expect(mdiFor("bell.slash.fill")).toBe("bell-off");
    expect(mdiFor("wifi.slash")).toBe("wifi-off");
    // No struck-through icon: the base.
    expect(mdiFor("key.slash")).toBe("key-outline");
  });

  it("has nothing for a symbol outside the table", () => {
    expect(mdiFor("")).toBeNull();
    expect(mdiFor("scribble.variable")).toBeNull();
    expect(mdiFor("fill")).toBeNull();
    // A suffix that changes what is depicted is not dropped.
    expect(mdiFor("lock.rotation")).toBeNull();
    expect(mdiFor("constructor")).toBeNull();
  });

  it("only names icons MDI has, filled variants included", () => {
    const names = Object.values(SYMBOL_ICON_TABLES).flatMap((table) => Object.values(table));
    expect(names.length).toBeGreaterThan(200);
    const missing = [...new Set(names.flatMap((n) => [n, n.replace(/-outline$/, "")]))].filter(
      (n) => !inMdi(n),
    );
    expect(missing).toEqual([]);
  });

  it("strikes through only symbols it maps", () => {
    for (const symbol of Object.keys(SYMBOL_ICON_TABLES.OFF))
      expect(SYMBOL_ICON_TABLES.MDI).toHaveProperty([symbol]);
  });
});

// In this order: a custom element can't be undefined again.
describe("the preview's icons", () => {
  const chip = (icon: string): HTMLElement =>
    $(
      previewWidget("status", "Front door", { icon: { name: icon, primary_color: "green" } }),
      '[data-slot="icon"]',
    );

  it("keeps the stand-in glyph where nothing defines <ha-icon>", () => {
    expect(text(chip("lock.fill"))).toBe("✦");
    expect(chip("lock.fill").querySelector("ha-icon")).toBeNull();
  });

  it("draws the approximate icon through <ha-icon> once it is defined", () => {
    customElements.define("ha-icon", class extends HTMLElement {});
    const icon = $(chip("lock.fill"), "ha-icon");
    expect(icon.getAttribute("icon")).toBe("mdi:lock");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(text(chip("lock.fill"))).toBe("");
    // A bare symbol name (an activity's), and the default symbol.
    const banner = previewActivity("monitor", "Washer", { icon: "washer" });
    expect($(banner, '[data-slot="banner-icon"] ha-icon').getAttribute("icon")).toBe(
      "mdi:washing-machine",
    );
  });

  it("keeps the stand-in for a symbol with no icon, even then", () => {
    expect(text(chip("scribble.variable"))).toBe("✦");
    expect(chip("scribble.variable").querySelector("ha-icon")).toBeNull();
  });
});
