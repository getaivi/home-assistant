// The List widget's preview at both sizes (preview/list.ts), against the
// app's List template: the name line, up to four rows, what a row keeps
// at each size, and the region that leads to the rows' field. Payloads
// are built inline against the wire types, after the docs' own example.

import { describe, expect, it } from "vitest";
import { COLOR_HEX, WP } from "../src/const";
import { list } from "../src/preview/list";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { slotById } from "../src/slots";
import { listPreviewStyles } from "../src/styles/preview/list";
import type { PreviewRow, WidgetContent } from "../src/types/content";
import { $, $$, css, text } from "./harness";

const SIZES: PreviewSize[] = ["small", "medium"];

/** The docs' example payload, with the fourth row of its reference render. */
const ROWS: PreviewRow[] = [
  {
    label: "Living room",
    value: { value: "21.4°" },
    icon: { name: "thermometer.medium", primary_color: "orange" },
  },
  { label: "Front door", value: { value: "Locked", text_color: "green" }, icon: "lock.fill" },
  {
    label: "Humidity",
    value: { value: "54%" },
    icon: { name: "humidity.fill", primary_color: "teal" },
  },
  { label: "Garage", value: { value: "Closed" }, icon: "door.garage.closed" },
];

const draw = (content: WidgetContent, size: PreviewSize): HTMLElement =>
  previewWidget("list", "Home", content, size);

/** The classes of a row's parts, in order. */
const parts = (row: HTMLElement): string[] => [...row.children].map((c) => c.className);

/** What a row says: its label and value (not its glyph). */
const words = (row: HTMLElement): string[] => $$(row, ".pv-list-label, .pv-list-value").map(text);

describe("list preview: the module", () => {
  it("draws both families itself", () => {
    expect(typeof list.small).toBe("function");
    expect(typeof list.medium).toBe("function");
  });
});

describe.each(SIZES)("list preview at %s: the frame", (size) => {
  it("is the name line over the rows, and nothing else", () => {
    const canvas = $(draw({ rows: ROWS }, size), ".pv-canvas");
    expect([...canvas.children].map((c) => c.className)).toEqual([
      "pv-list-head",
      `pv-list-rows is-${size}`,
    ]);
    expect(text($(canvas, ".pv-list-head > .pv-name"))).toBe("Home");
  });

  it("shows four rows and counts the rest in the name line", () => {
    const four = draw({ rows: ROWS }, size);
    expect($$(four, ".pv-list-rows > .pv-list-row")).toHaveLength(4);
    expect(four.querySelector(".pv-meta")).toBeNull();

    const six = draw({ rows: [...ROWS, { label: "Outdoor" }, { label: "Attic" }] }, size);
    expect($$(six, ".pv-list-rows > .pv-list-row")).toHaveLength(4);
    expect(text($(six, ".pv-list-head > .pv-meta"))).toBe("+2");
  });

  it("fewer rows are fewer rows: no empty bands", () => {
    const el = draw({ rows: ROWS.slice(0, 2) }, size);
    expect($$(el, ".pv-list-rows > .pv-list-row")).toHaveLength(2);
    expect(el.querySelector(".pv-meta")).toBeNull();
  });

  it("colors a row's icon with the icon's color, else secondary", () => {
    const icons = $$(draw({ rows: ROWS }, size), ".pv-list-row > .pv-list-icon");
    expect(icons.map(css)).toEqual([
      `color:${COLOR_HEX.orange};`,
      `color:${WP.secondary};`,
      `color:${COLOR_HEX.teal};`,
      `color:${WP.secondary};`,
    ]);
  });

  it("colors a value with its own text color, else primary", () => {
    const values = $$(draw({ rows: ROWS }, size), ".pv-list-row > .pv-list-value");
    expect(values.map(text)).toEqual(["21.4°", "Locked", "54%", "Closed"]);
    expect(values.map(css)).toEqual([
      `color:${WP.primary};`,
      `color:${COLOR_HEX.green};`,
      `color:${WP.primary};`,
      `color:${WP.primary};`,
    ]);
  });

  it("tags the rows as the one region, leading to the rows field", () => {
    const el = draw({ rows: ROWS }, size);
    const regions = $$(el, "[data-slot]");
    expect(regions).toEqual([$(el, ".pv-list-rows")]);
    expect(regions[0]!.dataset["slot"]).toBe("rows");
    expect(slotById("widget", "list", "rows")?.fields).toEqual(["rows"]);
    expect(el.querySelector("[data-ghost]")).toBeNull();
  });

  it("with no rows keeps the name and a placeholder for the rows", () => {
    for (const content of [{}, { rows: [] }]) {
      const canvas = $(draw(content, size), ".pv-canvas");
      expect(text($(canvas, ".pv-list-head > .pv-name"))).toBe("Home");
      expect(canvas.querySelector(".pv-meta")).toBeNull();
      expect($$(canvas, ".pv-list-row")).toHaveLength(0);
      const ghost = $(canvas, "[data-ghost]");
      expect(ghost.dataset["slot"]).toBe("rows");
      expect(ghost.className).toBe("pv-ghost is-grow");
      expect(text(ghost)).toBe("Entities");
      expect($$(canvas, "[data-slot]")).toEqual([ghost]);
    }
  });
});

