// The Battery widget's preview, matched to the app's Battery template:
// Apple's Batteries idiom, a level ring per device with its icon inside.
// Neither size shows the widget's name or a device's name; only Medium
// shows the percentages.

import { COLOR_HEX, colorHex, WP } from "../const";
import { h } from "../dom";
import { batteryPreviewStyles } from "../styles/preview/battery";
import type { PreviewDevice } from "../types/content";
import { glyphFor, setSvg } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** Both sizes draw the ring at 50 pt and show the first four devices. */
const SIZE = 50;
const SLOTS = [0, 1, 2, 3] as const;
/** The ring's line: 9 % of its size, 3.5 pt at least (4.5 pt here). */
const LINE = Math.max(3.5, SIZE * 0.09);

/** The charging bolt (bolt.fill at 26 % of the ring's size, bold: 13 pt,
 * about 10 × 15 pt), around its own center. Drawn half a point inside its
 * outline and stroked back out, for the symbol's rounded corners. */
const BOLT = "M1.5-7-4.4.5H-.9L-2.2 7h.7L4.4-.5H.9L2.2-7z";
const BOLT_EDGE = 1;
/** How far the knockout around the bolt reaches past its outline: 4 % of
 * the ring's size, 1.5 pt at least (2 pt here). */
const KNOCKOUT = Math.max(1.5, SIZE * 0.04);

/** Each charging ring's knockout is a mask of its own, and a mask is
 * found by id. */
let masks = 0;

/** The color rule for a ring: the device's own color first, else red
 * when low (20 % or less) and not charging, green otherwise. */
function batteryColor(dev: PreviewDevice): string {
  return (
    colorHex(dev.color) ??
    (dev.level != null && dev.level <= 20 && !dev.charging ? COLOR_HEX.red : COLOR_HEX.green)
  );
}

/** A device's level ring: a quaternary track and the level's arc from
 * 12 o'clock with round ends, both centered on the frame's edge, so the
 * ring overhangs its 50 pt box by half a line. The icon sits inside in
 * secondary whatever its own color (the ring carries the color). When
 * charging, the bolt rides the ring at 12 o'clock in the ring's color,
 * inside a knockout of its own silhouette that erases the ring under it,
 * so the background shows through as its outline. A device with no level
 * yet (the app requires one) keeps its track and icon, without an arc. */
function batteryRing(dev: PreviewDevice): HTMLElement {
  const r = SIZE / 2,
    circ = 2 * Math.PI * r;
  const color = batteryColor(dev);
  // The app trims the arc to 0.001 at least, so an empty battery still
  // shows the dot of its round ends.
  const frac = dev.level == null ? null : Math.max(0.001, Math.min(1, dev.level / 100));
  // The glyph's center sits on the ring's path at 12 o'clock; the shape
  // itself rides a hair low in its box.
  const bolt = `<path d="${BOLT}" transform="translate(${r} .3)" stroke-linejoin="round"`;
  const mask = dev.charging ? `pv-battery-knockout-${++masks}` : null;
  const ring = h("div", { class: "pv-battery-ring" });
  setSvg(
    ring,
    `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
      (mask
        ? `<mask id="${mask}" maskUnits="userSpaceOnUse" x="-10" y="-15" width="${SIZE + 20}" height="${SIZE + 30}">` +
          `<rect x="-10" y="-15" width="${SIZE + 20}" height="${SIZE + 30}" fill="#fff"/>` +
          `${bolt} fill="#000" stroke="#000" stroke-width="${BOLT_EDGE + 2 * KNOCKOUT}"/></mask>`
        : "") +
      `<g fill="none" stroke-width="${LINE}"${mask ? ` mask="url(#${mask})"` : ""}>` +
      `<circle cx="${r}" cy="${r}" r="${r}" stroke="${WP.quaternary}"/>` +
      (frac === null
        ? ""
        : `<circle class="pv-battery-arc" cx="${r}" cy="${r}" r="${r}" stroke="${color}" stroke-linecap="round"` +
          ` stroke-dasharray="${(circ * frac).toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${r} ${r})"/>`) +
      "</g>" +
      (mask
        ? `${bolt} class="pv-battery-bolt" fill="${color}" stroke="${color}" stroke-width="${BOLT_EDGE}"/>`
        : "") +
      "</svg>",
  );
  if (dev.icon)
    ring.append(
      h("div", { class: "pv-battery-glyph", style: `color:${WP.secondary}` }, glyphFor(dev.icon)),
    );
  return ring;
}

/** The quiet stand-in for a slot with no device: a quaternary ring of
 * the same line, drawn inside the 50 pt frame (SwiftUI's `strokeBorder`),
 * so it is half a line smaller than a device's ring all round. */
function placeholderRing(): HTMLElement {
  return h("div", {
    class: "pv-battery-placeholder",
    style: `border:${LINE}px solid ${WP.quaternary}`,
  });
}

const renders: TemplateRenderer = {
  // Small: a fixed 2×2 grid, two rows sharing the height 10 pt apart,
  // each a centered pair of rings 18 pt apart. A slot with no device keeps
  // a placeholder ring, so a short list fills from the top-leading corner.
  small: (_name, content) => {
    const devs = (content.devices ?? []).slice(0, 4);
    const ring = (i: number): HTMLElement => {
      const dev = devs[i];
      return dev ? batteryRing(dev) : placeholderRing();
    };
    return [
      h(
        "div",
        { class: "pv-battery-grid", "data-slot": "grid" },
        [0, 2].map((start) => h("div", { class: "pv-battery-row" }, ring(start), ring(start + 1))),
      ),
    ];
  },
  // Medium: four fixed columns sharing the width, each a ring with the
  // rounded percent 10 pt below it (subheadline, primary), the row centered
  // on the canvas. A column with no device keeps a placeholder ring over
  // a hidden percent, so every ring stays on the same line.
  medium: (_name, content) => {
    const devs = (content.devices ?? []).slice(0, 4);
    return [
      h(
        "div",
        { class: "pv-cols pv-battery-cols", "data-slot": "grid" },
        SLOTS.map((i) => {
          const dev = devs[i];
          const level = dev?.level;
          return h(
            "div",
            { class: "pv-col" },
            dev ? batteryRing(dev) : placeholderRing(),
            h(
              "div",
              {
                class: "pv-col-value pv-battery-percent",
                style: level == null ? "visibility:hidden" : "",
              },
              `${Math.round(level ?? 0)}%`,
            ),
          );
        }),
      ),
    ];
  },
};

/** The battery template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const battery: WidgetTemplate = {
  ...renders,
  styles: batteryPreviewStyles,
  slots: [
    { id: "grid", fields: ["devices"] },
    { id: "global", fields: ["icon", "accent", "tap_url"], global: true },
  ],
  layout: ["devices"],
};
