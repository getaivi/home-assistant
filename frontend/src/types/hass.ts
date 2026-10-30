// The subset of Home Assistant's `hass` object the panel touches, and an
// entity as the panel's pickers list it.

interface EntityAttributes {
  friendly_name?: string;
  device_class?: string;
  [key: string]: unknown;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: EntityAttributes;
  /** When the state last changed (ISO 8601); absent in bare harnesses. */
  last_changed?: string;
}

export interface RegistryEntry {
  device_id?: string;
  /** The entity's own name: the user's rename, else the integration's
   * (translated) name; absent for a device's main entity. */
  name?: string | null;
  /** Home Assistant builds the friendly name as the device's name, then
   * this entity's. */
  has_entity_name?: boolean;
}

export interface DeviceEntry {
  name?: string;
  name_by_user?: string;
}

interface HassLocale {
  language?: string;
}

/** The subset of Home Assistant's `hass` object the panel touches. */
export interface HassLike {
  states: Record<string, HassEntity>;
  entities?: Record<string, RegistryEntry>;
  devices?: Record<string, DeviceEntry>;
  /** The user's UI language (e.g. "sv"); absent in bare harnesses. */
  language?: string;
  /** Frontend locale settings; its language wins for formatting. */
  locale?: HassLocale;
  callWS(msg: object): Promise<unknown>;
  /** The WebSocket connection, for subscriptions; absent in bare
   * harnesses (the panel then reads a snapshot through callWS). */
  connection?: HassConnection;
}

interface HassConnection {
  subscribeMessage<T>(callback: (message: T) => void, msg: object): Promise<() => Promise<void>>;
}

export interface EntityOption {
  id: string;
  name: string;
}
