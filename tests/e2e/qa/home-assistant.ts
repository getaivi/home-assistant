import { fetchJson } from "./http";

export const USERNAME = "dev";
export const PASSWORD = "dev";

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  context: { id: string };
}

export interface ConfigEntry {
  entry_id: string;
  state: string;
}

/** A step of a config or repair flow, as the REST API answers it. */
export interface FlowResult {
  type: string;
  flow_id: string;
  step_id?: string;
  reason?: string;
}

export interface RepairIssue {
  domain: string;
  issue_id: string;
  translation_placeholders?: Record<string, string>;
}

export interface LogbookEntry {
  domain?: string;
  name?: string;
  message?: string;
  entity_id?: string;
  state?: string;
  context_event_type?: string;
  context_message?: string;
}

type WebSocketReply =
  | { type: "auth_required" | "auth_ok" }
  | { type: "auth_invalid"; message: string }
  | { type: "result"; id: number; success: boolean; result: unknown; error?: unknown };

/** Home Assistant's REST and WebSocket APIs, as the seeded dev user. */
export class HomeAssistant {
  private token = "";

  constructor(readonly url: string) {}

  /** The OAuth code flow against the seeded user. */
  async login(): Promise<void> {
    const clientId = `${this.url}/`;
    const json = { "Content-Type": "application/json" };
    const flow = await fetchJson<{ flow_id: string }>(`${this.url}/auth/login_flow`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        client_id: clientId,
        handler: ["homeassistant", null],
        redirect_uri: `${clientId}?auth_callback=1`,
      }),
    });
    const result = await fetchJson<{ type: string; result?: string; errors?: unknown }>(
      `${this.url}/auth/login_flow/${flow.flow_id}`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({ client_id: clientId, username: USERNAME, password: PASSWORD }),
      },
    );
    if (result.type !== "create_entry" || !result.result) {
      throw new Error(`login failed: ${JSON.stringify(result.errors ?? result)}`);
    }
    const token = await fetchJson<{ access_token: string }>(`${this.url}/auth/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: result.result,
        client_id: clientId,
      }),
    });
    this.token = token.access_token;
  }

  api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    return fetchJson<T>(`${this.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** One WebSocket command, for what REST does not expose. */
  ws<T>(message: { type: string }): Promise<T> {
    const socket = new WebSocket(`${this.url.replace(/^http/, "ws")}/api/websocket`);
    return new Promise<T>((resolve, reject) => {
      socket.onerror = () => reject(new Error(`websocket failed for ${message.type}`));
      socket.onmessage = (event) => {
        const reply = JSON.parse(String(event.data)) as WebSocketReply;
        if (reply.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: this.token }));
        } else if (reply.type === "auth_ok") {
          socket.send(JSON.stringify({ id: 1, ...message }));
        } else if (reply.type === "auth_invalid") {
          socket.close();
          reject(new Error(`websocket auth failed: ${reply.message}`));
        } else if (reply.type === "result" && reply.id === 1) {
          socket.close();
          if (reply.success) resolve(reply.result as T);
          else reject(new Error(`${message.type}: ${JSON.stringify(reply.error)}`));
        }
      };
    });
  }

  callService(domain: string, service: string, data: object): Promise<unknown> {
    return this.api("POST", `/api/services/${domain}/${service}`, data);
  }

  state(entityId: string): Promise<EntityState> {
    return this.api("GET", `/api/states/${entityId}`);
  }

  /** The first entity state matching the predicate, or undefined. */
  async findState(predicate: (state: EntityState) => boolean): Promise<EntityState | undefined> {
    return (await this.api<EntityState[]>("GET", "/api/states")).find(predicate);
  }

  aiviEntries(): Promise<ConfigEntry[]> {
    return this.api("GET", "/api/config/config_entries/entry?domain=aivi");
  }

  /** Connect the Aivi account by driving the config flow over REST.
   * Idempotent: an account that is already configured is success. */
  async connectAccount(): Promise<FlowResult> {
    const flow = await this.api<FlowResult>("POST", "/api/config/config_entries/flow", {
      handler: "aivi",
      show_advanced_options: false,
    });
    if (flow.type !== "form") throw new Error(`unexpected flow start: ${flow.type}`);
    return this.api("POST", `/api/config/config_entries/flow/${flow.flow_id}`, {
      token: "dev",
    });
  }

  /** The account's subscription repair issue, or undefined. */
  async subscriptionIssue(): Promise<RepairIssue | undefined> {
    const { issues } = await this.ws<{ issues: RepairIssue[] }>({
      type: "repairs/list_issues",
    });
    return issues.find(
      (issue) => issue.domain === "aivi" && issue.issue_id.startsWith("subscription_inactive_"),
    );
  }

  /** The account's Event stream connectivity sensor. */
  eventStream(): Promise<EntityState | undefined> {
    return this.findState(
      (s) =>
        s.entity_id.startsWith("binary_sensor.") &&
        s.attributes["device_class"] === "connectivity" &&
        String(s.attributes["friendly_name"] ?? "").endsWith("Event stream"),
    );
  }

  async setWasherProgress(value: number): Promise<void> {
    await this.callService("input_number", "set_value", {
      entity_id: "input_number.washer_progress",
      value,
    });
  }

  async setFrontDoor(on: boolean): Promise<void> {
    await this.callService("input_boolean", on ? "turn_on" : "turn_off", {
      entity_id: "input_boolean.front_door",
    });
  }
}
