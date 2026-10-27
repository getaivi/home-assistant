// What one template's preview module provides.

import type { CSSResult } from "lit";
import type { HChild } from "../dom";
import type { Entry } from "../form-groups";
import type { Slot } from "../slots";
import type { WidgetContent } from "../types/content";

/** The children of the widget canvas at one family's size: `name` is the
 * widget's name, `accent` the resolved accent color. */
type FamilyRenderer = (name: string, content: WidgetContent, accent: string) => HChild[];

/** A template's renders, one per family the preview draws. */
export interface TemplateRenderer {
  small: FamilyRenderer;
  medium: FamilyRenderer;
}

/** Everything the panel knows about one widget template, in its preview
 * module: adding a template is that module plus one line in
 * templates.ts. */
export interface WidgetTemplate extends TemplateRenderer {
  /** The template's preview stylesheet, after the shared one. */
  styles: CSSResult;
  /** The regions its fields paint, in form order (see slots.ts). */
  slots: readonly Slot[];
  /** The form's order and groups (see layout.ts). */
  layout: readonly Entry[];
  /** Fields its layout gives no region at all, left out of the form. */
  unpainted?: readonly string[];
  /** Fields of a styling kind (an icon, a color) that belong with what
   * the widget shows rather than under Appearance: a state mark's
   * symbol is part of the mark. */
  content?: readonly string[];
}
