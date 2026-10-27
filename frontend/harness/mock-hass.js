// A fake `hass` for the panel harness and the vitest suite: entity
// states plus the aivi/* WebSocket commands over the fixtures
// (fixtures.js) and the generated template metadata (meta.generated.js).
// Previews, save checks and defaults come from the integration itself: the dev
// server (scripts/harness_server.py) answers them on /engine, and the
// vitest suite replays its recorded answers.

import {
  AIVI_ACTIVITIES,
  AIVI_WIDGETS,
  BOUND,
  DEVICES,
  ENTITIES,
  LIST_BINDING,
  MORE_ACTIVITIES,
  MORE_WIDGETS,
  PRESSES,
  PUSHES,
  REMOTE_ACTIVITY_BINDING,
  REMOTE_BINDINGS,
  SHOWCASE_BINDING,
  STATES,
  SUGGESTIONS,
  SWITCHBOARD_BINDING,
  WAITING_PROGRESS,
  WAITING_PUSHES,
} from "./fixtures.js";
import { META } from "./meta.generated.js";

export { DEVICES, ENTITIES, STATES } from "./fixtures.js";
export { META } from "./meta.generated.js";

/** The Front door's State as a stored template (?templated=1). */
export const TEMPLATED = {
  state__template: [
    "{% set inside = states('sensor.living_temp') | float(0) %}",
    "{% set outside = states('sensor.outdoor_temp') | float(0) %}",
    "{% if inside - outside > 5 %}",
    "  {{ (inside - outside) | round(1) }}° warmer inside",
    "{% elif inside < outside %}",
    "  Colder inside",
    "{% else %}",
    "  About even",
    "{% endif %}",
  ].join("\n"),
  state__watched: ["sensor.living_temp", "sensor.outdoor_temp"],
};

/** Home Assistant rejects a failed command with `{code, message}`, not an
 * Error. */
function wsError(code, message) {
  return Promise.reject({ code, message });
}

// Dev-harness state flags, as query params:
//   ?offline=1    Aivi unreachable          -> the banner, bound cards only
//   ?noaccount=1  no config entries         -> the onboarding card
//   ?nowidgets=1  nothing on the account: no widgets and no Live
//                 Activities -> the empty account's steps;
//                 ?nowidgets=acc2 empties only that account
//   ?noactivities=1    widgets but no Live Activities
//   ?activitiesonly=1  Live Activities but no widgets
//   ?unbound=1    widgets exist, none bound -> the first-bind journey
//   ?suggest=not_loaded|no_entity           -> the disabled Suggest box
//   ?more=1       also list the budget, trend, prices and energy widgets
//                 and a bound list (Home)
//   ?inactive=1   subscription not active   -> the subscription banner
//                 (read per call, so dropping it and re-fetching renews);
//                 ?inactive=acc2 pauses only that account
//   ?accounts=2   a second account, Cabin (acc2), feeding one widget
//   ?longnames=1  with ?accounts=2: account names long enough to wrap
//   ?switchboard=1  the Living room switchboard is bound -> the hub's
//                 Events in the top bar and the editor's Recent presses
//   ?stream=reconnecting|stopped  the event stream's state (paused
//                 follows ?inactive=1)
//   ?nopushes=1   nothing pushed yet -> the Activity page's empty state
//   ?keeplog=1    the account keeps its activity log across restarts
//                 (the Activity page's footer); ?keeplog=acc2 only that one
//   ?templated=1  the Front door's State is a stored template, so the
//                 template workspace's URL opens it, after a reload too
//   ?waiting=1    the Washer's progress reads unknown: its editor and its
//                 hub card say nothing is sent, and the log has waiting
//                 and held rows
//   ?lang=de      the panel in a shipped translation (served from
//                 custom_components/aivi/translations/, as Home Assistant
//                 would)

/** Whether a per-account flag (?inactive, ?nowidgets) covers this
 * account: every account for a bare flag or "1", else the listed entry
 * ids. */
function covers(name, entryId) {
  const value = new URLSearchParams(location.search).get(name);
  if (value === null) return false;
  return value === "" || value === "1" || value.split(",").includes(entryId);
}

/** Whether ?inactive pauses this account. */
function paused(entryId) {
  return covers("inactive", entryId);
}

/** The mock account's event stream: present while a bound widget's
 * template accepts input. */
function streamStatus(account, flag) {
  const accepts = account.widgets.some((w) => META.templates[w.template]?.inputs);
  if (!accepts) return null;
  const state = paused(account.entry_id) ? "paused" : flag("stream") || "connected";
  const connected = state === "connected";
  const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  return {
    state,
    connected,
    reason:
      state === "paused" ? "subscription_inactive" : state === "stopped" ? "auth_failed" : null,
    last_error:
      state === "reconnecting"
        ? "Cannot connect to host api.getaivi.app"
        : state === "stopped"
          ? "The Aivi token was rejected; reauthentication required"
          : state === "paused"
            ? "No active subscription was found"
            : null,
    connected_since: connected ? minutesAgo(42) : null,
    last_event: minutesAgo(1),
    reconnects: connected ? 3 : 4,
  };
}

