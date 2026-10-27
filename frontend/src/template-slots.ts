// Every template box an editor has, by its address: the box's key in the
// preview's feedback, which is also its address in the URL of its
// template workspace (router.ts). There are four kinds:
//
//   <field>          a field read from a template (`state`, `value`)
//   <field>__color   a field's color read from one (`value__color`), or an
//                    icon's second or third (`icon__secondary_color`)
//   <field>          a trend's points written as a template (`points`)
//   <field>.<i>.source  the size of phase i of a bar (`segments.1.source`)
//
// A box is there only while its value is set to Template. The workspace
// draws its box from the same spec the form's inline box is drawn from
// (field-source.ts, segment-source.ts), without the row or the bar
// editor that draw the inline one: the form may not show it (a phase not
// selected), or not be drawn yet (a reload on the workspace's URL).

import type { AiviEditor } from "./aivi-editor";
import type { AiviSegmentsEditor } from "./aivi-segments-editor";
import { slotTemplateSpec } from "./field-source";
import { t } from "./i18n";
import { type SegmentHost, segmentTemplateSpec } from "./segment-source";
import { fractionsOf, percentages } from "./segments";
import type { TemplateSpec } from "./source-editor";
import { asSegments, type Bindings, type SegmentBinding } from "./types/bindings";
import type { FieldMeta, TemplateMeta } from "./types/meta";
import { labelFor } from "./util";
import { markerKey, segmentMode, slotMode } from "./value-source";

export type TemplateSlot =
  /** A field's value, or its color (`suffix` "__color"). */
  | { kind: "slot"; field: FieldMeta; address: string; suffix: string; slotKind: string }
  | { kind: "points"; field: FieldMeta; address: string }
  | { kind: "segment"; field: FieldMeta; address: string; index: number };

const SEGMENT = /^(.+)\.(\d+)\.source$/;

/** The template box at `address` in a form of `template` holding
 * `bindings`; null when there is none (no such field, or its value is
 * not set to Template). */
export function findTemplateSlot(
  template: TemplateMeta | null | undefined,
  bindings: Bindings,
  address: string,
): TemplateSlot | null {
  for (const field of template?.fields ?? []) {
    const key = field.key;
    const segment = SEGMENT.exec(address);
    if (segment && segment[1] === key) {
      if (field.kind !== "segments" || !field.sourced_values) return null;
      const index = Number(segment[2]);
      const s = asSegments(bindings[key])[index];
      return s && segmentMode(s) === "template" ? { kind: "segment", field, address, index } : null;
    }
    if (!address.startsWith(key)) continue;
    const suffix = address.slice(key.length);
    if (field.kind === "points") {
      if (suffix || !Object.hasOwn(bindings, markerKey(key, "template"))) continue;
      return { kind: "points", field, address };
    }
    if (suffix === "" && field.source) {
      // A field whose point is an entity: its bare key holds the entity.
      if (slotMode(bindings, key, "entity") !== "template") continue;
      return { kind: "slot", field, address, suffix, slotKind: field.slots?.[""]?.kind ?? "text" };
    }
    // The color has a box only where the form draws it.
    if (suffix === "__color" && !field.color) continue;
    const slot = field.slots?.[suffix];
    if (!slot?.sources.includes("template")) continue;
    if (slotMode(bindings, address, slot.bare) !== "template") continue;
    return { kind: "slot", field, address, suffix, slotKind: slot.kind };
  }
  return null;
}

/** What the workspace says the box is: its name ("State", "Icon color",
 * "Phase 2") and, for a value inside a field, the field's. */
export function slotNames(
  slot: TemplateSlot,
  bindings: Bindings,
): { label: string; parent: string | null } {
  const field = labelFor(slot.field.key);
  if (slot.kind === "segment") {
    const s = asSegments(bindings[slot.field.key])[slot.index];
    return { label: s?.label || t("segments.phase", { index: slot.index + 1 }), parent: field };
  }
  if (slot.kind === "slot" && slot.suffix === "__color")
    return slot.field.kind === "icon"
      ? { label: t("field.icon-color"), parent: null }
      : { label: t("common.color"), parent: field };
  if (slot.kind === "slot" && slot.suffix === "__secondary_color")
    return { label: t("field.secondary"), parent: field };
  if (slot.kind === "slot" && slot.suffix === "__tertiary_color")
    return { label: t("field.tertiary"), parent: field };
  return { label: field, parent: null };
}

/** The bar editor of `field`, when the form draws it; else what a
 * phase's box needs of it, over the bindings. */
function segmentHost(editor: AiviEditor, field: FieldMeta): SegmentHost {
  const drawn = [...editor.querySelectorAll<AiviSegmentsEditor>("aivi-segments-editor")].find(
    (el) => el.field?.key === field.key,
  );
  if (drawn) return drawn;
  const list = (): SegmentBinding[] => asSegments(editor.editorState.bindings[field.key]);
  return {
    editor,
    field,
    get list() {
      return list();
    },
    patch(i, up) {
      const next = list().map((s) => ({ ...s }));
      const target = next[i];
      if (!target) return;
      up(target);
      editor.editorState.bindings[field.key] = next;
      editor.schedulePreview();
      editor.requestUpdate();
    },
    sharePercents: () => percentages(fractionsOf(list())),
  };
}

/** The spec of the box `slot` names in `editor`'s form. */
export function slotSpec(editor: AiviEditor, slot: TemplateSlot): TemplateSpec {
  const bindings = editor.editorState.bindings;
  const { label } = slotNames(slot, bindings);
  if (slot.kind === "segment") {
    const s = asSegments(bindings[slot.field.key])[slot.index] ?? { value: 0 };
    return segmentTemplateSpec(segmentHost(editor, slot.field), slot.index, s, label);
  }
  // Every edit re-renders the editor, the workspace in it and every row.
  const row = { bindings, editor, field: slot.field, requestUpdate: () => {} };
  return slotTemplateSpec(
    row,
    slot.address,
    label,
    slot.kind === "points" ? "points" : slot.slotKind,
  );
}
