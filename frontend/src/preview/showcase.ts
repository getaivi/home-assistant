// The Showcase widget's preview, matched to the app's Showcase template:
// a picture of the thing, its state mark, when it last reported, and its
// readings. Small leads with the first reading; Medium sets the picture
// bottom-leading and three readings trailing. A photo (`fit: cover`)
// fills Small and bleeds across Medium's leading 44 %, with the text laid
// on it.
//
// The picture is drawn from its URL, as the device fetches it. The
// device trims a cut-out's transparent edges and stands a tall one
// beside the readings; the preview draws every cut-out in the wide
// layout.

import { colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { i18nLocale, t } from "../i18n";
import { showcasePreviewStyles } from "../styles/preview/showcase";
import type {
  IconSpec,
  PreviewPicture,
  PreviewStat,
  PreviewStateMark,
  PreviewValue,
  WidgetContent,
} from "../types/content";
import { fitted, textWidth } from "./fit";
import { ghost, glyphFor, heroWeight } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

/** How many readings Medium shows (Small shows the first); the rest
 * wait for a larger size. */
const MEDIUM_STATS = 3;
/** Small's numeric hero, its word reading, and the hero on a photo. */
const SMALL_HERO = 28;
const SMALL_WORD = 22;
const SMALL_PHOTO_HERO = 30;
/** The widest a cut-out gets in Medium, and the stand-in icon's size. */
const MEDIUM_CUT_OUT = 150;

/** The state mark of the content, which the wire carries under `state`
 * (a Status widget's `state` is a value instead). */
function stateMark(content: WidgetContent): PreviewStateMark | null {
  const raw = content.state as unknown;
  if (!raw || typeof raw !== "object" || !("text" in raw)) return null;
  const mark = raw as PreviewStateMark;
  return mark.text?.value != null && String(mark.text.value).trim() ? mark : null;
}

function iconName(icon: IconSpec | undefined): string {
  return typeof icon === "string" ? icon : (icon?.name ?? "");
}

/** What goes between a value and its unit: a space before a word
 * ("312 km"), nothing before a sign ("78%", "21°C"). */
export function unitSeparator(unit: string): string {
  return /^\p{L}/u.test(unit) ? " " : "";
}

/** A reading reads as a number (a measurement, a count, 142/230) when it
 * has digits and no letters, and no time formatter: only a number takes
 * the numeric hero. */
export function isNumericReading(stat: PreviewStat): boolean {
  const value = stat.value;
  if (value?.formatter === "time_since" || value?.formatter === "time_until") return false;
  const text = String(value?.value ?? "");
  return /\p{Nd}/u.test(text) && !/\p{L}/u.test(text);
}

/** The units a time is worded in, largest first: minutes up to years,
 * no weeks and no seconds, so the words never tick every second. */
const TIME_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** A moment in the compact words small and medium draw ("4m ago",
 * "in 3h"): one unit in the locale's narrow form, numeric throughout,
 * never a date. Within a minute either side they hold still: "Just now"
 * once it has come, "In a moment" while it is under a minute away. */
export function timeWords(at: number, now = Date.now()): string {
  const seconds = (at - now) / 1000;
  if (seconds > -60 && seconds <= 60)
    return t(seconds > 0 ? "preview.in-a-moment" : "preview.reported-now");
  const [unit, size] = TIME_UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ["minute", 60];
  return new Intl.RelativeTimeFormat(i18nLocale(), { numeric: "always", style: "narrow" }).format(
    Math.trunc(seconds / size),
    unit,
  );
}

/** A time reading in the compact words that keep themselves current on
 * the device, as of now. */
export function relativeWords(value: PreviewValue | undefined): string | null {
  const formatter = value?.formatter;
  if (formatter !== "time_since" && formatter !== "time_until") return null;
  const at = Date.parse(String(value?.value ?? ""));
  return Number.isNaN(at) ? null : timeWords(at);
}

/** What a reading says: a time in words, else the value as sent. */
export function readingText(stat: PreviewStat): string {
  return relativeWords(stat.value) ?? String(stat.value?.value ?? "–");
}

/** How long ago the thing reported, in the words of a time reading
 * ("Just now", then "12m ago"). A time to come reads as now. */
export function reportedPhrase(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : timeWords(Math.min(at, now), now);
}

/** A reading's value with its unit hugged on, the unit `unitScale` of the
 * value's size in `unitColor` (or the value's own). */
function reading(stat: PreviewStat, cls: string, style: string, unitStyle: string): HTMLElement {
  const unit = stat.unit ?? "";
  return h(
    "span",
    { class: cls, style },
    readingText(stat),
    unit
      ? h("span", { class: "pv-showcase-unit", style: unitStyle }, unitSeparator(unit) + unit)
      : null,
  );
}

/** A reading's own color, else primary. */
function statColor(stat: PreviewStat): string {
  return colorHex(stat.value?.text_color) ?? WP.primary;
}

/** The width of Small's header, inside its 16 pt margins. */
const SMALL_WIDTH = 126;

/** Small's state, in the header's trailing slot, in `color`: its glyph;
 * without one its word, or a 7 pt dot when the word does not fit beside
 * the name. A placeholder without a state. */
function smallMark(state: PreviewStateMark | null, name: string, color: string): HTMLElement {
  if (!state) return ghost("state", "state", "pv-showcase-ghost");
  const icon = iconName(state.icon);
  const word = String(state.text?.value ?? "");
  const room = SMALL_WIDTH - 4 - (textWidth(name, 15, 600) ?? 0);
  const fits = icon || (textWidth(word, 13, 600) ?? 0) <= room;
  return h(
    "span",
    {
      class: `pv-showcase-glyph${icon || fits ? "" : " is-dot"}`,
      "data-slot": "state",
      style: `color:${color}`,
    },
    icon ? glyphFor(icon) : fits ? word : null,
  );
}

/** The state mark: its symbol and word in the state's own color, else the
 * widget's tint. */
function mark(state: PreviewStateMark | null, accent: string): HTMLElement | null {
  if (!state) return null;
  const color = colorHex(state.text?.text_color) ?? accent;
  const icon = iconName(state.icon);
  return h(
    "div",
    { class: "pv-showcase-state", "data-slot": "state", style: `color:${color}` },
    icon ? h("span", { class: "pv-showcase-state-icon" }, glyphFor(icon)) : null,
    h("span", { class: "pv-showcase-state-word" }, String(state.text?.value ?? "")),
  );
}

/** Beside a medium photo, the room for the header: the widget less the
 * photo's 44 %, the 14 pt beside it and the 16 pt trailing margin. */
export const BESIDE_PHOTO = 338 - Math.round(0.44 * 338) - 14 - 16;

/** The report time with its clock, secondary caption. Where `room` is
 * given and the header would not fit it beside `name`, the clock drops
 * before the words truncate. */
export function meta(content: WidgetContent, name = "", room?: number): HTMLElement | null {
  const phrase = reportedPhrase(content.reported_at);
  if (!phrase) return null;
  // The clock and its 3 pt gap, and the 6 pt between the name and the time.
  const width = (textWidth(name, 17, 600) ?? 0) + 6 + 15 + (textWidth(phrase, 12, 500) ?? 0);
  const clock = room === undefined || width <= room;
  return h(
    "span",
    { class: "pv-showcase-meta" },
    clock ? h("span", { class: "pv-showcase-clock" }, glyphFor("clock")) : null,
    phrase,
  );
}

function badge(picture: PreviewPicture | undefined): HTMLElement | null {
  if (!picture?.url) return null;
  return h("img", {
    class: "pv-showcase-badge",
    src: picture.url,
    alt: "",
  });
}

/** The picture's slot when it is a cut-out: the picture fitted in it on a
 * soft contact shadow, else the widget's icon standing in on the slot's
 * bottom edge, else a placeholder for the picture. */
export function cutOut(content: WidgetContent, accent: string, standIn: number): HTMLElement {
  const picture = content.image;
  if (picture?.url)
    return h(
      "div",
      { class: "pv-showcase-cutout", "data-slot": "picture" },
      h("img", { class: "pv-showcase-img", src: picture.url, alt: picture.alt ?? "" }),
      h("span", { class: "pv-showcase-shadow", "aria-hidden": "true" }),
    );
  const icon = iconName(content.icon);
  if (icon)
    return h(
      "div",
      {
        class: "pv-showcase-cutout is-icon",
        "data-slot": "picture",
        style: `font-size:${standIn / 1.4}px;color:${accent}`,
      },
      glyphFor(icon),
    );
  return ghost("picture", "image", "pv-showcase-cutout is-ghost");
}

/** Small's and the photo layouts' lead: the first reading as the numeric
 * hero, or a word (Locked) as a title in its own color. */
function lead(
  stat: PreviewStat | undefined,
  hero: number,
  word: number,
  color?: string,
): HTMLElement {
  if (!stat) return ghost("stats", "stats");
  const fill = color ?? statColor(stat);
  if (isNumericReading(stat))
    return fitted(
      reading(
        stat,
        "pv-showcase-hero",
        `font-size:${hero}px;font-weight:${heroWeight(hero)};color:${fill}`,
        "font-size:.5em;font-weight:400",
      ),
      hero,
      0.6,
    );
  return fitted(
    h(
      "span",
      {
        class: "pv-showcase-hero is-word",
        style: `font-size:${word}px;font-weight:600;color:${fill}`,
      },
      readingText(stat),
    ),
    word,
    0.6,
  );
}

/** Readings as rows: the label leading, the value with its unit in one
 * piece trailing, so every row ends on the same edge. */
function rows(stats: PreviewStat[]): HTMLElement {
  if (!stats.length) return ghost("stats", "stats", "is-grow");
  return h(
    "div",
    { class: "pv-showcase-rows", "data-slot": "stats" },
    stats.map((stat) =>
      h(
        "div",
        { class: "pv-showcase-row" },
        h("span", { class: "pv-showcase-label" }, stat.label ?? ""),
        reading(stat, "pv-showcase-value", `color:${statColor(stat)}`, `color:${WP.secondary}`),
      ),
    ),
  );
}

/** The photo, cropped to fill its slot, under a scrim that keeps the
 * text on it readable. */
export function photo(picture: PreviewPicture, cls: string): HTMLElement {
  return h(
    "div",
    { class: `pv-showcase-photo ${cls}`, "data-slot": "picture" },
    h("img", { class: "pv-showcase-img", src: picture.url ?? "", alt: picture.alt ?? "" }),
  );
}

export function isPhoto(content: WidgetContent): boolean {
  return content.image?.fit === "cover" && !!content.image.url;
}

/** Small's header: the name, and the state's mark trailing. */
function smallHeader(name: string, state: PreviewStateMark | null, color: string): HTMLElement {
  return h(
    "div",
    { class: "pv-showcase-head" },
    fitted(h("div", { class: "pv-showcase-name", "data-slot": "header" }, name), 15, 0.8),
    smallMark(state, name, color),
  );
}

/** Small's reading with its label: beside a number, under words
 * ("Locked", "2h ago"), which leave no room beside them. */
function readingBlock(stat: PreviewStat | undefined, hero: number, color?: string): HTMLElement {
  const stacked = !!stat && !isNumericReading(stat);
  return h(
    "div",
    { class: `pv-showcase-lead${stacked ? " is-stacked" : ""}`, "data-slot": "stats" },
    lead(stat, hero, SMALL_WORD, color),
    stat ? h("span", { class: "pv-showcase-caption" }, stat.label ?? "") : null,
  );
}

function small(name: string, content: WidgetContent, accent: string): HChild[] {
  const first = (content.stats ?? [])[0];
  const state = stateMark(content);
  const stateColor = colorHex(state?.text?.text_color);
  if (isPhoto(content) && content.image)
    return [
      photo(content.image, "is-fill"),
      h(
        "div",
        { class: "pv-showcase-onphoto" },
        smallHeader(name, state, stateColor ?? "#fff"),
        h("div", { class: "pv-grow" }),
        readingBlock(first, SMALL_PHOTO_HERO, colorHex(first?.value?.text_color) ?? "#fff"),
      ),
    ];
  return [
    smallHeader(name, state, stateColor ?? accent),
    h("div", { class: "pv-showcase-zone" }, cutOut(content, accent, 40)),
    readingBlock(first, SMALL_HERO),
  ];
}

/** Medium's header: the name, then the report time and (off a photo)
 * the badge trailing. */
export function header(name: string, content: WidgetContent, onPhoto = false): HTMLElement {
  return h(
    "div",
    { class: "pv-showcase-head", "data-slot": "header" },
    fitted(h("div", { class: "pv-showcase-name is-headline" }, name), 17, 0.8),
    onPhoto ? meta(content, name, BESIDE_PHOTO) : meta(content),
    onPhoto ? null : badge(content.badge),
  );
}

function medium(name: string, content: WidgetContent, accent: string): HChild[] {
  const stats = (content.stats ?? []).slice(0, MEDIUM_STATS);
  const state = mark(stateMark(content), accent) ?? ghost("state", "state");
  if (isPhoto(content) && content.image)
    return [
      photo(content.image, "is-side"),
      h(
        "div",
        { class: "pv-showcase-beside" },
        header(name, content, true),
        state,
        h("div", { class: "pv-grow" }),
        rows(stats),
      ),
    ];
  return [
    header(name, content),
    state,
    h(
      "div",
      { class: "pv-showcase-bottom" },
      h(
        "div",
        { class: "pv-showcase-slot", style: `max-width:${MEDIUM_CUT_OUT}px` },
        cutOut(content, accent, 44),
      ),
      rows(stats),
    ),
  ];
}

const renders: TemplateRenderer = { small, medium };

/** The showcase template as the panel knows it: renders, styles, the
 * regions the form's fields paint (slots.ts) and the form's order
 * (layout.ts). */
export const showcase: WidgetTemplate = {
  ...renders,
  styles: showcasePreviewStyles,
  slots: [
    { id: "picture", fields: ["image", "image_fit", "image_alt", "icon"] },
    { id: "state", fields: ["state", "state_icon"] },
    // The name row: what the header carries beside the name. Small has no
    // report time on the device; its name still leads there.
    { id: "header", fields: ["reported_at", "badge", "badge_alt"] },
    { id: "stats", fields: ["stats"] },
    { id: "global", fields: ["accent", "tap_url"], global: true },
  ],
  layout: [
    { id: "picture", fields: ["image", "image_fit", "image_alt"] },
    { id: "state", fields: ["state", "state_icon"] },
    "stats",
    "reported_at",
    { id: "badge", fields: ["badge", "badge_alt"] },
  ],
  content: ["state_icon"],
};
