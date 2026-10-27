// The hub: a grid of all the account's widgets (bound or not) merged with
// the bound state from aivi/config, plus the Live Activities section.
// Binding is an action on a widget, not a separate "add" wizard.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { feederNote } from "./aivi-feeder-warning";
import type { AiviPanel } from "./aivi-panel";
import { templateInfo } from "./const";
import { define } from "./define";
import {
  cardStatus,
  chipCounts,
  filtering,
  HUB_CHIPS,
  type HubCardFacts,
  type HubChip,
  matches,
} from "./hub-filter";
import { i18nLocale, t, tPlural, tSplit } from "./i18n";
import { icon } from "./icons";
import { banner, note } from "./notice";
import {
  AIVI_APP_URL,
  accountEmpty,
  CONFIG_FLOW_PATH,
  startConfigFlow,
  TOKEN_DOCS_URL,
} from "./onboarding";
import type {
  Account,
  BindingStatus,
  BoundWidget,
  RemoteActivity,
  RemoteWidget,
} from "./types/accounts";
import type { HassLike } from "./types/hass";
import { errMsg, readsOn } from "./util";
import { markerOf } from "./value-source";
import { waitingLine } from "./waiting";

/** "Fed by <the first couple of sources>", shared by both card kinds.
 * Sources are entities, named: a field's own, and each row of a list.
 * Fixed values (an icon, a color, a label) feed nothing and are left out. */
function bindingSummary(hass: HassLike, bound: BoundWidget): TemplateResult {
  const b = bound.bindings ?? {};
  const parts: string[] = [];
  const add = (v: unknown): void => {
    const st = typeof v === "string" ? hass.states[v] : undefined;
    if (!st) return;
    const name = String(st.attributes.friendly_name || v);
    if (!parts.includes(name)) parts.push(name);
  };
  for (const [k, v] of Object.entries(b)) {
    if (markerOf(k) === "entity") add(v);
    else if (k.includes("__")) continue;
    else if (Array.isArray(v)) v.forEach(add);
    else add(v);
  }
  const tcount = Object.keys(b).filter((k) => markerOf(k) === "template" && b[k]).length;
  if (tcount) parts.push(tPlural("hub.template-count", tcount));
  const text = parts.slice(0, 2).join(", ") + (parts.length > 2 ? `, +${parts.length - 2}` : "");
  const [before, after] = tSplit("hub.fed-by", "sources");
  return html`${before}<b>${text || t("hub.nothing-yet")}</b>${after}`;
}

/** A bound card's warning while its content waits for a value: nothing
 * is sent until the field reads something. */
function waitingNote(
  status: BindingStatus | null,
  bound: BoundWidget,
  kind: "widget" | "activity",
): unknown {
  const waiting = status?.waiting;
  if (!waiting) return nothing;
  return note("warn", waitingLine(waiting, bound.template, kind), { cls: "waiting" });
}

/** How long an armed confirm ignores presses: the second half of a
 * double-click must not be the confirmation. */
export const UNBIND_ARM_DELAY_MS = 400;

/** The one armed confirm on the page; arming another disarms it. */
let armedButton: AiviUnbindButton | null = null;

/** Put focus back in the hub after an action removed the control that
 * had it (a banner's button, a card's): the pressed status chip, a
 * button that is always there and opens no keyboard. */
function refocusHub(hub: Element | null): void {
  const root = hub?.getRootNode();
  if (!hub || !(root instanceof ShadowRoot || root instanceof Document)) return;
  const active = root.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  (
    hub.querySelector<HTMLElement>(".fchip.on") ?? hub.querySelector<HTMLElement>("button, a[href]")
  )?.focus();
}

/** A card is one target: a press anywhere on it that is not one of its
 * own controls opens its editor, like its Edit / Set up button (which
 * stays the keyboard's way in, so the card adds no second tab stop). */
function cardPress(card: HTMLElement, open: (() => void) | null): void {
  card.onclick = open
    ? (e: MouseEvent): void => {
        const target = e.target as Element | null;
        // A drag that selected the name is not a press.
        if (target?.closest("button, a, dialog") || String(getSelection())) return;
        open();
      }
    : null;
}

/** Two-step destructive confirm: never a silent unbind. The armed state
 * takes a moment to accept (a double-click arms, it does not confirm),
 * and Escape, moving focus away or arming another card disarms it. */
