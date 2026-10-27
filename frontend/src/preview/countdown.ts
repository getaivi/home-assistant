// The Countdown widget's preview, matched to the app's Countdown
// template: a target moment as a hero that reads as a ticking timer
// inside the last day and as a relative distance before it, the
// publisher's expired text once passed.

import { h } from "../dom";
import { i18nLocale } from "../i18n";
import { countdownPreviewStyles } from "../styles/preview/countdown";
import type { WidgetContent } from "../types/content";
import { countdownHero } from "../util";
import { fittedTextSize } from "./fit";
import { ghost, glyphFor, heroWeight, valueColor, valueText } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** The content width of each family: the canvas less its 16 pt margins.
 * Beside a chip, Medium's text column also gives up its 44 pt and the
 * `HStack`'s 16 pt spacing on both sides of the `Spacer` between them. */
const SMALL_WIDTH = 158 - 2 * 16;
const MEDIUM_WIDTH = 338 - 2 * 16;
const MEDIUM_CHIP = 2 * 16 + 44;

/** The name line: subheadline (15) medium in secondary, one line,
 * shrinking to 0.8 before it truncates. */
function nameLabel(name: string, avail: number): HTMLElement {
  const size = fittedTextSize(name, 15, 500, avail, 0.8);
  return h(
    "div",
    { class: "pv-name pv-countdown-name", style: size < 15 ? `font-size:${size}px` : null },
    name,
  );
}

/** The icon chip: the symbol at half the chip's size, semibold, in the
 * accent on the accent at 16 %. No icon draws no chip on the device; here
 * its place stays, dashed. */
function chip(content: WidgetContent, accent: string, size: "small" | "large"): HTMLElement {
  if (!content.icon) return ghost("icon", "icon", `is-dark is-chip pv-countdown-chip-${size}`);
  return h(
    "div",
    {
      class: `pv-chip pv-countdown-chip-${size}`,
      "data-slot": "icon",
      style: `background:color-mix(in srgb, ${accent} 16%, transparent);color:${accent}`,
    },
    glyphFor(content.icon),
  );
}

/** The hero at `size`: the weight its size earns (32 Regular, 40 Light),
 * primary, monospaced digits, one line, shrinking to 0.6 before it
 * truncates. The target is required, so a payload without one has no
 * hero to show. */
function hero(content: WidgetContent, size: 32 | 40, avail: number): HTMLElement {
  if (!content.target) return ghost("hero", "target", "is-dark");
  const text = countdownHero(content.target, content.expired_text);
  const weight = heroWeight(size);
  const fitted = fittedTextSize(text, size, weight, avail, 0.6);
  return h(
    "div",
    {
      class: "pv-hero pv-countdown-hero",
      "data-slot": "hero",
      style: `font-size:${fitted}px;font-weight:${weight}`,
    },
    text,
  );
}

/** The line under the hero: the subtitle as a state line, footnote (13)
 * medium in its own color or else the accent. (The app's stale variant,
 * "as of 07:00", needs an age the preview never has.) */
function bottomLine(content: WidgetContent, accent: string): HTMLElement {
  const sub = valueText(content.subtitle);
  return sub
    ? h(
        "div",
        {
          class: "pv-state pv-countdown-state",
          "data-slot": "caption",
          style: `color:${valueColor(content.subtitle) || accent}`,
        },
        sub,
      )
    : ghost("caption", "subtitle", "is-dark");
}

/** The target line: the absolute moment as a meta line, caption (12)
 * medium in tertiary: weekday, month, day, hour and minute in the user's
 * locale ("Thu, Oct 1 at 6:24 PM"). */
function targetLine(target: string): HTMLElement | null {
  const at = Date.parse(target);
  if (Number.isNaN(at)) return null;
  const text = new Intl.DateTimeFormat(i18nLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return h("div", { class: "pv-meta pv-countdown-meta", "data-slot": "hero" }, text);
}

const renders: TemplateRenderer = {
  // The chip alone at the top, then the name, the 32 pt hero and the
  // subtitle pinned to the bottom, each 2 pt under the one above.
  small: (name, content, accent) => [
    h(
      "div",
      { class: "pv-countdown-col" },
      h("div", { class: "pv-countdown-top" }, chip(content, accent, "small")),
      h("div", { class: "pv-grow" }),
      nameLabel(name, SMALL_WIDTH),
      hero(content, 32, SMALL_WIDTH),
      bottomLine(content, accent),
    ),
  ],
  // The name at the top of a leading column whose 40 pt hero, subtitle
  // and target date sit at the bottom; the 44 pt chip at the top right.
  medium: (name, content, accent) => {
    // Without an icon the app gives the text the whole width; only the
    // name makes room for the placeholder that stands in the corner.
    const beside = MEDIUM_WIDTH - MEDIUM_CHIP;
    const width = content.icon ? beside : MEDIUM_WIDTH;
    return [
      h(
        "div",
        { class: content.icon ? "pv-countdown-row" : "pv-countdown-row is-iconless" },
        h(
          "div",
          { class: "pv-countdown-lead" },
          nameLabel(name, beside),
          h("div", { class: "pv-grow" }),
          hero(content, 40, width),
          bottomLine(content, accent),
          content.target ? targetLine(content.target) : null,
        ),
        chip(content, accent, "large"),
      ),
    ];
  },
};

/** The countdown template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const countdown: WidgetTemplate = {
  ...renders,
  styles: countdownPreviewStyles,
  slots: [
    { id: "hero", fields: ["target", "expired_text"] },
    { id: "caption", fields: ["subtitle"] },
    { id: "icon", fields: ["icon", "accent"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  layout: [{ id: "countdown", fields: ["target", "expired_text"] }, "subtitle"],
};