/** The pushes of whatever the account binds among the fixture pushes;
 * with ?waiting=1, also the Washer's waiting and held ones, newest
 * first. */
function pushRows(account, waiting) {
  const bound = (kind, slug) =>
    (kind === "activity" ? account.activities : account.widgets).find((w) => w.slug === slug);
  const all = waiting ? [...WAITING_PUSHES, ...PUSHES] : PUSHES;
  return all.flatMap(({ minutes, heldFor, ...row }, i) => {
    const binding = bound(row.kind, row.slug);
    if (!binding) return [];
    const at = Date.now() - minutes * 60_000;
    return [
      {
        id: `push_${i}`,
        time: new Date(at).toISOString(),
        subentry_id: binding.subentry_id,
        error: null,
        duration_ms: null,
        truncated: false,
        waiting: null,
        // A hold lasts its interval from the push before it, a few
        // seconds before the row.
        held: heldFor
          ? { until: new Date(at - 5_000 + heldFor * 1000).toISOString(), interval: heldFor }
          : null,
        count: 1,
        ...row,
      },
    ];
  });
}

/** Each binding's status, by subentry id: all fine, but with ?waiting=1
 * the Washer waits for its progress, as its latest push row says. */
function bindingStatus(account, waiting) {
  const waits = waiting ? WAITING_PUSHES.find((row) => row.outcome === "waiting") : undefined;
  return Object.fromEntries(
    [...account.widgets, ...(account.activities ?? [])].map((binding) => {
      const row =
        waits && binding.slug === waits.slug
          ? { status: "waiting", waiting: waits.waiting, held: null }
          : { status: "ok", waiting: null, held: null };
      return [binding.subentry_id, row];
    }),
  );
}

function pressRows(account) {
  const bound = account.widgets.find((w) => w.slug === SWITCHBOARD_BINDING.slug);
  if (!bound) return [];
  return PRESSES.map(({ minutes, ...row }, i) => {
    const time = new Date(Date.now() - minutes * 60_000).toISOString();
    return {
      id: `evt_${i}`,
      time,
      received_at: time,
      kind: "widget",
      slug: bound.slug,
      subentry_id: bound.subentry_id,
      error: null,
      recorded: true,
      count: 1,
      ...row,
    };
  });
}