class AiviUnbindButton extends LitElement {
  static override properties = {
    panel: { attribute: false },
    acc: { attribute: false },
    bound: { attribute: false },
    _armed: { state: true },
    _busy: { state: true },
  };
  declare panel: AiviPanel;
  declare acc: Account;
  declare bound: BoundWidget;
  declare private _armed: boolean;
  declare private _busy: boolean;

  private _timer: number | undefined;
  private _armedAt = 0;

  constructor() {
    super();
    this._armed = false;
    this._busy = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._disarm();
  }

  private _disarm(): void {
    clearTimeout(this._timer);
    this._armed = false;
    if (armedButton === this) armedButton = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): unknown {
    // aria-live: the armed state swaps the label of the *focused* button
    // ("Unbind" -> "Really unbind?"), which screen readers don't re-read
    // on their own; the live region makes the arming audible.
    // Busy is aria-disabled, not disabled: a disabled button drops the
    // focus it holds, and focus would fall to the page.
    return html`<button
      class=${this._armed ? "btn danger small" : "btn ghost small"}
      aria-live="polite"
      aria-disabled=${this._busy ? "true" : "false"}
      @click=${() => void this._click()}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || !this._armed || this._busy) return;
        e.stopPropagation();
        this._disarm();
      }}
      @blur=${() => {
        if (!this._busy) this._disarm();
      }}
    >${this._armed ? t("hub.unbind-confirm") : t("hub.unbind")}</button>`;
  }

  private async _click(): Promise<void> {
    if (this._busy) return;
    if (!this._armed) {
      if (armedButton && armedButton !== this && !armedButton._busy) armedButton._disarm();
      armedButton = this;
      this._armed = true;
      this._armedAt = performance.now();
      this._timer = window.setTimeout(() => this._disarm(), 4000);
      return;
    }
    if (performance.now() - this._armedAt < UNBIND_ARM_DELAY_MS) return;
    clearTimeout(this._timer);
    this._busy = true;
    const name = this.bound.name;
    const slug = this.bound.slug;
    // The card re-renders without this button once the binding is gone:
    // remember which card it is, so focus can stay on it.
    const hub = this.closest("aivi-hub");
    const cardTag = this.closest("aivi-widget-card, aivi-activity-card")?.localName;
    try {
      await this.panel.api.delete(this.acc.entry_id, this.bound.subentry_id);
    } catch (err) {
      this._busy = false;
      this._disarm();
      this.panel.toast(t("hub.unbind-failed", { name, error: errMsg(err) }));
      // Never disabled, so focus is still here; if the user pressed
      // elsewhere during the call, focus stays where they put it.
      return;
    }
    try {
      await this.panel.refresh();
    } catch {
      // The binding is gone either way; the hub keeps what it last read
      // until the next refresh.
    } finally {
      this._busy = false;
      this._disarm();
    }
    this.panel.toast(t("hub.unbound-toast", { name }));
    if (!hub || !cardTag) return;
    await (hub as LitElement).updateComplete;
    const card = [...hub.querySelectorAll<AiviWidgetCard | AiviActivityCard>(cardTag)].find(
      (c) => (c.remote ?? c.bound)?.slug === slug,
    );
    await card?.updateComplete;
    const root = hub.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    // Place focus only if nothing else took it meanwhile.
    if (active && active !== document.body && active.isConnected) return;
    const next = card?.querySelector<HTMLElement>("button");
    if (next) next.focus();
    else refocusHub(hub);
  }
}

