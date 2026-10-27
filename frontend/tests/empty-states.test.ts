// The hub with nothing to list: the onboarding card with no account
// connected, the steps for an account with nothing on it, and the note
// for an account with only one kind.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiviPanel } from "../src/aivi-panel";
import { AIVI_APP_URL, CONFIG_FLOW_PATH, TOKEN_DOCS_URL } from "../src/onboarding";
import type { HassLike } from "../src/types/hass";
import {
  $,
  $$,
  makeHass,
  mountPanel,
  setInput,
  sr,
  text,
  tick,
  unboundHass,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

/** No config entries at all: the onboarding case. */
function noAccountHass(): HassLike {
  const hass = makeHass();
  const orig = hass.callWS.bind(hass);
  hass.callWS = (msg: object): Promise<unknown> =>
    (msg as { type: string }).type === "aivi/config"
      ? Promise.resolve({ accounts: [] })
      : orig(msg);
  return hass;
}

/** The hub over the harness mock in one of its states (see
 * frontend/harness/README.md). */
function mountWith(flags: string): Promise<AiviPanel> {
  history.replaceState(null, "", `/${flags}`);
  return mountPanel();
}

/** The section headings, in order. */
function headings(panel: AiviPanel): string[] {
  return $$(sr(panel), "aivi-hub .eyebrow").map(text);
}

describe("onboarding card", () => {
  it("explains the model and deep-links into the config flow", async () => {
    const panel = await mountPanel(noAccountHass());
    const hero = $(sr(panel), ".hero-empty");
    expect(text($(hero, "h2"))).toBe("Connect your Aivi account");
    expect(text($(hero, "p"))).toContain("Widgets are built in the Aivi app");
    const connect = $(hero, "a.btn") as HTMLAnchorElement;
    expect(text(connect)).toBe("Connect account");
    expect(connect.getAttribute("href")).toBe(CONFIG_FLOW_PATH);
  });

  it("links the token help to the docs, in a new tab", async () => {
    const panel = await mountPanel(noAccountHass());
    const help = $(sr(panel), ".hero-empty .subnote a");
    expect(text(help)).toBe("Where do I find my token?");
    expect(help.getAttribute("href")).toBe(TOKEN_DOCS_URL);
    expect(help.getAttribute("target")).toBe("_blank");
  });
});

describe("an account with nothing on it", () => {
  it("says how widgets and Live Activities get here, as steps", async () => {
    const panel = await mountWith("?nowidgets=1");
    const card = $(sr(panel), ".acct-empty");
    expect(text($(card, "h2"))).toBe("No widgets or Live Activities yet");
    expect(card.getAttribute("aria-labelledby")).toBe($(card, "h2").id);
    expect($$(card, "ol.steps li").map(text)).toEqual([
      "Create a widget or a Live Activity in the Aivi app on your iPhone or iPad.",
      "Press Refresh here. New ones appear then, not on their own.",
      "Press Set up on it and pick the entities that feed it.",
    ]);
    // The page's only content: no "Widgets" heading over it, no note.
    expect(headings(panel)).toEqual([]);
    expect(card.classList.contains("in-section")).toBe(false);
    expect(sr(panel).querySelector(".empty-note")).toBeNull();
  });

  it("links the Aivi app in a new tab", async () => {
    const panel = await mountWith("?nowidgets=1");
    const cta = $(sr(panel), ".acct-empty a.btn.primary") as HTMLAnchorElement;
    expect(text(cta)).toBe("Open the Aivi app");
    expect(cta.getAttribute("href")).toBe(AIVI_APP_URL);
    expect(cta.getAttribute("target")).toBe("_blank");
    expect(cta.getAttribute("rel")).toBe("noreferrer");
  });

  it("refreshes from the card, and says when nothing new turned up", async () => {
    const panel = await mountWith("?nowidgets=1");
    const run = vi.spyOn(panel, "checkForChanges");
    const button = $(sr(panel), ".acct-empty button.rfbtn");
    expect(text(button)).toBe("Refresh");
    expect(button.getAttribute("aria-disabled")).toBe("false");
    button.click();
    expect(run).toHaveBeenCalledOnce();
    await until(() => panel.refreshState === "done", "refresh done");
    await tick();
    const done = $(sr(panel), ".acct-empty button.rfbtn");
    expect(done.getAttribute("aria-disabled")).toBe("true");
    expect(text($(sr(panel), ".acct-empty .rfnote"))).toBe(
      "Up to date: nothing changed in the Aivi app.",
    );
  });

  it("gives way to what a refresh found, keeping focus in the hub", async () => {
    const panel = await mountWith("?nowidgets=1");
    const button = $(sr(panel), ".acct-empty button.rfbtn");
    button.focus();
    // Meanwhile, widgets were created in the app (the mock reads its
    // flags on every listing).
    history.replaceState(null, "", "/");
    button.click();
    await until(() => panel.refreshState === "done", "refresh done");
    await tick();
    expect(sr(panel).querySelector(".acct-empty")).toBeNull();
    expect($$(sr(panel), "aivi-widget-card").length).toBeGreaterThan(0);
    const active = sr(panel).activeElement;
    expect(active?.closest("aivi-hub")).not.toBeNull();
  });

  it("sits in that account's own section when there are several", async () => {
    const panel = await mountWith("?accounts=2&nowidgets=acc2");
    const cards = $$(sr(panel), ".acct-empty");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.classList.contains("in-section")).toBe(true);
    // Under Cabin's name, after Home's cards.
    expect(headings(panel)).toEqual(["Home", "Home· Live Activities", "Cabin"]);
    expect(cards[0]?.previousElementSibling?.textContent).toContain("Cabin");
    expect($$(sr(panel), "aivi-widget-card").length).toBeGreaterThan(0);
  });

  it("claims nothing about the account while Aivi is unreachable", async () => {
    // Unreachable is unknown, not empty. "No widgets yet"
    // under a banner saying Aivi can't be reached would be a guess.
    const hass = unboundHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = (msg: object): Promise<unknown> =>
      (msg as { type: string }).type === "aivi/widgets"
        ? Promise.reject(new Error("unreachable"))
        : orig(msg);
    const panel = await mountPanel(hass);
    expect(text($(sr(panel), ".banner"))).toContain("Aivi is unreachable");
    expect(sr(panel).querySelector(".hero-empty, .acct-empty, .empty-note")).toBeNull();
    expect(text($(sr(panel), "aivi-hub"))).not.toContain("yet");
  });
});

