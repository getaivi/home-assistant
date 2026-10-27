// An account whose subscription isn't active: the hub states that instead of
// "unreachable", keeps the bound cards, and editing keeps working. The
// fixture is the harness mock's ?inactive=1 flag.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiviPanel } from "../src/aivi-panel";
import { isSubscriptionInactive } from "../src/api";
import {
  $,
  $$,
  makeHass,
  mountPanel,
  openWidgetEditor,
  previewSettled,
  sr,
  text,
  until,
} from "./harness";

beforeEach(() => {
  history.replaceState(null, "", "/?inactive=1");
});

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

describe("inactive subscription", () => {
  it("shows the subscription banner, not the offline one", async () => {
    const panel = await mountPanel();
    const banners = $$(sr(panel), ".banner");
    expect(banners).toHaveLength(1);
    expect(text(banners[0]!)).toContain(
      "Your Aivi subscription isn't active. Everything you set up is kept and resumes when you renew.",
    );
    expect(text(banners[0]!)).not.toContain("unreachable");
    // The bound cards stay, without claiming their widget is gone.
    expect($$(sr(panel), "aivi-widget-card")).toHaveLength(1);
    expect(text($(sr(panel), "aivi-widget-card .sum"))).not.toContain("Not in the Aivi app");
    expect(text($(sr(panel), "aivi-activity-card .sum"))).not.toContain("Not in the Aivi app");
  });

  it("keeps editing and previews working", async () => {
    const panel = await mountPanel();
    const editor = await openWidgetEditor(panel, "frontdoor");
    await previewSettled(editor);
    expect(editor.editorState.preview).toBeTruthy();
  });

  it("clears the banner once a check finds the account renewed", async () => {
    const panel = await mountPanel();
    history.replaceState(null, "", "/");
    const check = $$(sr(panel), ".banner button").find((b) => text(b) === "Check again");
    check!.click();
    await until(() => $$(sr(panel), "aivi-widget-card").length === 7, "widgets back");
    expect(sr(panel).querySelector(".banner")).toBeNull();
  });

  it("trusts a refused listing over a stale account state", async () => {
    // aivi/config still says active; the refused listing is more recent.
    history.replaceState(null, "", "/");
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = (msg: object): Promise<unknown> =>
      (msg as { type: string }).type === "aivi/widgets"
        ? Promise.reject({ code: "subscription_inactive", message: "x" })
        : orig(msg);
    const panel = await mountPanel(hass);
    expect(text($(sr(panel), ".banner"))).toContain("subscription isn't active");
  });

  /** Two accounts, Home and Second; `lapsed` lists the paused ones. */
  async function twoAccounts(lapsed: string[]): Promise<AiviPanel> {
    history.replaceState(null, "", "/");
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const m = msg as { type: string; entry_id?: string };
      if (m.type === "aivi/config") {
        const res = (await orig(msg)) as { accounts: Record<string, unknown>[] };
        const first = res.accounts[0]!;
        const state = (id: string): object =>
          lapsed.includes(id)
            ? { subscription: "inactive", subscription_ended: "2026-09-30T08:00:00+00:00" }
            : { subscription: "active", subscription_ended: null };
        return {
          ...res,
          accounts: [
            { ...first, title: "Home", ...state("acc1") },
            { ...first, entry_id: "acc2", title: "Second", ...state("acc2") },
          ],
        };
      }
      const listing = ["aivi/widgets", "aivi/activities"].includes(m.type);
      if (listing && lapsed.includes(m.entry_id ?? ""))
        return Promise.reject({ code: "subscription_inactive", message: "x" });
      return orig(msg);
    };
    return mountPanel(hass);
  }

  it("names the lapsed account in one banner above every section", async () => {
    const panel = await twoAccounts(["acc2"]);
    expect(panel.inactive).toEqual({ acc1: false, acc2: true });
    const banners = $$(sr(panel), ".banner");
    expect(banners).toHaveLength(1);
    expect(text(banners[0]!)).toContain("The Aivi subscription for Second isn't active");
    // Above the first section, not inside the lapsed account's.
    expect(
      banners[0]!.compareDocumentPosition($$(sr(panel), ".eyebrow")[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Only the lapsed account's headings are marked, and its cards' dots.
    const marked = $$(sr(panel), ".eyebrow")
      .filter((e) => e.querySelector(".chip.warn"))
      .map((e) => text(e));
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((label) => label.startsWith("Second"))).toBe(true);
    expect($$(sr(panel), ".dot.warn").length).toBeGreaterThan(0);
  });

  it("names every lapsed account, without marking each heading", async () => {
    const panel = await twoAccounts(["acc1", "acc2"]);
    const banners = $$(sr(panel), ".banner");
    expect(banners).toHaveLength(1);
    expect(text(banners[0]!)).toContain("The Aivi subscriptions for Home and Second aren't active");
    expect($$(sr(panel), ".eyebrow .chip.warn")).toHaveLength(0);
  });

  it("shortens a long account name in the banner, never in the menu", async () => {
    const long = "Summer cabin by the lake (rented out in July)";
    history.replaceState(null, "", "/");
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const m = msg as { type: string; entry_id?: string };
      if (m.type === "aivi/config") {
        const res = (await orig(msg)) as { accounts: Record<string, unknown>[] };
        const first = res.accounts[0]!;
        return {
          ...res,
          accounts: [first, { ...first, entry_id: "acc2", title: long, subscription: "inactive" }],
        };
      }
      if (["aivi/widgets", "aivi/activities"].includes(m.type) && m.entry_id === "acc2")
        return Promise.reject({ code: "subscription_inactive", message: "x" });
      return orig(msg);
    };
    const panel = await mountPanel(hass);
    const banner = text($(sr(panel), ".banner"));
    expect(banner).toContain("Summer cabin by the lake (rente…");
    expect(banner).not.toContain(long);
    const name = $$(sr(panel), ".acctlist .an")[1]!;
    expect(text(name)).toBe(long);
    expect(name.getAttribute("title")).toBe(long);
  });

  it("says in the accounts menu when each subscription ended", async () => {
    const panel = await twoAccounts(["acc2"]);
    const rows = $$(sr(panel), ".acctlist .acct").map((row) => text(row));
    expect(rows[0]).toContain("Connected");
    expect(rows[1]).toContain("Subscription ended");
    expect(rows[1]).toContain("2026");
  });

  it("tells a subscription refusal from other errors", () => {
    expect(isSubscriptionInactive({ code: "subscription_inactive" })).toBe(true);
    expect(isSubscriptionInactive({ code: "cannot_connect" })).toBe(false);
    expect(isSubscriptionInactive(new Error("unreachable"))).toBe(false);
    expect(isSubscriptionInactive(null)).toBe(false);
  });
});
