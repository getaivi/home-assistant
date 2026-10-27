// Typed client for the aivi/* WebSocket commands. The wire types mirror
// custom_components/aivi/websocket.py; each response's top-level shape is
// checked here, so a backend that disagrees fails at this boundary with a
// clear error instead of deep inside a render.

import type { Account, Feeder, InputsUpdate, RemoteActivity, RemoteWidget } from "./types/accounts";
import type { Bindings } from "./types/bindings";
import type { ContentSize, FieldFeedback, Waiting, WidgetContent } from "./types/content";
import type { EditorKind, SuggestRejected } from "./types/editor";
import type { HassLike } from "./types/hass";
import type { Meta } from "./types/meta";

/** How ready the Suggest backend is (mirrors SuggestState in
 * custom_components/aivi/suggest/). Anything but "ready" renders the
 * box disabled with setup guidance for that state. */
export type SuggestState = "ready" | "no_entity" | "not_loaded";

/** One AI Task model a conversation can ask (mirrors SuggestModel in
 * custom_components/aivi/suggest/). */
export interface SuggestModel {
  entity_id: string;
  name: string;
  preferred: boolean;
}

interface ConfigResult {
  accounts: Account[];
  suggest_state?: SuggestState;
  suggest_models?: SuggestModel[];
  /** The integration's version. Absent from an integration older than
   * this bundle: after an update the new bundle is served while the old
   * integration runs until Home Assistant restarts. */
  version?: string | null;
  /** Automations feeding a slug (absent from an integration older than
   * this bundle). */
  automations?: Feeder[];
}

interface PreviewRequest {
  template: string;
  bindings: Bindings;
  kind: EditorKind;
  /** Entity states to draw the preview with instead of the real ones. */
  states?: Record<string, string>;
}

interface SaveRequest {
  entry_id: string;
  subentry_id?: string | undefined;
  slug: string;
  name: string;
  template: string;
  bindings: Bindings;
  kind: EditorKind;
  active?: string | undefined;
  /** Widgets: seconds, 0 to clear; left out, the widget's own setting
   * stands. */
  stale_after?: number | undefined;
  /** Activities: the least seconds between content pushes. */
  throttle?: number | undefined;
}

interface SuggestRequest {
  template: string;
  kind: EditorKind;
  name: string;
  description: string;
  bindings?: Bindings | undefined;
  /** The conversation so far: each ask, and the model's reply to it. */
  history?: { ask: string; reply?: string | undefined }[] | undefined;
  /** The AI Task entity to ask; left out, Home Assistant's preferred one. */
  entity_id?: string | undefined;
}

/** Whether a rejected aivi/widgets or aivi/activities call was refused
 * because the account has no active subscription. */
export function isSubscriptionInactive(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "subscription_inactive"
  );
}

/** A response that doesn't have the shape this build expects. */
export class WireShapeError extends Error {
  constructor(command: string, detail: string) {
    super(`Unexpected ${command} response: ${detail}`);
    this.name = "WireShapeError";
  }
}

type Shape = (value: unknown) => boolean;

const isRecord: Shape = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isList: Shape = Array.isArray;
const isString: Shape = (v) => typeof v === "string";
const optional =
  (shape: Shape): Shape =>
  (v) =>
    v === undefined || shape(v);
const nullable =
  (shape: Shape): Shape =>
  (v) =>
    v === null || shape(v);
const oneOf =
  (...values: string[]): Shape =>
  (v) =>
    typeof v === "string" && values.includes(v);
/** A list whose every item is an object with these keys' shapes. */
const listOf =
  (keys: Record<string, Shape>): Shape =>
  (v) =>
    Array.isArray(v) &&
    v.every(
      (item) =>
        isRecord(item) &&
        Object.entries(keys).every(([key, shape]) => shape((item as Record<string, unknown>)[key])),
    );

/** Checks the named keys of a response object, then hands it on typed. */
function shaped<T>(command: string, value: unknown, keys: Record<string, Shape>): T {
  if (!isRecord(value)) throw new WireShapeError(command, "not an object");
  const record = value as Record<string, unknown>;
  for (const [key, shape] of Object.entries(keys))
    if (!shape(record[key])) throw new WireShapeError(command, `bad "${key}"`);
  return value as T;
}

export class AiviApi {
  private readonly _getHass: () => HassLike;

  constructor(getHass: () => HassLike) {
    this._getHass = getHass;
  }

  private async _call<T>(
    msg: { type: string } & Record<string, unknown>,
    keys: Record<string, Shape>,
  ): Promise<T> {
    return shaped<T>(msg.type, await this._getHass().callWS(msg), keys);
  }

