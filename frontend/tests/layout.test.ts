// The form layout: which fields are grouped, held to the field metadata
// the backend ships, and how the editor draws a group, a row and an
// inline group.

import { afterEach, describe, expect, it } from "vitest";
import type { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import { tOpt } from "../src/i18n";
import { groupDefs, groupLabel, groupsFor } from "../src/layout";
import type { EditorKind } from "../src/types/editor";
import type { FieldMeta, TemplateMeta } from "../src/types/meta";
import {
  $,
  $$,
  META,
  mountPanel,
  openActivityEditor,
  openWidgetEditor,
  setInput,
  sr,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

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

async function openNew(panel: AiviPanel, slug: string, template: string): Promise<AiviEditor> {
  const acc = panel.accounts[0];
  if (!acc) throw new Error("no mock account");
  panel.openEditor(acc, { slug, name: slug, template, supported: true }, null);
  await until(() => !!sr(panel).querySelector("aivi-editor .form"), `editor for ${slug}`);
  return $(sr(panel), "aivi-editor") as AiviEditor;
}

describe("the layout map", () => {
  it("only groups fields the template has, each in one group", () => {
    for (const e of templates()) {
      const keys = new Set(e.fields.map((f) => f.key));
      const seen = new Set<string>();
      for (const group of groupDefs(e.kind, e.template))
        for (const key of group.fields) {
          const where = `${e.kind}:${e.template} ${group.id}.${key}`;
          expect(keys.has(key), where).toBe(true);
          expect(seen.has(key), where).toBe(false);
          seen.add(key);
        }
    }
  });

  it("names every group, and keeps inline groups to short plain fields", () => {
    for (const e of templates())
      for (const group of groupDefs(e.kind, e.template)) {
        expect(
          tOpt(`group-${e.template}.${group.id}`) ?? tOpt(`group.${group.id}`),
          group.id,
        ).toBeDefined();
        if (!group.inline) continue;
        for (const key of group.fields) {
          const field = e.fields.find((f) => f.key === key);
          expect(field?.kind, key).toBe("number_literal");
          // No source menu and no extras would fit in a mini field.
          expect(field?.slots, key).toBeUndefined();
        }
      }
  });

  it("places every key once, grouped keys together, the rest on their own", () => {
    for (const e of templates()) {
      const keys = e.fields.map((f) => f.key);
      const groups = groupsFor(e.kind, e.template, keys);
      expect(groups.flatMap((g) => g.keys).sort(), e.template).toEqual([...keys].sort());
      for (const group of groups)
        if (group.id === null) expect(group.keys).toHaveLength(1);
        else expect(group.keys.length).toBeGreaterThan(1);
    }
    // A group with one field left in a section is a plain field, and a
    // key the map never mentions is kept.
    expect(groupsFor("widget", "gauge", ["value", "brand_new"])).toEqual([
      { id: null, inline: false, keys: ["value"] },
      { id: null, inline: false, keys: ["brand_new"] },
    ]);
    expect(groupLabel("left-column", "monitor")).toBe("Left column");
  });
});

describe("groups and rows in the editor", () => {
  it("draws a titled group as rows under one heading, with short labels", async () => {
    const panel = await mountPanel();
    const editor = await openActivityEditor(panel, "grill");
    const group = $(editor, '.fgroup[data-group="left-column"]');
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Left column");
    expect(text($(group, ".fgl"))).toBe("Left column");
    const rows = $$(group, ":scope > aivi-field-row");
    expect(rows.map((r) => r.dataset["key"])).toEqual(["left_value", "left_header", "left_footer"]);
    // Under the group's heading a row goes by its short label; its control
    // keeps the full one as its accessible name.
    expect(rows.map((r) => text($(r, ".flabel")))).toEqual(["Value", "Header", "Footer"]);
    expect($(rows[1]!, "input").getAttribute("aria-label")).toBe("Left column header");
    // A row: the label, the control, then the source menu.
    expect([...rows[0]!.children].map((c) => c.className.split(" ")[0])).toEqual([
      "flab",
      "fmain",
      "fsrc",
      "fmain",
    ]);
  });

  it("puts short sibling fields on one row, under the group's label", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "livingroom-gauge", "gauge");
    const group = $(editor, '.fgroup[data-group="range"]');
    expect(text($(group, ".frow > .flab .flabel"))).toBe("Range");
    const minis = $$(group, ".finline > aivi-field-row.mini");
    expect(minis.map((m) => m.dataset["key"])).toEqual(["min_value", "max_value"]);
    expect(minis.map((m) => text($(m, ".k")))).toEqual(["Minimum", "Maximum"]);
    // Each shows what it defaults to, and the group carries one hint.
    expect(minis.map((m) => $(m, "input").getAttribute("placeholder"))).toEqual(["0", "1"]);
    expect(text($(group, ".fhint"))).toContain("from 0 to 1");
    setInput($(minis[1]!, "input"), "40");
    expect(editor.editorState.bindings["max_value"]).toBe(40);
  });

  it("leaves out a field the layout paints nowhere, unless it is already set", async () => {
    const panel = await mountPanel();
    const editor = await openNew(panel, "livingroom-gauge", "gauge");
    // The gauge has no icon chip and tints no text: no accent row.
    expect(editor.querySelector('aivi-field-row[data-key="accent"]')).toBeNull();
    expect(editor.querySelector('aivi-field-row[data-key="ring"]')).toBeTruthy();
    // A stored value stays reachable.
    editor.editorState.bindings["accent"] = "orange";
    editor.applySuggestion();
    await tick();
    expect(editor.querySelector('aivi-field-row[data-key="accent"]')).toBeTruthy();
  });

  it("leaves a field in no group on its own, and a list of rows as a block", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const solo = $(editor, 'aivi-field-row[data-key="state"]').parentElement!;
    expect(solo.className).toBe("fgroup");
    expect(solo.querySelector(".fgl")).toBeNull();
    expect($$(solo, "aivi-field-row")).toHaveLength(1);
    document.body.innerHTML = "";
    const batteries = await openWidgetEditor(await mountPanel(), "batteries");
    expect($(batteries, 'aivi-field-row[data-key="devices"]').classList.contains("block")).toBe(
      true,
    );
  });

  it("orders the look the same everywhere: own colors, the icon, the accent", async () => {
    const panel = await mountPanel();
    const keys = (editor: AiviEditor): (string | undefined)[] =>
      $$(editor, '.fsect[data-section="look"] aivi-field-row').map((r) => r.dataset["key"]);
    expect(keys(await openNew(panel, "porch", "switchboard"))).toEqual(["icon", "accent"]);
    expect(keys(await openNew(panel, "indoor", "trend"))).toEqual(["color", "icon", "accent"]);
  });

  it("gives an icon its color as a second row of the same field", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const icon = $(editor, 'aivi-field-row[data-key="icon"]');
    expect($$(icon, ":scope > .flab").map((l) => text($(l, ".flabel")))).toEqual([
      "Icon",
      "Icon color",
    ]);
    expect($(icon, ":scope > .fsrc.r2 select.srcsel")).toBeTruthy();
    expect($(icon, ":scope > .fmain.r3 details.fold")).toBeTruthy();
  });
});

