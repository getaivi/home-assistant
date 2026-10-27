// Pure helpers: field labels, error text, the iOS-style timer/countdown
// formatting (frozen clock), and the imperative DOM builder.

import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "../src/dom";
import { resetCatalog, setCatalog } from "../src/i18n";
import { countdownHero, enumLabel, errMsg, formatterTimer, labelFor, timerText } from "../src/util";

afterEach(() => {
  vi.useRealTimers();
  resetCatalog();
});

const NOW = "2026-07-27T12:00:00Z";

function freeze(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
}

describe("labelFor", () => {
  it("uses the curated label when one exists", () => {
    expect(labelFor("tap_url")).toBe("Opens on tap");
    expect(labelFor("end_date")).toBe("Finish time");
  });

  it("falls back to a humanized key", () => {
    expect(labelFor("some_new_field")).toBe("Some new field");
    expect(labelFor("x")).toBe("X");
  });
});

describe("enumLabel", () => {
  it("uses the catalog display name for known enum values", () => {
    expect(enumLabel("color", "gray2")).toBe("Gray 2");
    expect(enumLabel("track-fill", "hatched")).toBe("Hatched");
    expect(enumLabel("primary_column", "left")).toBe("Left");
  });

  it("humanizes unknown values instead of rendering blank or raw", () => {
    // The server may send values this build doesn't know.
    expect(enumLabel("color", "ultramarine")).toBe("Ultramarine");
    expect(enumLabel("rendering-mode", "extra-vibrant_mode")).toBe("Extra vibrant mode");
    expect(enumLabel("no-such-group", "x")).toBe("X");
  });

  it("follows the active catalog with per-key en fallback", () => {
    setCatalog({ "enum.color.red": "Röd" }, "sv");
    expect(enumLabel("color", "red")).toBe("Röd");
    expect(enumLabel("color", "blue")).toBe("Blue");
  });
});

describe("errMsg", () => {
  it("unwraps Error messages and stringifies the rest", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg(42)).toBe("42");
  });

  it("reads Home Assistant's {code, message} command errors", () => {
    expect(errMsg({ code: "invalid_format", message: "Invalid state words" })).toBe(
      "Invalid state words",
    );
  });
});

describe("timerText", () => {
  it("renders H:MM:SS an hour or more away", () => {
    freeze();
    expect(timerText("2026-07-27T13:30:05Z")).toBe("1:30:05");
    expect(timerText("2026-07-28T14:00:00Z")).toBe("26:00:00");
  });

  it("drops the hour under an hour away", () => {
    freeze();
    expect(timerText("2026-07-27T12:05:09Z")).toBe("5:09");
  });

  it("clamps past and invalid inputs to 0:00", () => {
    freeze();
    expect(timerText("2026-07-27T11:00:00Z")).toBe("0:00");
    expect(timerText("not a date")).toBe("0:00");
  });
});

describe("countdownHero", () => {
  it("shows the expired text once past, defaulting to Done", () => {
    freeze();
    expect(countdownHero("2026-07-27T11:59:00Z")).toBe("Done");
    expect(countdownHero("2026-07-27T11:59:00Z", "Gone")).toBe("Gone");
  });

  it("ticks as a timer under 24 h", () => {
    freeze();
    expect(countdownHero("2026-07-27T18:30:00Z")).toBe("6:30:00");
  });

  it("switches to days beyond 24 h", () => {
    freeze();
    expect(countdownHero("2026-07-30T07:00:00Z")).toBe("2 days, 19 hr");
    expect(countdownHero("2026-07-28T12:00:00Z")).toBe("1 day");
    expect(countdownHero("2026-07-28T15:00:00Z")).toBe("1 day, 3 hr");
  });

  it("passes unparseable input through", () => {
    expect(countdownHero("whenever")).toBe("whenever");
  });
});

describe("formatterTimer", () => {
  // On-device ground truth: both time formatters render as the ticking
  // timer reading on-device (time_since counts up from the timestamp,
  // time_until counts down to it), never as relative words (those exist
  // only as what VoiceOver reads).
  it("time_since counts up from the timestamp", () => {
    freeze();
    expect(formatterTimer("2026-07-27T11:55:00Z", "time_since")).toBe("5:00");
    expect(formatterTimer("2026-07-27T09:00:00Z", "time_since")).toBe("3:00:00");
    expect(formatterTimer("2025-06-27T12:00:00Z", "time_since")).toBe(
      "9480:00:00", // 395 days: hours keep counting, as the device timer does
    );
  });

  it("time_until counts down to the timestamp", () => {
    freeze();
    expect(formatterTimer("2026-07-27T12:20:00Z", "time_until")).toBe("20:00");
    expect(formatterTimer("2026-07-30T07:00:00Z", "time_until")).toBe("67:00:00");
  });

  it("clamps the wrong-direction case at 0:00 like the device intervals", () => {
    freeze();
    // A past target under time_until (interval now...max(now, date)) and a
    // future timestamp under time_since both floor at zero.
    expect(formatterTimer("2026-07-27T11:00:00Z", "time_until")).toBe("0:00");
    expect(formatterTimer("2026-07-27T13:00:00Z", "time_since")).toBe("0:00");
  });

  it("rejects non-timestamp values, including bare numbers", () => {
    freeze();
    // Date.parse would read "62" as a year; the formatter must not
    // (the device's strict ISO8601 parse falls back to the raw string too).
    expect(formatterTimer("62", "time_since")).toBeNull();
    expect(formatterTimer("Washing", "time_until")).toBeNull();
    expect(formatterTimer("2026-13-99Tnope", "time_since")).toBeNull();
  });
});

describe("h", () => {
  it("builds elements with class, style, and attributes", () => {
    const el = h("div", { class: "a b", style: "color:red", title: "t" });
    expect(el.className).toBe("a b");
    expect(el.style.color).toBe("red");
    expect(el.getAttribute("title")).toBe("t");
  });

  it("skips null/false props and renders true as an empty attribute", () => {
    const el = h("div", { hidden: true, "data-x": null, "data-y": false });
    expect(el.getAttribute("hidden")).toBe("");
    expect(el.hasAttribute("data-x")).toBe(false);
    expect(el.hasAttribute("data-y")).toBe(false);
  });

  it("wires on* props as listeners", () => {
    const fn = vi.fn();
    const el = h("button", { onclick: fn });
    el.click();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("appends nested children, flattening arrays and skipping gaps", () => {
    const el = h("div", null, "a", [h("span", {}, "b"), null, ["c", 1]], false);
    expect(el.textContent).toBe("abc1");
    expect(el.querySelector("span")?.textContent).toBe("b");
  });
});
