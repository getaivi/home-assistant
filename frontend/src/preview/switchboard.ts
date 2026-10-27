// The Switchboard widget's preview, matched to the app's Switchboard
// template.
//
// The app lays the grid out and draws each tile the same way: a round
// mark (the orb) that says what the press does, on a plate that says
// state. The preview draws the settled states a payload can carry (off,
// on, a button idle or active). What a press is waiting for (turning on
// or off, sent, no response) only exists on the device, and so do the
// pictures, which the device fetches: a tile with one keeps the mark the
// device falls back to (its gradient, else its icon).

import { colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { t } from "../i18n";
import { switchboardPreviewStyles } from "../styles/preview/switchboard";
import type { PreviewAction, WidgetContent } from "../types/content";
import { fittedSize, textWidth } from "./fit";
import { glyphFor, valueText } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** How a family lays its tiles out: the grid, the orb's diameter, and
 * whether a tile has a second line. `tile` is a tile's size in points on
 * the 6.1" iPhone's canvas: 16 pt margins leave 126 pt of height and 126
 * or 306 pt of width, less the 6 pt gutters. */
export interface TileLayout {
  columns: number;
  rows: number;
  arrangement: "stacked" | "row";
  orb: number;
  tile: { w: number; h: number };
}

const SMALL: TileLayout = {
  columns: 2,
  rows: 2,
  arrangement: "stacked",
  orb: 30,
  tile: { w: 60, h: 60 },
};
const MEDIUM: TileLayout = {
  columns: 2,
  rows: 3,
  arrangement: "row",
  orb: 26,
  tile: { w: 150, h: 38 },
};

/** A remote's marked button in Small and Medium: a stacked tile with a
 * 24 pt orb, 50 pt tall, in one row. */
export const STACKED_TILE: TileLayout = {
  columns: 1,
  rows: 1,
  arrangement: "stacked",
  orb: 24,
  tile: { w: 60, h: 50 },
};

/** The room a stacked tile's label has: the tile less 4 pt a side. */
const STACKED_LABEL_WIDTH = SMALL.tile.w - 8;
/** The room a row tile's text has: the tile less 9 pt a side, the orb and
 * the 8 pt between the orb and the text. */
const ROW_TEXT_WIDTH = MEDIUM.tile.w - 18 - MEDIUM.orb - 8;

/** A stacked tile's label: caption2 (11) semibold. */
const STACKED_LABEL_SIZE = 11;

/** The ink the app writes on a filled tile when its fill is pale
 * (red, green, blue: 0.11, 0.11, 0.12). */
export const DARK_INK = "#1c1c1f";

/** A color as the wire writes one that is not a palette name: six hex
 * digits. */
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The colors a tile's mark is made of: its gradient (2 stops at least,
 * the first 3 at most), else its one color, else the widget accent.
 * Palette names resolve and six-digit hex stays as it is; anything else
 * is taken as the accent, so only those two forms reach a style. */
export function tileColors(tile: PreviewAction, accent: string): string[] {
  const hex = (c: string): string => colorHex(c) ?? (HEX.test(c) ? c : accent);
  const stops = (tile.gradient ?? []).map(hex);
  if (stops.length >= 2) return stops.slice(0, 3);
  return [tile.color ? hex(tile.color) : accent];
}

/** Whether text on a fill of these colors should be dark: their mean
 * relative luminance (linear sRGB) above 0.4, the app's threshold. A
 * color that isn't `#RRGGBB` counts as dark. */
export function prefersDarkInk(colors: string[]): boolean {
  const linear = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = colors.map((color) => {
    const m = HEX.exec(color);
    if (!m) return 0;
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => linear(parseInt(x ?? "0", 16)));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  });
  return lum.length > 0 && lum.reduce((a, b) => a + b, 0) / lum.length > 0.4;
}

/** The CSS angle of a fill that runs along a tile's own diagonal, from
 * its bottom trailing corner to its top leading one, as the app's does
 * (startPoint: .bottomTrailing, endPoint: .topLeading). CSS's `to top
 * left` is only that on a square: on a wide tile it runs nearly top to
 * bottom, where the app's runs nearly side to side. */
export function fillAngle(width: number, height: number): string {
  const deg = (Math.atan2(-width, height) * 180) / Math.PI;
  return `${+(deg + 360).toFixed(1)}deg`;
}

