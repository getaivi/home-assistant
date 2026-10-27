// The first-run rules: which empty state the hub shows, what counts as a
// first bind, and the deep link into the config flow.

import { describe, expect, it } from "vitest";
import { accountEmpty, CONFIG_FLOW_PATH, isFirstBind, startConfigFlow } from "../src/onboarding";
import type { Account } from "../src/types/accounts";

describe("accountEmpty", () => {
  it("is null when both lists have cards", () => {
    expect(accountEmpty(false, 1, 1)).toBeNull();
  });

  it("is the account's card when it has nothing at all", () => {
    expect(accountEmpty(false, 0, 0)).toBe("nothing");
  });

  it("names the one empty list when the other has cards", () => {
    expect(accountEmpty(false, 0, 2)).toBe("no-widgets");
    expect(accountEmpty(false, 3, 0)).toBe("no-activities");
  });

  it("claims nothing while Aivi is unreachable", () => {
    // Unreachable (or paused): the lists are unknown, not empty.
    expect(accountEmpty(true, 0, 0)).toBeNull();
    expect(accountEmpty(true, 2, 0)).toBeNull();
    expect(accountEmpty(true, 0, 1)).toBeNull();
  });
});

describe("isFirstBind", () => {
  const acc = (widgets: number, activities: number): Account => ({
    entry_id: "acc1",
    title: "aivi",
    widgets: Array.from({ length: widgets }, (_, i) => ({
      subentry_id: `w${i}`,
      slug: `s${i}`,
      name: `W${i}`,
      template: "status",
    })),
    activities: Array.from({ length: activities }, (_, i) => ({
      subentry_id: `a${i}`,
      slug: `la${i}`,
      name: `A${i}`,
      template: "progress",
    })),
  });

  it("is true only for a create on a nothing-bound account", () => {
    expect(isFirstBind(acc(0, 0), null)).toBe(true);
    expect(isFirstBind(acc(1, 0), null)).toBe(false);
    expect(isFirstBind(acc(0, 1), null)).toBe(false); // activities count too
  });

  it("is false for edits and unknown accounts", () => {
    expect(isFirstBind(acc(0, 0), "w1")).toBe(false);
    expect(isFirstBind(undefined, null)).toBe(false);
  });
});

describe("startConfigFlow", () => {
  it("pushes the my-redirect path and fires location-changed", () => {
    let detail: unknown;
    const onChange = (e: Event): void => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener("location-changed", onChange);
    startConfigFlow();
    window.removeEventListener("location-changed", onChange);
    expect(location.pathname + location.search).toBe(CONFIG_FLOW_PATH);
    expect(detail).toEqual({ replace: false });
    // Leave the URL clean for the rest of the suite (makeHass reads
    // location.search for its dev-harness flags).
    history.pushState(null, "", "/");
  });
});
