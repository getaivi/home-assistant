// Insight into presses and pushes: the top bar's Log button and its
// Events (stream state, the latest few presses, the way to the rest of
// them on the Log page) and the editor's Log, from the harness mock's ?switchboard=1 (and ?stream=,
// ?inactive=1) flags.

import { afterEach, describe, expect, it } from "vitest";
import { activityFor, outcomeText, requestText, whenText } from "../src/activity-rows";
import { SHOWN, worstTone } from "../src/aivi-events";
import { RECENT_SHOWN } from "../src/aivi-recent-activity";
import type { StreamStatus } from "../src/types/accounts";
import {
  $,
  $$,
  makeHass,
  mountPanel,
  openWidgetEditor,
  sr,
  takeBacks,
  text,
  tick,
  until,
} from "./harness";
import { liveHass, press } from "./live";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

function button(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>("aivi-events .evbtn");
}

/** Press the bar's Events button and hand back its open panel. */
async function openEvents(root: ParentNode): Promise<HTMLElement> {
  button(root)!.click();
  await tick();
  return $(root, "aivi-events dialog.evpop");
}

describe("events in the top bar", () => {
  it("says it is not listening while nothing the account binds accepts input", async () => {
    const panel = await mountPanel();
    await tick();
    // An expected state is shown, not hidden: a hollow dot and the reason.
    const btn = button(sr(panel))!;
    expect(btn.className).toContain("idle");
    expect(btn.getAttribute("aria-label")).toBe("Events: not listening");
    const pop = await openEvents(sr(panel));
    expect(text($(pop, ".evstream .evs"))).toBe("Not listening");
    expect(text($(pop, ".evstream .evd"))).toContain("That is expected");
    // No feed, no empty feed asking for a press that cannot arrive, and
    // no link to events there are none of (the bar's Log button has the
    // pushes).
    expect(pop.querySelector(".evlist")).toBeNull();
    expect(pop.querySelector(".evempty")).toBeNull();
    expect(pop.querySelector(".evfoot")).toBeNull();
  });

  it("has a Log button of its own before Events, opening the page unnarrowed", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    const root = sr(panel);
    await until(() => !!button(root), "the button");
    const log = $(root, ".topbar .logbtn");
    expect(log.getAttribute("type")).toBe("button");
    expect(log.getAttribute("aria-label")).toBe("Open the log");
    expect(log.title).toBe("Log");
    expect(log.nextElementSibling?.tagName).toBe("AIVI-EVENTS");
    takeBacks();
    log.click();
    await until(() => panel.view === "log", "the Log page");
    expect(panel.route?.path).toBe("/log");
    await until(() => !!root.querySelector("aivi-activity-log .logsel"), "its selects");
    const show = $(
      root,
      'aivi-activity-log .logsel select[aria-label="Show"]',
    ) as HTMLSelectElement;
    expect(show.value).toBe("all");
    expect(
      ($(root, 'aivi-activity-log .logsel select[aria-label="For"]') as HTMLSelectElement).value,
    ).toBe("any");
    // Back returns to the hub's entry.
    $(root, "aivi-activity-log .backbtn").click();
    expect(panel.view).toBe("home");
    expect(takeBacks()).toBe(1);
  });

  it("wears the stream's state, and opens on its status and the latest events", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    const root = sr(panel);
    await until(() => !!button(root), "the button");
    const btn = button(root)!;
    expect(btn.className).toContain("ok");
    expect(btn.getAttribute("aria-label")).toBe("Events: connected");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    // The stream belongs to the account: nothing about it sits by "Widgets".
    expect(root.querySelector(".eyebrow .chip")).toBeNull();

    const pop = await openEvents(root);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.title).toBe("Events");
    expect(text($(pop, "h3"))).toBe("Events from your devices");
    expect(text($(pop, ".evstream .evs"))).toBe("Connected");
    expect(text($(pop, ".evstream .evd"))).toMatch(/^Listening since /);
    // Every bound resource's presses, newest first, each with where it
    // happened and what became of it. Pushes are the Log page's.
    const rows = $$(pop, ".evlist .arow").map((item) => [
      text($(item, ".aname")),
      text($(item, ".areq")),
      text($(item, ".outcome")),
    ]);
    expect(rows).toEqual([
      ["Porch light", "On", "Handled"],
      ["Movie night", "Press", "Failed"],
      ["Fountain", "Off", "Expired"],
      ["Living room", "Press", "Not handled"],
      ["Garage", "On", "Handled"],
    ]);
    expect(pop.querySelector(".arow.push")).toBeNull();
    expect(text($(pop, ".evlist .arow .awhere"))).toMatch(/^Living room · /);
    // A press that names no tile is headed by the switchboard it came
    // from (the link), and the line under it says only when.
    const nameless = $$(pop, ".evlist .arow")[3]!;
    expect(nameless.querySelector(".aname .evlink")).not.toBeNull();
    expect(nameless.querySelector(".awhere .evlink")).toBeNull();
    expect(text($(nameless, ".awhere"))).not.toContain("Living room");
    expect(text($$(pop, ".evlist .arow")[1]!)).toContain("Unable to reach the device");

    // Escape closes it and hands the focus back to the button.
    pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens an event's widget from the list", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    await until(() => !!button(sr(panel)), "the button");
    const pop = await openEvents(sr(panel));
    $(pop, ".evlist .evlink").click();
    await until(() => sr(panel).querySelector(".edbar") !== null, "the editor");
    expect(text($(sr(panel), ".edbar .title"))).toBe("Living room");
  });

  it("lists the latest few and links to the rest on the Log page, narrowed to them", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const live = liveHass();
    const panel = await mountPanel(live.hass);
    await until(() => !!button(sr(panel)), "the button");
    const pop = await openEvents(sr(panel));
    live.push({
      stream: null,
      presses: Array.from({ length: SHOWN + 4 }, (_, i) => press(i * 60 + 60)),
      pushes: [],
    });
    await until(() => $$(pop, ".evlist .arow").length === SHOWN, "the trimmed list");
    const link = $(pop, ".evfoot .evlink");
    expect(text(link)).toBe("See all events");
    link.click();
    await until(() => panel.view === "log", "the Log page");
    expect(panel.route?.path).toBe("/log");
    expect(button(sr(panel))).toBeNull(); // the page has no bar of its own events
    await until(() => !!sr(panel).querySelector("aivi-activity-log .logsel"), "its selects");
    const show = $(
      sr(panel),
      'aivi-activity-log .logsel select[aria-label="Show"]',
    ) as HTMLSelectElement;
    expect(show.value).toBe("presses");
    // The narrowing select has the focus: it is what is read out first.
    expect(sr(panel).activeElement).toBe(show);
    await until(
      () => $$(sr(panel), "aivi-activity-log .loglist .arow").length === SHOWN + 4,
      "every event on the page",
    );
  });

  it("carries the last error while reconnecting", async () => {
    history.replaceState(null, "", "/?switchboard=1&stream=reconnecting");
    const panel = await mountPanel();
    await until(() => !!button(sr(panel)), "the button");
    expect(button(sr(panel))!.className).toContain("warn");
    const pop = await openEvents(sr(panel));
    expect($(pop, ".evstream").className).toContain("warn");
    expect(text($(pop, ".evstream .evs"))).toBe("Reconnecting…");
    expect(text($(pop, ".evstream .evd"))).toBe("Cannot connect to host api.getaivi.app");
  });

  it("says why it is paused while the subscription is inactive", async () => {
    history.replaceState(null, "", "/?switchboard=1&inactive=1");
    const panel = await mountPanel();
    await until(() => !!button(sr(panel)), "the button");
    const pop = await openEvents(sr(panel));
    expect(text($(pop, ".evstream .evs"))).toBe("Paused");
    expect(text($(pop, ".evstream .evd"))).toContain("subscription isn't active");
  });

  it("takes the worst of several streams, and words every date", () => {
    const status = (state: StreamStatus["state"]): StreamStatus => ({
      state,
      connected: state === "connected",
      reason: null,
      last_error: "boom",
      connected_since: null,
      last_event: null,
      reconnects: 0,
    });
    expect(worstTone([])).toBe("idle");
    expect(worstTone([status("connected")])).toBe("ok");
    expect(worstTone([status("connected"), status("paused")])).toBe("warn");
    expect(worstTone([status("reconnecting"), status("stopped")])).toBe("bad");
    const now = new Date("2026-10-03T12:00:00");
    // Today: the time alone. Earlier: the date with it.
    expect(whenText("2026-10-03T09:05:07", now)).not.toMatch(/2026|Oct/);
    expect(whenText("2026-10-01T09:05:07", now)).toMatch(/Oct/);
    expect(whenText("not a date", now)).toBe("not a date");
  });

  it("falls back to aivi/config without subscriptions", async () => {
    history.replaceState(null, "", "/?switchboard=1&stream=stopped");
    const hass = makeHass();
    delete hass.connection;
    const panel = await mountPanel(hass);
    await until(() => !!button(sr(panel)), "the button");
    expect(button(sr(panel))!.className).toContain("bad");
    const pop = await openEvents(sr(panel));
    expect(text($(pop, ".evstream .evs"))).toBe("Disconnected");
    expect(text($(pop, ".evstream .evd"))).toContain("token was rejected");
    // No subscription, no feed: the empty state says what would show.
    expect(text($(pop, ".evempty"))).toContain("Nothing yet");
  });

  it("follows live updates, blinks for a new event, and unsubscribes when the panel goes", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const live = liveHass();
    const panel = await mountPanel(live.hass);
    await until(() => !!button(sr(panel)), "the button");
    const pop = await openEvents(sr(panel));
    const stream: StreamStatus = {
      state: "reconnecting",
      connected: false,
      reason: null,
      last_error: "Read timed out",
      connected_since: null,
      last_event: null,
      reconnects: 5,
    };
    live.push({ stream, presses: [], pushes: [] });
    await until(() => text($(pop, ".evstream")).includes("Read timed out"), "the update");
    expect(button(sr(panel))!.className).not.toContain("ping");
    live.push({ stream, presses: [press(0, { id: "evt_new" })], pushes: [] });
    await until(() => $$(pop, ".evlist .arow").length === 1, "the event");
    expect(button(sr(panel))!.className).toContain("ping");
    panel.remove();
    await until(live.unsubscribed, "unsubscribe");
  });
});