describe("copy", () => {
  it("gives every field of every template one hint line at most, and every text input a hint", async () => {
    const twice: string[] = [];
    const none: string[] = [];
    let seen = 0;
    for (const [kind, slug] of [
      ...Object.keys(META.templates).map((s) => ["widget", s] as const),
      ...Object.keys(META.activity_templates ?? {}).map((s) => ["activity", s] as const),
    ]) {
      const panel = await mountPanel();
      const acc = panel.accounts[0]!;
      const remote = { slug: `copy-${slug}`, name: slug, template: slug, supported: true };
      if (kind === "widget") panel.openEditor(acc, remote, null);
      else panel.openActivityEditor(acc, remote, null);
      await until(() => !!sr(panel).querySelector("aivi-editor .form"), `editor for ${slug}`);
      for (const row of $$(sr(panel), "aivi-field-row")) {
        // The row's own hint lines: not a fold's, a list row's or a note's.
        const hints = $$(row, ".fhint").filter(
          (h) => h.closest("aivi-field-row") === row && !h.closest("details, .ordrow, .ctl"),
        );
        const id = `${kind}:${slug}.${row.dataset["key"]}`;
        seen += 1;
        if (hints.length > 1) twice.push(`${id} ${JSON.stringify(hints.map(text))}`);
        if (!hints.length && row.querySelector(":scope > .fmain > input, :scope > .fmain > .vsrc"))
          none.push(id);
      }
      panel.remove();
    }
    expect(seen).toBeGreaterThan(80);
    expect(twice).toEqual([]);
    expect(none).toEqual([]);
  });
});