export class AiviWidgetCard extends LitElement {
  static override properties = {
    panel: { attribute: false },
    acc: { attribute: false },
    remote: { attribute: false },
    bound: { attribute: false },
    offline: { attribute: false },
    status: { attribute: false },
    // Read through the panel; a property so the card follows a change.
    automations: { attribute: false },
  };
  declare panel: AiviPanel;
  declare acc: Account;
  declare remote: RemoteWidget | null;
  declare bound: BoundWidget | null;
  /** How the bound widget's pushing stands, while the account says. */
  declare status: BindingStatus | null;
  /** Aivi is unreachable: the remote list is unknown, not empty, so a
   * bound card without a remote match must not claim the widget vanished
   * (the offline banner already states that Aivi cannot be reached). */
  declare offline: boolean;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): unknown {
    const w = this.remote ?? this.bound;
    if (!w) return nothing;
    const bound = this.bound;
    const info = templateInfo(w.template);
    const supported = this.remote ? this.remote.supported !== false : true;
    const missingRemote = !this.remote && !this.offline;
    const summary = bound
      ? bindingSummary(this.panel.hass, bound)
      : supported
        ? (info.hint ?? "")
        : (info.retired ?? t("hub.unsupported"));
    cardPress(
      this,
      bound || supported ? () => this.panel.openEditor(this.acc, this.remote, bound) : null,
    );
    return html`<div class="head">${
      bound
        ? this.panel.inactive[this.acc.entry_id]
          ? html`<span class="dot warn" title=${t("hub.paused-mark")}></span>`
          : this.status?.waiting
            ? html`<span class="dot warn" title=${t("hub.waiting-dot")}></span>`
            : html`<span class="dot on" title=${t("hub.fed-dot")}></span>`
        : nothing
    }<span class="nm">${w.name}</span>${
      bound
        ? html`<aivi-feeder-warning .panel=${this.panel} .kind=${"widget"} .slug=${w.slug} .automations=${this.panel.automations}></aivi-feeder-warning>`
        : nothing
    }<div class="grow"></div><span class="chip secondary">${info.label}</span></div>${
      missingRemote && bound ? note("warn", t("hub.widget-gone"), { cls: "gone" }) : nothing
    }<div class="sum">${summary}</div>${
      bound ? waitingNote(this.status, bound, "widget") : feederNote(this.panel, "widget", w.slug)
    }<div class="foot">${
      bound
        ? html`<button
              class="btn secondary small"
              @click=${() => this.panel.openEditor(this.acc, this.remote, bound)}
            >${t("common.edit")}</button><aivi-unbind-button .panel=${this.panel} .acc=${this.acc} .bound=${bound}></aivi-unbind-button>`
        : supported
          ? html`<button
              class="btn secondary small"
              @click=${() => this.panel.openEditor(this.acc, this.remote, null)}
            >${t("hub.bind")}</button>`
          : nothing
    }</div>`;
  }
}

/** One Live Activity card, mirroring AiviWidgetCard's states. The dot
 * shows whether a bound activity is running: its active entity reads on,
 * by the integration's rule. */
class AiviActivityCard extends LitElement {
  static override properties = {
    panel: { attribute: false },
    acc: { attribute: false },
    remote: { attribute: false },
    bound: { attribute: false },
    offline: { attribute: false },
    status: { attribute: false },
    // Read through the panel; a property so the card follows a change.
    automations: { attribute: false },
  };
  declare panel: AiviPanel;
  declare acc: Account;
  declare remote: RemoteActivity | null;
  declare bound: BoundWidget | null;
  /** See AiviWidgetCard.offline: unreachable is not vanished. */
  declare offline: boolean;
  /** See AiviWidgetCard.status. */
  declare status: BindingStatus | null;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): unknown {
    const a = this.remote ?? this.bound;
    if (!a) return nothing;
    const bound = this.bound;
    const info = templateInfo(a.template);
    const supported = this.remote ? this.remote.supported !== false : true;
    const missingRemote = !this.remote && !this.offline;
    cardPress(
      this,
      bound || supported ? () => this.panel.openActivityEditor(this.acc, this.remote, bound) : null,
    );
    if (!bound) {
      return html`<div class="head"><span class="nm">${a.name}</span><div class="grow"></div><span class="chip secondary">${info.label}</span></div><div class="sum">${
        supported ? (info.hint ?? "") : (info.retired ?? t("hub.unsupported"))
      }</div>${feederNote(this.panel, "activity", a.slug)}<div class="foot">${
        supported
          ? html`<button
              class="btn secondary small"
              @click=${() => this.panel.openActivityEditor(this.acc, this.remote, null)}
            >${t("hub.bind")}</button>`
          : nothing
      }</div>`;
    }
    const active = bound.active ? this.panel.hass.states[bound.active] : null;
    const running = !!active && readsOn(active.state, this.panel.meta.on_states);
    const [runsBefore, runsAfter] = tSplit("hub.runs-on", "entity");
    // A paused account's Live Activity is not updated, whatever its entity.
    const dot = this.panel.inactive[this.acc.entry_id]
      ? html`<span class="dot warn" title=${t("hub.paused-mark")}></span>`
      : html`<span class=${`dot ${running ? "on" : "off"}`} title=${running ? t("hub.running-dot") : t("hub.idle-dot")}></span>`;
    return html`<div class="head">${dot}<span class="nm">${a.name}</span><aivi-feeder-warning .panel=${this.panel} .kind=${"activity"} .slug=${a.slug} .automations=${this.panel.automations}></aivi-feeder-warning><div class="grow"></div><span class="chip secondary">${info.label}</span></div>${
      missingRemote ? note("warn", t("hub.activity-gone"), { cls: "gone" }) : nothing
    }<div class="sum">${bindingSummary(this.panel.hass, bound)}${
      bound.active
        ? html` · ${runsBefore}<b>${active?.attributes.friendly_name || bound.active}</b>${runsAfter}`
        : ""
    }</div>${waitingNote(this.status, bound, "activity")}<div class="foot"><button
        class="btn secondary small"
        @click=${() => this.panel.openActivityEditor(this.acc, this.remote, bound)}
      >${t("common.edit")}</button><aivi-unbind-button .panel=${this.panel} .acc=${this.acc} .bound=${bound}></aivi-unbind-button></div>`;
  }
}

