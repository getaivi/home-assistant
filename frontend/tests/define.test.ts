// `define` registers a custom element once and lets a second import of the
// bundle (Home Assistant re-registering the panel under a new URL while the
// tab stays open) pass over names already taken instead of throwing.

import { describe, expect, it } from "vitest";
import { define } from "../src/define";

describe("define", () => {
  it("registers a new name and keeps the first definition on a repeat", () => {
    class First extends HTMLElement {}
    class Second extends HTMLElement {}

    define("aivi-define-test", First);
    expect(customElements.get("aivi-define-test")).toBe(First);

    expect(() => define("aivi-define-test", Second)).not.toThrow();
    expect(customElements.get("aivi-define-test")).toBe(First);
  });
});
