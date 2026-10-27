import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fetchJson } from "./http";

const QA_DIR = join(__dirname, "../../../qa");

/** A push as the mock lists it at /pushes.json, newest first. */
export interface Push {
  slug: string;
  stale_after?: number;
  content?: {
    progress?: { value?: number | string };
    entries?: unknown[];
    actions?: { id: string; kind: string; on?: boolean }[];
  };
}

/** The mock Aivi API: what it received, and its switches for the cases a
 * real account cannot produce on demand (qa/README.md). */
export class MockAivi {
  constructor(readonly url: string) {}

  pushes(): Promise<Push[]> {
    return fetchJson(`${this.url}/pushes.json`);
  }

  /** The newest push matching the predicate, or undefined. */
  async findPush(predicate: (push: Push) => boolean): Promise<Push | undefined> {
    return (await this.pushes()).find(predicate);
  }

  /** The requests the mock refused for breaking the API's schema. */
  refusals(): Promise<unknown[]> {
    return fetchJson(`${this.url}/refusals.json`);
  }

  /** How many API calls were answered 402 since the subscription last
   * changed. */
  async answered402(): Promise<number> {
    const state = await fetchJson<{ answered_402: number }>(`${this.url}/state.json`);
    return state.answered_402;
  }

  private post<T>(path: string, body: object): Promise<T> {
    return fetchJson(`${this.url}${path}`, { method: "POST", body: JSON.stringify(body) });
  }

  /** Restore every switch and clear the pushes. */
  reset(): Promise<unknown> {
    return this.post("/admin/reset", {});
  }

  setSubscription(body: { active: boolean; expired_at?: string }): Promise<unknown> {
    return this.post("/admin/subscription", body);
  }

  /** Stand in for a Home Screen tile press: the mock delivers it on the
   * event streams it holds open and says how many there were. */
  async pressTile(widget: string, action: string, value?: boolean): Promise<number> {
    const sent = await this.post<{ delivered_to: number }>("/command", {
      widget,
      action,
      ...(value === undefined ? {} : { value }),
    });
    return sent.delivered_to;
  }

  /** Take the mock's container down, as an outage of Aivi. */
  stop(): void {
    this.compose("stop");
  }

  start(): void {
    this.compose("start");
  }

  private compose(command: "stop" | "start"): void {
    execFileSync("docker", ["compose", command, "mock-aivi"], {
      cwd: QA_DIR,
      stdio: "inherit",
    });
  }
}

/** Predicate for a laundry push carrying the given washer progress. The
 * engine scales 0-100 to 0-1 and rounds away float noise (wire_number in
 * blocks.py), so strict equality holds. */
export const laundryPushWith =
  (value: number) =>
  (push: Push): boolean =>
    push.slug === "laundry" && Number(push.content?.progress?.value) === value / 100;