describe("the log in the editor", () => {
  it("lists the binding's pushes and presses with their outcome", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "livingroom");
    const items = (): HTMLElement[] => $$(editor, "aivi-recent-activity ul.recentlist .arow");
    await until(() => items().length === RECENT_SHOWN, "the rows");
    const rows = items().map((item) => [
      text($(item, ".aname")),
      text($(item, ".areq")),
      text($(item, ".outcome")),
      item.querySelector(".perr")?.textContent ?? "",
    ]);
    // Newest first, the push among the presses by its time; a push in
    // the list of one binding says only where it went.
    expect(rows).toEqual([
      ["Porch light", "On", "Handled", ""],
      ["Movie night", "Press", "Failed", "Unable to reach the device"],
      ["To Aivi", "", "Delivered", ""],
      ["Fountain", "Off", "Expired", ""],
      ["Living room", "Press", "Not handled", ""],
    ]);
    // In the binding's own list the fallback headline is plain text.
    expect(items()[4]!.querySelector(".aname .evlink")).toBeNull();
    expect(text($(items()[2]!, ".atook"))).toBe("341 ms");
    expect(text($(items()[2]!, "details.abody pre"))).toContain("Porch light");
    const log = $(editor, "aivi-recent-activity");
    expect(text($(log, ".phead h3"))).toBe("Log");
    // A log, not a setting: under the preview, never inside the form.
    expect(log.parentElement?.className).toBe("sidebody");
    expect(log.previousElementSibling?.localName).toBe("aivi-preview-pane");
    expect(editor.querySelector(".form aivi-recent-activity")).toBeNull();
  });

  it("lists the latest few and opens the Log page on the binding for the rest", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    const acc = panel.accounts[0]!;
    // More than the card lists: the full history is a press away.
    expect(activityFor(panel, acc.entry_id, "widget", "livingroom").length).toBeGreaterThan(
      RECENT_SHOWN,
    );
    const editor = await openWidgetEditor(panel, "livingroom");
    const items = (): HTMLElement[] => $$(editor, "aivi-recent-activity ul.recentlist .arow");
    await until(() => items().length === RECENT_SHOWN, "the rows");
    const link = $(editor, "aivi-recent-activity .recentfoot button");
    expect(link.getAttribute("type")).toBe("button");
    expect(text(link)).toBe("Open the log");
    takeBacks();
    link.click();
    await until(() => panel.view === "log", "the Log page");
    expect(panel.route?.path).toBe("/log");
    // The editor's entry gives way to the page's; the hub's is below it.
    expect(location.pathname).toBe("/aivi/log");
    expect(takeBacks()).toBe(0);
    const root = sr(panel);
    await until(() => !!root.querySelector("aivi-activity-log .loglist .arow"), "the page's rows");
    const forSelect = $(
      root,
      'aivi-activity-log .logsel select[aria-label="For"]',
    ) as HTMLSelectElement;
    expect(forSelect.value).toBe("widget:livingroom");
    // The narrowing select has the focus: it is what is read out first.
    expect(root.activeElement).toBe(forSelect);
    const shown = $$(root, "aivi-activity-log .loglist .arow");
    expect(shown.length).toBe(activityFor(panel, acc.entry_id, "widget", "livingroom").length);
    expect(text($(root, "aivi-activity-log .logcount"))).toContain(`${shown.length} of`);
    // Back from the page returns to the hub's entry, and the next visit
    // to the page starts unfiltered.
    $(root, "aivi-activity-log .backbtn").click();
    expect(panel.view).toBe("home");
    expect(takeBacks()).toBe(1);
    await until(() => !!root.querySelector("aivi-hub"), "the hub");
    panel.openLog();
    await until(() => panel.view === "log", "the page again");
    await until(() => !!root.querySelector("aivi-activity-log .logsel"), "its selects");
    expect(
      ($(root, 'aivi-activity-log .logsel select[aria-label="For"]') as HTMLSelectElement).value,
    ).toBe("any");
  });

  it("asks about unsaved changes before it opens the Log page", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "livingroom");
    await until(() => !!editor.querySelector("aivi-recent-activity .recentfoot"), "the link");
    if (panel.editorState) panel.editorState.staleAfter = 3600; // an unsaved change
    $(editor, "aivi-recent-activity .recentfoot button").click();
    await tick();
    expect(panel.view).toBe("editor");
    $(sr(panel), "dialog.leavedlg .keep").click();
    await tick();
    expect(panel.view).toBe("editor");
    // Kept editing: the page, opened another way later, is not narrowed.
    expect(panel.logPreset).toBeNull();
    $(editor, "aivi-recent-activity .recentfoot button").click();
    await tick();
    $(sr(panel), "dialog.leavedlg .discard").click();
    await until(() => panel.view === "log", "the Log page");
    await until(() => !!sr(panel).querySelector("aivi-activity-log .logsel"), "its selects");
    expect(
      ($(sr(panel), 'aivi-activity-log .logsel select[aria-label="For"]') as HTMLSelectElement)
        .value,
    ).toBe("widget:livingroom");
  });

  it("is there for a template that takes no input: its pushes are", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    const items = (): HTMLElement[] => $$(editor, "aivi-recent-activity ul.recentlist .arow");
    await until(() => items().length === 3, "the rows");
    const rows = items().map((item) => [
      text($(item, ".aname")),
      text($(item, ".areq")),
      text($(item, ".aout")),
    ]);
    expect(rows).toEqual([
      ["To Aivi", "", "Delivered · 212 ms"],
      ["To Aivi", "×3", "Retrying"],
      ["To Aivi", "", "Delivered · 198 ms"],
    ]);
    expect(text($(items()[1]!, ".perr"))).toContain("Cannot reach Aivi");
    // All of them fit: no link to the rest.
    expect(editor.querySelector("aivi-recent-activity .recentfoot")).toBeNull();
    // Nothing of the Washer's here: the list is this binding's alone.
    expect(editor.querySelector("aivi-recent-activity .outcome.unchanged")).toBeNull();
  });

  it("updates live and shows coalesced play-only events once", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const live = liveHass();
    const panel = await mountPanel(live.hass);
    const editor = await openWidgetEditor(panel, "livingroom");
    const items = (): HTMLElement[] => $$(editor, "aivi-recent-activity ul.recentlist .arow");
    await until(() => items().length === RECENT_SHOWN, "the rows");
    live.push({
      stream: null,
      presses: [
        press(0, {
          id: "evt_9",
          event_type: "volume_step",
          entity_id: "media_player.tv",
          label: "TV",
          recorded: false,
          count: 4,
        }),
        press(0, {
          id: "evt_other",
          slug: "elsewhere",
          subentry_id: null,
          entity_id: null,
          label: null,
          outcome: "not_bound",
        }),
      ],
      pushes: [],
    });
    await until(() => items().length === 1, "the update");
    const item = items()[0]!;
    expect([text($(item, ".aname")), text($(item, ".areq")), text($(item, ".outcome"))]).toEqual([
      "TV",
      "volume_step ×4",
      "Handled",
    ]);
  });

  it("says when there is nothing yet", async () => {
    const live = liveHass();
    const panel = await mountPanel(live.hass);
    const editor = await openWidgetEditor(panel, "frontdoor");
    live.push({ stream: null, presses: [], pushes: [] });
    await until(() => !!editor.querySelector("aivi-recent-activity .pempty"), "the empty state");
    expect(text($(editor, "aivi-recent-activity .pempty"))).toContain("Nothing yet");
  });

  it("words unknown types and outcomes as they come", () => {
    expect(requestText("toggle_on")).toBe("On");
    expect(requestText("dial_turned")).toBe("dial_turned");
    expect(outcomeText({ outcome: "weird" } as unknown as Parameters<typeof outcomeText>[0])).toBe(
      "weird",
    );
  });
});
