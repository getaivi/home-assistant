// What aivi/config and the listings report about each connected account:
// its bindings, the remote widgets and Live Activities, its event stream
// and the events the phone sent back, and the automations that feed a
// slug. The WebSocket layer (api.ts) is the trusted boundary: results are
// typed against the Python side (custom_components/aivi/wire.py) rather
// than re-validated at runtime, and tests/wire.test.ts holds the harness
// mock to what the integration sends.

import type { Bindings } from "./bindings";
import type { Waiting } from "./content";
import type { EditorKind } from "./editor";

export interface BoundWidget {
  subentry_id: string;
  slug: string;
  name: string;
  template: string;
  bindings?: Bindings;
  /** Live Activities only: the lifecycle entity. */
  active?: string;
  /** Widgets only: the stale_after sent with every push, in seconds (0:
   * cleared); null or absent leaves the widget's own setting alone. */
  stale_after?: number | null;
  /** Live Activities only: the least seconds between content pushes. */
  throttle?: number;
}

export interface Account {
  entry_id: string;
  title: string;
  /** "inactive" while the account is paused for its subscription; absent
   * from an integration older than this bundle. */
  subscription?: "active" | "inactive";
  /** While paused: when the subscription ended (ISO 8601), or null when
   * Aivi gave no date, as for an account that never had one. */
  subscription_ended?: string | null;
  /** The account's event stream; null while nothing it binds accepts
   * input, absent from an integration older than this bundle. */
  stream?: StreamStatus | null;
  /** Whether the account keeps its activity log across restarts (an
   * entry option); absent from an integration older than this bundle. */
  keep_log?: boolean;
  widgets: BoundWidget[];
  activities?: BoundWidget[];
}

/** How an account's event stream stands (aivi/config, and every
 * aivi/inputs/subscribe update). */
export interface StreamStatus {
  state: "connected" | "reconnecting" | "paused" | "stopped";
  connected: boolean;
  reason: string | null;
  last_error: string | null;
  connected_since: string | null;
  last_event: string | null;
  reconnects: number;
}

type PressOutcome = "played" | "expired" | "not_bound" | "ignored" | "failed";

/** One event from the phone and what became of it, newest first. */
export interface PressRow {
  id: string | null;
  time: string;
  received_at: string;
  kind: string;
  slug: string;
  subentry_id: string | null;
  event_type: string;
  entity_id: string | null;
  label: string | null;
  value: unknown;
  outcome: PressOutcome;
  error: string | null;
  recorded: boolean;
  /** Coalesced play-only events: how many this row stands for. */
  count: number;
}

export type PushOutcome = "delivered" | "unchanged" | "retrying" | "failed" | "waiting" | "held";

/** A push as it goes over the wire to Aivi. */
export interface PushRequest {
  method: string;
  /** Under the API's base URL, e.g. `/activities/washer`. */
  path: string;
  /** The JSON body (an object), or its JSON cut short (a string) when the
   * row is `truncated`. */
  body: unknown;
}

/** One push cycle for a binding and how it ended, newest first. */
export interface PushRow {
  id: string;
  time: string;
  kind: string;
  slug: string;
  subentry_id: string;
  outcome: PushOutcome;
  /** The binding's push status after the cycle (ok, retrying, rejected…). */
  status: string;
  error: string | null;
  duration_ms: number | null;
  /** The request as sent (or, unchanged or held, as it would be sent),
   * or null when nothing resolved. */
  request: PushRequest | null;
  truncated: boolean;
  /** Outcome "waiting": the field with no value, so nothing was sent. */
  waiting: Waiting | null;
  /** Outcome "held": when the throttle lets it go, and the interval in
   * seconds that holds it. */
  held: { until: string; interval: number } | null;
  /** Coalesced repeats: how many cycles this row stands for. */
  count: number;
}

/** How a binding's pushing stands now (aivi/inputs/subscribe). */
export interface BindingStatus {
  /** The push status sensor's state (ok, waiting, retrying…). */
  status: string;
  /** Status "waiting": the field with no value, so nothing is sent. */
  waiting: Waiting | null;
  /** While the throttle holds a change back: when it goes out. */
  held: { until: string; interval: number } | null;
}

/** What aivi/inputs/subscribe sends: now, and on every change. */
export interface InputsUpdate {
  stream: StreamStatus | null;
  presses: PressRow[];
  /** Absent from an integration older than this bundle. */
  pushes?: PushRow[];
  /** Each running binding's status, by subentry id. Absent from an
   * integration older than this bundle. */
  status?: Record<string, BindingStatus>;
}

export interface RemoteWidget {
  slug: string;
  name: string;
  template: string;
  supported?: boolean;
}

/** One remote Live Activity (aivi/activities); same wire shape as a widget. */
export type RemoteActivity = RemoteWidget;

/** An automation that feeds a widget or Live Activity by its slug. */
export interface Feeder {
  kind: EditorKind;
  slug: string;
  entity_id: string;
  name: string;
  enabled: boolean;
  /** Its id in the automation editor; null for YAML without an id. */
  config_id: string | null;
  blueprint: boolean;
  /** Why turning it off is not offered here, or null when it is. */
  keep: "shared" | "initial_state" | null;
}
