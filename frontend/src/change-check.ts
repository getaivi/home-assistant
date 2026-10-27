// The Refresh button: ask Aivi again what the account holds. The Aivi API
// sends nothing when a widget is created or deleted in the app, and the
// panel does not poll for it. One read at a time, and none while the
// button still shows the last one's outcome.

import type { ReactiveController, ReactiveControllerHost } from "lit";

/** The Refresh button turns at least this long, */
const REFRESH_TURN_MS = 600;
/** then shows the outcome this long before it takes another press. */
const REFRESH_REST_MS = 2000;

interface ChangeCheckOptions {
  refresh(): Promise<void>;
  /** Every listed widget and activity, as `kind:slug`. */
  listed(): Set<string>;
  /** Whether an account's list could not be read, other than for a
   * paused subscription. */
  unreachable(): boolean;
  /** The button's state changed. */
  changed(): void;
}

export class ChangeCheck implements ReactiveController {
  private readonly _options: ChangeCheckOptions;
  private _running: Promise<void> | null = null;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  /** What the Refresh button shows: it turns while Aivi is asked, then
   * shows a tick (or a warning) for a moment before it can be pressed
   * again. That rest is also what keeps a held finger from hammering
   * the API. */
  state: "idle" | "busy" | "done" | "failed" = "idle";
  /** The cards a refresh just found (`kind:slug`): they glow once, so
   * what is new can be seen without a message about it. */
  fresh = new Set<string>();

  constructor(host: ReactiveControllerHost, options: ChangeCheckOptions) {
    this._options = options;
    host.addController(this);
  }

  hostDisconnected(): void {
    clearTimeout(this._timer);
  }

  /** The offline banner shows a failure; it is never an unhandled error. */
  run(): Promise<void> {
    const options = this._options;
    if (this.state !== "idle") return this._running ?? Promise.resolve();
    const settle = (state: "done" | "failed"): void => {
      this.state = state;
      options.changed();
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this.state = "idle";
        this.fresh = new Set();
        options.changed();
      }, REFRESH_REST_MS);
    };
    this.state = "busy";
    options.changed();
    this._running = (async () => {
      const before = options.listed();
      const turned = new Promise((done) => setTimeout(done, REFRESH_TURN_MS));
      try {
        await options.refresh();
        // One full turn at least, so a fast answer still reads as done.
        await turned;
        const unreachable = options.unreachable();
        this.fresh = new Set([...options.listed()].filter((slug) => !before.has(slug)));
        settle(unreachable ? "failed" : "done");
      } catch {
        settle("failed");
      } finally {
        this._running = null;
      }
    })();
    return this._running;
  }
}
