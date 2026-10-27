// The Gauge widget's preview, matched to the app's Gauge template: the
// label over the dial at Small, the full-height dial beside a larger label
// at Medium.

import { COLOR_HEX, colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { RANGE, READING } from "../form-groups";
import { gaugePreviewStyles } from "../styles/preview/gauge";
import type { WidgetContent } from "../types/content";
import { fittedSize, fittedTextSize, textWidth } from "./fit";
import { clamp01, fmt01, glyphFor, heroStyle, heroWeight, rampAt, setSvg } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** The ring's stroke, as the app draws it. */
const LW = 7;
/** Fraction of the circle the dial spans: 270°. */
const SWEEP = 0.75;
/** The built-in cool-to-warm sweep: systemCyan, systemGreen and
 * systemOrange as the dark appearance draws them. */
const BUILTIN = [COLOR_HEX.cyan, COLOR_HEX.green, COLOR_HEX.orange];
/** The content box of both families: the 158 pt canvas inside its 16 pt
 * margins. */
const BOX = 126;
/** The Small dial: the box less the 20 pt name line (subheadline) and
 * the 10 pt the `VStack` leaves under it. */
const SMALL_D = BOX - 20 - 10;
/** The Medium dial takes the full height (`aspectRatio(1, .fit)`). */
const MEDIUM_D = BOX;
/** What Medium leaves the label: the box's width less the dial and the
 * `HStack`'s 20 pt. */
const LABEL_W = 338 - 32 - MEDIUM_D - 20;

/** The ring: the style at 25 % as the track, at full strength up to the
 * value, and the dot riding the stroke's centerline there. The colors
 * run along the 270° (an angular gradient from the arc's start to its
 * end), so a ring of stops is drawn as short segments of the ramp. */
function ring(content: WidgetContent, d: number, frac: number): string {
  const r = (d - LW) / 2,
    c = d / 2;
  const stops = content.color
    ? [colorHex(content.color) ?? "#888"]
    : content.gradient?.length
      ? content.gradient.map((x) => colorHex(x) ?? "#888")
      : BUILTIN;
  // The 90° mouth is centered at the bottom: the arc starts at 135°.
  const pt = (f: number): [number, number] => {
    const a = ((135 + 360 * SWEEP * f) * Math.PI) / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const seg = (f0: number, f1: number, color: string): string => {
    const [x0, y0] = pt(f0),
      [x1, y1] = pt(f1);
    return (
      `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"` +
      ` stroke="${color}" stroke-width="${LW}" fill="none"/>`
    );
  };
  // Round line caps, in the color the gradient has at that end.
  const cap = (f: number): string => {
    const [x, y] = pt(f);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${LW / 2}" fill="${rampAt(stops, f)}"/>`;
  };
  // Segments about 4.5 pt long at either size.
  const n = Math.round((2 * Math.PI * r * SWEEP) / 4.5);
  let track = "",
    value = "";
  for (let i = 0; i < n; i++) {
    const f0 = i / n,
      f1 = (i + 1) / n;
    const col = rampAt(stops, (f0 + f1) / 2);
    track += seg(f0, Math.min(1, f1 + 0.003), col);
    if (f0 < frac) value += seg(f0, Math.min(f1 + 0.003, frac), col);
  }
  track += cap(0) + cap(1);
  // The app never sweeps less than 0.0001, so the low end keeps its cap.
  value += cap(0);
  const [dx, dy] = pt(frac);
  // Segments are opaque and only the group is translucent, so the seams
  // where they overlap don't double up. The dot is the line's width plus
  // 4 pt across, filled with the system background (black in the dark
  // appearance) under a 2 pt primary stroke.
  return (
    `<g opacity="0.25">${track}</g>${value}` +
    `<circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="${(LW + 4) / 2}" fill="#000" stroke="${WP.primary}" stroke-width="2"/>`
  );
}

/** The dial at diameter `d`: the ring around the icon glyph, the hero
 * reading and the quiet bounds line, 2 pt apart, all sized from the
 * diameter. */
function gaugeDial(content: WidgetContent, d: number): HTMLElement {
  const min = content.min_value != null ? content.min_value : 0;
  const max = content.max_value != null ? content.max_value : 1;
  const span = max - min;
  const num = Number(content.value);
  const known = content.value != null && Number.isFinite(num);
  // A degenerate range reads 0, as does a gauge with no number yet (a
  // NaN here would reach the SVG as cx="NaN").
  const frac = span > 0 && known ? clamp01((num - min) / span) : 0;

  // The arc leaves the bottom of its square empty, so the app shifts the
  // whole dial down by half that strip to center what is visible.
  const emptyBelow = d / 2 - ((d - LW) / 2) * Math.SQRT1_2 - LW / 2;
  const dial = h("div", {
    class: "pv-gauge-dial",
    style: `width:${d}px;height:${d}px;transform:translateY(${(emptyBelow / 2).toFixed(2)}px)`,
  });
  setSvg(
    dial,
    `<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">${ring(content, d, frac)}</svg>`,
  );

  // The hero is 26 % of the diameter in a frame 60 % of it wide, and
  // shrinks to 0.6 of its size before it truncates.
  const size = d * 0.26;
  const text = known ? fmt01(num) : "…";
  const unit = content.unit || "";
  // The app appends the unit verbatim (no inserted space) at half size;
  // symbol units (°…, %) are raised toward the cap height and
  // counterweighted by an invisible leading copy so the number stays
  // optically centered in the dial. Word units get neither.
  const trimmed = unit.trim();
  const sym = trimmed.startsWith("°") || trimmed === "%";
  // The unit is measured with the number, twice when its hidden copy is
  // there.
  const width = (px: number): number | null => {
    const number = textWidth(text, px, heroWeight(size));
    if (number === null) return null;
    return number + (unit ? (textWidth(unit, px * 0.5, 400) ?? 0) * (sym ? 2 : 1) : 0);
  };
  const fitted = fittedSize(width, size, d * 0.6, 0.6);
  const hero = h(
    "div",
    {
      class: "pv-hero",
      // The weight is the nominal size's: the shrink scales the set text,
      // which truncates only once it has shrunk as far as it goes.
      style:
        `${heroStyle(size)};font-size:${+fitted.toFixed(2)}px;width:${+(d * 0.6).toFixed(2)}px` +
        (fitted < size && fitted > size * 0.6 ? ";overflow:visible" : ""),
    },
    text,
  );
  if (unit) {
    if (sym)
      hero.prepend(
        h(
          "span",
          {
            style: "font-size:.5em;font-weight:400;visibility:hidden",
            "aria-hidden": "true",
          },
          unit,
        ),
      );
    // The raise is 0.28 of the nominal size and does not shrink with the
    // text, so a shrunk reading carries its unit at the digits' tops.
    hero.append(
      h(
        "span",
        {
          style: `font-size:.5em;font-weight:400;line-height:0${sym ? `;vertical-align:${+(size * 0.28).toFixed(2)}px` : ""}`,
        },
        unit,
      ),
    );
  }
  dial.append(
    h(
      "div",
      { class: "pv-gauge-stack" },
      // The dial icon is always secondary on the device (it never takes
      // the icon's own color), semibold at 11 % of the diameter, 11 pt at
      // least.
      content.icon
        ? h(
            "div",
            {
              class: "pv-gauge-icon",
              style: `font-size:${+Math.max(11, d * 0.11).toFixed(2)}px;font-weight:600;color:${WP.secondary}`,
            },
            glyphFor(content.icon),
          )
        : null,
      hero,
      // "0 – 40": semibold at 8 % of the diameter, 10 pt at least.
      h(
        "div",
        { class: "pv-gauge-bounds", style: `font-size:${+Math.max(10, d * 0.08).toFixed(2)}px` },
        `${fmt01(min)} – ${fmt01(max)}`,
      ),
    ),
  );
  return dial;
}

/** The lines `words` wrap to at `size`, and whether each word fits one. */
function wraps(words: string[], size: number, avail: number): { lines: number; fits: boolean } {
  const space = textWidth(" ", size, 500) ?? 0;
  let lines = 1,
    used = 0,
    fits = true;
  for (const word of words) {
    const w = textWidth(word, size, 500) ?? 0;
    if (w > avail) fits = false;
    if (used && used + space + w > avail) {
      lines++;
      used = w;
    } else used += (used ? space : 0) + w;
  }
  return { lines, fits };
}

/** The Medium label's size: title3 (20 pt), shrunk as far as 0.6 of it
 * when two lines of the column would not hold it otherwise. */
function labelSize(label: string): number {
  const words = label.split(/\s+/).filter(Boolean);
  for (const k of [1, 0.9, 0.8, 0.7]) {
    const { lines, fits } = wraps(words, 20 * k, LABEL_W);
    if (fits && lines <= 2) return 20 * k;
  }
  return 12;
}

/** Small: the name line (the label, else the widget's name) over the
 * dial, which is centered in what is left. */
function small(name: string, content: WidgetContent): HChild[] {
  const label = content.label || name;
  // The name line shrinks to 0.8 of its 15 pt before it truncates.
  const size = fittedTextSize(label, 15, 500, BOX, 0.8);
  return [
    h(
      "div",
      { class: "pv-gauge-head" },
      h(
        "div",
        {
          class: "pv-name",
          "data-slot": "label",
          ...(size < 15
            ? {
                style: `font-size:${+size.toFixed(2)}px${size > 15 * 0.8 ? ";overflow:visible" : ""}`,
              }
            : {}),
        },
        label,
      ),
    ),
    h("div", { class: "pv-grow pv-gauge-area", "data-slot": "dial" }, gaugeDial(content, SMALL_D)),
  ];
}

/** Medium: the dial at full height on the left, its bounds inside as in
 * Small, and the label beside it, centered on the dial, in larger type
 * on at most two lines. */
function medium(name: string, content: WidgetContent): HChild[] {
  const label = content.label || name;
  return [
    h(
      "div",
      { class: "pv-gauge-row" },
      h("div", { class: "pv-gauge-area", "data-slot": "dial" }, gaugeDial(content, MEDIUM_D)),
      h(
        "div",
        { class: "pv-gauge-label", "data-slot": "label", style: `font-size:${labelSize(label)}px` },
        label,
      ),
    ),
  ];
}

const renders: TemplateRenderer = { small, medium };

/** The gauge template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const gauge: WidgetTemplate = {
  ...renders,
  styles: gaugePreviewStyles,
  slots: [
    { id: "label", fields: ["label"] },
    {
      id: "dial",
      fields: ["value", "unit", "min_value", "max_value", "ring", "icon"],
    },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  layout: [READING, RANGE, "label"],
  // The gauge paints no icon chip and tints no text, so its accent lands
  // nowhere.
  unpainted: ["accent"],
};
