// <aivi-activity-log>: the Log page (its route is /log, router.ts). One
// timeline per account, newest first, of what Home Assistant sent to
// Aivi and what the devices sent back, with how each went: the place to
// look when a widget does not show what it should. The hub's bar opens
// it; its Events panel shows the latest few presses and links here,
// narrowed to them.
//
// Two selects narrow it, like the editor's form controls: what to show
// (everything, one direction, or the problems alone) and which widget or
// Live Activity it is about. They are view-local, like the hub's search;
// an editor's Log card opens the page with them on its binding, the
// Events panel with "Show" on the presses (the panel's `logPreset`).
// Light DOM, inside the panel's shadow root, so the panel's styles reach
// it.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import {
  type ActivityItem,
  activityOf,
  activityRow,
  boundOf,
  streamLine,
  wentWell,
} from "./activity-rows";
import type { AiviPanel } from "./aivi-panel";
import { define } from "./define";
import { t, tPlural } from "./i18n";
import { icon } from "./icons";
import type { Account } from "./types/accounts";

export type Show = "all" | "pushes" | "presses" | "problems";

export const SHOWS: readonly Show[] = ["all", "pushes", "presses", "problems"];

/** The "For" value that narrows to nothing. */
export const ANY = "any";

/** Whether a row went wrong: a push retrying, failed or waiting on a
 * field with no value, a press failed, expired or not handled. An
 * unchanged push is not a problem, nor one the throttle holds. */
export function isProblem(item: ActivityItem): boolean {
  return (
    !wentWell(item) &&
    !(item.kind === "push" && (item.row.outcome === "unchanged" || item.row.outcome === "held"))
  );
}

export function matchesShow(item: ActivityItem, show: Show): boolean {
  switch (show) {
    case "all":
      return true;
    case "pushes":
      return item.kind === "push";
    case "presses":
      return item.kind === "press";
    default:
      return isProblem(item);
  }
}

/** The "For" key of a binding: its kind and slug. */
export function subjectKey(kind: string, slug: string): string {
  return `${kind}:${slug}`;
}

/** The "For" key of a row. */
export function subjectOf(item: ActivityItem): string {
  return subjectKey(item.row.kind, item.row.slug);
}

export function matchesFor(item: ActivityItem, subject: string): boolean {
  return subject === ANY || subjectOf(item) === subject;
}

class AiviActivityLog extends LitElement {
  static override properties = {
    panel: { attribute: false },
    // The panel's revision: a refresh (accounts, their bindings) or a
    // live update re-renders the page.
    rev: { attribute: false },
    _account: { state: true },
    _show: { state: true },
    _for: { state: true },
  };
  declare panel: AiviPanel;
  declare rev: number;
  declare private _account: string | null;
  declare private _show: Show;
  declare private _for: string;
  /** The select that takes the focus once it renders: the one a preset
   * narrowed. */
  private _focus: "show" | "for" | null = null;

  constructor() {
    super();
    this._account = null;
    this._show = "all";
    this._for = ANY;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("logpage");
    const preset = this.panel.logPreset;
    if (preset) {
      if (preset.entryId) this._account = preset.entryId;
      if (preset.show) this._show = preset.show;
      if (preset.subject) this._for = preset.subject;
      this._focus = preset.subject ? "for" : preset.show ? "show" : null;
      this.panel.logPreset = null;
    }
  }

  /** A select's value is bound before its options render, and a preset
   * "For" may name an option that only comes with the rows: set both
   * again once the options are there. */
  override updated(): void {
    const show = this.querySelector<HTMLSelectElement>(
      `.logsel select[aria-label="${t("log.show-label")}"]`,
    );
    const subject = this.querySelector<HTMLSelectElement>(
      `.logsel select[aria-label="${t("log.for-label")}"]`,
    );
    if (show && show.value !== this._show) show.value = this._show;
    if (subject && subject.value !== this._for) subject.value = this._for;
    // Opened narrowed (an editor's link, the Events panel's): the
    // narrowing select takes the focus, so what the page shows is the
    // first thing read out.
    const target = this._focus === "for" ? subject : this._focus === "show" ? show : null;
    if (target) {
      this._focus = null;
      target.focus();
    }
  }

  private _acc(): Account | null {
    const accounts = this.panel.accounts;
    return accounts.find((a) => a.entry_id === this._account) ?? accounts[0] ?? null;
  }

  override render(): unknown {
    const panel = this.panel;
    const acc = this._acc();
    return html`${this._bar()}${
      acc
        ? html`${this._accounts(acc)}<ul class="evstreams logstreams">${streamLine(
            acc,
            panel.streamOf(acc),
            false,
          )}</ul>${this._list(acc)}<div class="logfoot">${t(
            acc.keep_log ? "log.footer-kept" : "log.footer-memory",
          )}</div>`
        : html`<div class="evempty">${t("log.empty")}</div>`
    }`;
  }

