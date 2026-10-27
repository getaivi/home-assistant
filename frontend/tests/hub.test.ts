// Hub smoke tests: cards rendered from the harness fixture data (one
// bound widget, several unbound remote widgets), the binding summary, the
// two-step unbind, the offline banner, and the empty states.

import { afterEach, describe, expect, it, vi } from "vitest";
import { type AiviWidgetCard, UNBIND_ARM_DELAY_MS } from "../src/aivi-hub";
import { $, $$, hubCard, makeHass, mountPanel, sr, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** An armed confirm takes a moment to accept (a double-click must not
 * confirm): wait it out before the second press. */
const armDelay = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, UNBIND_ARM_DELAY_MS + 30));

function cardByName(root: ParentNode, name: string): HTMLElement {
  const card = $$(root, "aivi-widget-card").find((c) => text($(c, ".nm")) === name);
  if (!card) throw new Error(`no card named ${name}`);
  return card;
}

describe("aivi-hub", () => {
  it("renders one card per remote widget, merged with bound state", async () => {
    const panel = await mountPanel();
    const cards = $$(sr(panel), "aivi-widget-card");
    // The mock account exposes 7 remote widgets; frontdoor is bound and
    // weather's template is unsupported.
    expect(cards).toHaveLength(7);
    const front = cardByName(sr(panel), "Front door");
    expect($(front, ".dot").className).toContain("on");
    expect(text($(front, ".sum"))).toContain("Fed by Front door open");
    expect(text(front)).toContain("Edit");
    expect(text(front)).toContain("Stop feeding");

    const laundry = cardByName(sr(panel), "Laundry");
    // Nothing feeds it yet, so no state dot is shown.
    expect(laundry.querySelector(".dot")).toBeNull();
    expect(text($(laundry, ".sum"))).toBe("Something running to completion");
    expect(text($(laundry, ".foot"))).toBe("Set up");
    expect($(laundry, ".chip").textContent).toBe("Progress");
  });

  it("opens the editor from a press anywhere on a card, but not from its controls", async () => {
    const panel = await mountPanel();
    const open = vi.spyOn(panel, "openEditor");
    // Stop feeding is the card's own control: it arms, it does not open.
    const front = cardByName(sr(panel), "Front door");
    $(front, "aivi-unbind-button button").click();
    expect(open).not.toHaveBeenCalled();
    // A card with no editor (unsupported) is not a target.
    cardByName(sr(panel), "Weather").click();
    expect(open).not.toHaveBeenCalled();
    // A press on the name, the summary or the padding opens the card.
    $(cardByName(sr(panel), "Laundry"), ".sum").click();
    expect(open).toHaveBeenCalledTimes(1);
    await until(() => sr(panel).querySelector(".edbar") !== null, "editor");
    expect(text($(sr(panel), ".edbar .title"))).toBe("Laundry");
    expect(text($(sr(panel), ".edbar .subtitle"))).toBe("Widget · Progress · laundry");
  });

  it("marks unsupported templates and offers no bind action", async () => {
    // The mock derives `supported` from META; the fixture Weather widget's
    // "forecast" template is one this build doesn't know.
    const panel = await mountPanel();
    const card = cardByName(sr(panel), "Weather");
    expect(text($(card, ".sum"))).toBe("Needs a newer Aivi integration");
    expect(card.querySelector("button")).toBeNull();
    expect(card.className).toContain("dim");
  });

  it("flags a bound widget whose remote counterpart vanished", async () => {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    const card = document.createElement("aivi-widget-card") as AiviWidgetCard;
    card.panel = panel;
    card.acc = acc;
    card.remote = null;
    card.bound = bound;
    document.body.append(card);
    await tick();
    expect(text($(card, ".tnote.gone"))).toContain("Not in the Aivi app");
    expect(text(card)).toContain("Stop feeding");
  });

  it("compacts the binding summary: entities by name, templates, and a +N tail", async () => {
    const panel = await mountPanel();
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    const card = document.createElement("aivi-widget-card") as AiviWidgetCard;
    card.panel = panel;
    card.acc = acc;
    card.remote = null;
    card.bound = {
      ...bound,
      bindings: {
        rows: ["sensor.vacuum_battery", "sensor.lock_battery"],
        state: "sensor.living_temp",
        value: "sensor.humidity",
        // Fixed values feed nothing: no icon or color in the summary.
        icon: "house.fill",
        accent: "green",
        tap_url__template: "{{ 1 }}",
      },
    };
    document.body.append(card);
    await tick();
    // remote: null renders the vanished-widget note as its own line, so
    // the summary is the sum line that isn't the note.
    expect(text($(card, ".sum"))).toContain("Fed by Robot vacuum battery, Door lock battery, +3");
  });

  it("Edit on a bound card opens the editor with the binding loaded", async () => {
    const panel = await mountPanel();
    const front = cardByName(sr(panel), "Front door");
    $$(front, "button")
      .find((b) => text(b) === "Edit")!
      .click();
    await tick();
    expect(panel.view).toBe("editor");
    expect(panel.editorState?.slug).toBe("frontdoor");
    expect(panel.editorState?.bindings["state"]).toBe("input_boolean.front_door");
  });

  it("unbinds only after the confirm step, then refreshes the card", async () => {
    const panel = await mountPanel();
    const front = cardByName(sr(panel), "Front door");
    const btn = $(front, "aivi-unbind-button button");
    expect(text(btn)).toBe("Stop feeding");
    btn.click();
    await tick();
    expect(text(btn)).toBe("Stop feeding?");
    expect(btn.className).toContain("danger");
    // The account still holds the binding: nothing destructive happened.
    expect(panel.accounts[0]?.widgets).toHaveLength(1);
    await armDelay();
    btn.click();
    await until(
      () => text($(cardByName(sr(panel), "Front door"), ".foot")) === "Set up",
      "card back to unbound",
    );
    expect(panel.accounts[0]?.widgets).toHaveLength(0);
    expect(text($(sr(panel), ".toast"))).toBe("Stopped feeding Front door");
  });

  it("ignores a second confirm while the unbind is in flight", async () => {
    const panel = await mountPanel();
    const btn = $(cardByName(sr(panel), "Front door"), "aivi-unbind-button button");
    const del = vi.spyOn(panel.api, "delete");
    btn.click();
    await armDelay();
    btn.click();
    btn.click();
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("toasts a failed unbind and keeps the binding", async () => {
    const panel = await mountPanel();
    const btn = $(cardByName(sr(panel), "Front door"), "aivi-unbind-button button");
    vi.spyOn(panel.api, "delete").mockRejectedValue(new Error("not_found"));
    btn.click();
    await armDelay();
    btn.click();
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(text($(sr(panel), ".toast"))).toBe("Couldn't stop feeding Front door: not_found");
    expect(panel.accounts[0]?.widgets).toHaveLength(1);
    await tick();
    expect(text(btn)).toBe("Stop feeding");
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("disarms the unbind confirm after 4 s", async () => {
    const panel = await mountPanel();
    const btn = $(cardByName(sr(panel), "Front door"), "aivi-unbind-button button");
    vi.useFakeTimers();
    btn.click();
    await Promise.resolve();
    expect(text(btn)).toBe("Stop feeding?");
    vi.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();
    expect(text(btn)).toBe("Stop feeding");
  });

  it("shows the offline banner when Aivi is unreachable, keeping bound cards", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = (msg: object): Promise<unknown> =>
      ["aivi/widgets", "aivi/activities"].includes((msg as { type: string }).type)
        ? Promise.reject(new Error("unreachable"))
        : orig(msg);
    const panel = await mountPanel(hass);
    expect(text($(sr(panel), ".banner"))).toContain("Aivi is unreachable");
    // Only the configured (bound) widget renders.
    expect($$(sr(panel), "aivi-widget-card")).toHaveLength(1);
    expect(text($(sr(panel), "aivi-widget-card .nm"))).toBe("Front door");
    // Unreachable is not vanished: without a remote list nobody can claim
    // the widget/activity no longer exists. The banner shows that Aivi is
    // unreachable, and the cards must not contradict it with the gone note.
    expect(text($(sr(panel), "aivi-widget-card .sum"))).not.toContain("Not in the Aivi app");
    expect(text($(sr(panel), "aivi-activity-card .sum"))).not.toContain("Not in the Aivi app");
  });

  it("shows the connect hero when no accounts exist", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = (msg: object): Promise<unknown> =>
      (msg as { type: string }).type === "aivi/config"
        ? Promise.resolve({ accounts: [] })
        : orig(msg);
    const panel = await mountPanel(hass);
    expect(text($(sr(panel), ".hero-empty h2"))).toBe("Connect your Aivi account");
  });

  it("retries a fetch from the offline banner", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    let offline = true;
    hass.callWS = (msg: object): Promise<unknown> =>
      offline && (msg as { type: string }).type === "aivi/widgets"
        ? Promise.reject(new Error("unreachable"))
        : orig(msg);
    const panel = await mountPanel(hass);
    offline = false;
    const retry = $$(sr(panel), ".banner button").find((b) => text(b) === "Retry");
    retry!.click();
    await until(() => $$(sr(panel), "aivi-widget-card").length === 7, "widgets back");
    expect(sr(panel).querySelector(".banner")).toBeNull();
  });

  it("renders one card per remote activity, merged with bound state", async () => {
    // The mock account lists two remote activities; washer is bound (and
    // runs on the front door boolean, which the mock states hold `on`),
    // grill is unbound and offers Bind.
    const panel = await mountPanel();
    const cards = $$(sr(panel), "aivi-activity-card");
    expect(cards.map((c) => text($(c, ".nm")))).toEqual(["Washer", "Grill"]);

    const washer = cards[0]!;
    expect($(washer, ".dot").className).toContain("on");
    expect(text($(washer, ".sum"))).toContain("runs on Front door open");
    expect(text($(washer, ".sum"))).toContain("Fed by Washer progress");
    expect(text(washer)).toContain("Stop feeding");

    const grill = cards[1]!;
    expect(grill.querySelector(".dot")).toBeNull();
    expect($(grill, ".chip").textContent).toBe("Monitor");
    expect(text($(grill, ".sum"))).toBe("Two columns of readings");
    expect(text($(grill, ".foot"))).toBe("Set up");

    $$(washer, "button")
      .find((b) => text(b) === "Edit")!
      .click();
    await tick();
    expect(panel.view).toBe("editor");
    expect(panel.editorState?.kind).toBe("activity");
    expect(panel.editorState?.active).toBe("input_boolean.front_door");
  });

  it("calls an activity running on every state the integration reads as on", async () => {
    // The integration's rule (meta.on_states), not a list of the panel's
    // own: "charging" keeps a Live Activity running.
    for (const [state, dot, title] of [
      ["charging", "on", "Running"],
      [" Yes ", "on", "Running"],
      ["1", "on", "Running"],
      ["off", "off", "Not running"],
      ["unknown", "off", "Not running"],
    ] as const) {
      const hass = makeHass();
      const door = hass.states["input_boolean.front_door"]!;
      hass.states = { ...hass.states, "input_boolean.front_door": { ...door, state } };
      const panel = await mountPanel(hass);
      const mark = $(hubCard(panel, "Washer"), ".dot");
      expect(mark.className, state).toContain(dot);
      expect(mark.title, state).toBe(title);
      document.body.innerHTML = "";
    }
  });

  it("Set up on an unbound activity opens the editor with the remote identity", async () => {
    const panel = await mountPanel();
    const grill = $$(sr(panel), "aivi-activity-card")[1]!;
    $$(grill, "button")
      .find((b) => text(b) === "Set up")!
      .click();
    await tick();
    expect(panel.view).toBe("editor");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: null,
      slug: "grill",
      name: "Grill",
      template: "monitor",
    });
  });

  it("marks unsupported activity templates and offers no bind action", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/activities") {
        const r = res as {
          activities: { slug: string; supported: boolean }[];
        };
        for (const a of r.activities) if (a.slug === "grill") a.supported = false;
      }
      return res;
    };
    const panel = await mountPanel(hass);
    const grill = $$(sr(panel), "aivi-activity-card")[1]!;
    expect(text($(grill, ".sum"))).toBe("Needs a newer Aivi integration");
    expect(grill.querySelector("button")).toBeNull();
    expect(grill.className).toContain("dim");
  });

  it("says an activity's template is retired rather than too new", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/activities") {
        const r = res as {
          activities: { slug: string; template: string; supported: boolean }[];
        };
        for (const a of r.activities)
          if (a.slug === "grill") Object.assign(a, { template: "generic", supported: false });
      }
      return res;
    };
    const panel = await mountPanel(hass);
    const grill = $$(sr(panel), "aivi-activity-card")[1]!;
    expect(text($(grill, ".chip"))).toBe("Generic");
    expect(text($(grill, ".sum"))).toBe(
      "An older template Aivi no longer supports. Switch it to Progress or Monitor in the Aivi app.",
    );
    expect(grill.querySelector("button")).toBeNull();
  });

  it("flags a bound activity whose remote counterpart vanished", async () => {
    // A bound activity whose slug the remote list doesn't contain still
    // renders, with a note, like a vanished widget.
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/activities")
        (res as { activities: unknown[] }).activities = [];
      return res;
    };
    const panel = await mountPanel(hass);
    const cards = $$(sr(panel), "aivi-activity-card");
    expect(cards).toHaveLength(1);
    expect(text($(cards[0]!, ".nm"))).toBe("Washer");
    expect(text($(cards[0]!, ".tnote.gone"))).toContain("Not in the Aivi app");
    expect(text(cards[0]!)).toContain("Stop feeding");
  });

  it("has no in-panel activity create flow", async () => {
    // Activities are defined in the Aivi app and merely bound here.
    const panel = await mountPanel();
    expect(sr(panel).querySelector(".wcard.add")).toBeNull();
    expect(sr(panel).textContent).not.toContain("Bind a Live Activity");
  });

  it("boot failure renders the error card with a retry", async () => {
    const hass = makeHass();
    hass.callWS = (): Promise<unknown> => Promise.reject(new Error("nope"));
    const panel = await mountPanel(hass);
    expect(text($(sr(panel), ".hero-empty h2"))).toBe("Couldn't load Aivi");
    expect(text($(sr(panel), ".hero-empty p"))).toBe("nope");
  });
});

