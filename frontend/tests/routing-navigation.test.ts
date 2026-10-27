// Navigation after boot: the pushState + location-changed contract for
// what the UI opens and closes, and back/forward and links arriving as
// fresh host `route` assignments.

import { afterEach, describe, expect, it } from "vitest";
import { $, mountRouted, sr, takeBacks, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  takeBacks();
});

describe("navigation", () => {
  it("openEditor pushes the widget URL and fires location-changed", async () => {
    const panel = await mountRouted("");
    const events: { replace?: boolean }[] = [];
    const listen = (e: Event): void => {
      events.push((e as CustomEvent<{ replace?: boolean }>).detail);
    };
    window.addEventListener("location-changed", listen);
    try {
      const acc = panel.accounts[0];
      const bound = acc?.widgets[0];
      if (!acc || !bound) throw new Error("no bound fixture widget");
      panel.openEditor(acc, null, bound);
      expect(panel.route).toEqual({
        prefix: "/aivi",
        path: "/widget/frontdoor",
      });
      expect(location.pathname).toBe("/aivi/widget/frontdoor");
      expect(events).toEqual([{ replace: false }]);

      // Closing returns to the hub entry the editor was opened from:
      // history.back, after which the host echoes the hub route. No
      // second hub entry goes on top of the editor's.
      takeBacks();
      panel.closeEditor();
      expect(panel.view).toBe("home");
      expect(panel.route).toEqual({ prefix: "/aivi", path: "" });
      expect(takeBacks()).toBe(1);
      expect(events).toEqual([{ replace: false }]);
      // The host's echo of the hub route changes nothing.
      panel.route = { prefix: "/aivi", path: "" };
      expect(panel.view).toBe("home");
    } finally {
      window.removeEventListener("location-changed", listen);
    }
  });

  it("closing a deep-linked editor replaces its entry with the hub's", async () => {
    // With no hub entry below (the editor was the way in), going back
    // would leave the panel; the URL is replaced.
    const panel = await mountRouted("/widget/frontdoor");
    await until(() => panel.view === "editor", "editor restore");
    history.replaceState(null, "", "/aivi/widget/frontdoor");
    const events: { replace?: boolean }[] = [];
    const listen = (e: Event): void => {
      events.push((e as CustomEvent<{ replace?: boolean }>).detail);
    };
    window.addEventListener("location-changed", listen);
    try {
      panel.closeEditor();
    } finally {
      window.removeEventListener("location-changed", listen);
    }
    expect(panel.view).toBe("home");
    expect(takeBacks()).toBe(0);
    expect(location.pathname).toBe("/aivi");
    expect(events).toEqual([{ replace: true }]);
  });

  it("an editor the host opens over the hub closes back to it", async () => {
    // A link or browser forward while the hub is mounted: the hub's entry
    // is the one below, same as opening from a card.
    const panel = await mountRouted("");
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor" };
    expect(panel.view).toBe("editor");
    takeBacks();
    panel.closeEditor();
    expect(takeBacks()).toBe(1);
  });

  it("Discard after a dirty route change continues to the route asked for", async () => {
    // The user was going to the Washer activity; discarding the widget's
    // changes must not strand them on the hub.
    const panel = await mountRouted("");
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "editor");
    if (panel.editorState) panel.editorState.staleAfter = 3600; // an unsaved change
    panel.route = { prefix: "/aivi", path: "/activity/washer" };
    await tick();
    // Held back: still the widget editor, its URL put back, the question up.
    expect(panel.editorState?.slug).toBe("frontdoor");
    expect(location.pathname).toBe("/aivi/widget/frontdoor");
    $(sr(panel), "dialog.leavedlg .discard").click();
    await until(() => panel.editorState?.kind === "activity", "the activity editor");
    expect(panel.editorState?.slug).toBe("washer");
    expect(panel.route).toEqual({ prefix: "/aivi", path: "/activity/washer" });
    expect(location.pathname).toBe("/aivi/activity/washer");
    expect(takeBacks()).toBe(0);
  });

  it("Keep editing forgets where a held-back route change was going", async () => {
    // After Keep, a later Back + Discard is a plain leave to the hub, not
    // a jump to the activity asked for earlier.
    const panel = await mountRouted("");
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "editor");
    if (panel.editorState) panel.editorState.staleAfter = 3600;
    panel.route = { prefix: "/aivi", path: "/activity/washer" };
    await tick();
    $(sr(panel), "dialog.leavedlg .keep").click();
    await tick();
    $(sr(panel), ".backbtn").click();
    await tick();
    $(sr(panel), "dialog.leavedlg .discard").click();
    await tick();
    expect(panel.view).toBe("home");
  });

  it("Discard after browser back goes back to the hub entry", async () => {
    // Browser back from a dirty editor: the editor's URL is pushed back
    // on top of the hub's entry, so Discard goes back to it.
    const panel = await mountRouted("");
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    await until(() => !!sr(panel).querySelector("aivi-editor .form"), "editor");
    if (panel.editorState) panel.editorState.staleAfter = 3600;
    panel.route = { prefix: "/aivi", path: "" };
    await tick();
    takeBacks();
    $(sr(panel), "dialog.leavedlg .discard").click();
    await tick();
    expect(panel.view).toBe("home");
    expect(takeBacks()).toBe(1);
  });

  it("openActivityEditor pushes the remote activity's slug route", async () => {
    const panel = await mountRouted("");
    const acc = panel.accounts[0];
    if (!acc) throw new Error("no account");
    const remote = panel.aiviActivities[acc.entry_id]?.find((a) => a.slug === "grill") ?? null;
    panel.openActivityEditor(acc, remote, null);
    expect(panel.route).toEqual({ prefix: "/aivi", path: "/activity/grill" });
  });

  it("host route assignments navigate hub <-> editor (back/forward)", async () => {
    const panel = await mountRouted("");
    // Forward: the host hands the panel an editor route.
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor" };
    expect(panel.view).toBe("editor");
    expect(panel.editorState?.slug).toBe("frontdoor");
    // Back: the host hands the hub route; unsaved editor state is
    // discarded without a prompt (same contract as the Back button).
    if (panel.editorState) panel.editorState.bindings["state"] = "sensor.humidity";
    panel.route = { prefix: "/aivi", path: "" };
    expect(panel.view).toBe("home");
    expect(panel.editorState).toBeNull();
  });

  it("keeps the vanished-id toast across the editor -> hub re-render", async () => {
    // A host route assignment mid-editor swaps the editor template for the
    // hub; a toast raised before that commit must survive it.
    const panel = await mountRouted("/widget/laundry");
    await until(() => panel.view === "editor", "editor restore");
    panel.route = { prefix: "/aivi", path: "/widget/ghost" };
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    await tick(); // let the re-render settle; the toast must survive it
    expect(panel.view).toBe("home");
    expect(sr(panel).querySelector(".toast")).not.toBeNull();
  });

  it("ignores the host's echo of the panel's own push", async () => {
    const panel = await mountRouted("");
    const acc = panel.accounts[0];
    const bound = acc?.widgets[0];
    if (!acc || !bound) throw new Error("no bound fixture widget");
    panel.openEditor(acc, null, bound);
    const editorState = panel.editorState;
    panel.route = { prefix: "/aivi", path: "/widget/frontdoor" };
    expect(panel.editorState).toBe(editorState); // same editor state: not re-opened
  });
});
