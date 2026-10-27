// What aivi/preview answers: the resolved widget payload, its size
// against Aivi's cap, and the render feedback for each sourced value.

export interface PreviewValue {
  value?: unknown;
  text_color?: string;
  /** A wire formatter name (time_since / time_until); the app renders the
   * value through it, so the preview must too. */
  formatter?: string;
}

interface PreviewIcon {
  name?: string;
  primary_color?: string;
}

export type IconSpec = string | PreviewIcon;

export interface PreviewSegment {
  value?: number;
  fill_color?: string;
  label?: string;
  track_color?: string;
  track_fill?: string;
}

export interface PreviewProgress {
  value?: number;
  color?: string;
  style?: string;
  /** Segmented bars: "layered" renders the Live Activity's continuous
   * bar; absent/"split" is the capsule row. Widgets always render split
   * on-device, whatever this says. */
  display?: string;
  segments?: PreviewSegment[];
}

export interface PreviewRow {
  label?: string;
  value?: PreviewValue;
  icon?: IconSpec;
}

export interface PreviewDevice {
  name?: string;
  level?: number;
  charging?: boolean;
  color?: string;
  icon?: IconSpec;
}

/** One switchboard tile (Aivi's `Action`): a bare SF Symbol name, a
 * label, and the state the fill paints: `on` for a toggle, `active` for
 * a button that is highlighted (a running script). */
export interface PreviewAction {
  id?: string;
  label?: string;
  icon?: string;
  kind?: string;
  on?: boolean;
  active?: boolean;
  /** A palette name or `#RRGGBB` (Aivi's action color). */
  color?: string;
  subtitle?: PreviewValue;
  /** 2 to 3 stops, palette names or `#RRGGBB`. */
  gradient?: string[];
  image?: { url: string; alt?: string };
  /** The tile's own state words; a missing key keeps the app's word,
   * `""` hides it. */
  state_text?: Record<string, string>;
}

/** A budget line (Aivi's `BudgetEntry`): amounts are decimal strings. */
export interface PreviewBudgetEntry {
  spent?: string | number;
  budget?: string | number;
  label?: string;
  icon?: IconSpec;
  color?: string;
}

export interface PreviewPriceEntry {
  start?: string;
  price?: number;
  level?: string;
}

/** One node of the energy picture: watts, kWh today, charge percent. */
export interface PreviewEnergyNode {
  name?: string;
  power?: number;
  today?: number;
  level?: number;
  icon?: IconSpec;
  color?: string;
}

export interface PreviewColumn {
  header?: string;
  footer?: string;
  value?: PreviewValue;
}

/** A showcase reading (Aivi's `Stat`): a label, a value, a unit drawn
 * after it, a symbol for where it stands alone, and `max` for a gauge. */
export interface PreviewStat {
  label?: string;
  value?: PreviewValue;
  unit?: string;
  icon?: string;
  max?: number;
}

/** A picture by URL (Aivi's `HeroImage` and `Image`): a cut-out
 * (`contain`, the default) or a photo (`cover`). */
export interface PreviewPicture {
  url?: string;
  alt?: string;
  fit?: string;
}

/** A showcase's state mark: a symbol in front of a word. */
export interface PreviewStateMark {
  icon?: IconSpec;
  text?: PreviewValue;
}

/** One loose shape across all templates; each renderer narrows what it reads. */
export interface WidgetContent {
  state?: PreviewValue;
  value?: PreviewValue | number;
  progress?: PreviewProgress;
  end_date?: string;
  target?: string;
  subtitle?: PreviewValue;
  expired_text?: string;
  icon?: IconSpec;
  accent?: string;
  label?: string;
  unit?: string;
  min_value?: number;
  max_value?: number;
  color?: string;
  gradient?: string[];
  rows?: PreviewRow[];
  devices?: PreviewDevice[];
  actions?: PreviewAction[];
  header_left?: PreviewValue;
  header_right?: PreviewValue;
  footer_left?: PreviewValue;
  footer_right?: PreviewValue;
  /** Activity progress: the Dynamic Island compact-trailing slot. */
  compact_value?: PreviewValue;
  left_column?: PreviewColumn;
  right_column?: PreviewColumn;
  /** Activity monitor: which column the island compact-trailing shows
   * ("left" | "right"); the device defaults to right when absent. */
  primary_column?: string;
  total?: PreviewBudgetEntry;
  categories?: PreviewBudgetEntry[];
  currency?: string;
  display?: string;
  points?: number[];
  entries?: PreviewPriceEntry[];
  sources?: PreviewEnergyNode[];
  grid?: PreviewEnergyNode;
  battery?: PreviewEnergyNode;
  home?: PreviewEnergyNode;
  stats?: PreviewStat[];
  image?: PreviewPicture;
  badge?: PreviewPicture;
  reported_at?: string;
  [key: string]: unknown;
}

/** Content size against Aivi's cap ("size" in the aivi/preview result). */
export interface ContentSize {
  bytes: number;
  limit: number;
}

/** Why the content does not resolve ("waiting" in the aivi/preview
 * result, and on a push row that waited): the required field with no
 * value, and what its source reads. */
export interface Waiting {
  /** The field; null when none of `fields` has a value (a group of
   * which one is needed). */
  field: string | null;
  fields: string[];
  entity_id: string | null;
  /** The entity's raw state ("unknown", "unavailable", "abc"),
   * "missing" (no such entity), "empty" (a template renders nothing), or
   * null for a field made of several values. */
  reading: string | null;
}

/** Per-value render feedback for sourced bindings ("fields" in the
 * aivi/preview result), keyed by the value's address: `<key>` and its
 * sub-slots (`<key>__color`), `<key>.<entity id>.<option>` for a selected
 * row's option, `<key>.<index>.<slot>` for a segment (its weight is
 * `source`). "fallback" means the source yields nothing usable, so the
 * stored literal is in effect. */
export interface FieldFeedback {
  status: "ok" | "empty" | "error" | "fallback";
  /** The rendered value, in full (status "ok", and for a template also
   * "empty" and "fallback"). */
  value?: string;
  /** The Jinja error message, verbatim (status "error"). */
  error?: string;
  /** A template's: the kind of value it renders to. */
  kind?: ValueKind;
  /** A list's item count, and its lowest and highest number when every
   * item is a number. */
  items?: number;
  range?: [number, number];
  /** A template's: what the push re-renders it on (absent on an error). */
  listens?: TemplateListens;
  /** A syntax error's line and, where Jinja names a position, column. */
  line?: number;
  column?: number;
  /** A common error the panel words plainly (`field.error-<reason>`),
   * with the words it fills in. */
  reason?: string;
  params?: Record<string, string>;
  /** Entity ids the template names that Home Assistant does not have,
   * each with the closest ids it does have. */
  unknown?: UnknownEntity[];
  /** The most characters the field takes on the wire, when the value is
   * longer: the rest is cut off. */
  limit?: number;
  /** An entity, attribute or bands source that does not resolve: what
   * it reads (the raw state, "missing" or "empty"). */
  reading?: string;
}

export type ValueKind = "text" | "number" | "bool" | "list" | "nothing";

/** Home Assistant's template tracking for one template: the entities and
 * whole domains it reads, every state (`all`), the clock (`time`, the
 * start of every minute), and the least seconds between re-renders a
 * domain or every-state listener allows. */
export interface TemplateListens {
  entities: string[];
  domains: string[];
  all: boolean;
  time: boolean;
  rate_limit?: number;
}

export interface UnknownEntity {
  id: string;
  suggestions: string[];
}
