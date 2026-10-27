// The Status widget's preview, matched to the app's Status template:
// icon chip, name, hero reading, accent state line.

import { WP } from "../const";
import { type HChild, h } from "../dom";
import { statusPreviewStyles } from "../styles/preview/status";
import type { WidgetContent } from "../types/content";
import { fitted } from "./fit";
import { ghost, glyphFor, nameLabel, valueColor, valueText } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** The icon chip: the glyph at half the chip's size in the tint, on the
 * tint at 16 %. The app draws no chip without an icon; the preview keeps
 * a placeholder there so the icon stays reachable. */
function chip(content: WidgetContent, accent: string, size: number): HTMLElement {
  const box = `width:${size}px;height:${size}px`;
  if (!content.icon) {
    const empty = ghost("icon", "icon", "is-dark is-chip");
    empty.style.cssText = box;
    return empty;
  }
  return h(
    "div",
    {
      class: "pv-chip",
      "data-slot": "icon",
      style: `${box};font-size:${size * 0.5}px;background:color-mix(in srgb, ${accent} 16%, transparent);color:${accent}`,
    },
    glyphFor(content.icon),
  );
}

/** The hero and the line under it. The hero is the value when there is
 * one (the state then moves to the line below), else the state. With
 * neither there is nothing to show yet (the state is required, so a
 * widget that resolves always has one): the hero is a placeholder, as
 * the caption above the preview says, never the name a second time.
 * Both hero sizes are Light (a hero is Light from 34 pt), and the hero
 * scales down to 60 % before it truncates. */
function reading(content: WidgetContent, accent: string, size: number): HChild[] {
  const value = valueText(content.value);
  const state = valueText(content.state);
  if (!value && !state) return [ghost("hero", "state", "is-dark")];
  // The hero takes its own value's color, else primary; never the tint.
  const color = (value ? valueColor(content.value) : valueColor(content.state)) ?? WP.primary;
  return [
    fitted(
      h(
        "div",
        {
          class: "pv-hero pv-status-hero",
          "data-slot": "hero",
          style: `font-size:${size}px;font-weight:300;color:${color}`,
        },
        value || state,
      ),
      size,
      0.6,
    ),
    // No placeholder when this is empty: the line is only where `state`
    // moves once `value` is bound, and `state` is already reachable
    // through the hero, which always paints. A dashed "State" box under
    // a hero that is showing the state would name a field the user had
    // already set.
    value && state
      ? h(
          "div",
          {
            class: "pv-state pv-status-state",
            "data-slot": "caption",
            // The state's own color, else the widget's tint.
            style: `color:${valueColor(content.state) ?? accent}`,
          },
          state,
        )
      : null,
  ];
}

const renders: TemplateRenderer = {
  // Small: the 28 pt chip top-left, then name, 40 pt hero and state line
  // pinned to the bottom, 2 pt apart.
  small: (name, content, accent) => [
    h(
      "div",
      { class: "pv-status-box" },
      h("div", { class: "pv-status-top" }, chip(content, accent, 28)),
      h("div", { class: "pv-grow" }),
      nameLabel(name, "pv-status-name"),
      ...reading(content, accent, 40),
    ),
  ],
  // Medium: the name top-left with the 44 pt hero and the state line
  // pinned to the bottom under it, and a 44 pt chip top-right. The text
  // column keeps 32 pt clear of the chip (the stack's 16 pt spacing on
  // either side of its spacer).
  medium: (name, content, accent) => [
    h(
      "div",
      { class: `pv-status-box pv-status-row${content.icon ? "" : " is-iconless"}` },
      h(
        "div",
        { class: "pv-status-col" },
        nameLabel(name, "pv-status-name"),
        h("div", { class: "pv-grow" }),
        ...reading(content, accent, 44),
      ),
      chip(content, accent, 44),
    ),
  ],
};

/** The status template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const status: WidgetTemplate = {
  ...renders,
  styles: statusPreviewStyles,
  slots: [
    // `state` first: the hero prefers `value` when both are bound, but
    // `state` is the required field and the one a person sets first.
    { id: "hero", fields: ["state", "value"] },
    { id: "caption", fields: ["state"] },
    { id: "icon", fields: ["icon", "accent"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  layout: ["state", "value"],
};
