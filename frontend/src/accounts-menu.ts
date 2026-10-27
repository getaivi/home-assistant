// The accounts panel behind the hub bar's gear: every connected account,
// its state, and the way to add or manage one. Accounts are rarely
// touched: one gear, with a mark on it while an account needs attention.
// The panel is a native, non-modal dialog that follows its state; a press
// outside it, Escape, or focus leaving it closes it.

import { html, nothing, type ReactiveController, type TemplateResult } from "lit";
import type { AiviPanel } from "./aivi-panel";
import { BUILD_STAMP } from "./build-info";
import { i18nLocale, t } from "./i18n";
import { icon } from "./icons";
import {
  CONFIG_FLOW_PATH,
  INTEGRATION_PATH,
  navigateLocal,
  SUPPORT_URL,
  startConfigFlow,
  TOKEN_DOCS_URL,
} from "./onboarding";
import type { Account } from "./types/accounts";

/** Why a paused account is paused: when its subscription ended, when
 * Aivi said. */
function pausedLabel(acc: Account): string {
  const ended = acc.subscription_ended ? new Date(acc.subscription_ended) : null;
  if (!ended || Number.isNaN(ended.getTime())) return t("hub.account-paused");
  const date = new Intl.DateTimeFormat(i18nLocale(), { dateStyle: "medium" }).format(ended);
  return t("hub.account-ended", { date });
}

export class AccountsMenu implements ReactiveController {
  private readonly _host: AiviPanel;
  private _open = false;

  constructor(host: AiviPanel) {
    this._host = host;
    host.addController(this);
  }

  hostUpdated(): void {
    const pop = this._host.renderRoot.querySelector<HTMLDialogElement>("dialog.acctpop");
    if (pop && pop.open !== this._open) {
      if (this._open) {
        if (typeof pop.show === "function") pop.show();
        else pop.setAttribute("open", "");
        // The panel takes the focus, not its first button: Tab goes on to
        // the buttons, and no button shows a focus ring before then.
        pop.focus();
      } else if (typeof pop.close === "function") pop.close();
      else pop.removeAttribute("open");
    }
    if (this._open) document.addEventListener("pointerdown", this._onOutsidePress, true);
    else document.removeEventListener("pointerdown", this._onOutsidePress, true);
  }

  hostDisconnected(): void {
    document.removeEventListener("pointerdown", this._onOutsidePress, true);
  }

  /** The gear and, under it, the panel. */
  render(): TemplateResult {
    const panel = this._host;
    const attention = panel.accounts.some(
      (acc) => panel.inactive[acc.entry_id] || panel.aiviWidgets[acc.entry_id] === null,
    );
    return html`<div
          class="acctwrap"
          @keydown=${(e: KeyboardEvent) => {
            // A non-modal dialog never fires `cancel`: Escape is handled here.
            if (e.key !== "Escape" || !this._open) return;
            e.stopPropagation();
            this._set(false);
            panel.renderRoot.querySelector<HTMLElement>(".acctbtn")?.focus();
          }}
          @focusout=${(e: FocusEvent) => {
            // Focus moved on (Tab past the last link): the panel closes.
            // A press on its own text moves focus nowhere (null).
            const to = e.relatedTarget;
            if (this._open && to instanceof Node && !(e.currentTarget as HTMLElement).contains(to))
              this._set(false);
          }}
        ><button
          class=${`iconbtn acctbtn${attention ? " attn" : ""}`}
          aria-label=${t("hub.accounts")}
          title=${t("hub.accounts")}
          aria-haspopup="dialog"
          aria-expanded=${this._open ? "true" : "false"}
          aria-controls="aivi-accounts"
          @click=${() => this._set(!this._open)}
        >${icon("cog")}</button>${this._panel()}</div>`;
  }

  /** Accounts are Home Assistant config entries, so adding opens the
   * config flow and managing opens the integration's page in Settings. */
  private _panel(): TemplateResult {
    const panel = this._host;
    const state = (acc: Account): [string, string] =>
      panel.inactive[acc.entry_id]
        ? ["warn", pausedLabel(acc)]
        : panel.aiviWidgets[acc.entry_id] === null
          ? ["bad", t("hub.account-unreachable")]
          : ["ok", t("hub.account-connected")];
    return html`<dialog
      class="acctpop" id="aivi-accounts" tabindex="-1"
      aria-labelledby="aivi-accounts-title"
      @close=${() => this._set(false)}
    ><h3 id="aivi-accounts-title">${t("hub.accounts")}</h3><ul class="acctlist">${panel.accounts.map(
      (acc) => {
        const [tone, label] = state(acc);
        return html`<li class=${`acct ${tone}`}><span class="dot"></span><span class="ainfo"><span class="an" title=${acc.title}>${acc.title}</span><span class="as">${label}</span></span></li>`;
      },
    )}</ul><div class="acctactions"><a
        class="btn quiet small"
        href=${CONFIG_FLOW_PATH}
        @click=${(e: Event) => {
          e.preventDefault();
          this._set(false);
          startConfigFlow();
        }}
      >${t("hub.add-account")}</a><a
        class="btn quiet small"
        href=${INTEGRATION_PATH}
        @click=${(e: Event) => {
          e.preventDefault();
          this._set(false);
          navigateLocal(INTEGRATION_PATH);
        }}
      >${t("hub.manage-accounts")}</a></div><div class="acctabout"><a
        href=${TOKEN_DOCS_URL} target="_blank" rel="noreferrer"
      >${t("hub.docs")}</a><a
        href=${SUPPORT_URL} target="_blank" rel="noreferrer"
      >${t("hub.support")}</a>${
        panel.version
          ? html`<span class="ver" title=${BUILD_STAMP}>${t("hub.version", { version: panel.version })}</span>`
          : nothing
      }</div></dialog>`;
  }

  private _set(open: boolean): void {
    if (open === this._open) return;
    this._open = open;
    this._host.requestUpdate();
  }

  private _onOutsidePress = (e: Event): void => {
    const inside = e
      .composedPath()
      .some((node) => node instanceof Element && node.matches(".acctwrap"));
    if (!inside) this._set(false);
  };
}
