// The template metadata that drives the editor form (aivi/templates):
// each template's fields, what they accept, and the palette and
// formatters the form offers.

import type { SlotMeta } from "../value-source";

export interface EntityFilter {
  domain?: string | string[];
  device_class?: string;
  /** Only entities whose state reads as a number. */
  numeric?: boolean;
  /** Entities of this device class are listed first. */
  device_class_first?: string;
}

export interface FieldMeta {
  key: string;
  required?: boolean;
  advanced?: boolean;
  /** Unknown kinds fall back to a plain text input. */
  kind?: string;
  source?: boolean;
  color?: boolean;
  formatter?: boolean;
  template?: boolean;
  filter?: EntityFilter;
  options?: string[];
  colors?: string[];
  max?: number;
  /** Segments fields: the wire's display enum (split | layered).
   * Informational: the panel folds display into the bar mode. */
  displays?: string[];
  track_fills?: string[];
  /** Segments fields: per-segment weights may be sourced (the inline
   * editor offers the Literal/Entity/Attribute/Template switch). */
  sourced_values?: boolean;
  rendering_modes?: string[];
  color_renderings?: string[];
  /** Rows fields: which per-row option keys apply (stored under
   * `<key>__options` as entity_id -> {option: value}). */
  row_options?: string[];
  /** Sourceable values on this field, keyed by the suffix that addresses
   * them: "" is the field itself, "__color" its text color. Mode controls
   * are built from this, so the backend alone decides what is sourceable. */
  slots?: Record<string, SlotMeta>;
  /** Segments fields: the sourceable values inside one segment dict. */
  segment_slots?: Record<string, SlotMeta>;
  /** Rows fields: the sourceable values inside one row's options dict. */
  row_slots?: Record<string, SlotMeta>;
  /** Switchboard rows: the state words a tile takes (row options
   * `state_text_<key>`), by tile kind, and the words a domain gets
   * without being asked. */
  state_text?: StateTextMeta;
  /** Number fields: a stored `<key>__invert` flips the sign. */
  invert?: boolean;
  /** Points fields: the field whose entity's history is charted by
   * default, and the time spans (`<key>__hours`) offered. */
  follows?: string;
  hours?: number[];
  default_hours?: number;
  /** Enum fields that always hold one of their options: this one when
   * nothing is stored, which is how it is stored (the wire's default). */
  default?: string;
  /** Enum fields that steer another field and are not sent. */
  setting?: boolean;
  /** Text fields holding a picture's URL, which Aivi checks as one: https
   * with a host, no spaces, at most 2048 characters. */
  picture?: boolean;
}

export interface StateTextMeta {
  keys: { toggle: string[]; button: string[] };
  /** At most this many characters, after trimming. */
  max: number;
  /** Domains whose tiles are toggles; everything else is a button. */
  toggle_domains: string[];
  /** Domain -> key -> the automatic word. */
  auto: Record<string, Record<string, string>>;
}

/** An input event type a template declares (presses on the phone). */
interface InputMeta {
  type: string;
  /** Recorded types fire the binding's event entity; play-only ones are
   * listed, coalesced, in Recent presses only. */
  recorded: boolean;
}

export interface TemplateMeta {
  slug: string;
  fields: FieldMeta[];
  /** Present for templates whose bindings accept input. */
  inputs?: InputMeta[];
  /** At least one of these fields must be bound to save. */
  requires_any?: string[];
}

export interface Meta {
  templates: Record<string, TemplateMeta>;
  activity_templates?: Record<string, TemplateMeta>;
  colors: string[];
  formatters: string[];
  /** The states that read as on: a Live Activity runs while its active
   * entity reads one (compared trimmed and lower-cased). */
  on_states: string[];
}
