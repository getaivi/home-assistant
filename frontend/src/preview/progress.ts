// The Progress widget's preview, matched to the app's Progress template:
// the icon chip, the name, a hero that is the running countdown, else the
// state word, else the percent, the state line while a timer runs, and
// the bar (Small) or the ring (Medium, a simple bar).

import { COLOR_HEX, colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { PROGRESS } from "../form-groups";
import { i18nLocale, t } from "../i18n";
import { segmentedBar } from "../segments-bar";
import { progressPreviewStyles } from "../styles/preview/progress";
import type { WidgetContent } from "../types/content";
import { timerText } from "../util";
import { fitted } from "./fit";
import {
  clamp01,
  ghost,
  glyphFor,
  heroStyle,
  nameLabel,
  setSvg,
  slot,
  valueColor,
  valueText,
} from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** What both families read off the payload, as the app does. */
interface Reading {
  /** The progress value held to 0...1. */
  frac: number;
  /** The percent as the device writes it: the rounded integer and "%",
   * never locale-formatted (no "62 %", no "%62"). */
  percent: string;
  /** The end date while it is still ahead: a timer is running. */
  endDate: string | null;
  state: string | null;
  /** The theme's hero fill: the state's text color, whatever the hero
   * shows (timer, state word or percent), else primary. */
  heroColor: string;
  /** The theme's state fill: the state's text color, else the tint. */
  stateColor: string;
  /** The theme's bar fill: the bar's own color, else system blue. The
   * widget accent never reaches it: the app always resolves a bar color,
   * and an explicit color outranks `.tint`. */
  barColor: string;
  segmented: boolean;
}

function read(content: WidgetContent, accent: string): Reading {
  const frac = clamp01(content.progress?.value ?? 0);
  const end = content.end_date;
  const stateColor = valueColor(content.state);
  return {
    frac,
    percent: `${Math.round(frac * 100)}%`,
    endDate: end && Date.parse(end) > Date.now() ? end : null,
    state: valueText(content.state),
    heroColor: stateColor ?? WP.primary,
    stateColor: stateColor ?? accent,
    barColor: colorHex(content.progress?.color) ?? COLOR_HEX.blue,
    segmented: content.progress?.style === "segmented",
  };
}

/** The top row: the 28 pt icon chip alone at the leading edge (the
 * glyph at half the chip in the tint, on the tint at 16 %). The device
 * draws nothing without an icon; the placeholder keeps the field
 * reachable. */
function chipRow(content: WidgetContent, accent: string): HTMLElement {
  return h(
    "div",
    { class: "pv-progress-top" },
    content.icon
      ? h(
          "div",
          {
            class: "pv-chip",
            "data-slot": "icon",
            style: `background:color-mix(in srgb, ${accent} 16%, transparent);color:${accent}`,
          },
          glyphFor(content.icon),
        )
      : ghost("icon", "icon", "is-dark is-chip"),
  );
}

/** The hero: the countdown while the timer runs, else the state word,
 * else the percent; one line that shrinks to 60 % before it truncates.
 * The preview is a still, so the countdown is read once. */
function hero(r: Reading, size: number): HTMLElement {
  const text = r.endDate ? timerText(r.endDate) : (r.state ?? r.percent);
  return fitted(
    h(
      "div",
      {
        class: "pv-hero pv-progress-hero",
        "data-slot": "hero",
        style: `${heroStyle(size)};color:${r.heroColor}`,
      },
      text,
    ),
    size,
    0.6,
  );
}

/** `.dateTime.hour().minute()` in the viewer's locale: "3:54 PM", "15:54". */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18nLocale(), { hour: "numeric", minute: "2-digit" });
}

/** The supporting line, there only while a timer runs: the state word
 * (the hero is the countdown then) and, on Medium, "· done 15:42" in the
 * meta role 4 pt after it on the same baseline. With neither, the row is
 * empty and only its 2 pt top padding remains. Nothing stands in when no
 * timer runs: the hero always paints and already leads to `state` and
 * `end_date`. */
function stateDoneLine(r: Reading, showsDone: boolean): HTMLElement | null {
  if (!r.endDate) return null;
  return h(
    "div",
    { class: "pv-progress-line" },
    r.state
      ? h(
          "div",
          {
            class: "pv-state pv-progress-state",
            "data-slot": "caption",
            style: `color:${r.stateColor}`,
          },
          r.state,
        )
      : null,
    // The finish time is the end date's, so it leads where the countdown
    // does.
    showsDone
      ? h(
          "div",
          { class: "pv-meta pv-progress-meta", "data-slot": "finish" },
          `· ${t("preview.done-at", { time: clock(r.endDate) })}`,
        )
      : null,
  );
}

