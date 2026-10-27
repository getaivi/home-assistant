// The entity card of the template workspace: what an entity id in the
// template is right now (its name, state and unit, when it last changed,
// its attributes), shown where the pointer rests on the id or the caret
// is moved onto it, so checking a sensor needs no trip to Developer
// tools. Finding the id at an offset is a pure function over the text.

import { html, nothing, type TemplateResult } from "lit";
import { i18nLocale, t, tPlural } from "./i18n";
import type { HassLike } from "./types/hass";

/** Attributes the card shows at most; the rest are counted. */
export const CARD_ATTRIBUTES = 8;

/** Attributes the card's head already says. */
const SAID = new Set(["friendly_name", "unit_of_measurement", "icon"]);

/** An entity id in the text, and where it is. */
export interface IdSpan {
  id: string;
  from: number;
  to: number;
}

/** Runs of dotted names: states.sensor.living_temp.state holds the id
 * sensor.living_temp. */
const DOTTED = /(?<![\w.])[a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+/g;

/** The entity id at offset `pos` of `text` (the caret or the pointer on
 * it, or right after it): one Home Assistant has, or, in quotes, one it
 * does not (a typo is worth a card that says so). */
export function entityAt(text: string, pos: number, hass: HassLike): IdSpan | null {
  for (const m of text.matchAll(DOTTED)) {
    const start = m.index;
    if (start > pos) break;
    if (start + m[0].length < pos) continue;
    const parts = m[0].split(".");
    let at = start;
    for (let i = 0; i + 1 < parts.length; i++) {
      const id = `${parts[i]}.${parts[i + 1]}`;
      const to = at + id.length;
      if (at <= pos && pos <= to) {
        if (hass.states[id]) return { id, from: at, to };
        const quoted = /['"]/.test(text.charAt(at - 1)) && /['"]/.test(text.charAt(to));
        if (quoted && parts.length === 2) return { id, from: at, to };
      }
      at += (parts[i] ?? "").length + 1;
    }
  }
  return null;
}

/** The entity a pick near offset `pos` is most likely for: the id there,
 * else the one the template names last before it, else the first it
 * names; null when it names none Home Assistant has. */
export function entityNear(text: string, pos: number, hass: HassLike): string | null {
  const here = entityAt(text, pos, hass);
  if (here && hass.states[here.id]) return here.id;
  let before: string | null = null;
  let first: string | null = null;
  for (const m of text.matchAll(DOTTED)) {
    const parts = m[0].split(".");
    for (let i = 0; i + 1 < parts.length; i++) {
      const id = `${parts[i]}.${parts[i + 1]}`;
      if (!hass.states[id]) continue;
      first ??= id;
      if (m.index <= pos) before = id;
    }
  }
  return before ?? first;
}

/** "12 minutes ago", in the panel's language. */
export function sinceText(iso: string, now: number = Date.now()): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.round((then - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(i18nLocale(), { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

/** An attribute's value on one line. */
function valueText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "";
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** The card for entity `id`, under the id `cardId`. */
export function entityCard(hass: HassLike, id: string, cardId: string): TemplateResult {
  const entity = hass.states[id];
  if (!entity)
    return html`<div class="entcard missing" id=${cardId} role="tooltip"><span class="entid">${t(
      "field.unknown-entity",
      { id },
    )}</span></div>`;
  const attrs = entity.attributes;
  const name =
    typeof attrs.friendly_name === "string" && attrs.friendly_name ? attrs.friendly_name : id;
  const unit = typeof attrs["unit_of_measurement"] === "string" ? attrs["unit_of_measurement"] : "";
  const since = entity.last_changed ? sinceText(entity.last_changed) : null;
  const rest = Object.entries(attrs).filter(([key]) => !SAID.has(key));
  const shown = rest.slice(0, CARD_ATTRIBUTES);
  return html`<div class="entcard" id=${cardId} role="tooltip"><div class="enthead"><span class="entname">${name}</span><span class="entstate">${entity.state}${
    unit ? html`<span class="entunit"> ${unit}</span>` : nothing
  }</span></div><div class="entid">${id}</div>${
    since
      ? html`<div class="entsince">${t("workspace.card-changed", { when: since })}</div>`
      : nothing
  }${
    shown.length
      ? html`<dl class="entattrs">${shown.map(
          ([key, value]) => html`<dt>${key}</dt><dd>${valueText(value)}</dd>`,
        )}</dl>`
      : nothing
  }${
    rest.length > shown.length
      ? html`<div class="entmore">${tPlural("workspace.card-more", rest.length - shown.length)}</div>`
      : nothing
  }</div>`;
}
