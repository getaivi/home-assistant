// The slot map: the join between what the preview paints and which form
// fields feed it. A slot is a named region of a rendered surface plus the
// field keys that feed it. It:
//
// 1. tags each preview region with `data-slot`, so pressing a region
//    flashes its fields and focusing a field outlines its regions;
// 2. keeps empty regions rendered as dashed placeholders carrying the
//    field's own label, so every region is addressable;
// 3. orders and groups the form by surface and region order.
//
// Slots carry no display names: regions are labeled, where
// unavoidable, with the field label the rest of the panel uses. Slot ids
// stay internal.
//
// - A field may feed more than one slot (activity `progress` paints the
//   island ring and the Lock Screen bar).
// - A field need not paint at all (`tap_url`; `icon`/`accent` in layouts
//   without an icon chip).
//
// The map is not derived from the backend's `FieldDef.path`: a path says
// where a value lands in the payload, not which pixels it moves.
// Each widget template's slots live in its preview module
// (preview/<slug>.ts); the Live Activities' are below.
// tests/slots.test.ts holds the two halves together.

import { tOpt } from "./i18n";
import { widgetTemplate } from "./preview/templates";
import type { EditorKind } from "./types/editor";

/** The rendered surface a slot lives on, for templates with more than
 * one. Absent = the template's only surface. */
export type SlotSurface = "island" | "banner";

export interface Slot {
  /** Unique within its template; the `data-slot` value the preview
   * renderers tag the region with. Internal, never shown. */
  id: string;
  /** Field keys feeding this slot. The first is the one a placeholder
   * borrows its label from. Keys the template doesn't define are ignored. */
  fields: string[];
  surface?: SlotSurface;
  /** No painted region at all: a property of the whole surface (the tap
   * action), or a field this template's layout happens not to render. */
  global?: boolean;
}

/** Each Live Activity template's slots over the Lock Screen banner and
 * the collapsed Dynamic Island, in form order: the Lock Screen comes
 * before the island even though the canvas stacks the island on top. */
