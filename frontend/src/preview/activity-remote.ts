// The remote Live Activity's Lock Screen card and its compact Dynamic
// Island slots, after the app's RemoteLiveActivity: a picture (here
// always its icon tile, since a preview never has the app's cached
// image), the name over a state word, one reading, a bar or two stats,
// and one to three buttons. The card is pure black with the dark scheme
// forced, so translucent fills are mixed over black into opaque colors,
// as the app does.

import { COLOR_HEX, colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import type { PreviewAction, PreviewStat, PreviewValue, WidgetContent } from "../types/content";
import { labelFor } from "../util";
import { clamp01, ghost, glyphFor, iconColorHex, slot, valueColor, valueText } from "./kit";
import { DARK_INK, prefersDarkInk } from "./switchboard";

const HEX = /^#[0-9a-f]{6}$/i;
/** The icon the app falls back to. */
const FALLBACK_ICON = "switch.2";

/** A wire color as hex: a palette name, or the hex the remote takes
 * (`ColorV2`); anything else is unset. */
function hex(color: string | undefined): string | undefined {
  return colorHex(color) ?? (color && HEX.test(color) ? color : undefined);
}

/** `color` at `alpha` over black, as one opaque color. */
function overBlack(color: string, alpha: number): string {
  const channel = (i: number): number => Math.round(parseInt(color.slice(i, i + 2), 16) * alpha);
  return `rgb(${channel(1)},${channel(3)},${channel(5)})`;
}

/** The card's tint: the accent, else the state's color, else the icon's,
 * else system blue. */
export function remoteAccent(content: WidgetContent): string {
  return (
    hex(content.accent) ?? valueColor(content.state) ?? iconColorHex(content.icon) ?? COLOR_HEX.blue
  );
}

/** The bar's color: its own, else the state's, else the card's tint. */
export function remoteBarColor(content: WidgetContent): string {
  return hex(content.progress?.color) ?? valueColor(content.state) ?? remoteAccent(content);
}

/** The compact trailing text: the compact value, else the value with its
 * unit, joined without a space before % and °. */
export function remoteCompactText(content: WidgetContent): string | null {
  const own = valueText(content.compact_value);
  if (own != null) return own;
  const value = valueText(content.value as PreviewValue | undefined);
  if (value == null) return null;
  const unit = content.unit;
  if (!unit) return value;
  return /^[%°]/.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

/** The compact trailing color: the value's own, else the state's, else
 * the card's tint. */
export function remoteCompactColor(content: WidgetContent): string {
  const own = content.compact_value ?? (content.value as PreviewValue | undefined);
  return valueColor(own) ?? valueColor(content.state) ?? remoteAccent(content);
}

/** The compact leading glyph: the bare symbol at 20 pt in its color, else
 * the card's tint. */
export function remoteIslandIcon(content: WidgetContent, scale: number): HTMLElement {
  return h(
    "div",
    {
      "data-slot": "island-icon",
      style: `flex:none;font-size:${20 * scale}px;color:${iconColorHex(content.icon) ?? remoteAccent(content)}`,
    },
    glyphFor(content.icon ?? FALLBACK_ICON),
  );
}

const SEMI = "font-weight:600;font-size:";

function line(text: string, style: string): HTMLElement {
  return h(
    "div",
    { style: `${style};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0` },
    text,
  );
}

/** The header: the 40 pt icon tile (the accent at 18 % over black), the
 * name over the state word, and the reading trailing. */
function header(name: string, content: WidgetContent, accent: string): HTMLElement {
  const tile = h(
    "div",
    {
      "data-slot": "picture",
      style:
        `flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;` +
        `font-size:20px;background:${overBlack(accent, 0.18)};color:${iconColorHex(content.icon) ?? accent}`,
    },
    glyphFor(content.icon ?? FALLBACK_ICON),
  );
  const state = valueText(content.state);
  const title = h(
    "div",
    { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:1px" },
    line(name, `${SEMI}15px`),
    state
      ? slot(line(state, `${SEMI}13px;color:${valueColor(content.state) ?? WP.secondary}`), "state")
      : ghost("state", "state", "is-dark"),
  );
  const value = valueText(content.value as PreviewValue | undefined);
  const label = content["value_label"];
  const reading = value
    ? h(
        "div",
        {
          "data-slot": "reading",
          style:
            "flex:none;max-width:150px;margin-left:8px;display:flex;flex-direction:column;align-items:flex-end",
        },
        h(
          "div",
          { style: "display:flex;align-items:baseline;gap:1px;max-width:100%" },
          line(
            value,
            `${SEMI}22px;font-variant-numeric:tabular-nums;color:${valueColor(content.value as PreviewValue) ?? "#fff"}`,
          ),
          content.unit
            ? h("span", { style: `flex:none;font-size:17px;color:${WP.secondary}` }, content.unit)
            : null,
        ),
        typeof label === "string" && label
          ? line(label, `font-size:12px;color:${WP.secondary}`)
          : null,
      )
    : ghost("reading", "value", "is-dark");
  return h("div", { style: "display:flex;align-items:center;gap:12px" }, tile, title, reading);
}

/** Up to two stats in two equal columns: the reading (with its symbol and
 * unit) over its label in small capitals. One stat takes half the width. */
function stats(list: PreviewStat[]): HTMLElement {
  const stat = (s: PreviewStat): HTMLElement =>
    h(
      "div",
      { style: "min-width:0;display:flex;flex-direction:column" },
      h(
        "div",
        {
          style: `display:flex;align-items:baseline;gap:3px;color:${valueColor(s.value) ?? "#fff"}`,
        },
        s.icon ? h("span", { style: `${SEMI}13px` }, glyphFor(s.icon)) : null,
        h(
          "span",
          { style: "display:flex;align-items:baseline;gap:1px;min-width:0" },
          line(valueText(s.value) ?? "", `${SEMI}15px`),
          s.unit ? h("span", { style: `${SEMI}12px;color:${WP.secondary}` }, s.unit) : null,
        ),
      ),
      line(
        s.label ?? "",
        `${SEMI}11px;text-transform:uppercase;letter-spacing:.3px;color:${WP.secondary}`,
      ),
    );
  return h(
    "div",
    {
      "data-slot": "stats",
      style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px",
    },
    list.slice(0, 2).map(stat),
  );
}

/** The buttons: equal widths, 8 apart, 40 tall, on a plate of white at
 * 16 %. An on toggle or an active button is filled with its color (else
 * the tint), its ink dark on a light fill. Two or fewer carry their
 * label beside the symbol; three are symbols only. */
function buttons(actions: PreviewAction[], accent: string): HTMLElement {
  const labeled = actions.length <= 2;
  const button = (a: PreviewAction): HTMLElement => {
    const lit = a.kind === "toggle" ? !!a.on : !!a.active;
    const fill = lit ? (hex(a.color) ?? accent) : "rgb(41,41,41)";
    const ink = lit && prefersDarkInk([fill]) ? DARK_INK : "#fff";
    return h(
      "div",
      {
        style:
          `flex:1;min-width:0;height:40px;border-radius:14px;padding:0 8px;display:flex;` +
          `align-items:center;justify-content:center;gap:5px;background:${fill};color:${ink}`,
      },
      h(
        "span",
        { style: `flex:none;${SEMI}${labeled ? 14 : 16}px` },
        glyphFor(a.icon ?? FALLBACK_ICON),
      ),
      labeled ? line(a.label ?? "", `${SEMI}15px`) : null,
    );
  };
  return h(
    "div",
    { "data-slot": "actions", style: "display:flex;gap:8px;margin-top:10px" },
    actions.slice(0, 3).map(button),
  );
}

/** The Lock Screen card's rows, under `.pv-banner`. A bar takes the
 * stats' place; with neither, both stay pressable as placeholders. */
export function remoteCard(name: string, content: WidgetContent): HChild[] {
  const accent = remoteAccent(content);
  const kids: HChild[] = [header(name, content, accent)];
  const progress = content.progress;
  if (progress?.value != null) {
    kids.push(
      slot(
        h(
          "div",
          {
            class: "pv-bar",
            style: "height:6px;border-radius:3px;margin-top:8px;background:#242424",
          },
          h("i", {
            style: `width:${Math.round(clamp01(progress.value) * 100)}%;background:${remoteBarColor(content)}`,
          }),
        ),
        "bar",
      ),
    );
  } else if (content.stats?.length) {
    kids.push(stats(content.stats));
  } else {
    kids.push(
      h(
        "div",
        { style: "display:flex;gap:8px;margin-top:8px" },
        ghost("bar", "progress", "is-dark is-grow"),
        ghost("stats", "stats", "is-dark is-grow"),
      ),
    );
  }
  const actions = content.actions ?? [];
  kids.push(
    actions.length
      ? buttons(actions, accent)
      : h(
          "div",
          { style: "display:flex;margin-top:10px" },
          // A remote's actions are buttons, not a switchboard's tiles.
          Object.assign(ghost("actions", "actions", "is-dark is-grow"), {
            textContent: labelFor("actions", "remote"),
          }),
        ),
  );
  return kids;
}
