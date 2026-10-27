// What every template's preview is drawn with: the canvas tokens, the
// regions that press through to the form, the icon stand-in, value text
// and color, and the small shapes several templates share. One module
// per template (preview/<template>.ts) builds on these.

import { colorHex, WP } from "../const";
import { h } from "../dom";
import { i18nLocale } from "../i18n";
import { mdiFor } from "../symbol-icons";
import type { IconSpec, PreviewValue } from "../types/content";
import { formatterTimer, labelFor } from "../util";
import { fitted } from "./fit";

/** A symbol as the preview can draw it: the closest Material icon through
 * Home Assistant's `<ha-icon>`, which takes its size from the font size of
 * whatever holds it and that element's color. That is one color: the
 * preview does not draw a multicolor symbol's layers. The neutral glyph
 * stands in for a symbol nothing approximates, and wherever there is no
 * `<ha-icon>` (outside Home Assistant). */
export function glyphFor(icon: IconSpec): HTMLElement | string {
  const mdi = mdiFor(typeof icon === "string" ? icon : (icon.name ?? ""));
  if (!mdi || !customElements.get("ha-icon")) return "✦";
  return h("ha-icon", { class: "pv-icon", icon: `mdi:${mdi}`, "aria-hidden": "true" });
}

/** Tag a region with the slot that owns it, so a press on it jumps to the
 * fields that produce it. The bars are tagged with this too: they come
 * from segments-bar.ts, which the editor's own bar also uses and which
 * takes no slot id. */
export function slot(el: HTMLElement, id: string): HTMLElement {
  el.setAttribute("data-slot", id);
  return el;
}

/**
 * A placeholder for a region this payload doesn't fill: the one place the
 * preview shows something the device would not. A region that collapsed
 * when empty could only be pressed once configured, so it keeps its
 * rectangle, dashed and labeled with the field that would fill it, and
 * styled as editor chrome so it can't pass for device output.
 */
export function ghost(id: string, key: string, extra = ""): HTMLElement {
  const el = h(
    "div",
    { "data-slot": id, "data-ghost": "", class: `pv-ghost ${extra}`.trim() },
    labelFor(key),
  );
  // A round chip has no room to spare, and the label is a translation of
  // any length: it shrinks from the chip’s 7.5 px (styles/preview.ts), to half.
  return extra.split(" ").includes("is-chip") ? fitted(el, 7.5, 0.5) : el;
}

/** A value held to 0...1. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Draw an SVG into `el` from markup. The markup is parsed as HTML, so
 * what a caller interpolates into it is only ever a number it computed
 * or a color that is not the payload's own text: a palette color
 * (`colorHex`), the accent resolved from one, or a constant. Payload
 * text never goes in. */
export function setSvg(el: HTMLElement, markup: string): void {
  el.innerHTML = markup;
}

export function iconColorHex(icon: IconSpec | undefined): string | undefined {
  if (icon && typeof icon === "object") return colorHex(icon.primary_color);
  return undefined;
}

export function valueText(v: PreviewValue | number | undefined): string | null {
  if (v && typeof v === "object" && v.value != null) {
    const raw = String(v.value);
    // The app's time formatters tick on the device; here they are
    // computed once. An unknown formatter falls back to the raw value.
    if (v.formatter === "time_since" || v.formatter === "time_until")
      return formatterTimer(raw, v.formatter) ?? raw;
    return raw;
  }
  return null;
}

export function valueColor(v: PreviewValue | number | undefined): string | null {
  if (v && typeof v === "object") return colorHex(v.text_color) ?? null;
  return null;
}

/** The weight a hero takes at its nominal size: Light from 34 pt,
 * Regular from 24 pt, else Semibold. */
export function heroWeight(size: number): number {
  return size >= 34 ? 300 : size >= 24 ? 400 : 600;
}

export function heroStyle(size: number): string {
  return `font-size:${size}px;font-weight:${heroWeight(size)}`;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
function lerpColor(a: string, b: string, t: number): string {
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r0, g0, b0] = rgb(a);
  const [r1, g1, b1] = rgb(b);
  return `rgb(${lerpChannel(r0, r1, t)},${lerpChannel(g0, g1, t)},${lerpChannel(b0, b1, t)})`;
}
export function rampAt(stops: string[], f: number): string {
  if (stops.length === 1) return stops[0] ?? "#888";
  const pos = Math.min(0.9999, Math.max(0, f)) * (stops.length - 1);
  const i = Math.floor(pos);
  return lerpColor(stops[i] ?? "#888", stops[i + 1] ?? "#888", pos - i);
}

/** A ring chip, as the Budget template draws one: quaternary track, the
 * fill arc from 12 o'clock, the glyph inside. The stroke (9 % of the
 * size, 3 pt at least) is centered on the frame's edge, so the ring
 * overhangs its box by half a line, as on the device. `frac` null draws
 * no arc. */
export function ringChip(
  frac: number | null,
  color: string,
  size: number,
  glyph: HTMLElement | string | null,
): HTMLElement {
  const lw = Math.max(3, size * 0.09),
    r = size / 2,
    c = size / 2;
  const circ = 2 * Math.PI * r;
  const ring = h("div", {
    style: `position:relative;width:${size}px;height:${size}px;flex:none;border-radius:50%`,
  });
  setSvg(
    ring,
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;overflow:visible">` +
      `<circle cx="${c}" cy="${c}" r="${r}" stroke="${WP.quaternary}" stroke-width="${lw}" fill="none"/>` +
      (frac === null
        ? ""
        : `<circle cx="${c}" cy="${c}" r="${r}" stroke="${color}" stroke-width="${lw}" fill="none"` +
          ` stroke-linecap="round" stroke-dasharray="${(circ * clamp01(frac)).toFixed(2)} ${circ.toFixed(2)}"` +
          ` transform="rotate(-90 ${c} ${c})"/>`) +
      "</svg>",
  );
  if (glyph)
    ring.append(
      h(
        "div",
        {
          style: `position:absolute;inset:0;display:grid;place-items:center;font-size:${size * 0.36}px;font-weight:600;color:${color}`,
        },
        glyph,
      ),
    );
  return ring;
}

/** A hero number with the unit appended verbatim at half size, as the
 * app sets one. `raised` lifts the unit toward the cap height (0.28 of
 * the hero size), which the app does for all but word-length units. */
export function heroWithUnit(
  text: string,
  unit: string | undefined,
  size: number,
  slotId: string,
  raised = false,
): HTMLElement {
  const hero = h("div", { class: "pv-hero", "data-slot": slotId, style: heroStyle(size) }, text);
  if (unit)
    hero.append(
      h(
        "span",
        { style: `font-size:.5em;font-weight:400${raised ? ";vertical-align:.56em" : ""}` },
        unit,
      ),
    );
  return hero;
}

export function fmt01(value: number): string {
  return value.toLocaleString(i18nLocale(), { maximumFractionDigits: 1 });
}

/** The name line: subheadline medium in secondary, one line. The app
 * scales it down to 80 % before it truncates. */
export function nameLabel(name: string, extra = ""): HTMLElement {
  return fitted(h("div", { class: `pv-name ${extra}`.trim() }, name), 15, 0.8);
}