describe("an account with only one kind", () => {
  it("notes the missing widgets where their cards would be", async () => {
    const panel = await mountWith("?activitiesonly=1");
    expect(sr(panel).querySelector(".acct-empty")).toBeNull();
    expect(headings(panel)).toEqual(["Widgets", "Live Activities"]);
    const note = $(sr(panel), ".empty-note");
    expect(note.previousElementSibling?.textContent).toBe("Widgets");
    expect(text($(note, "p"))).toBe("No widgets yet. Create one in the Aivi app, then refresh.");
    expect($(note, "a").getAttribute("href")).toBe(AIVI_APP_URL);
    expect(text($(note, "button.rfbtn"))).toBe("Refresh");
    expect($$(sr(panel), "aivi-activity-card")).toHaveLength(2);
  });

  it("notes the missing Live Activities under their heading", async () => {
    const panel = await mountWith("?noactivities=1");
    expect(headings(panel)).toEqual(["Widgets", "Live Activities"]);
    const note = $(sr(panel), ".empty-note");
    expect(note.previousElementSibling?.textContent).toBe("Live Activities");
    expect(text($(note, "p"))).toBe(
      "No Live Activities yet. Create one in the Aivi app, then refresh.",
    );
    expect($$(sr(panel), "aivi-widget-card").length).toBeGreaterThan(0);
  });

  it("leaves the note out while searching", async () => {
    const panel = await mountWith("?activitiesonly=1");
    setInput($(sr(panel), '.hubbar input[type="search"]'), "washer");
    await tick();
    expect(sr(panel).querySelector(".empty-note")).toBeNull();
    expect(headings(panel)).toEqual(["Live Activities"]);
  });
});
