// Types for the harness modules, so the vitest suite can import
// them as its single source of fixture data under strict TypeScript.
import type { DeviceEntry, HassEntity, HassLike, RegistryEntry } from "../src/types/hass";
import type { Meta } from "../src/types/meta";

export declare const META: Meta;
export declare const STATES: Record<string, HassEntity>;
export declare const ENTITIES: Record<string, RegistryEntry>;
export declare const DEVICES: Record<string, DeviceEntry>;
/** A request to the integration -> `{result}` or `{error: {code, message}}`. */
export type Engine = (msg: object) => Promise<object>;
export declare function makeHass(engine?: Engine): HassLike;
export declare function mountPanelHost(el: HTMLElement): void;
export declare const TEMPLATED: Record<string, string | string[]>;