/** Asks the dev server, which answers `{result}` or `{error}`. */
async function serverEngine(msg) {
  const res = await fetch("/engine", { method: "POST", body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`engine: HTTP ${res.status}`);
  return res.json();
}

export function makeHass(engine = serverEngine) {
  const ask = (msg) =>
    engine(msg).then((out) => (out.error ? Promise.reject(out.error) : out.result));
  const flags = new URLSearchParams(location.search);
  // The empty-account flags also empty the Live Activities, so the
  // first-bind journey (?unbound=1) still starts from a zero bound count.
  const bare = covers("nowidgets", "acc1") || flags.has("unbound");
  const noWidgets = bare || flags.has("activitiesonly");
  const noActivities = bare || flags.has("noactivities");
  const accounts = flags.has("noaccount")
    ? []
    : [
        {
          entry_id: "acc1",
          title: "aivi",
          widgets: noWidgets
            ? []
            : structuredClone([
                ...BOUND.widgets,
                ...(flags.has("switchboard") ? [SWITCHBOARD_BINDING] : []),
                ...(flags.has("more") ? [LIST_BINDING, SHOWCASE_BINDING, ...REMOTE_BINDINGS] : []),
              ]),
          activities: noActivities
            ? []
            : structuredClone([
                ...BOUND.activities,
                ...(flags.has("more") ? [REMOTE_ACTIVITY_BINDING] : []),
              ]),
        },
        ...(flags.get("accounts") === "2"
          ? [
              {
                entry_id: "acc2",
                title: "Cabin",
                widgets: covers("nowidgets", "acc2")
                  ? []
                  : structuredClone(BOUND.widgets.slice(0, 1)).map((w) => ({
                      ...w,
                      subentry_id: `cabin-${w.subentry_id}`,
                    })),
                activities: [],
              },
            ]
          : []),
      ];
  // ?waiting=1: the Washer's progress follows a sensor that reads
  // unknown, so its content does not resolve.
  const washer = accounts[0]?.activities.find((a) => a.slug === "washer");
  if (washer && flags.has("waiting")) washer.bindings.progress = WAITING_PROGRESS;
  // ?templated=1: the Front door's State is a template already saved.
  const door = accounts[0]?.widgets.find((w) => w.slug === "frontdoor");
  if (door && flags.has("templated"))
    door.bindings = { accent: door.bindings.accent, ...TEMPLATED };
  if (flags.get("accounts") === "2") {
    const long = flags.has("longnames");
    accounts[0].title = long ? "Main house on Lindenallee with the garden office" : "Home";
    accounts[1].title = long ? "Summer cabin by the lake (rented out in July)" : "Cabin";
  }
  let counter = 2;
  // ?feeders=1: automations (a blueprint's, a hand-written one) feeding
  // the bound Front door widget and the unbound Laundry; ?feeders=kept
  // adds one the panel will not turn off.
  const automations = flags.has("feeders")
    ? [
        {
          kind: "widget",
          slug: "frontdoor",
          entity_id: "automation.front_door_status",
          name: "Front door status",
          enabled: true,
          config_id: "1719000000001",
          blueprint: true,
          keep: null,
        },
        ...(flags.get("feeders") === "kept"
          ? [
              {
                kind: "widget",
                slug: "frontdoor",
                entity_id: "automation.all_widgets",
                name: "All widgets",
                enabled: true,
                config_id: null,
                blueprint: false,
                keep: "shared",
              },
            ]
          : []),
        {
          kind: "widget",
          slug: "laundry",
          entity_id: "automation.laundry_widget",
          name: "Laundry widget",
          enabled: true,
          config_id: "1719000000002",
          blueprint: true,
          keep: null,
        },
      ]
    : [];
  // Read per call, like the original page URL a reload would carry.
  const flag = (name) => new URLSearchParams(location.search).get(name);
  const listed = (key, items, pool, entryId) => {
    // The error Home Assistant relays for a listing Aivi refused with a 402.
    if (paused(entryId))
      return wsError("subscription_inactive", "No active subscription was found");
    if (flag("offline") !== null) return Promise.reject(new Error("unreachable"));
    if (
      covers("nowidgets", entryId) ||
      flag(key === "widgets" ? "activitiesonly" : "noactivities") !== null
    )
      return Promise.resolve({ [key]: [] });
    return Promise.resolve({
      [key]: items.map((item) => ({ ...item, supported: !!pool?.[item.template] })),
    });
  };
  const inputsUpdate = (entryId) => {
    const account = accounts.find((a) => a.entry_id === entryId);
    return {
      stream: streamStatus(account, flag),
      presses: pressRows(account),
      pushes: flag("nopushes") !== null ? [] : pushRows(account, flag("waiting") !== null),
      status: bindingStatus(account, flag("waiting") !== null),
    };
  };
  // Only with ?lang=: the suite sets `language` on the object itself.
  const lang = flag("lang");
  return {
    ...(lang ? { language: lang, locale: { language: lang } } : {}),
    states: STATES,
    entities: ENTITIES,
    devices: DEVICES,
    connection: {
      // aivi/inputs/subscribe: the current state at once; the harness has
      // no stream of its own, so nothing follows.
      subscribeMessage(callback, msg) {
        if (msg.type !== "aivi/inputs/subscribe")
          return wsError("unknown_command", `Unknown command ${msg.type}`);
        if (!accounts.some((a) => a.entry_id === msg.entry_id))
          return wsError("not_found", "Unknown account");
        setTimeout(() => callback(inputsUpdate(msg.entry_id)), 0);
        return Promise.resolve(async () => {});
      },
    },
    callWS(msg) {
      switch (msg.type) {
        case "aivi/templates":
          return Promise.resolve(META);
        case "aivi/config":
          return Promise.resolve({
            accounts: structuredClone(accounts).map((account) => ({
              ...account,
              subscription: paused(account.entry_id) ? "inactive" : "active",
              subscription_ended: paused(account.entry_id) ? "2026-09-30T08:00:00+00:00" : null,
              stream: streamStatus(account, flag),
              keep_log: covers("keeplog", account.entry_id),
            })),
            version: "1.2.0",
            automations: structuredClone(automations),
            suggest_state: flag("suggest") || "ready",
            // Two models, so the composer shows its picker; ?models=1
            // for the single-model toolbar.
            suggest_models:
              flag("models") === "1"
                ? [{ entity_id: "ai_task.local", name: "Local model", preferred: true }]
                : [
                    { entity_id: "ai_task.local", name: "Local model", preferred: true },
                    { entity_id: "ai_task.cloud", name: "Cloud model", preferred: false },
                  ],
          });
        case "aivi/widgets":
          return listed(
            "widgets",
            flag("more") !== null ? [...AIVI_WIDGETS, ...MORE_WIDGETS] : AIVI_WIDGETS,
            META.templates,
            msg.entry_id,
          );
        case "aivi/activities":
          return listed(
            "activities",
            flag("more") !== null ? [...AIVI_ACTIVITIES, ...MORE_ACTIVITIES] : AIVI_ACTIVITIES,
            META.activity_templates,
            msg.entry_id,
          );
        case "aivi/save": {
          const kind = msg.kind || "widget";
          const acc = accounts.find((a) => a.entry_id === msg.entry_id);
          if (!acc) return wsError("not_found", "Unknown account");
          return ask(msg).then(({ bindings }) => {
            const list = kind === "activity" ? acc.activities : acc.widgets;
            const data = { slug: msg.slug, name: msg.name, template: msg.template, bindings };
            if (kind === "activity") {
              data.active = msg.active;
              if (msg.throttle !== undefined) data.throttle = msg.throttle;
            } else if (msg.stale_after !== undefined) data.stale_after = msg.stale_after;
            let entry = msg.subentry_id && list.find((x) => x.subentry_id === msg.subentry_id);
            if (entry) Object.assign(entry, data);
            else {
              entry = { subentry_id: (kind === "activity" ? "a" : "w") + counter++, ...data };
              list.push(entry);
            }
            return { subentry_id: entry.subentry_id };
          });
        }
        case "aivi/automations/turn_off":
          for (const feeder of automations)
            if (msg.entity_ids.includes(feeder.entity_id)) feeder.enabled = false;
          return Promise.resolve({ automations: structuredClone(automations) });
        case "aivi/preview":
        case "aivi/defaults":
        case "aivi/suggest/starters":
          return ask(msg);
        case "aivi/suggest": {
          // A canned answer per template, and a reply in the model's
          // voice: what it did on the first ask, a confirmation after.
          const bindings = structuredClone(SUGGESTIONS[msg.template] ?? {});
          const reply = Object.keys(bindings).length
            ? msg.history?.length
              ? "Adjusted it as you asked."
              : "Set it up from your entities; say what to change."
            : null;
          // ?ask=1: the model could not tell what to show, and asks back
          // with what the home has.
          if (flag("ask") !== null && !msg.history?.length)
            return new Promise((done) =>
              setTimeout(
                () =>
                  done({
                    bindings: structuredClone(msg.bindings ?? {}),
                    match: "none",
                    reply: "Nothing here is about that. What should it show?",
                    options: ["The washer", "The front door", "The outside temperature"],
                  }),
                700,
              ),
            );
          return new Promise((done) => setTimeout(() => done({ bindings, reply }), 700));
        }
        case "frontend/get_translations":
          return translations(msg.language);
        case "aivi/delete": {
          const acc = accounts.find((a) => a.entry_id === msg.entry_id);
          if (!acc) return wsError("not_found", "Unknown account");
          acc.widgets = acc.widgets.filter((x) => x.subentry_id !== msg.subentry_id);
          acc.activities = acc.activities.filter((x) => x.subentry_id !== msg.subentry_id);
          return Promise.resolve({});
        }
      }
      return wsError("unknown_command", `Unknown command ${msg.type}`);
    },
  };
}

/** frontend/get_translations for the panel's category: the language's
 * config_panel strings under Home Assistant's flattened keys. */
async function translations(lang) {
  const res = await fetch(`/custom_components/aivi/translations/${lang}.json`);
  if (!res.ok) return { resources: {} };
  const panel = (await res.json()).config_panel ?? {};
  const resources = {};
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") resources[`${path}${key}`] = value;
      else walk(value, `${path}${key}.`);
    }
  };
  walk(panel, "component.aivi.config_panel.");
  return { resources };
}

// Mimic Home Assistant's <ha-panel-custom> host: it assigns `hass`,
// `narrow`, `route` and `panel` properties onto the panel element (so a
// getter-only accessor for any of them throws on mount), and re-assigns a
// fresh `route` on `location-changed` (fired after the panel's own
// pushState, HA's navigate() contract) and on popstate.
//
// The route path lives in the URL hash (index.html#/widget/frontdoor), so
// `route.prefix` is the page plus "#": pushState(prefix + path) just
// rewrites the hash, deep links survive reload, and it all works against
// a static file server.
export function mountPanelHost(el) {
  const route = () => ({
    prefix: `${location.pathname}${location.search}#`,
    path: location.hash.slice(1),
  });
  const sync = () => {
    el.route = route();
  };
  window.addEventListener("location-changed", sync);
  window.addEventListener("popstate", sync);
  // `narrow` follows the viewport breakpoint the way HA's host does.
  const mq = matchMedia("(max-width: 870px)");
  el.narrow = mq.matches;
  mq.addEventListener("change", () => {
    el.narrow = mq.matches;
  });
  el.route = route();
  el.panel = { component_name: "custom", url_path: "aivi", title: "aivi", config: {} };
  el.hass = makeHass();
}