/** A hub card plus the facts the search/filter matches against. */
interface CardEntry {
  remote: RemoteWidget | null;
  bound: BoundWidget | null;
  facts: HubCardFacts;
}

/** Name + template (slug and localized label) are what search matches. */
function facts(name: string, template: string, status: HubCardFacts["status"]): HubCardFacts {
  return { name, template: [template, templateInfo(template).label], status };
}

/** Merge a remote list with the bound subentries: the remote list is the
 * source of truth for what exists; bound entries whose remote counterpart
 * vanished still show (with a note). Used for widgets and Live Activities. */
function mergeCards(
  remote: readonly RemoteWidget[] | null,
  bound: readonly BoundWidget[],
): CardEntry[] {
  const boundBySlug = new Map(bound.map((b) => [b.slug, b]));
  const entries: CardEntry[] = [];
  const seen = new Set<string>();
  for (const r of remote ?? []) {
    seen.add(r.slug);
    const b = boundBySlug.get(r.slug) ?? null;
    entries.push({
      remote: r,
      bound: b,
      facts: facts(r.name, r.template, cardStatus(!!b, r.supported !== false)),
    });
  }
  for (const b of bound) {
    if (!seen.has(b.slug))
      entries.push({
        remote: null,
        bound: b,
        facts: facts(b.name, b.template, "bound"),
      });
  }
  return entries;
}

class AiviHub extends LitElement {
  static override properties = {
    panel: { attribute: false },
    rev: { attribute: false },
    _resultNote: { state: true },
  };
  declare panel: AiviPanel;
  /** The panel's data revision; bumped on every refresh so the hub
   * re-renders even though the `panel` reference never changes. */
  declare rev: number;
  // Search/filter state is kept out of the URL: the hub route
  // stays /aivi and browser back never replays a search (see
  // hub-filter.ts). It lives on the panel, which outlives the hub: a
  // visit to an editor comes back to the same search.
  private get _query(): string {
    return this.panel.hubQuery;
  }
  private set _query(value: string) {
    this.panel.hubQuery = value;
    this.requestUpdate();
  }
  private get _chip(): HubChip {
    return this.panel.hubChip;
  }
  private set _chip(value: HubChip) {
    this.panel.hubChip = value;
    this.requestUpdate();
  }
  /** Screen-reader announcement of the filtered result count. Debounced
   * past the typing cadence so it doesn't narrate every keystroke; empty
   * when no filter is active. */
  declare private _resultNote: string;

  private _announceTimer: number | undefined;

  constructor() {
    super();
    this._resultNote = "";
  }

