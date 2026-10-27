// Drift guard for enum display names: every enum value the generated META
// can surface must have an `enum.<group>.<value>` key in the en catalog
// (and, via the parity test, strings.json). A new value in blocks.py or
// templates.py fails here after `make meta`.
//
// Group derivation mirrors the render call sites: palette colors use
// "color", the segments editor "track-fill", icon styling
// "rendering-mode" / "color-rendering", and a generic enum field its field
// key. A segments field's `displays` enum is not surfaced: it is the bar
// mode, labeled under bar.mode-*.

import { describe, expect, it } from "vitest";
import { en } from "../src/translations/en";
import type { FieldMeta } from "../src/types/meta";
import { META } from "./harness";

function enumKeys(): string[] {
  const keys = new Set<string>();
  const add = (group: string, values?: string[]): void => {
    for (const v of values ?? []) keys.add(`enum.${group}.${v}`);
  };
  add("color", META.colors);
  const templates = [
    ...Object.values(META.templates),
    ...Object.values(META.activity_templates ?? {}),
  ];
  for (const template of templates)
    for (const f of template.fields as FieldMeta[]) {
      if (f.kind === "color" || f.kind === "colors") add("color", f.options);
      if (f.kind === "segments") {
        add("color", f.colors);
        add("track-fill", f.track_fills);
      }
      if (f.kind === "icon") {
        add("rendering-mode", f.rendering_modes);
        add("color-rendering", f.color_renderings);
      }
      if (f.kind === "enum") add(f.key, f.options);
    }
  return [...keys];
}

describe("enum display-name coverage", () => {
  it("every enum value in META has an enum.<group>.<value> catalog key", () => {
    const keys = enumKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in en))).toEqual([]);
  });

  it("every META formatter has its formatter.* catalog key", () => {
    const missing = META.formatters
      .map((f) => `formatter.${f.replace(/_/g, "-")}`)
      .filter((key) => !(key in en));
    expect(missing).toEqual([]);
  });
});
