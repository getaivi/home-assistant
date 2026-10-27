// The two notice shapes: a note under what it is about, a banner for a
// page or section; severity picks the mark and the class, never a color.

import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import { banner, note } from "../src/notice";
import { $, text } from "./harness";

function shown(view: unknown): HTMLElement {
  const host = document.createElement("div");
  render(view, host);
  return host;
}

describe("notices", () => {
  it("draws a note as its mark, then its words, tied to its control", () => {
    const host = shown(
      note("warn", "Nothing to read right now.", { id: "x-tnote", role: "status" }),
    );
    const el = $(host, ".tnote.warn");
    expect(el.id).toBe("x-tnote");
    expect(el.getAttribute("role")).toBe("status");
    expect($(el, ":scope > svg.icon").getAttribute("aria-hidden")).toBe("true");
    expect(text($(el, ":scope > .tnbody"))).toBe("Nothing to read right now.");
  });

  it("leaves out what it is not given", () => {
    const el = $(shown(note("error", "Bad.")), ".tnote.error");
    expect(el.hasAttribute("id")).toBe(false);
    expect(el.hasAttribute("role")).toBe(false);
  });

  it("marks each severity differently", () => {
    const paths = (["ok", "warn", "error"] as const).map((s) =>
      $(shown(note(s, "x")), "path").getAttribute("d"),
    );
    expect(new Set(paths).size).toBe(3);
  });

  it("boxes a banner with its action at the trailing edge", () => {
    const host = shown(
      banner("error", "Fix the fields.", {
        role: "status",
        cls: "rowfix",
        action: html`<button class="btn">Retry</button>`,
      }),
    );
    const el = $(host, ".banner.error.rowfix");
    expect(el.getAttribute("role")).toBe("status");
    expect([...el.children].map((c) => c.tagName.toLowerCase())).toEqual(["svg", "div", "button"]);
    expect(text($(el, ".grow"))).toBe("Fix the fields.");
  });
});