describe("accounts", () => {
  it("opens from the bar's gear: each account with its state, add, and manage", async () => {
    const panel = await mountPanel();
    const root = sr(panel);
    const gear = $(root, ".topbar .acctbtn");
    const pop = $(root, "dialog.acctpop") as HTMLDialogElement;
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    expect(pop.open).toBe(false);
    // Nothing needs attention: no mark on the gear.
    expect(gear.classList.contains("attn")).toBe(false);
    gear.click();
    await tick();
    expect(pop.open).toBe(true);
    expect($$(pop, ".acct").map((row) => text(row))).toEqual(["aiviConnected"]);
    expect($(pop, 'a[href="/_my_redirect/config_flow_start?domain=aivi"]').textContent).toBe(
      "Add account",
    );
    expect($(pop, 'a[href="/_my_redirect/integration?domain=aivi"]').textContent).toBe(
      "Manage in Settings",
    );
    // Under the buttons, one per line: where to read, where to ask, and
    // which version this is.
    expect($$(pop, ".acctabout > *").map(text)).toEqual([
      "Documentation",
      "Support",
      "Version 1.2.0",
    ]);
    expect($$(pop, ".acctabout a").map((a) => a.getAttribute("href"))).toEqual([
      "https://docs.getaivi.app/home-assistant/integration/",
      "https://docs.getaivi.app/support/",
    ]);
    // A press outside closes it.
    $(root, ".hubbar").dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await tick();
    expect(pop.open).toBe(false);
  });

  it("is absent with no account, where the hub's card says how to connect one", async () => {
    const hass = makeHass();
    const base = hass.callWS.bind(hass);
    hass.callWS = async (msg: { type: string }) =>
      msg.type === "aivi/config" ? { accounts: [], suggest_state: "ready" } : base(msg);
    const panel = await mountPanel(hass);
    expect(sr(panel).querySelector(".acctbtn")).toBeNull();
    expect(sr(panel).querySelector(".logbtn")).toBeNull();
    expect(text($(sr(panel), ".hero-empty h2"))).toBe("Connect your Aivi account");
  });
});
