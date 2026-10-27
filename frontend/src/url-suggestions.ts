// Deep-link suggestions for a tap URL, derived from the form's bound
// entities: their devices, their history, the dashboard. The Home
// Assistant app opens homeassistant://navigate/... paths directly.

import { html, type TemplateResult } from "lit";
import { t } from "./i18n";
import type { HassLike } from "./types/hass";

/** At most this many suggestions are shown. */
const SHOWN = 6;

/** The suggestions as [label, url], most specific first. */
function suggestions(hass: HassLike, boundIds: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const id of boundIds) {
    const deviceId = hass.entities?.[id]?.device_id;
    if (deviceId && !seen.has(deviceId)) {
      seen.add(deviceId);
      const device = hass.devices?.[deviceId];
      out.push([
        t("field.device-chip", { name: device?.name_by_user || device?.name || id }),
        `homeassistant://navigate/config/devices/device/${deviceId}`,
      ]);
    }
    const st = hass.states[id];
    out.push([
      t("field.history-chip", { name: st?.attributes.friendly_name || id }),
      `homeassistant://navigate/history?entity_id=${id}`,
    ]);
  }
  out.push([t("field.dashboard-chip"), "homeassistant://navigate/lovelace/0"]);
  return out;
}

export function urlSuggestions(
  hass: HassLike,
  boundIds: string[],
  apply: (url: string) => void,
): TemplateResult {
  return html`<div class="urlsug"><span class="segbar-note">${t("field.suggestions")}</span>${suggestions(
    hass,
    boundIds,
  )
    .slice(0, SHOWN)
    .map(
      // Real buttons: Enter/Space activation and focusability come from
      // the platform instead of a hand-rolled role="button".
      ([label, url]) =>
        html`<button type="button" class="chip" title=${url} @click=${() => apply(url)}>${label}</button>`,
    )}</div>`;
}