  /** A banner's action can take the banner (and the focus on its button)
   * away: keep focus in the hub. */
  private async _afterBanner(action: () => void | Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      this.panel.toast(errMsg(err));
    }
    await this.updateComplete;
    refocusHub(this);
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._announceTimer);
  }

  /** The count is read from the rendered grid when the timer fires, so it
   * always matches what the user sees. */
  private _scheduleAnnounce(): void {
    clearTimeout(this._announceTimer);
    this._announceTimer = window.setTimeout(() => {
      if (!filtering(this._query, this._chip)) {
        this._resultNote = "";
        return;
      }
      const count = this.querySelectorAll("aivi-widget-card, aivi-activity-card").length;
      this._resultNote = tPlural("hub.results", count);
    }, 600);
  }

  private _clearFilters(): void {
    this._query = "";
    this._chip = "all";
    this._scheduleAnnounce();
    // Focus the search box so clearing flows into retyping.
    void this.updateComplete.then(() =>
      this.querySelector<HTMLInputElement>(".hubbar input")?.focus(),
    );
  }

  /** The search box + status chips. Rendered whenever anything is
   * searchable, and always first in the template, so typing re-renders
   * update the toolbar's DOM in place and never move focus. */
  private _toolbar(all: readonly HubCardFacts[]): TemplateResult {
    const counts = chipCounts(all, this._query);
    const chips = HUB_CHIPS.filter((c) => c !== "unsupported" || counts[c] > 0 || this._chip === c);
    return html`<div class="hubbar" role="search"><input
        type="search"
        .value=${this._query}
        placeholder=${t("hub.search-placeholder")}
        aria-label=${t("hub.search-label")}
        @input=${(e: Event) => {
          this._query = (e.target as HTMLInputElement).value;
          this._scheduleAnnounce();
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape" && this._query) {
            e.stopPropagation();
            this._query = "";
            this._scheduleAnnounce();
          }
        }}
      /><div class="fchips" role="group" aria-label=${t("hub.filter-label")}>${chips.map(
        // Toggle buttons (aria-pressed) in the normal tab order rather than
        // a roving-tabindex APG toolbar: four chips are cheaper to reach
        // directly than to teach an arrow-key convention.
        (c) =>
          html`<button
            class=${`fchip${this._chip === c ? " on" : ""}`}
            aria-pressed=${this._chip === c ? "true" : "false"}
            @click=${() => {
              this._chip = c;
              this._scheduleAnnounce();
            }}
          >${t(`hub.filter-${c}`)}<span class="n">${counts[c]}</span></button>`,
      )}</div><span class="sr-only" role="status">${this._resultNote}</span></div>`;
  }

  /** No account yet: the onboarding card. The config-flow link is a real
   * anchor so middle-click/open-in-new-tab work; a plain click navigates
   * HA's router without a page load. */
  private _onboarding(): TemplateResult {
    return html`<div class="hero-empty"><h2>${t("onboarding.title")}</h2><p>${t("onboarding.body")}</p><div class="actions"><a
          class="btn primary"
          href=${CONFIG_FLOW_PATH}
          @click=${(e: Event) => {
            e.preventDefault();
            startConfigFlow();
          }}
        >${t("onboarding.connect")}</a></div><p class="subnote"><a href=${TOKEN_DOCS_URL} target="_blank" rel="noreferrer">${t("onboarding.token-help")}</a></p></div>`;
  }

  /** The Aivi app, in a new tab: the one place widgets and Live
   * Activities are created. */
  private _appLink(cls: string): TemplateResult {
    return html`<a class=${cls} href=${AIVI_APP_URL} target="_blank" rel="noreferrer">${t("hub.empty-cta")}${icon("open-in-new")}</a>`;
  }

  /** The top bar's Refresh, spelled out where an empty list says to use
   * it: nothing the app creates shows up here on its own. What it finds
   * replaces the empty state, button and all, so focus is put back in
   * the hub. */
  private _refreshButton(cls: string): TemplateResult {
    const state = this.panel.refreshState;
    return html`<button
      type="button"
      class=${`${cls} rfbtn ${state}`}
      aria-busy=${state === "busy" ? "true" : "false"}
      aria-disabled=${state === "idle" ? "false" : "true"}
      @click=${() => void this._afterBanner(() => this.panel.checkForChanges())}
    >${icon("refresh")}${t("hub.refresh")}</button>`;
  }

  /** Connected and reachable, with no widgets and no Live Activities:
   * how they get here, as steps, in the account's own section. (When
   * Aivi is unreachable or the account paused, the lists are unknown,
   * not empty: nothing is claimed and the banner alone explains.) */
  private _emptyAccount(acc: Account, inSection: boolean): TemplateResult {
    const panel = this.panel;
    const id = `empty-${acc.entry_id}`;
    // Refresh found nothing new: say so here too, where it was pressed.
    const same = panel.refreshState === "done" && !panel.fresh.size;
    return html`<section class=${`acct-empty${inSection ? " in-section" : ""}`} aria-labelledby=${id}>
      <h2 id=${id}>${t("hub.empty-title")}</h2>
      <p class="lead">${t("hub.empty-body")}</p>
      <ol class="steps">
        <li>${t("hub.empty-step-create")}</li>
        <li>${t("hub.empty-step-refresh")}</li>
        <li>${t("hub.empty-step-feed")}</li>
      </ol>
      <div class="actions">${this._appLink("btn primary")}${this._refreshButton("btn quiet")}</div>
      ${same ? html`<p class="rfnote">${t("hub.refresh-same")}</p>` : nothing}
    </section>`;
  }

  /** One list empty while the other has cards: a line where the list
   * would be, so the page never reads as if one kind did not exist. */
  private _emptyNote(kind: "widgets" | "activities"): TemplateResult {
    return html`<div class="empty-note"><p>${t(`hub.empty-${kind}-note`)}</p><div class="actions">${this._appLink(
      "btn ghost small",
    )}${this._refreshButton("btn ghost small")}</div></div>`;
  }

  override render(): unknown {
    const panel = this.panel;
    if (!panel.accounts.length) return this._onboarding();

    // First-bind banner (not a toast, so it persists until dismissed). Set
    // by the editor when a save takes the bound count 0 -> 1.
    const firstBind = panel.firstBindName
      ? banner(
          "ok",
          html`<b>${t("onboarding.first-bind-title")}</b> ${t("onboarding.first-bind-body", { name: panel.firstBindName })}`,
          {
            role: "status",
            action: html`<button
              class="btn quiet small"
              @click=${() => void this._afterBanner(() => panel.dismissFirstBind())}
            >${t("onboarding.first-bind-dismiss")}</button>`,
          },
        )
      : nothing;

    // Gather every account's cards up front so the toolbar counts span
    // all sections.
    const perAccount = panel.accounts.map((acc) => {
      const remote = panel.aiviWidgets[acc.entry_id];
      const remoteActs = panel.aiviActivities[acc.entry_id];
      const widgets = mergeCards(remote ?? null, acc.widgets);
      const activities = mergeCards(remoteActs ?? null, acc.activities ?? []);
      return {
        acc,
        // One API serves both lists, so either failing means Aivi is
        // unreachable.
        offline: remote === null || remoteActs === null,
        widgets,
        activities,
      };
    });

    const all = perAccount.flatMap((s) => [...s.widgets, ...s.activities].map((e) => e.facts));
    const active = filtering(this._query, this._chip);
    const query = this._query;
    const chip = this._chip;

    // With several accounts each has its own sections: when only some
    // are paused, theirs say so in their headings.
    const somePaused =
      panel.accounts.some((acc) => panel.inactive[acc.entry_id]) &&
      !panel.accounts.every((acc) => panel.inactive[acc.entry_id]);
    const pausedMark = (acc: Account): unknown =>
      somePaused && panel.inactive[acc.entry_id]
        ? html`<span class="chip warn">${t("hub.paused-mark")}</span>`
        : nothing;

    // A section's heading: the account's name when there are several (a
    // long one ellipsized, so what follows it stays readable), then what
    // the section holds, then the paused mark.
    const heading = (acc: Account, kind: string | null): TemplateResult =>
      panel.accounts.length > 1
        ? html`<div class="eyebrow"><span class="eb-name" title=${acc.title}>${acc.title}</span>${
            kind ? html`<span class="eb-kind">· ${kind}</span>` : nothing
          }${pausedMark(acc)}</div>`
        : html`<div class="eyebrow">${kind ?? t("hub.widgets")}</div>`;

    const sections: unknown[] = [];
    let shown = 0;
    for (const { acc, offline, widgets, activities } of perAccount) {
      const dimClass = (e: CardEntry, kind: "widget" | "activity" = "widget"): string =>
        "wcard" +
        ((e.remote ? e.remote.supported !== false : true) || e.bound ? "" : " dim") +
        // What a refresh just found glows once (see panel.fresh).
        (panel.fresh.has(`${kind}:${(e.remote ?? e.bound)?.slug ?? ""}`) ? " fresh" : "");
      const card = (e: CardEntry): TemplateResult =>
        html`<aivi-widget-card
          class=${dimClass(e)}
          .automations=${panel.automations}
          .panel=${panel}
          .acc=${acc}
          .remote=${e.remote}
          .bound=${e.bound}
          .offline=${offline}
          .status=${e.bound ? panel.statusOf(acc, e.bound.subentry_id) : null}
        ></aivi-widget-card>`;
      const cards = widgets.filter((e) => matches(e.facts, query, chip)).map(card);
      shown += cards.length;
      // While filtering, a section with no matches is omitted (the
      // toolbar's no-matches state covers the all-empty case below), and
      // what an empty account says waits until the filter is cleared.
      const emptyKind = active ? null : accountEmpty(offline, widgets.length, activities.length);
      if (emptyKind === "nothing") {
        // The account's own card: under its name when there are several,
        // else the page's only content.
        const several = panel.accounts.length > 1;
        if (several) sections.push(heading(acc, null));
        sections.push(this._emptyAccount(acc, several));
        continue;
      }
      if (cards.length) sections.push(heading(acc, null), html`<div class="cards">${cards}</div>`);
      else if (emptyKind === "no-widgets")
        sections.push(heading(acc, null), this._emptyNote("widgets"));

      // Activities are defined in the Aivi app; there is no in-panel create flow.
      const actCards: TemplateResult[] = activities
        .filter((e) => matches(e.facts, query, chip))
        .map(
          (e) =>
            html`<aivi-activity-card class=${dimClass(e, "activity")} .panel=${panel} .acc=${acc} .remote=${e.remote} .bound=${e.bound} .offline=${offline} .status=${e.bound ? panel.statusOf(acc, e.bound.subentry_id) : null} .automations=${panel.automations}></aivi-activity-card>`,
        );
      shown += actCards.length;
      if (actCards.length) {
        sections.push(
          heading(acc, t("hub.live-activities")),
          html`<div class="cards">${actCards}</div>`,
        );
      } else if (emptyKind === "no-activities") {
        sections.push(heading(acc, t("hub.live-activities")), this._emptyNote("activities"));
      }
    }

    // Blame the search text only when it alone matches nothing; when a
    // status chip empties the result, "No matches for X" would contradict
    // the visible chip counts.
    const queryAlone = !query.trim() || chipCounts(all, query).all === 0;
    const empty =
      active && shown === 0
        ? html`<div class="hero-empty" role="status"><p>${
            query.trim() && queryAlone
              ? t("hub.no-matches", { query: query.trim() })
              : t("hub.no-matches-filter")
          }</p><div style="margin-top:14px"><button
              class="btn quiet"
              @click=${() => this._clearFilters()}
            >${t("hub.clear-search")}</button></div></div>`
        : nothing;

    return html`${firstBind}${all.length ? this._toolbar(all) : nothing}${this._banners(perAccount)}${sections}${empty}`;
  }

  /** One banner for the page, however many accounts it concerns: a
   * paused subscription (naming the accounts when there are several; the
   * accounts menu says when each ended), and Aivi out of reach. */
  private _banners(perAccount: { acc: Account; offline: boolean }[]): unknown {
    const panel = this.panel;
    const paused = perAccount.filter(({ acc }) => panel.inactive[acc.entry_id]);
    const unreachable = perAccount.some(
      ({ acc, offline }) => offline && !panel.inactive[acc.entry_id],
    );
    const check = (label: string): TemplateResult =>
      html`<button class="btn quiet small" @click=${() => void this._afterBanner(() => panel.refresh())}>${label}</button>`;
    const pausedText =
      perAccount.length === 1
        ? t("hub.subscription-inactive")
        : tPlural("hub.subscription-inactive-some", paused.length, {
            names: listFormat(paused.map(({ acc }) => shortName(acc.title))),
          });
    return html`${
      paused.length
        ? banner("warn", pausedText, { role: "status", action: check(t("hub.check-again")) })
        : nothing
    }${
      unreachable
        ? banner("warn", t("hub.offline"), { role: "status", action: check(t("common.retry")) })
        : nothing
    }`;
  }
}

/** An account name short enough to sit in a sentence; the accounts menu
 * shows it in full. */
function shortName(name: string): string {
  const chars = [...name];
  return chars.length > 32 ? `${chars.slice(0, 31).join("").trimEnd()}…` : name;
}

/** "Home and Cabin", "Home, Cabin and Office", in the panel's language. */
function listFormat(names: string[]): string {
  return new Intl.ListFormat(i18nLocale(), { type: "conjunction" }).format(names);
}

define("aivi-unbind-button", AiviUnbindButton);
define("aivi-widget-card", AiviWidgetCard);
define("aivi-activity-card", AiviActivityCard);
define("aivi-hub", AiviHub);
