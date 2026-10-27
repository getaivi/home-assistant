// The hub's top app bar, following HA toolbar anatomy (menu button when
// narrow, 20px title): the Log (everything, both ways), how the events
// from the devices stand, Refresh, and the accounts gear. With no account connected it is the title alone; the
// hub's own card says how to connect one.

import { html, nothing, type TemplateResult } from "lit";
import type { AccountsMenu } from "./accounts-menu";
import type { AiviPanel } from "./aivi-panel";
import { BRAND_MARK } from "./brand-mark";
import { t } from "./i18n";
import { icon } from "./icons";

export function hubBar(panel: AiviPanel, accounts: AccountsMenu): TemplateResult {
  return html`<div class="topbar">${panel.menuButton()}<img
      class="logo"
      alt=""
      aria-hidden="true"
      src=${BRAND_MARK}
    /><div class="title">Aivi</div><div class="grow"></div>${
      panel.accounts.length
        ? html`<button
          type="button"
          class="iconbtn logbtn"
          aria-label=${t("log.open")}
          title=${t("log.title")}
          @click=${() => panel.openLog()}
        >${icon("format-list-bulleted-type")}</button><aivi-events .panel=${panel}></aivi-events><button
          type="button"
          class=${`iconbtn refreshbtn ${panel.refreshState}`}
          aria-label=${t("hub.refresh")}
          title=${t("hub.refresh")}
          aria-busy=${panel.refreshState === "busy" ? "true" : "false"}
          aria-disabled=${panel.refreshState === "idle" ? "false" : "true"}
          @click=${() => void panel.checkForChanges()}
        >${icon("refresh")}<span class="rbadge" aria-hidden="true">${icon(
          panel.refreshState === "failed" ? "alert-outline" : "check",
        )}</span></button><span class="sr-only" role="status">${
          panel.refreshState === "done"
            ? t(panel.fresh.size ? "hub.refresh-changed" : "hub.refresh-same")
            : panel.refreshState === "failed"
              ? t("hub.refresh-failed")
              : ""
        }</span>${accounts.render()}`
        : nothing
    }</div>`;
}
