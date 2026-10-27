// Drift guard for the slot map, plus the behavior it drives.
//
// The map in src/slots.ts is a claim about two things it does not own:
// which fields a template has (templates.py, via the generated META) and
// which regions the preview paints (preview-render.ts). Both drift
// silently: a field added in templates.py would just never appear in the
// form, and a renamed region would leave pixels that highlight nothing.
// So both halves are asserted here rather than trusted.

import { describe, expect, it } from "vitest";
import { previewActivity } from "../src/preview/activity";
import { type PreviewSize, previewWidget } from "../src/preview-render";
import { sectionsFor, slotsFor, slotsForField, unpaintedFields } from "../src/slots";
import { en } from "../src/translations/en";
import type { WidgetContent } from "../src/types/content";
import type { EditorKind } from "../src/types/editor";
import type { FieldMeta, TemplateMeta } from "../src/types/meta";
import { $, META, text } from "./harness";

interface Entry {
  kind: EditorKind;
  template: string;
  fields: FieldMeta[];
}

function templates(): Entry[] {
  const out: Entry[] = [];
  const add = (kind: EditorKind, pool: Record<string, TemplateMeta>): void => {
    for (const [template, meta] of Object.entries(pool))
      out.push({ kind, template, fields: meta.fields as FieldMeta[] });
  };
  add("widget", META.templates);
  add("activity", META.activity_templates ?? {});
  return out;
}

describe("slot map coverage", () => {
  it("covers every template the backend ships", () => {
    const uncovered = templates()
      .filter((e) => !slotsFor(e.kind, e.template).length)
      .map((e) => `${e.kind}:${e.template}`);
    expect(templates().length).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
  });

  it("gives every field of every template a slot, or says it paints nowhere", () => {
    const orphans: string[] = [];
    for (const e of templates())
      for (const f of e.fields)
        if (
          !slotsForField(e.kind, e.template, f.key).length &&
          !unpaintedFields(e.kind, e.template).includes(f.key)
        )
          orphans.push(`${e.kind}:${e.template}.${f.key}`);
    expect(orphans).toEqual([]);
  });

  it("names only fields the template actually defines", () => {
    const phantom: string[] = [];
    for (const e of templates()) {
      const keys = new Set(e.fields.map((f) => f.key));
      for (const slot of slotsFor(e.kind, e.template))
        for (const key of slot.fields)
          if (!keys.has(key)) phantom.push(`${e.kind}:${e.template}.${slot.id} -> ${key}`);
    }
    expect(phantom).toEqual([]);
  });

  it("uses slot ids that are unique within a template", () => {
    for (const e of templates()) {
      const ids = slotsFor(e.kind, e.template).map((s) => s.id);
      expect(new Set(ids).size, `${e.kind}:${e.template}`).toBe(ids.length);
    }
  });

  it("carries no per-slot catalog names", () => {
    // Regions are identified by pressing them and labeled with the field
    // label the rest of the panel uses. A `slot.<kind>.<template>.<id>`
    // key in the catalog would be a second vocabulary for the same regions.
    const named = Object.keys(en).filter(
      (k) => k.startsWith("slot.") && !k.startsWith("slot.surface."),
    );
    expect(named).toEqual([]);
  });
});

// Every visible field lands in exactly one section, in region order, and
// a field feeding two surfaces is claimed once.
describe("form sections", () => {
  it("places every visible key exactly once", () => {
    for (const e of templates()) {
      const keys = e.fields.map((f) => f.key);
      const placed = sectionsFor(e.kind, e.template, keys).flatMap((s) => s.keys);
      expect(placed.slice().sort(), `${e.kind}:${e.template}`).toEqual(keys.slice().sort());
    }
  });

  it("groups an activity by surface, Lock Screen first, then the behavior", () => {
    const keys = (META.activity_templates?.["progress"]?.fields ?? []).map(
      (f) => (f as FieldMeta).key,
    );
    const sections = sectionsFor("activity", "progress", keys);
    expect(sections.map((s) => s.id)).toEqual(["banner", "island", "behavior"]);
    expect(sections.map((s) => s.surface)).toEqual(["banner", "island", null]);
    // `progress` paints both the banner bar and the island ring; it is
    // claimed by the banner and not repeated.
    expect(sections[0]?.keys).toContain("progress");
    expect(sections[1]?.keys).not.toContain("progress");
    expect(sections[1]?.keys).toContain("compact_value");
    expect(sections[2]?.keys).toEqual(["tap_url"]);
  });

  it("files a widget's fields as content, then look, then behavior", () => {
    const fields = (META.templates["status"]?.fields ?? []) as FieldMeta[];
    const look = (key: string): boolean =>
      ["icon", "color", "colors"].includes(fields.find((f) => f.key === key)?.kind ?? "");
    const sections = sectionsFor(
      "widget",
      "status",
      fields.map((f) => f.key),
      look,
    );
    expect(sections.map((s) => [s.id, s.keys])).toEqual([
      ["content", ["state", "value"]],
      ["look", ["icon", "accent"]],
      ["behavior", ["tap_url"]],
    ]);
  });

  it("puts the look after the content wherever its region is", () => {
    // The switchboard's accent paints the grid and the gauge's ring the
    // dial: both are still how the widget looks.
    const of = (template: string): [string, string[]][] => {
      const fields = (META.templates[template]?.fields ?? []) as FieldMeta[];
      return sectionsFor(
        "widget",
        template,
        fields.map((f) => f.key),
        (key) =>
          ["icon", "color", "colors"].includes(fields.find((f) => f.key === key)?.kind ?? ""),
      ).map((s) => [s.id, s.keys]);
    };
    expect(of("switchboard")).toEqual([
      ["content", ["actions"]],
      ["look", ["accent", "icon"]],
      ["behavior", ["tap_url"]],
    ]);
    expect(of("gauge").map(([id]) => id)).toEqual(["content", "look", "behavior"]);
    expect(of("gauge")[1]?.[1]).toContain("ring");
  });

  it("appends keys the map doesn't mention rather than dropping them", () => {
    const sections = sectionsFor("widget", "status", ["state", "brand_new"]);
    expect(sections.flatMap((s) => s.keys)).toContain("brand_new");
  });
});

