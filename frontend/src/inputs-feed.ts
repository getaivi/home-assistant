// What the phone sends back, live: one aivi/inputs/subscribe per account,
// so the bar's Events and the editor's Recent presses follow each event
// stream and its presses. The subscriptions end when the panel leaves the
// document and resume when it returns (Home Assistant keeps panels around).

import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AiviApi } from "./api";
import type { InputsUpdate } from "./types/accounts";

interface InputsFeedOptions {
  api: AiviApi;
  /** The accounts to follow, by config entry id. */
  accounts(): string[];
  /** An account's update arrived. */
  changed(): void;
}

export class InputsFeed implements ReactiveController {
  private readonly _options: InputsFeedOptions;
  /** Per account: the latest event stream status and recent presses. */
  private _latest: Record<string, InputsUpdate> = {};
  private _unsubscribes = new Map<string, Promise<(() => Promise<void>) | null>>();

  constructor(host: ReactiveControllerHost, options: InputsFeedOptions) {
    this._options = options;
    host.addController(this);
  }

  hostConnected(): void {
    this.sync();
  }

  hostDisconnected(): void {
    for (const entryId of [...this._unsubscribes.keys()]) this._unsubscribe(entryId);
  }

  /** The account's latest update, if it has sent one. */
  of(entryId: string): InputsUpdate | undefined {
    return this._latest[entryId];
  }

  /** Follow exactly the current accounts. */
  sync(): void {
    const wanted = new Set(this._options.accounts());
    for (const entryId of [...this._unsubscribes.keys()])
      if (!wanted.has(entryId)) this._unsubscribe(entryId);
    for (const entryId of wanted) {
      if (this._unsubscribes.has(entryId)) continue;
      const subscribed = this._options.api
        .subscribeInputs(entryId, (update) => {
          this._latest[entryId] = update;
          this._options.changed();
        })
        .catch(() => null);
      this._unsubscribes.set(entryId, subscribed);
    }
  }

  private _unsubscribe(entryId: string): void {
    const subscribed = this._unsubscribes.get(entryId);
    this._unsubscribes.delete(entryId);
    delete this._latest[entryId];
    void subscribed?.then((unsubscribe) => unsubscribe?.()).catch(() => {});
  }
}