/** The size a stacked tile's label is drawn at: the small family's
 * narrow tiles shrink a long label until it fits, to 0.8 of caption2's
 * 11 pt at most (minimumScaleFactor), before it truncates. `width` is
 * the label's width at a size. */
export function stackedLabelSize(width: (size: number) => number | null): number {
  return fittedSize(width, STACKED_LABEL_SIZE, STACKED_LABEL_WIDTH, 0.8);
}

/** The state a settled tile's word names. */
type StateKey = "on" | "off" | "active" | "idle";

/** The state word: the tile's own for the state when it has one (`""`
 * hides it), else the app's, which an idle button has none of. */
function stateWord(tile: PreviewAction, key: StateKey): string {
  const own = tile.state_text?.[key];
  if (own !== undefined) return own.trim();
  return key === "idle" ? "" : t(`preview.tile-${key}`);
}

/** A tile's second line, composed as the app does: the state word and
 * the subtitle joined when both are there and fit, the word alone when
 * they do not; otherwise whichever is there. An off toggle says only its
 * word. `fits` answers whether a line fits beside the orb; where text
 * cannot be measured it is taken to fit, and the line then truncates. */
export function tileSecondLine(
  tile: PreviewAction,
  fits: (line: string) => boolean = () => true,
): string {
  const toggle = tile.kind === "toggle";
  const lit = toggle ? !!tile.on : !!tile.active;
  const key: StateKey = toggle ? (lit ? "on" : "off") : lit ? "active" : "idle";
  const word = stateWord(tile, key);
  const subtitle = valueText(tile.subtitle) ?? "";
  if (!word) return subtitle;
  if (!subtitle || key === "off") return word;
  const both = `${word} · ${subtitle}`;
  return fits(both) ? both : word;
}

/** The orb. A gradient mark is the gradient alone, from the top leading
 * corner, under a soft highlight up and left; an
 * icon mark the glyph in white on the tile's color. An off toggle's is
 * muted: a quaternary disc, with the glyph in secondary for an icon mark
 * and nothing for a gradient. On a lit tile the orb lifts off the fill
 * with a shadow in the fill's own hue (its last color, 60 % toward
 * black), stronger on a deep fill than on a pale one. */
function tileOrb(
  tile: PreviewAction,
  colors: string[],
  layout: TileLayout,
  state: { lit: boolean; muted: boolean; pale: boolean },
): HTMLElement {
  const gradient = colors.length >= 2;
  const size = `width:${layout.orb}px;height:${layout.orb}px`;
  // The glyph is 0.46 of the orb, semibold.
  const glyph = `font-size:${+(layout.orb * 0.46).toFixed(2)}px`;
  let paint: string;
  if (state.muted) {
    paint = `background:${WP.quaternary};color:${WP.secondary}`;
  } else if (gradient) {
    paint = `background:linear-gradient(135deg, ${colors.join(", ")})`;
  } else {
    paint = `background:${colors[0] ?? ""}`;
  }
  const last = colors[colors.length - 1] ?? "";
  // SwiftUI's shadow radius is the blur's sigma; CSS's blur is twice it.
  const shadow = state.lit
    ? `;box-shadow:0 2.5px 14px color-mix(in srgb, color-mix(in oklab, ${last} 40%, #000) ${state.pale ? 45 : 55}%, transparent)`
    : "";
  return h(
    "span",
    {
      class: `pv-switchboard-orb${tile.image ? " has-picture" : ""}`,
      style: `${size};${glyph};${paint}${shadow}`,
    },
    gradient
      ? // The sheen: white at 0.28 fading out over 0.55 of the orb.
        state.muted
        ? null
        : h("span", {
            class: "pv-switchboard-sheen",
            style: `background:radial-gradient(circle ${+(layout.orb * 0.55).toFixed(2)}px at 30% 25%, rgba(255,255,255,.28), rgba(255,255,255,0))`,
          })
      : glyphFor(tile.icon ?? ""),
  );
}

/** One tile. The plate is neutral (quaternary) when off or idle and
 * fills with the mark's colors when on or active, running the
 * opposite way to the orb's; text on a fill is white, or dark on a pale
 * one, and the second line a step fainter. Elsewhere the label is primary
 * and the second line secondary. The plate is exposed as a single
 * accessible unit ("Porch light, on"). */
