// First-run helpers: the config-flow deep link and the pure state behind
// the hub's onboarding / empty / first-bind states.

import type { Account } from "./types/accounts";

/**
 * The in-instance My Home Assistant redirect that opens the Aivi config
 * flow. The `my` integration (default_config) registers the `_my_redirect`
 * panel; unlike the public my.home-assistant.io link it never leaves the
 * running instance.
 */
export const CONFIG_FLOW_PATH = "/_my_redirect/config_flow_start?domain=aivi";

/** The integration's own page in Settings, where accounts are renamed,
 * reconfigured (a new token) and removed: the `my` redirect for it. */
export const INTEGRATION_PATH = "/_my_redirect/integration?domain=aivi";

export const TOKEN_DOCS_URL = "https://docs.getaivi.app/home-assistant/integration/";

/** Where to ask for help or report a problem. */
export const SUPPORT_URL = "https://docs.getaivi.app/support/";

export const AIVI_APP_URL = "https://getaivi.app";

/** Navigate to an in-instance path the way HA's own navigate() helper
 * does (history.pushState plus a `location-changed` event), so the
 * frontend routes to it without a full page load. */
export function navigateLocal(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(
    new CustomEvent("location-changed", {
      bubbles: true,
      composed: true,
      detail: { replace: false },
    }),
  );
}

export function startConfigFlow(): void {
  navigateLocal(CONFIG_FLOW_PATH);
}

/**
 * What an account says about the lists it has nothing in. Widgets and
 * Live Activities are only created in the Aivi app, so each case points
 * there:
 * - "nothing": reachable, with no widgets and no Live Activities: the
 *   account's own card with the steps.
 * - "no-widgets" / "no-activities": one list is empty while the other
 *   has cards: a one-line note where the empty list would be.
 * - null: both lists have cards, or Aivi is unreachable (or the account
 *   paused). An unreachable list is unknown, not empty, so nothing is
 *   claimed and the banner alone explains.
 */
export type AccountEmpty = "nothing" | "no-widgets" | "no-activities" | null;

export function accountEmpty(offline: boolean, widgets: number, activities: number): AccountEmpty {
  if (offline) return null;
  if (!widgets) return activities ? "no-widgets" : "nothing";
  return activities ? null : "no-activities";
}

/**
 * True when saving the open editor would create the account's first
 * binding (widgets and Live Activities alike). Needs no persistence: a
 * second save can never see a zero count again.
 */
export function isFirstBind(acc: Account | undefined, subentryId: string | null): boolean {
  if (!acc || subentryId) return false;
  return acc.widgets.length + (acc.activities?.length ?? 0) === 0;
}
