// Boot restore from the host-assigned `route` property (deep links and
// reloads), and the fallback for a target that is gone or unreadable: the
// hub, with a toast when an id has gone away, never a blank screen.

import { afterEach, describe, expect, it } from "vitest";
import { makeHass, mountRouted, sr, takeBacks, text, tick, until } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  takeBacks();
});

describe("boot restore", () => {
  it("restores a bound widget's editor from its slug", async () => {
    const panel = await mountRouted("/widget/frontdoor");
    await until(() => panel.view === "editor", "editor restore");
    expect(panel.editorState).toMatchObject({
      kind: "widget",
      slug: "frontdoor",
      subentryId: "w1",
    });
    expect(panel.editorState?.bindings).toMatchObject({
      state: "input_boolean.front_door",
    });
  });

  it("restores an unbound widget's bind editor (no subentry id yet)", async () => {
    const panel = await mountRouted("/widget/laundry");
    await until(() => panel.view === "editor", "editor restore");
    expect(panel.editorState).toMatchObject({
      kind: "widget",
      slug: "laundry",
      subentryId: null,
      template: "progress",
    });
  });

  it("restores a bound activity's editor from its remote slug", async () => {
    const panel = await mountRouted("/activity/washer");
    await until(() => panel.view === "editor", "editor restore");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: "a1",
      slug: "washer",
      active: "input_boolean.front_door",
    });
  });

  it("restores an unbound activity's bind editor from its slug", async () => {
    const panel = await mountRouted("/activity/grill");
    await until(() => panel.view === "editor", "editor restore");
    expect(panel.editorState).toMatchObject({
      kind: "activity",
      subentryId: null,
      slug: "grill",
      template: "monitor",
    });
  });

  it("lands vanished widget ids on the hub with a toast and a normalized URL", async () => {
    const panel = await mountRouted("/widget/ghost");
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(panel.view).toBe("home");
    const toast = sr(panel).querySelector(".toast");
    expect(toast && text(toast)).toBe("That widget wasn't found. Showing your widgets instead.");
    expect(panel.route).toEqual({ prefix: "/aivi", path: "" });
    expect(location.pathname).toBe("/aivi");
  });

  it("lands vanished activity ids on the hub with the activity toast", async () => {
    const panel = await mountRouted("/activity/gone");
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(panel.view).toBe("home");
    const toast = sr(panel).querySelector(".toast");
    expect(toast && text(toast)).toBe(
      "That Live Activity wasn't found. Showing your widgets instead.",
    );
  });

  it("lands a malformed deep link on the hub with a normalized URL", async () => {
    // Not the boot-error card.
    const panel = await mountRouted("/widget/%E0%A4%A");
    expect(panel.view).toBe("home");
    expect(sr(panel).querySelector("aivi-hub")).not.toBeNull();
    expect(sr(panel).querySelector(".toast")).toBeNull();
    expect(panel.route).toEqual({ prefix: "/aivi", path: "" });
    expect(location.pathname).toBe("/aivi");
  });

  it("does not claim a widget is gone when its list could not be read", async () => {
    // Offline (or paused), the list is unknown. The hub's
    // banner states why nothing opened; "wasn't found" would be
    // a guess.
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = (msg: object): Promise<unknown> =>
      ["aivi/widgets", "aivi/activities"].includes((msg as { type: string }).type)
        ? Promise.reject(new Error("unreachable"))
        : orig(msg);
    const panel = await mountRouted("/widget/laundry", hass);
    await until(() => !!sr(panel).querySelector(".banner"), "offline banner");
    await tick();
    expect(panel.view).toBe("home");
    expect(panel.route).toEqual({ prefix: "/aivi", path: "" });
    expect(sr(panel).querySelector(".toast")).toBeNull();
  });

  it("normalizes unrecognized paths to the hub, silently", async () => {
    const panel = await mountRouted("/bogus/path/here");
    expect(panel.view).toBe("home");
    expect(sr(panel).querySelector(".toast")).toBeNull();
    expect(panel.route).toEqual({ prefix: "/aivi", path: "" });
  });

  it("navigates editor -> editor on a fresh route assignment", async () => {
    // Two editors can be adjacent in history (or hand-edited URLs); the
    // route swap must re-render the mounted editor, not just swap `editorState`.
    const panel = await mountRouted("/widget/frontdoor");
    await until(() => panel.view === "editor", "widget editor");
    panel.route = { prefix: "/aivi", path: "/activity/washer" };
    await until(() => panel.editorState?.kind === "activity", "activity editor state");
    await until(() => {
      const title = sr(panel).querySelector(".topbar .title");
      return !!title && text(title) === "Washer";
    }, "activity editor rendered");
  });

  it("does not open unbound unsupported widgets", async () => {
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    hass.callWS = async (msg: object): Promise<unknown> => {
      const res = await orig(msg);
      if ((msg as { type: string }).type === "aivi/widgets") {
        const r = res as { widgets: { slug: string; supported: boolean }[] };
        for (const w of r.widgets) if (w.slug === "laundry") w.supported = false;
      }
      return res;
    };
    const panel = await mountRouted("/widget/laundry", hass);
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(panel.view).toBe("home");
  });

  it("does not open unbound unsupported activities", async () => {
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
    const panel = await mountRouted("/activity/grill", hass);
    await until(() => !!sr(panel).querySelector(".toast"), "toast");
    expect(panel.view).toBe("home");
  });
});