export function actionTile(tile: PreviewAction, accent: string, layout: TileLayout): HTMLElement {
  const toggle = tile.kind === "toggle";
  const lit = toggle ? !!tile.on : !!tile.active;
  const muted = toggle && !lit;
  const colors = tileColors(tile, accent);
  const pale = lit && prefersDarkInk(colors);
  const ink = lit ? (pale ? DARK_INK : "#fff") : null;
  const fill =
    colors.length >= 2
      ? `linear-gradient(${fillAngle(layout.tile.w, layout.tile.h)}, ${colors.join(", ")})`
      : (colors[0] ?? accent);
  const state = toggle ? (lit ? "on" : "off") : lit ? "active" : "";
  const row = layout.arrangement === "row";
  const plate = h("div", {
    class: `pv-switchboard-tile${row ? " is-row" : ""} ${lit ? "is-on" : "is-off"}`,
    style: `background:${lit ? fill : WP.quaternary}${ink ? `;color:${ink}` : ""}`,
    "data-action": tile.id ?? "",
    role: "img",
    "aria-label": state ? `${tile.label ?? ""}, ${state}` : (tile.label ?? ""),
  });
  const orb = tileOrb(tile, colors, layout, { lit, muted, pale });
  const label = tile.label ?? "";
  if (!row) {
    // Stacked: the orb over the label, which shrinks before it truncates.
    const size = stackedLabelSize((px) => textWidth(label, px, 600));
    plate.append(
      orb,
      h(
        "span",
        {
          class: "pv-switchboard-label",
          style: size < STACKED_LABEL_SIZE ? `font-size:${size}px` : null,
        },
        label,
      ),
    );
    return plate;
  }
  const second = tileSecondLine(tile, (line) => {
    // A row tile's second line: caption2 (11) regular.
    const width = textWidth(line, 11, 400);
    return width === null || width <= ROW_TEXT_WIDTH;
  });
  // The ink at 0.72 on a pale fill and 0.82 on a deep one.
  const secondInk = ink ? (pale ? "rgba(28,28,31,.72)" : "rgba(255,255,255,.82)") : WP.secondary;
  plate.append(
    orb,
    h(
      "span",
      { class: "pv-switchboard-text" },
      h("span", { class: "pv-switchboard-label" }, label),
      // The line keeps its height when blank, so labels stay aligned.
      h("span", { class: "pv-switchboard-second", style: `color:${secondInk}` }, second || " "),
    ),
  );
  return plate;
}

/** The fixed grid: the first actions in the publisher's order, as many
 * as the family holds, and a quiet plate for every empty slot so a short
 * list keeps the anatomy. No name at these sizes; the grid is the region
 * that owns the actions. */
function grid(content: WidgetContent, accent: string, layout: TileLayout): HChild[] {
  const capacity = layout.columns * layout.rows;
  const tiles = (content.actions ?? []).slice(0, capacity);
  return [
    h(
      "div",
      {
        class: `pv-switchboard-grid${layout.rows === 3 ? " is-three-rows" : ""}`,
        "data-slot": "grid",
      },
      Array.from({ length: capacity }, (_, i) => {
        const tile = tiles[i];
        return tile
          ? actionTile(tile, accent, layout)
          : h("div", {
              class: "pv-switchboard-tile is-off is-empty",
              style: `background:${WP.quaternary}`,
            });
      }),
    ),
  ];
}

const renders: TemplateRenderer = {
  // Small: a 2×2 of 30 pt orbs over labels, no second line.
  small: (_name, content, accent) => grid(content, accent, SMALL),
  // Medium: a 2×3 of 26 pt orbs beside a label and a second line.
  medium: (_name, content, accent) => grid(content, accent, MEDIUM),
};

/** The switchboard template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const switchboard: WidgetTemplate = {
  ...renders,
  styles: switchboardPreviewStyles,
  // The accent paints every lit tile that sets no color of its own, so
  // it lists with the grid; the small family draws no icon chip.
  slots: [
    { id: "grid", fields: ["actions", "accent"] },
    { id: "global", fields: ["icon", "tap_url"], global: true },
  ],
  layout: ["actions"],
};