/** The bar under the reading. Segmented bars are the app's split bar with
 * its 6 pt gaps, whatever `display` says (layered is the Live Activity's)
 * and never labeled, and they stay static. A simple bar is the app's 6 pt
 * track (quaternary, with a fill never narrower than the bar is tall);
 * while a timer runs the device swaps in the system's linear
 * `ProgressView`, which is 4 pt tall on the system's own track and
 * advances by itself: drawn here at the reported fraction. */
function bar(content: WidgetContent, r: Reading, height: number, top: number): HTMLElement {
  if (r.segmented && content.progress)
    return slot(segmentedBar(content.progress, height, 6, false, top), "bar");
  return h(
    "div",
    {
      class: r.endDate ? "pv-bar pv-progress-bar is-live" : "pv-bar pv-progress-bar",
      "data-slot": "bar",
      style: `margin-top:${top}px`,
    },
    h("i", { style: `width:${Math.round(r.frac * 100)}%;background:${r.barColor}` }),
  );
}

const RING = 56;
const RING_LINE = 5;

/** The progress ring: a 56 pt circle stroked 5 pt on its frame's edge
 * (so the ring overhangs its box by half a line), quaternary under the
 * bar fill running clockwise from 12 o'clock with round caps; an empty
 * ring keeps a dot there (the trim never goes below 0.001). The percent
 * sits in the middle in the hero's color. */
function ring(r: Reading): HTMLElement {
  const c = RING / 2;
  const circ = 2 * Math.PI * c;
  const el = h("div", { class: "pv-progress-ring", "data-slot": "bar" });
  setSvg(
    el,
    `<svg width="${RING}" height="${RING}" viewBox="0 0 ${RING} ${RING}" aria-hidden="true">` +
      `<circle cx="${c}" cy="${c}" r="${c}" stroke="${WP.quaternary}" stroke-width="${RING_LINE}" fill="none"/>` +
      `<circle class="pv-progress-arc" cx="${c}" cy="${c}" r="${c}" stroke="${r.barColor}" stroke-width="${RING_LINE}"` +
      ` fill="none" stroke-linecap="round"` +
      ` stroke-dasharray="${(circ * Math.max(0.001, r.frac)).toFixed(2)} ${circ.toFixed(2)}"` +
      ` transform="rotate(-90 ${c} ${c})"/>` +
      "</svg>",
  );
  el.append(h("div", { class: "pv-progress-percent", style: `color:${r.heroColor}` }, r.percent));
  return el;
}

const renders: TemplateRenderer = {
  // Small: chip, a spacer, then name, the 36 pt hero 2 pt under it, the
  // state line (never the finish time) and the 6 pt bar 6 pt below.
  small(name, content, accent): HChild[] {
    const r = read(content, accent);
    const head = hero(r, 36);
    head.classList.add("is-spaced");
    return [
      chipRow(content, accent),
      h("div", { class: "pv-grow" }),
      nameLabel(name, "pv-progress-name"),
      head,
      stateDoneLine(r, false),
      bar(content, r, 6, 6),
    ];
  },

  // Medium: the same column with a 40 pt hero flush under the name and
  // the finish time on the state line. A simple bar becomes the ring,
  // 16 pt to the column's right and centered on the canvas; a segmented
  // one stays a bar, 8 pt under the reading.
  medium(name, content, accent): HChild[] {
    const r = read(content, accent);
    const column: HChild[] = [
      chipRow(content, accent),
      h("div", { class: "pv-grow" }),
      nameLabel(name, "pv-progress-name"),
      hero(r, 40),
      stateDoneLine(r, true),
    ];
    if (r.segmented) return [...column, bar(content, r, 6, 8)];
    return [
      h(
        "div",
        { class: "pv-progress-split" },
        h("div", { class: "pv-progress-col" }, column),
        ring(r),
      ),
    ];
  },
};

/** The progress template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const progress: WidgetTemplate = {
  ...renders,
  styles: progressPreviewStyles,
  slots: [
    // The hero is the running timer when an end date is set, else the
    // state word, else the percentage: all three are this one region.
    { id: "hero", fields: ["state", "end_date"] },
    { id: "caption", fields: ["state"] },
    // Medium's "done 15:42" beside the state line: fed by the end date alone.
    { id: "finish", fields: ["end_date"] },
    { id: "bar", fields: ["progress", "segments", "bar_color"] },
    { id: "icon", fields: ["icon", "accent"] },
    { id: "global", fields: ["tap_url"], global: true },
  ],
  layout: [PROGRESS, "state", "end_date"],
};
