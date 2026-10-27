// One account's activity as the panel lists it: the pushes that went to
// Aivi and the presses the devices sent back, merged newest first, and
// the one row shape every list of them renders (the bar's Events panel,
// the Log page, the editor's Log). What differs per
// list is only what each row says about where it happened.

import { html, nothing, type TemplateResult } from "lit";
import type { AiviPanel } from "./aivi-panel";
import { i18nLocale, t, tOpt } from "./i18n";
import { icon } from "./icons";
import { fieldName } from "./layout";
import type { Account, BoundWidget, PressRow, PushRow, StreamStatus } from "./types/accounts";
import type { Waiting } from "./types/content";
import type { EditorKind } from "./types/editor";
import { everyLabel, quotable } from "./util";

export type ActivityItem = { acc: Account; time: string } & (
  | { kind: "press"; row: PressRow }
  | { kind: "push"; row: PushRow }
);

/** Everything the account logged, newest first. */
export function activityOf(panel: AiviPanel, acc: Account): ActivityItem[] {
  const items: ActivityItem[] = [
    ...panel
      .eventsOf(acc)
      .map((row): ActivityItem => ({ acc, kind: "press", row, time: row.time })),
    ...panel.pushesOf(acc).map((row): ActivityItem => ({ acc, kind: "push", row, time: row.time })),
  ];
  return items.sort((a, b) => b.time.localeCompare(a.time));
}

/** One binding's activity across the accounts, newest first. */
export function activityFor(
  panel: AiviPanel,
  entryId: string,
  kind: string,
  slug: string,
): ActivityItem[] {
  const acc = panel.accounts.find((a) => a.entry_id === entryId);
  if (!acc) return [];
  return activityOf(panel, acc).filter((item) => item.row.kind === kind && item.row.slug === slug);
}

/** The binding a row is for, if the account still has it. */
export function boundOf(acc: Account, kind: string, slug: string): BoundWidget | null {
  const list = kind === "activity" ? (acc.activities ?? []) : acc.widgets;
  return list.find((w) => w.slug === slug) ?? null;
}

/** What the press asked for: a template's event type, in words. */
export function requestText(eventType: string): string {
  return tOpt(`presses.type-${eventType}`) ?? eventType;
}

export function outcomeText(row: PressRow): string {
  return tOpt(`presses.outcome-${row.outcome}`) ?? row.outcome;
}

export function pushOutcomeText(row: PushRow): string {
  return tOpt(`pushes.outcome-${row.outcome}`) ?? row.outcome;
}

/** Whether a row went as it should (delivered, or handled). */
export function wentWell(item: ActivityItem): boolean {
  return item.kind === "push" ? item.row.outcome === "delivered" : item.row.outcome === "played";
}

/** Why a push waited: the field with no value and what it reads. */
export function waitingText(waiting: Waiting, template: string, kind: EditorKind): string {
  const name = (key: string): string => fieldName(key, template, kind);
  if (waiting.field === null)
    return t("pushes.waiting-any", { fields: waiting.fields.map(name).join(", ") });
  const field = name(waiting.field);
  return quotable(waiting.reading)
    ? t("pushes.waiting", { field, reading: waiting.reading })
    : t("pushes.waiting-none", { field });
}

/** Why a push is held: until when, by the binding's interval, and the
 * setting that sets it. */
export function heldText(held: NonNullable<PushRow["held"]>): string {
  return t("pushes.held", {
    time: timeText(held.until),
    every: everyLabel(held.interval),
    setting: t("delivery.throttle-label"),
    section: t("section.behavior"),
  });
}

