// "Events" in the hub's top bar: what the devices send back into Home
// Assistant (tile presses today; whatever accepts input tomorrow). The
// button shows the event stream's state as a dot and blinks when an event
// lands; its panel says how each account's stream stands and lists the
// latest few events across everything the accounts bind, newest first,
// live from the panel's aivi/inputs/subscribe subscriptions, with a link
// to the rest of them on the Log page. The Log itself, both ways, has its
// own button beside this one (hub-bar.ts).
//
// It sits in the top bar, not beside the hub's "Widgets" heading: the
// stream belongs to the account, not to the widgets under that heading.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { type ActivityItem, activityRow, streamLine } from "./activity-rows";
import type { AiviPanel } from "./aivi-panel";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import { focusLeft, watchOutsidePress } from "./popover";
import type { Account, StreamStatus } from "./types/accounts";

export { whenText } from "./activity-rows";

type Tone = "ok" | "warn" | "bad" | "idle";
type PressItem = Extract<ActivityItem, { kind: "press" }>;

const TONE: Record<StreamStatus["state"], Tone> = {
  connected: "ok",
  reconnecting: "warn",
  paused: "warn",
  stopped: "bad",
};
const WORST: readonly Tone[] = ["bad", "warn", "ok"];

/** How long the button blinks for an event that just landed. */
const PING_MS = 1200;
/** An event this fresh just happened; an older one is the log loading. */
const JUST_NOW_MS = 15_000;
/** The panel lists this many events; the Log page has them all. */
export const SHOWN = 10;

/** The worst state among the streams: what the button's dot shows. No
 * stream at all is idle: nothing takes input, so nothing listens. */
export function worstTone(streams: readonly StreamStatus[]): Tone {
  const tones = new Set(streams.map((s) => TONE[s.state]));
  return WORST.find((tone) => tones.has(tone)) ?? (streams.length ? "ok" : "idle");
}

class AiviEvents extends LitElement {
  static override properties = {
    panel: { attribute: false },
    _open: { state: true },
    _ping: { state: true },
  };
  declare panel: AiviPanel;
  declare private _open: boolean;
  declare private _ping: boolean;
  private _unwatch: (() => void) | null = null;
  private _pingTimer: ReturnType<typeof setTimeout> | undefined;
  /** The newest event seen, to tell a new one from a re-render. */
  private _newest: string | null | undefined;

  constructor() {
    super();
    this._open = false;
    this._ping = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unwatch?.();
    this._unwatch = null;
    clearTimeout(this._pingTimer);
  }

  /** Every account with how its stream stands; null while nothing the
   * account binds takes input (the integration then holds no stream). */
  private _streams(): { acc: Account; stream: StreamStatus | null }[] {
    return this.panel.accounts.map((acc) => ({ acc, stream: this.panel.streamOf(acc) }));
  }

  private _events(): PressItem[] {
    return this.panel.accounts
      .flatMap((acc) =>
        this.panel
          .eventsOf(acc)
          .map((row): PressItem => ({ acc, kind: "press", row, time: row.time })),
      )
      .sort((a, b) => b.time.localeCompare(a.time));
  }

  private _toggle(open: boolean, refocus = false): void {
    this._open = open;
    if (refocus) this.querySelector<HTMLElement>(".evbtn")?.focus();
  }

  protected override willUpdate(): void {
    // An event that was not there at the last render, and that Home
    // Assistant received just now: the button blinks, open or closed. The
    // log arriving after the first render holds older events: no blink.
    const newest = this._events()[0]?.row;
    const key = newest ? `${newest.id ?? ""}|${newest.time}|${newest.count}` : null;
    const fresh = !!newest && Math.abs(Date.now() - Date.parse(newest.received_at)) < JUST_NOW_MS;
    if (this._newest !== undefined && key !== this._newest && fresh) {
      this._ping = true;
      clearTimeout(this._pingTimer);
      this._pingTimer = setTimeout(() => {
        this._ping = false;
      }, PING_MS);
    }
    this._newest = key;
  }

  /** A native, non-modal dialog that follows its state, like the
   * accounts panel: a press outside, Escape, or focus leaving closes it. */
  protected override updated(): void {
    const pop = this.querySelector<HTMLDialogElement>("dialog.evpop");
    if (pop && pop.open !== this._open) {
      if (this._open) {
        if (typeof pop.show === "function") pop.show();
        else pop.setAttribute("open", "");
        pop.focus();
      } else if (typeof pop.close === "function") pop.close();
      else pop.removeAttribute("open");
    }
    if (this._open && !this._unwatch)
      this._unwatch = watchOutsidePress(this, () => this._toggle(false));
    else if (!this._open && this._unwatch) {
      this._unwatch();
      this._unwatch = null;
    }
  }

  override render(): unknown {
    const streams = this._streams();
    if (!streams.length) return nothing;
    // Not listening is a state like the others, shown rather than hidden:
    // the button is always there, and its panel says why nothing arrives.
    const tone = worstTone(streams.flatMap((s) => (s.stream ? [s.stream] : [])));
    const state = t(`events.state-${tone}`);
    return html`<div
      class="evwrap"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || !this._open) return;
        e.stopPropagation();
        this._toggle(false, true);
      }}
      @focusout=${(e: FocusEvent) => {
        if (this._open && focusLeft(e, e.currentTarget as HTMLElement)) this._toggle(false);
      }}
    ><button
        type="button"
        class=${`iconbtn evbtn ${tone}${this._ping ? " ping" : ""}`}
        aria-label=${t("events.button", { state })}
        title=${t("events.tooltip")}
        aria-haspopup="dialog"
        aria-expanded=${this._open ? "true" : "false"}
        aria-controls="aivi-events"
        @click=${() => this._toggle(!this._open)}
      >${icon("pulse")}<span class="evdot" aria-hidden="true"></span></button>${this._panel(streams)}</div>`;
  }

  private _panel(streams: { acc: Account; stream: StreamStatus | null }[]): TemplateResult {
    const panel = this.panel;
    const events = this._open ? this._events().slice(0, SHOWN) : [];
    const several = panel.accounts.length > 1;
    const close = (): void => this._toggle(false);
    return html`<dialog
      class="evpop" id="aivi-events" tabindex="-1"
      aria-labelledby="aivi-events-title"
      @close=${() => {
        this._open = false;
      }}
    ><h3 id="aivi-events-title">${t("events.title")}</h3><ul class="evstreams">${streams.map(
      ({ acc, stream }) => streamLine(acc, stream, several),
    )}</ul>${
      !streams.some((s) => s.stream) && !events.length
        ? nothing // not listening: its own line states that, no empty feed under it
        : events.length
          ? html`<ul class="alist evlist" aria-label=${t("events.list-label")}>${events.map(
              (item) =>
                activityRow(panel, item, {
                  where: true,
                  account: several,
                  dateful: true,
                  onOpen: close,
                }),
            )}</ul>`
          : html`<div class="evempty">${t("events.empty")}</div>`
    }${
      events.length
        ? html`<div class="evfoot"><button
            type="button"
            class="evlink"
            @click=${() => {
              close();
              panel.logPreset = { show: "presses" };
              panel.openLog();
            }}
          >${t("events.see-all")}</button></div>`
        : nothing
    }</dialog>`;
  }
}

define("aivi-events", AiviEvents);