// Every id the renderers tag must be a slot, and every non-global slot
// must be present even with nothing bound (the reason for the
// placeholders).
describe("painted regions", () => {
  function tagged(node: HTMLElement): Set<string> {
    return new Set(
      [...node.querySelectorAll<HTMLElement>("[data-slot]")].map((el) => el.dataset["slot"] ?? ""),
    );
  }
  const render = (e: Entry, content: WidgetContent, size: PreviewSize = "small"): HTMLElement =>
    e.kind === "activity"
      ? previewActivity(e.template, "Preview", content)
      : previewWidget(e.template, "Preview", content, size);
  // Both widget sizes hold both properties below.
  const SIZES: PreviewSize[] = ["small", "medium"];

  // A payload rich enough to paint every optional region.
  const value = { value: "42" };
  const FULL = {
    state: value,
    value,
    subtitle: value,
    target: "2030-01-01T00:00:00Z",
    icon: "bolt",
    accent: "blue",
    label: "Label",
    unit: "%",
    min_value: 0,
    max_value: 100,
    progress: { value: 0.5, color: "green" },
    header_left: value,
    header_right: value,
    footer_left: value,
    footer_right: value,
    compact_value: value,
    left_column: { header: "L", value, footer: "l" },
    right_column: { header: "R", value, footer: "r" },
    rows: [{ label: "Row", value, icon: "bolt" }],
    devices: [{ name: "Phone", level: 80 }],
    actions: [{ id: "a", label: "A", icon: "power", kind: "toggle", on: true }],
    sources: [{ power: 1 }],
    home: { power: 2, today: 3 },
    total: { spent: 1, budget: 2, icon: "bolt" },
    currency: "USD",
    categories: [{ label: "C", spent: 1, budget: 2 }],
    points: [1, 2, 3],
    entries: [{ start: "2020-01-01T00:00:00Z", price: 1 }],
  };

  it("tags only ids the slot map declares", () => {
    const stray: string[] = [];
    for (const e of templates()) {
      const ids = new Set(slotsFor(e.kind, e.template).map((s) => s.id));
      for (const size of SIZES)
        for (const id of tagged(render(e, FULL, size)))
          if (!ids.has(id)) stray.push(`${e.kind}:${e.template}@${size} -> ${id}`);
    }
    expect(stray).toEqual([]);
  });

  it("reaches every non-global field from the canvas with nothing bound", () => {
    // What the placeholders guarantee, stated as the property that
    // matters: not "every region renders" but "every field is
    // reachable". A region whose fields are already reachable through
    // another region that always paints needs no placeholder: the status
    // caption is where `state` moves once `value` is set, and a dashed
    // "State" box under a hero already showing the state would name a
    // field the user had plainly set.
    const unreachable: string[] = [];
    for (const e of templates())
      for (const size of SIZES) {
        const painted = tagged(render(e, {}, size));
        const reachable = new Set(
          slotsFor(e.kind, e.template)
            .filter((s) => painted.has(s.id))
            .flatMap((s) => s.fields),
        );
        for (const slot of slotsFor(e.kind, e.template)) {
          if (slot.global) continue;
          for (const key of slot.fields)
            if (!reachable.has(key)) unreachable.push(`${e.kind}:${e.template}@${size}.${key}`);
        }
      }
    expect([...new Set(unreachable)]).toEqual([]);
  });

  it("labels a placeholder with its field's own label, not a slot name", () => {
    const node = previewActivity("progress", "Preview", {});
    const ghost = $(node, '[data-ghost][data-slot="island-value"]');
    expect(text(ghost)).toBe("Dynamic Island");
  });

  it("marks placeholders so they can never read as content", () => {
    const node = previewActivity("progress", "Preview", {});
    for (const el of node.querySelectorAll("[data-ghost]"))
      expect(el.className).toContain("pv-ghost");
  });
});
