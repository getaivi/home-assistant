// The form's groups (see layout.ts): the definition, and the groups more
// than one template uses.

export interface GroupDef {
  /** Names the group in the catalog (`group.<id>`). */
  id: string;
  fields: readonly string[];
  /** The fields share one row, labeled by the group. */
  inline?: boolean;
}

export type Entry = string | GroupDef;

export const RANGE: GroupDef = {
  id: "range",
  fields: ["min_value", "max_value"],
  inline: true,
};
export const READING: GroupDef = { id: "reading", fields: ["value", "unit"] };
export const PROGRESS: GroupDef = {
  id: "progress",
  fields: ["progress", "segments", "bar_color"],
};
