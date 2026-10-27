// The Save gate's pure rules, over the real template metadata.

import { describe, expect, it } from "vitest";
import {
  badUrlFields,
  erroredFields,
  isBound,
  missingFields,
  oversize,
  problemRows,
  rowsMax,
  urlProblem,
} from "../src/editor-validation";
import type { FieldMeta, TemplateMeta } from "../src/types/meta";
import { META } from "./harness";

function templateMeta(slug: string): TemplateMeta {
  const t = META.templates[slug];
  if (!t) throw new Error(`no template ${slug}`);
  return t;
}

describe("editor validation", () => {
  it("binds rows by a non-empty list and sourced fields by their marker", () => {
    const rows: FieldMeta = { key: "devices", kind: "rows" };
    expect(isBound(rows, { devices: [] })).toBe(false);
    expect(isBound(rows, { devices: ["sensor.x"] })).toBe(true);
    const value: FieldMeta = { key: "state" };
    expect(isBound(value, { state: "x", state__template: "" })).toBe(false);
    expect(isBound(value, { state__template: "{{ 1 }}" })).toBe(true);
    expect(isBound(value, { state: "x", state__attribute: "" })).toBe(false);
    expect(isBound(value, { state: "x", state__attribute: "a" })).toBe(true);
  });

  it("lists missing and hard-erroring required fields", () => {
    const status = templateMeta("status");
    expect(missingFields(status, {}).map((f) => f.key)).toEqual(["state"]);
    const b = { state__template: "{{" };
    expect(erroredFields(status, b, undefined)).toEqual([]);
    expect(
      erroredFields(status, b, { state: { status: "error", error: "x" } }).map((f) => f.key),
    ).toEqual(["state"]);
  });

  it("names the rows with an option the push would drop", () => {
    const tiles = {
      actions: ["light.porch", "scene.movie"],
      actions__options: { "scene.movie": { color: "nope", image: "http://x" } },
    };
    expect(problemRows(templateMeta("switchboard"), tiles, META.colors)).toEqual(["scene.movie"]);
    // A budget is checked wherever a row takes one; a tile's marks only
    // on tiles (a battery row's color is a palette pick, never typed).
    const categories = {
      categories: ["sensor.food_spent", "sensor.car_spent"],
      categories__options: {
        "sensor.food_spent": { budget: "300", color: "nope" },
        "sensor.car_spent": { budget: "-1" },
      },
    };
    expect(problemRows(templateMeta("budget"), categories, META.colors)).toEqual([
      "sensor.car_spent",
    ]);
    // Options of a row that is no longer picked hold nothing up.
    expect(
      problemRows(
        templateMeta("budget"),
        { ...categories, categories: ["sensor.food_spent"] },
        META.colors,
      ),
    ).toEqual([]);
  });

  it("measures oversize content", () => {
    expect(oversize(undefined)).toBeNull();
    expect(oversize({ bytes: 4096, limit: 4096 })).toBeNull();
    expect(oversize({ bytes: 4097, limit: 4096 })).toEqual({
      bytes: 4097,
      limit: 4096,
    });
  });

  it("caps rows at eight unless the metadata says otherwise", () => {
    expect(rowsMax({ key: "rows", kind: "rows" })).toBe(8);
    expect(rowsMax({ key: "rows", kind: "rows", max: 4 })).toBe(4);
  });

  it("checks tap URLs the way Aivi parses them", () => {
    expect(urlProblem("")).toBeNull();
    expect(urlProblem("  https://example.com  ")).toBeNull();
    expect(urlProblem("homeassistant://navigate/lovelace/0")).toBeNull();
    expect(urlProblem("example.com")).toBe("field.url-invalid");
    expect(urlProblem("https://")).toBe("field.url-invalid");
    expect(urlProblem(`https://x.com/${"a".repeat(243)}`)).toBe("field.url-long");
    expect(badUrlFields(templateMeta("status"), { tap_url: "nope" }).map((f) => f.key)).toEqual([
      "tap_url",
    ]);
    expect(badUrlFields(templateMeta("status"), { tap_url: "https://ok.example" })).toEqual([]);
  });
});
