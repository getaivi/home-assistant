// The remote Live Activity's preview: the Lock Screen card and the
// compact Dynamic Island, from the harness's Robot vacuum binding as the
// integration resolves it, and from payloads built against the wire.

import { afterEach, describe, expect, it } from "vitest";
import { COLOR_HEX, fieldHint } from "../src/const";
import { t } from "../src/i18n";
import { groupLabel } from "../src/layout";
import { previewActivity } from "../src/preview/activity";
import { remoteCompactText } from "../src/preview/activity-remote";
import type { WidgetContent } from "../src/types/content";
import { labelFor } from "../src/util";
import { $, $$, css, makeHass, text } from "./harness";

afterEach(() => {
  history.replaceState(null, "", "/");
});

/** The harness's Robot vacuum (bound under ?more=1), resolved by the
 * integration. */
async function vacuum(): Promise<WidgetContent> {
  history.replaceState(null, "", "/?more=1");
  const hass = makeHass();
  const config = (await hass.callWS({ type: "aivi/config" })) as {
    accounts: { activities: { slug: string; bindings: object }[] }[];
  };
  const bound = config.accounts[0]?.activities.find((a) => a.slug === "vacuum");
  if (!bound) throw new Error("no vacuum activity in the harness");
  const res = (await hass.callWS({
    type: "aivi/preview",
    template: "remote",
    bindings: structuredClone(bound.bindings),
    kind: "activity",
  })) as { content: WidgetContent | null };
  if (!res.content) throw new Error("unresolvable remote activity");
  return res.content;
}

const slotEl = (root: HTMLElement, id: string): HTMLElement => $(root, `[data-slot="${id}"]`);

describe("the remote Live Activity preview", () => {
  it("draws the vacuum's card: icon tile, name over its state, the reading, the bar and two buttons", async () => {
    const el = previewActivity("remote", "Robot vacuum", await vacuum());
    const banner = $(el, ".pv-banner");
    expect(text(banner)).toContain("Robot vacuum");
    const state = slotEl(banner, "state");
    expect(text(state)).toBe("Cleaning");
    expect(css(state)).toContain(COLOR_HEX.green);
    const reading = slotEl(banner, "reading");
    expect(text(reading)).toBe("68%");
    expect(css(reading.querySelector("div div div")!)).toContain("font-size:22px");
    // The bar takes the stats' place, in the state's color.
    const bar = slotEl(banner, "bar");
    expect(css(bar.querySelector("i")!)).toContain("width:40%");
    expect(css(bar.querySelector("i")!)).toContain(COLOR_HEX.green);
    expect(banner.querySelector('[data-slot="stats"]')).toBeNull();
    // Two buttons carry their labels.
    const buttons = [...slotEl(banner, "actions").children];
    expect(buttons.map((b) => text(b.lastElementChild!))).toEqual(["Pause", "Dock"]);
    // The picture is its icon tile: no image is ever cached in a preview.
    expect(css(slotEl(banner, "picture"))).toContain("width:40px");
    // The island: the bare glyph leading, the value and unit trailing at
    // caption semibold, joined without a space before %.
    const value = $(el, '.pv-island-pill [data-slot="island-value"]');
    expect(text(value)).toBe("68%");
    expect(css(value)).toContain("font-weight:600");
    expect(el.querySelector('.pv-island-pill [data-slot="island-icon"]')).not.toBeNull();
  });

  it("shows stats without a bar, symbols only for three buttons, and fills an on toggle", () => {
    const el = previewActivity("remote", "Garage", {
      value: { value: "Open" },
      accent: "yellow",
      stats: [
        { label: "Temp", value: { value: "18" }, unit: "°" },
        { label: "Car", value: { value: "Home" } },
      ],
      actions: [
        { id: "door", label: "Door", icon: "door.garage.open", kind: "toggle", on: true },
        { id: "light", label: "Light", icon: "lightbulb", kind: "toggle", on: false },
        { id: "bell", label: "Bell", icon: "bell", kind: "button" },
      ],
    });
    const stats = slotEl(el, "stats");
    expect(css(stats)).toContain("grid-template-columns:1fr1fr");
    expect(text(stats)).toContain("Temp");
    const buttons = $$(slotEl(el, "actions"), ":scope > div");
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.children.length === 1)).toBe(true);
    // Yellow is light: the on toggle's ink is dark; the off plate is
    // white at 16 % over black.
    expect(css(buttons[0]!)).toContain(`background:${COLOR_HEX.yellow}`);
    expect(css(buttons[0]!)).toContain("color:#1c1c1f");
    expect(css(buttons[1]!)).toContain("background:rgb(41,41,41)");
    // The state has no word: a placeholder keeps it pressable.
    expect(slotEl(el, "state").hasAttribute("data-ghost")).toBe(true);
  });

  it("keeps empty regions pressable as placeholders", () => {
    const el = previewActivity("remote", "New", {});
    for (const id of ["reading", "bar", "stats", "actions", "island-value"])
      expect(slotEl(el, id).hasAttribute("data-ghost"), id).toBe(true);
  });

  it("words the compact value: its own, else the value and a spaced unit", () => {
    expect(remoteCompactText({ compact_value: { value: "Docked" }, value: { value: "1" } })).toBe(
      "Docked",
    );
    expect(remoteCompactText({ value: { value: "12" }, unit: "km" })).toBe("12 km");
    expect(remoteCompactText({ value: { value: "21" }, unit: "°C" })).toBe("21°C");
    expect(remoteCompactText({})).toBeNull();
  });

  it("takes the Live Activity's own copy before the widget's of the same slug", () => {
    expect(fieldHint("actions", "remote", false, "activity")).toBe(
      t("field-hint-activity-remote.actions"),
    );
    expect(fieldHint("actions", "remote", false, "widget")).toBe(t("field-hint-remote.actions"));
    expect(fieldHint("actions", "remote")).toBe(t("field-hint-remote.actions"));
    // Where the Live Activity has none of its own, the slug's is shared.
    expect(fieldHint("icon", "remote", false, "activity")).toBe(t("field-hint-remote.icon"));
    expect(labelFor("actions", "remote", "activity")).toBe(t("field-label-remote.actions"));
    expect(groupLabel("bar", "remote", "activity")).toBe(t("group-remote.bar"));
  });
});