/** A time of day for today's events, with the date for older ones. */
export function whenText(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const today = when.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    i18nLocale(),
    today ? { timeStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(when);
}

/** A time of day alone (the editor's list is about today). */
export function timeText(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  return new Intl.DateTimeFormat(i18nLocale(), { timeStyle: "medium" }).format(when);
}

/** The request a push sent, as text for the disclosure: its method and
 * path, then its body. */
export function sentText(row: PushRow): string | null {
  const request = row.request;
  if (request === null || request === undefined) return null;
  const body =
    typeof request.body === "string" ? request.body : JSON.stringify(request.body, null, 2);
  return `${request.method} ${request.path}\n${body}`;
}

/** Open the editor of the binding a row is for; nothing when it is not
 * bound any more. */
export function openEditorFor(panel: AiviPanel, acc: Account, kind: string, slug: string): void {
  const bound = boundOf(acc, kind, slug);
  if (!bound) return;
  if (kind === "activity") {
    const remote = panel.aiviActivities[acc.entry_id]?.find((a) => a.slug === slug);
    panel.openActivityEditor(acc, remote ?? null, bound);
  } else {
    const remote = panel.aiviWidgets[acc.entry_id]?.find((w) => w.slug === slug);
    panel.openEditor(acc, remote ?? null, bound);
  }
}

const TONE: Record<StreamStatus["state"], string> = {
  connected: "ok",
  reconnecting: "warn",
  paused: "warn",
  stopped: "bad",
};

/** One account's event stream: its state in words, since when (or why
 * not). */
export function streamLine(
  acc: Account,
  stream: StreamStatus | null,
  several: boolean,
): TemplateResult {
  const tone = stream ? TONE[stream.state] : "idle";
  const detail = !stream
    ? t("events.idle-why")
    : stream.state === "connected"
      ? stream.connected_since
        ? t("events.since", { time: whenText(stream.connected_since) })
        : null
      : stream.state === "paused"
        ? t("events.paused-why")
        : stream.last_error;
  return html`<li class=${`evstream ${tone}`}><span class="dot"></span><span class="evs">${
    several ? html`<b>${acc.title}</b> · ` : nothing
  }${t(`events.stream-${stream?.state ?? "idle"}`)}</span>${
    detail ? html`<span class="evd">${detail}</span>` : nothing
  }</li>`;
}

export interface RowOptions {
  /** Say which widget or Live Activity the row is about (a link to its
   * editor while it is bound). Off in a list that is about one binding. */
  where: boolean;
  /** Say which account, in a list across several. */
  account: boolean;
  /** Date the time for rows from other days. */
  dateful: boolean;
  /** Called before the row's link opens an editor (a panel closes). */
  onOpen?: () => void;
}

/** One row: what happened and what was asked, then where, when, and what
 * became of it. A push carries what it sent behind a disclosure. */
export function activityRow(panel: AiviPanel, item: ActivityItem, o: RowOptions): TemplateResult {
  const { acc, row } = item;
  const bound = boundOf(acc, row.kind, row.slug);
  const name = bound?.name ?? row.slug;
  const open = (): void => {
    o.onOpen?.();
    openEditorFor(panel, acc, row.kind, row.slug);
  };
  const link = bound
    ? html`<button type="button" class="evlink" @click=${open}>${name}</button>`
    : html`${name}`;
  const when = html`<span title=${new Date(item.time).toLocaleString(i18nLocale())}>${
    o.dateful ? whenText(item.time) : timeText(item.time)
  }</span>`;
  const count =
    row.count > 1
      ? html` <span class="n">${t("presses.count", { count: row.count })}</span>`
      : nothing;
  // A press names its tile; one that names nothing (a tile the binding
  // no longer has) is headed by what it was pressed on instead, and the
  // line under it then says only when.
  const nameless = item.kind === "press" && item.row.label == null && item.row.entity_id == null;
  const place = [
    ...(o.where && item.kind === "press" && !nameless ? [html`${link}`] : []),
    ...(o.account ? [html`${acc.title}`] : []),
    when,
  ];
  const where = html`<span class="awhere">${place.map((part, i) =>
    i ? html` · ${part}` : part,
  )}</span>`;
  if (item.kind === "press") {
    const press = item.row;
    const headline = nameless ? (o.where ? link : name) : (press.label ?? press.entity_id);
    return html`<li class="arow press"><div class="awhat"><span class="aname">${headline}</span><span class="areq">${requestText(press.event_type)}${count}</span></div><div class="ameta">${where}<span class=${`outcome ${press.outcome}`}>${outcomeText(press)}</span></div>${
      press.error ? html`<div class="perr">${press.error}</div>` : nothing
    }</li>`;
  }
  const push = item.row;
  const text = sentText(push);
  const took =
    push.outcome === "delivered" && push.duration_ms !== null
      ? html` · <span class="atook">${t("pushes.took", { ms: push.duration_ms })}</span>`
      : nothing;
  return html`<li class="arow push"><div class="awhat"><span class="aname">${
    o.where ? link : t("pushes.to-aivi")
  }</span><span class="areq">${o.where ? t("pushes.to-aivi") : nothing}${count}</span></div><div class="ameta">${where}<span class="aout"><span class=${`outcome ${push.outcome}`}>${pushOutcomeText(push)}</span>${took}</span></div>${
    push.error ? html`<div class="perr">${push.error}</div>` : nothing
  }${
    push.waiting
      ? html`<div class="pwarn">${waitingText(
          push.waiting,
          bound?.template ?? "",
          push.kind === "activity" ? "activity" : "widget",
        )}</div>`
      : nothing
  }${push.held ? html`<div class="fhint">${heldText(push.held)}</div>` : nothing}${
    text === null
      ? push.outcome === "failed"
        ? html`<div class="fhint">${t("pushes.content-none")}</div>`
        : nothing
      : html`<details class="abody"><summary><span class="tri" aria-hidden="true">${icon(
          "chevron-right",
        )}</span>${
          // Held: not sent yet.
          push.outcome === "held" ? t("preview.payload-title") : t("pushes.content")
        }</summary>${
          push.outcome === "unchanged"
            ? html`<div class="fhint">${t("pushes.unchanged-why")}</div>`
            : nothing
        }<pre>${text}</pre>${
          push.truncated ? html`<div class="fhint">${t("pushes.content-cut")}</div>` : nothing
        }</details>`
  }</li>`;
}