  templates(): Promise<Meta> {
    return this._call(
      { type: "aivi/templates" },
      {
        templates: isRecord,
        activity_templates: optional(isRecord),
        colors: isList,
        formatters: isList,
        on_states: isList,
      },
    );
  }

  config(): Promise<ConfigResult> {
    return this._call(
      { type: "aivi/config" },
      {
        accounts: listOf({
          entry_id: isString,
          title: isString,
          subscription: optional(oneOf("active", "inactive")),
          subscription_ended: optional(nullable(isString)),
          stream: optional(nullable(isRecord)),
          widgets: isList,
          activities: optional(isList),
        }),
        suggest_state: optional(isString),
        suggest_models: optional(listOf({ entity_id: isString, name: isString })),
        version: optional(nullable(isString)),
        automations: optional(isList),
      },
    );
  }

  widgets(entryId: string): Promise<{ widgets: RemoteWidget[] }> {
    return this._call({ type: "aivi/widgets", entry_id: entryId }, { widgets: isList });
  }

  activities(entryId: string): Promise<{ activities: RemoteActivity[] }> {
    return this._call({ type: "aivi/activities", entry_id: entryId }, { activities: isList });
  }

  preview(req: PreviewRequest): Promise<{
    content: WidgetContent | null;
    /** Absent from an integration older than this bundle. */
    fields?: Record<string, FieldFeedback>;
    /** Switchboards only: the size Aivi will measure. */
    size?: ContentSize;
    /** While content is null: the field it waits on. */
    waiting?: Waiting;
  }> {
    return this._call(
      { type: "aivi/preview", ...req },
      {
        content: nullable(isRecord),
        fields: optional(isRecord),
        size: optional(isRecord),
        waiting: optional(isRecord),
      },
    );
  }

  save(req: SaveRequest): Promise<{ subentry_id: string }> {
    return this._call({ type: "aivi/save", ...req }, { subentry_id: isString });
  }

  /** A new binding's starting form state (what Home Assistant already
   * knows: its currency, a price sensor, the Energy dashboard). */
  defaults(template: string, kind: EditorKind): Promise<{ bindings: Bindings }> {
    return this._call({ type: "aivi/defaults", template, kind }, { bindings: isRecord });
  }

  turnOffAutomations(entityIds: string[]): Promise<{ automations: Feeder[] }> {
    return this._call(
      { type: "aivi/automations/turn_off", entity_ids: entityIds },
      { automations: isList },
    ) as Promise<{ automations: Feeder[] }>;
  }

  /** Conversation starters from this home for a widget of this name:
   * the entities its name points at. No model is asked. */
  suggestStarters(
    template: string,
    kind: EditorKind,
    name: string,
  ): Promise<{ starters: string[] }> {
    return this._call(
      { type: "aivi/suggest/starters", template, kind, name },
      { starters: isList },
    ) as Promise<{ starters: string[] }>;
  }

  suggest(req: SuggestRequest): Promise<{
    bindings?: Bindings;
    reply?: string | null;
    /** Absent from an integration older than this bundle. */
    rejected?: SuggestRejected[];
    /** How the request met the home, and what to offer next (absent
     * from an integration older than this bundle). */
    match?: string | null;
    options?: string[];
  }> {
    return this._call(
      { type: "aivi/suggest", ...req },
      {
        bindings: optional(isRecord),
        reply: optional(nullable(isString)),
        rejected: optional(listOf({ key: isString, value: isString, reason: isString })),
        match: optional(nullable(isString)),
        options: optional(isList),
      },
    );
  }

  /** Follow an account's event stream and recent presses: `onUpdate`
   * gets the current state now and again on every change. Resolves to
   * the unsubscribe function, or null where the host offers no
   * subscriptions. */
  async subscribeInputs(
    entryId: string,
    onUpdate: (update: InputsUpdate) => void,
  ): Promise<(() => Promise<void>) | null> {
    const connection = this._getHass().connection;
    if (!connection) return null;
    return connection.subscribeMessage<InputsUpdate>(
      (update) => {
        if (isRecord(update) && isList((update as InputsUpdate).presses)) onUpdate(update);
      },
      { type: "aivi/inputs/subscribe", entry_id: entryId },
    );
  }

  async delete(entryId: string, subentryId: string): Promise<void> {
    await this._getHass().callWS({
      type: "aivi/delete",
      entry_id: entryId,
      subentry_id: subentryId,
    });
  }
}