describe("list preview at medium: a row", () => {
  it("is icon, label, value", () => {
    const rows = $$(draw({ rows: ROWS }, "medium"), ".pv-list-rows > .pv-list-row");
    expect(rows.map(parts)).toEqual(
      Array(4).fill(["pv-list-icon", "pv-list-label", "pv-list-value"]),
    );
    expect(rows.map((r) => r.className)).toEqual(Array(4).fill("pv-list-row has-icon has-value"));
    expect(rows.map((r) => text($(r, ".pv-list-label")))).toEqual([
      "Living room",
      "Front door",
      "Humidity",
      "Garage",
    ]);
  });

  it("keeps the label whatever else is missing, and no slot for a missing icon", () => {
    const rows = $$(
      draw(
        {
          rows: [
            { label: "No icon", value: { value: "42" } },
            { label: "Only a label" },
            { label: "Label and icon", icon: "lock.fill" },
            { value: { value: "Only a value" } },
          ],
        },
        "medium",
      ),
      ".pv-list-rows > .pv-list-row",
    );
    expect(rows.map(parts)).toEqual([
      ["pv-list-label", "pv-list-value"],
      ["pv-list-label"],
      ["pv-list-icon", "pv-list-label"],
      ["pv-list-label", "pv-list-value"],
    ]);
    expect(rows.map((r) => r.className)).toEqual([
      "pv-list-row has-value",
      "pv-list-row",
      "pv-list-row has-icon",
      "pv-list-row has-value",
    ]);
    expect(rows.map(words)).toEqual([
      ["No icon", "42"],
      ["Only a label"],
      ["Label and icon"],
      ["", "Only a value"],
    ]);
  });
});

describe("list preview at small: a row", () => {
  it("is icon and value: the label is dropped", () => {
    const rows = $$(draw({ rows: ROWS }, "small"), ".pv-list-rows > .pv-list-row");
    expect(rows.map(parts)).toEqual(Array(4).fill(["pv-list-icon", "pv-list-value"]));
    expect(rows.map(words)).toEqual([["21.4°"], ["Locked"], ["54%"], ["Closed"]]);
  });

  it("falls back to the label only where there is no value", () => {
    const rows = $$(
      draw(
        {
          rows: [
            { label: "No icon", value: { value: "42" } },
            { label: "Only a label" },
            { label: "Label and icon", icon: "lock.fill" },
            { value: { value: "Only a value" } },
          ],
        },
        "small",
      ),
      ".pv-list-rows > .pv-list-row",
    );
    expect(rows.map(parts)).toEqual([
      ["pv-list-value"],
      ["pv-list-label"],
      ["pv-list-icon", "pv-list-label"],
      ["pv-list-value"],
    ]);
    expect(rows.map((r) => r.className)).toEqual([
      "pv-list-row has-value",
      "pv-list-row",
      "pv-list-row has-icon",
      "pv-list-row has-value",
    ]);
    expect(rows.map(words)).toEqual([
      ["42"],
      ["Only a label"],
      ["Label and icon"],
      ["Only a value"],
    ]);
  });
});

describe("list preview: the stylesheet", () => {
  const sheet = listPreviewStyles.cssText.replace(/\s+/g, " ");

  it("keeps label and value on one line with an ellipsis", () => {
    expect(sheet).toMatch(
      /\.pv-list-label, \.pv-canvas \.pv-list-rows \.pv-list-value \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/,
    );
  });

  it("sets rows at footnote, the value semibold, and the small value at subheadline", () => {
    expect(sheet).toMatch(
      /\.pv-list-label, \.pv-canvas \.pv-list-rows \.pv-list-value \{[^}]*font-size: 13px;/,
    );
    expect(sheet).toMatch(/\.pv-canvas \.pv-list-rows \.pv-list-value \{[^}]*font-weight: 600;/);
    expect(sheet).toMatch(
      /\.pv-canvas \.pv-list-rows\.is-small \.pv-list-value \{[^}]*font-size: 15px;/,
    );
  });

  it("gives the icon a 20 pt slot and the rows a separator hairline between them", () => {
    expect(sheet).toMatch(/\.pv-list-icon \{[^}]*width: 20px;/);
    expect(sheet).toMatch(
      /\.pv-list-row \+ \.pv-list-row::before \{[^}]*height: calc\(1px \/ 3\); background: rgba\(84,84,88,\.6\);/,
    );
    expect(sheet).not.toMatch(/\.pv-list-row:first-child::before/);
  });
});
