// The Remote widget's preview, matched to the app's Remote template: a
// picture of the thing, one big reading and the buttons that work it.
// Small leads with the name and the reading, the picture beside it, two
// buttons along the foot; Medium is the showcase's medium (the picture
// bottom-leading, the reading trailing) over one row of up to five
// buttons. A photo (`fit: cover`) fills Small and bleeds into Medium's
// leading 44 %, down to the buttons. The stats wait for the Large size.
//
// The buttons are plain (the action's glyph on a quiet plate, filled
// when on or active) unless any action carries a mark (a picture, a
// gradient or a color): then every one is the switchboard's tile,
// stacked, with its label. What a press is waiting for only exists on the
// device, as on the switchboard.

import { colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { remotePreviewStyles } from "../styles/preview/remote";
import type { PreviewAction, PreviewValue, WidgetContent } from "../types/content";
import { fitted } from "./fit";
import { ghost, glyphFor, heroWeight } from "./kit";
import { cutOut, header, isNumericReading, isPhoto, photo, relativeWords } from "./showcase";
import { actionTile, DARK_INK, prefersDarkInk, STACKED_TILE, tileColors } from "./switchboard";
import type { TemplateRenderer, WidgetTemplate } from "./types";

type Family = "small" | "medium";

/** How many buttons a family shows; Medium shows four once they carry
 * marks (and so labels). The rest wait for a larger size. */
function capacity(family: Family, marked: boolean): number {
  return family === "small" ? 2 : marked ? 4 : 5;
}

/** Whether the actions carry marks: then all of them are tiles. */
export function isMarked(actions: readonly PreviewAction[]): boolean {
  return actions.some((a) => !!(a.image || a.gradient?.length || a.color));
}

/** The hero's size: Small 28, Medium 34, 30 over marked buttons. */
function heroSize(family: Family, marked: boolean): number {
  return family === "small" ? 28 : marked ? 30 : 34;
}

/** A reading's number and a unit of up to six characters after it ("78%"
 * is 78 and %, "1 150 kWh" is 1 150 and kWh); null for anything else (a
 * word, a bare number, a time). */
export function splitUnit(
  value: PreviewValue | undefined,
): { number: string; separator: string; unit: string } | null {
  if (value?.formatter && value.formatter !== "none") return null;
  const m = /^([+\-−]?\d[\d.,]*(?:[   ]\d{3})*)(\s?)([^\d\s][^\d]{0,5})$/u.exec(
    String(value?.value ?? "").trim(),
  );
  return m ? { number: m[1] ?? "", separator: m[2] ?? "", unit: m[3] ?? "" } : null;
}

/** Whether the reading takes the numeric hero: a number (the showcase's
 * rule), or a number with a short unit after it ("7.4 kW"). */
export function isNumericValue(value: PreviewValue | undefined): boolean {
  return isNumericReading({ value: value ?? {} }) || splitUnit(value) !== null;
}

/** The reading: a number in the hero voice (a unit after it at half the
 * size), words (Closed, "2h ago") semibold at 0.72 of it, in the
 * reading's own color, else `fill`. */
function reading(content: WidgetContent, size: number, fill: string): HTMLElement {
  const value = content.value;
  if (!value || typeof value !== "object" || value.value == null)
    return ghost("value", "value", "pv-remote-ghost");
  const color = colorHex(value.text_color) ?? fill;
  if (isNumericValue(value)) {
    const split = splitUnit(value);
    return fitted(
      h(
        "span",
        {
          class: "pv-showcase-hero",
          "data-slot": "value",
          style: `font-size:${size}px;font-weight:${heroWeight(size)};color:${color}`,
        },
        split ? split.number : String(value.value),
        split
          ? h("span", { style: "font-size:.5em;font-weight:400" }, split.separator + split.unit)
          : null,
      ),
      size,
      0.6,
    );
  }
  const word = Math.round(size * 0.72);
  return fitted(
    h(
      "span",
      {
        class: "pv-showcase-hero is-word",
        "data-slot": "value",
        style: `font-size:${word}px;font-weight:600;color:${color}`,
      },
      relativeWords(value) ?? String(value.value),
    ),
    word,
    0.6,
  );
}

/** A plain button: the glyph at 16 pt on a quiet plate, the plate filled
 * with the action's color (else the tint) when on or active, the glyph
 * dark on a pale fill; an off toggle's glyph is secondary. */
function plainButton(action: PreviewAction, accent: string): HTMLElement {
  const toggle = action.kind === "toggle";
  const lit = toggle ? !!action.on : !!action.active;
  const fill = tileColors({ ...action, gradient: [] }, accent)[0] ?? accent;
  const ink = lit
    ? prefersDarkInk([fill])
      ? DARK_INK
      : "#fff"
    : toggle
      ? WP.secondary
      : WP.primary;
  const state = toggle ? (lit ? "on" : "off") : lit ? "active" : "";
  return h(
    "div",
    {
      class: "pv-remote-button",
      style: `background:${lit ? fill : WP.quaternary};color:${ink}`,
      "data-action": action.id ?? "",
      role: "img",
      "aria-label": state ? `${action.label ?? ""}, ${state}` : (action.label ?? ""),
    },
    glyphFor(action.icon ?? ""),
  );
}

/** The buttons along the foot, sharing the row 6 pt apart: plain at 36
 * (Small) or 40 (Medium) tall, tiles at 50. */
function buttons(content: WidgetContent, accent: string, family: Family): HTMLElement {
  const actions = content.actions ?? [];
  const marked = isMarked(actions);
  const shown = actions.slice(0, capacity(family, marked));
  return h(
    "div",
    {
      class: `pv-remote-buttons is-${marked ? "marked" : family}`,
      "data-slot": "actions",
    },
    shown.length
      ? shown.map((a) => (marked ? actionTile(a, accent, STACKED_TILE) : plainButton(a, accent)))
      : ghost("actions", "actions", "is-grow"),
  );
}

/** The picture's slot when it is not a photo: the cut-out, or the icon
 * standing in; nothing (a placeholder while editing) without either. */
function picture(content: WidgetContent, accent: string, standIn: number): HTMLElement {
  return cutOut(content, accent, standIn);
}

function name(text: string, size: number): HTMLElement {
  return fitted(
    h("div", { class: `pv-showcase-name${size > 15 ? " is-headline" : ""}` }, text),
    size,
    0.8,
  );
}

function small(title: string, content: WidgetContent, accent: string): HChild[] {
  const marked = isMarked(content.actions ?? []);
  const size = heroSize("small", marked);
  if (isPhoto(content) && content.image)
    return [
      photo(content.image, "is-fill is-remote"),
      h(
        "div",
        { class: "pv-remote-onphoto", "data-slot": "header" },
        name(title, 15),
        h("div", { class: "pv-grow" }),
        reading(content, size, "#fff"),
      ),
      h("div", { class: "pv-grow" }),
      buttons(content, accent, "small"),
    ];
  return [
    h("div", { "data-slot": "header" }, name(title, 15)),
    h(
      "div",
      { class: "pv-remote-zone" },
      reading(content, size, WP.primary),
      h("div", { class: "pv-remote-slot" }, picture(content, accent, 40)),
    ),
    buttons(content, accent, "small"),
  ];
}

function medium(title: string, content: WidgetContent, accent: string): HChild[] {
  const marked = isMarked(content.actions ?? []);
  const size = heroSize("medium", marked);
  if (isPhoto(content) && content.image)
    return [
      h(
        "div",
        { class: "pv-remote-beside" },
        photo(content.image, "is-bled"),
        header(title, content, true),
        h("div", { class: "pv-grow" }),
        reading(content, size, WP.primary),
      ),
      buttons(content, accent, "medium"),
    ];
  return [
    h(
      "div",
      { class: "pv-remote-top" },
      header(title, content),
      h(
        "div",
        { class: "pv-remote-bottom" },
        h("div", { class: "pv-showcase-slot" }, picture(content, accent, 44)),
        reading(content, size, WP.primary),
      ),
    ),
    buttons(content, accent, "medium"),
  ];
}

const renders: TemplateRenderer = { small, medium };

/** The remote template as the panel knows it: renders, styles, the
 * regions the form's fields paint (slots.ts) and the form's order
 * (layout.ts). */
export const remote: WidgetTemplate = {
  ...renders,
  styles: remotePreviewStyles,
  slots: [
    { id: "picture", fields: ["image", "image_fit", "image_alt", "icon"] },
    { id: "header", fields: ["reported_at"] },
    // The stats show under the reading from the Large size up, which the
    // preview does not draw: the reading is their region here.
    { id: "value", fields: ["value", "stats"] },
    // The accent fills a lit button that sets no color of its own.
    { id: "actions", fields: ["actions", "accent"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  layout: [
    { id: "picture", fields: ["image", "image_fit", "image_alt"] },
    "value",
    "actions",
    "stats",
    "reported_at",
  ],
};
