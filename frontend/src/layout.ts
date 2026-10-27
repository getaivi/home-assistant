// The form layout: which fields belong together, and in which order.
//
// Related fields form a group: one titled block of rows with no divider
// between them, so what belongs together reads as one thing (a column's
// value, header and footer; a meter's power and its daily total). A field
// in no group is a group of its own. Sibling fields that are short (a
// range's minimum and maximum) share one row: an inline group.
//
// The map is the form's order within a section; which section a field is
// in still comes from the slot map (slots.ts), and a field the map
// doesn't mention is appended on its own, so an integration newer
// than this bundle can never hide a field from the form.

import { type Entry, type GroupDef, PROGRESS } from "./form-groups";
import { i18nLocale, t, tOpt, tTemplate } from "./i18n";
import { widgetTemplate } from "./preview/templates";
import type { EditorKind } from "./types/editor";
import { labelFor } from "./util";

/** The Live Activities' layouts; each widget template carries its own
 * (`layout` in preview/<slug>.ts). */
const ACTIVITY_LAYOUT: Record<string, readonly Entry[]> = {
  "activity:progress": [
    { id: "headline", fields: ["header_left", "header_right"] },
    PROGRESS,
    { id: "footnote", fields: ["footer_left", "footer_right"] },
    "compact_value",
  ],
  "activity:monitor": [
    { id: "left-column", fields: ["left_value", "left_header", "left_footer"] },
    {
      id: "right-column",
      fields: ["right_value", "right_header", "right_footer"],
    },
    "primary_column",
  ],
  "activity:remote": [
    { id: "reading", fields: ["value", "unit", "value_label"] },
    "state",
    "actions",
    { id: "picture", fields: ["image", "image_alt"] },
    { id: "bar", fields: ["progress", "bar_color"] },
    "stats",
    "compact_value",
  ],
};

/** A choice that only means something once other fields carry content:
 * for each listed set, at least one of its fields must be set. Until
 * then the control is shown idle with the reason (disabled, not hidden:
 * the user sees it exists and what unlocks it). The monitor's primary
 * column chooses between two columns, so both must show something. */
const NEEDS: Record<string, Record<string, string[][]>> = {
  "activity:monitor": {
    primary_column: [
      ["left_value", "left_header", "left_footer"],
      ["right_value", "right_header", "right_footer"],
    ],
  },
};

export function fieldNeeds(kind: EditorKind, template: string, key: string): string[][] {
  return NEEDS[`${kind}:${template}`]?.[key] ?? [];
}

function layoutFor(kind: EditorKind, template: string): readonly Entry[] | undefined {
  return kind === "widget"
    ? widgetTemplate(template)?.layout
    : ACTIVITY_LAYOUT[`activity:${template}`];
}

/** One block of the form: a titled group, or a single field (`id` null). */
export interface FormGroup {
  id: string | null;
  inline: boolean;
  keys: string[];
}

/** The groups a template defines, for the tests that hold the map to the
 * field metadata. */
export function groupDefs(kind: EditorKind, template: string): GroupDef[] {
  return (layoutFor(kind, template) ?? []).filter(
    (entry): entry is GroupDef => typeof entry !== "string",
  );
}

/**
 * Order and group the keys of one form section. A group keeps only the
 * keys this section holds, and is a plain single field once fewer than
 * two remain.
 */
export function groupsFor(
  kind: EditorKind,
  template: string,
  keys: readonly string[],
): FormGroup[] {
  const left = new Set(keys);
  const groups: FormGroup[] = [];
  const take = (wanted: readonly string[]): string[] => {
    const found = wanted.filter((key) => left.has(key));
    for (const key of found) left.delete(key);
    return found;
  };
  for (const entry of layoutFor(kind, template) ?? []) {
    if (typeof entry === "string") {
      const found = take([entry]);
      if (found.length) groups.push({ id: null, inline: false, keys: found });
      continue;
    }
    const found = take(entry.fields);
    if (found.length > 1) groups.push({ id: entry.id, inline: !!entry.inline, keys: found });
    else if (found.length) groups.push({ id: null, inline: false, keys: found });
  }
  for (const key of keys) if (left.has(key)) groups.push({ id: null, inline: false, keys: [key] });
  return groups;
}

/** A field as a sentence names it, so it matches the form row it is:
 * a field that goes by a short label inside its group ("Value" under
 * "Progress") is named by both ("the progress value"); any other by its
 * label alone. How the two combine, and whether they are lower-cased
 * mid-sentence, is each language's (`field.name-grouped`,
 * `field.name-case`). */
export function fieldName(key: string, template: string, kind: EditorKind): string {
  const short = tOpt(`field-short.${key}`);
  const group = groupDefs(kind, template).find((g) => g.fields.includes(key));
  if (!short || !group) return t("field.name", { field: labelFor(key, template, kind) });
  const lower = t("field.name-case") === "lower";
  const cased = (text: string): string => (lower ? text.toLocaleLowerCase(i18nLocale()) : text);
  return t("field.name-grouped", {
    group: cased(groupLabel(group.id, template, kind)),
    field: cased(short),
  });
}

/** A group's title: the template's own wording when it has one. */
export function groupLabel(id: string, template: string, kind?: string): string {
  return tTemplate("group", template, id, kind) ?? tOpt(`group.${id}`) ?? id;
}

/** A group's hint (only inline groups show one: their fields have no
 * room for their own). */
export function groupHint(id: string, template: string, kind?: string): string | undefined {
  return tTemplate("group-hint", template, id, kind) ?? tOpt(`group-hint.${id}`);
}