const ACTIVITY_SLOTS: Record<string, readonly Slot[]> = {
  progress: [
    { id: "header-left", surface: "banner", fields: ["header_left"] },
    { id: "header-right", surface: "banner", fields: ["header_right"] },
    {
      id: "bar",
      surface: "banner",
      fields: ["progress", "segments", "bar_color"],
    },
    { id: "footer-left", surface: "banner", fields: ["footer_left"] },
    { id: "footer-right", surface: "banner", fields: ["footer_right"] },
    { id: "banner-icon", surface: "banner", fields: ["icon"] },
    // `progress` and `icon` are claimed by the banner above; the island
    // ring lists them so focusing either still outlines the ring.
    {
      id: "island-ring",
      surface: "island",
      fields: ["progress", "segments", "bar_color", "icon"],
    },
    { id: "island-value", surface: "island", fields: ["compact_value"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  monitor: [
    {
      id: "left-column",
      surface: "banner",
      fields: ["left_value", "left_header", "left_footer"],
    },
    {
      id: "right-column",
      surface: "banner",
      fields: ["right_value", "right_header", "right_footer"],
    },
    { id: "banner-icon", surface: "banner", fields: ["icon"] },
    { id: "island-icon", surface: "island", fields: ["icon"] },
    // The island's trailing slot shows whichever column primary_column
    // picks, so the picker belongs to the region it steers.
    {
      id: "island-value",
      surface: "island",
      fields: ["primary_column", "right_value", "left_value"],
    },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  // The picture is always its icon tile in a preview (the app draws the
  // image only once it has cached it), tinted by the accent.
  remote: [
    { id: "picture", surface: "banner", fields: ["image", "image_alt", "icon", "accent"] },
    { id: "state", surface: "banner", fields: ["state"] },
    { id: "reading", surface: "banner", fields: ["value", "unit", "value_label"] },
    { id: "bar", surface: "banner", fields: ["progress", "bar_color"] },
    { id: "stats", surface: "banner", fields: ["stats"] },
    { id: "actions", surface: "banner", fields: ["actions"] },
    { id: "island-icon", surface: "island", fields: ["icon", "accent"] },
    { id: "island-value", surface: "island", fields: ["compact_value", "value", "unit"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
};

/** Fields a template's layout gives no region at all: the editor leaves
 * them out of the form (unless one is already set, which stays editable
 * so nothing becomes stuck). */
export function unpaintedFields(kind: EditorKind, template: string): readonly string[] {
  return kind === "widget" ? (widgetTemplate(template)?.unpainted ?? []) : [];
}

/** The slots of a template, or none for a template this build has no map
 * for (an integration newer than this bundle): the editor then falls back
 * to a plain form. */
export function slotsFor(kind: EditorKind, template: string): readonly Slot[] {
  if (kind === "widget") return widgetTemplate(template)?.slots ?? [];
  return Object.hasOwn(ACTIVITY_SLOTS, template) ? (ACTIVITY_SLOTS[template] ?? []) : [];
}

export function slotById(kind: EditorKind, template: string, id: string): Slot | null {
  return slotsFor(kind, template).find((s) => s.id === id) ?? null;
}

/** Every slot a field key feeds: more than one when the field paints in
 * more than one place. */
export function slotsForField(kind: EditorKind, template: string, key: string): Slot[] {
  return slotsFor(kind, template).filter((s) => s.fields.includes(key));
}

/** The surfaces a field paints on, in map order (for the "also shows in"
 * caption). */
export function surfacesForField(kind: EditorKind, template: string, key: string): SlotSurface[] {
  const out: SlotSurface[] = [];
  for (const slot of slotsForField(kind, template, key))
    if (slot.surface && !out.includes(slot.surface)) out.push(slot.surface);
  return out;
}

export function surfaceLabel(surface: SlotSurface): string {
  return tOpt(`slot.surface.${surface}`) ?? surface;
}

/** Which group of the form a field belongs to: what the widget shows
 * (one group per surface when a template has several), how it looks, or
 * how it behaves. */
type SectionId = "content" | SlotSurface | "look" | "behavior";

/** One group of the form, in the order every editor uses: the content
 * (per surface, in the order the regions appear), then the look, then the
 * behavior. `surface` is set for a content group that lands on one. */
export interface FormSection {
  id: SectionId;
  surface: SlotSurface | null;
  keys: string[];
}

const SECTION_RANK: Record<string, number> = { look: 1, behavior: 2 };

/**
 * Group and order the visible field keys. A field is claimed by the first
 * slot that lists it and filed under:
 *
 * - the look, when `isLook` says it only styles the widget (an icon, a
 *   color) wherever its region is;
 * - the behavior, when its slot paints nothing (the tap action);
 * - else the content, under its slot's surface.
 *
 * Keys the map doesn't mention are appended (to the look or the content)
 * rather than dropped, so an integration newer than this bundle can never
 * hide a field from the form.
 */
export function sectionsFor(
  kind: EditorKind,
  template: string,
  visible: readonly string[],
  isLook: (key: string) => boolean = () => false,
): FormSection[] {
  const sections: FormSection[] = [];
  const section = (id: SectionId, surface: SlotSurface | null): FormSection => {
    let found = sections.find((s) => s.id === id);
    if (!found) {
      found = { id, surface, keys: [] };
      sections.push(found);
    }
    return found;
  };
  const place = (key: string, slot: Slot | null): void => {
    if (isLook(key)) section("look", null).keys.push(key);
    else if (slot?.global) section("behavior", null).keys.push(key);
    else if (slot?.surface) section(slot.surface, slot.surface).keys.push(key);
    else section("content", null).keys.push(key);
  };

  const claimed = new Set<string>();
  for (const slot of slotsFor(kind, template)) {
    for (const key of slot.fields) {
      if (claimed.has(key) || !visible.includes(key)) continue;
      claimed.add(key);
      place(key, slot);
    }
  }
  for (const key of visible) if (!claimed.has(key)) place(key, null);

  // Stable: the content groups keep their region order.
  return sections
    .filter((s) => s.keys.length)
    .sort((a, b) => (SECTION_RANK[a.id] ?? 0) - (SECTION_RANK[b.id] ?? 0));
}