  /** HA toolbar anatomy, like the editor's: Back, then the page's name. */
  private _bar(): TemplateResult {
    const panel = this.panel;
    return html`<div class="topbar">${panel.menuButton()}<button
        class="backbtn iconbtn"
        aria-label=${t("common.back")}
        title=${t("common.back")}
        @click=${() => panel.closeLog()}
      >${icon("arrow-left")}</button><div class="title">${t("log.title")}</div><div class="grow"></div></div>`;
  }

  /** Which account's log, only when there is a choice. */
  private _accounts(acc: Account): unknown {
    const accounts = this.panel.accounts;
    if (accounts.length < 2) return nothing;
    return html`<div class="fchips logaccts" role="group" aria-label=${t("log.account-label")}>${accounts.map(
      (a) =>
        html`<button
          type="button"
          class=${`fchip${a.entry_id === acc.entry_id ? " on" : ""}`}
          aria-pressed=${a.entry_id === acc.entry_id ? "true" : "false"}
          @click=${() => {
            this._account = a.entry_id;
          }}
        >${a.title}</button>`,
    )}</div>`;
  }

  private _reset(): void {
    this._show = "all";
    this._for = ANY;
  }

  private _list(acc: Account): TemplateResult {
    const panel = this.panel;
    const all = activityOf(panel, acc);
    const bySubject = all.filter((item) => matchesFor(item, this._for));
    const byShow = all.filter((item) => matchesShow(item, this._show));
    const shown = bySubject.filter((item) => matchesShow(item, this._show));
    const filtered = this._show !== "all" || this._for !== ANY;
    // What the log is about: every widget and Live Activity with a row,
    // by name, with how many rows it has under the current "Show".
    const subjects = new Map<string, { name: string; count: number }>();
    for (const item of byShow) {
      const key = subjectOf(item);
      const name = boundOf(acc, item.row.kind, item.row.slug)?.name ?? item.row.slug;
      const entry = subjects.get(key) ?? { name, count: 0 };
      entry.count++;
      subjects.set(key, entry);
    }
    for (const item of all) {
      const key = subjectOf(item);
      if (!subjects.has(key))
        subjects.set(key, {
          name: boundOf(acc, item.row.kind, item.row.slug)?.name ?? item.row.slug,
          count: 0,
        });
    }
    const sorted = [...subjects.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    const option = (label: string, count: number): string =>
      t("log.option-count", { label, count });
    return html`<div class="logsels"><div class="logsel"><span class="k">${t("log.show-label")}</span><select
          aria-label=${t("log.show-label")}
          .value=${this._show}
          @change=${(e: Event) => {
            this._show = (e.target as HTMLSelectElement).value as Show;
          }}
        >${SHOWS.map(
          (show) =>
            html`<option value=${show} ?selected=${show === this._show}>${option(
              t(`log.show-${show}`),
              bySubject.filter((item) => matchesShow(item, show)).length,
            )}</option>`,
        )}</select></div><div class="logsel"><span class="k">${t("log.for-label")}</span><select
          aria-label=${t("log.for-label")}
          .value=${this._for}
          @change=${(e: Event) => {
            this._for = (e.target as HTMLSelectElement).value;
          }}
        ><option value=${ANY} ?selected=${this._for === ANY}>${option(
          t("log.for-any"),
          byShow.length,
        )}</option>${sorted.map(
          ([key, { name, count }]) =>
            html`<option value=${key} ?selected=${key === this._for}>${option(name, count)}</option>`,
        )}</select></div></div>${
          filtered
            ? html`<div class="logcount" role="status">${tPlural("log.showing", all.length, {
                shown: shown.length,
              })}<button type="button" class="btn quiet small" @click=${() => this._reset()}>${t(
                "log.show-everything",
              )}</button></div>`
            : nothing
        }${
          !all.length
            ? html`<div class="logcard"><div class="evempty">${t("log.empty")}</div></div>`
            : !shown.length
              ? html`<div class="logcard"><div class="evempty">${t("log.no-matches")}<div><button
                type="button"
                class="btn quiet small"
                @click=${() => this._reset()}
              >${t("log.show-everything")}</button></div></div></div>`
              : html`<div class="logcard"><ul class="alist loglist" aria-label=${t("log.list-label")}>${shown.map(
                  (item) =>
                    activityRow(panel, item, { where: true, account: false, dateful: true }),
                )}</ul></div>`
        }`;
  }
}

define("aivi-activity-log", AiviActivityLog);
