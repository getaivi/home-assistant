// What every popup shares (popover.ts): telling a press outside from one
// inside when the panel is a shadow root, telling focus that left from
// focus that went nowhere, and staying inside the viewport.

import { afterEach, describe, expect, it, vi } from "vitest";
import { eventInside, focusLeft, placePopup, watchOutsidePress } from "../src/popover";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function press(el: Element): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
}

/** A field with a popup child inside a shadow root, and a sibling. */
function shadowed(): { field: HTMLElement; inner: HTMLElement; sibling: HTMLElement } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const field = document.createElement("div");
  const inner = document.createElement("button");
  const sibling = document.createElement("button");
  field.append(inner);
  root.append(field, sibling);
  return { field, inner, sibling };
}

describe("watchOutsidePress", () => {
  it("reads the composed path: the document's target is the shadow host", () => {
    // What `contains(event.target)` gets wrong: in a browser, the target
    // the document sees for every press in the panel is the panel. (This
    // DOM doesn't retarget, so the path is what is checked here.)
    const { field, inner, sibling } = shadowed();
    const outside = vi.fn();
    const stop = watchOutsidePress(field, outside);
    press(inner);
    expect(outside).not.toHaveBeenCalled();
    press(field);
    expect(outside).not.toHaveBeenCalled();
    press(sibling);
    expect(outside).toHaveBeenCalledTimes(1);
    press(document.body);
    expect(outside).toHaveBeenCalledTimes(2);
    stop();
    press(document.body);
    expect(outside).toHaveBeenCalledTimes(2);
  });

  it("sees a press even when something on the way stops it", () => {
    const { field, sibling } = shadowed();
    const outside = vi.fn();
    const stop = watchOutsidePress(field, outside);
    sibling.addEventListener("pointerdown", (e) => e.stopPropagation());
    press(sibling);
    expect(outside).toHaveBeenCalledTimes(1);
    stop();
  });

  it("eventInside answers for any event", () => {
    const { field, inner, sibling } = shadowed();
    const answers: boolean[] = [];
    document.addEventListener("pointerdown", (e) => answers.push(eventInside(e, field)));
    press(inner);
    press(sibling);
    expect(answers).toEqual([true, false]);
  });
});

describe("focusLeft", () => {
  const out = (to: EventTarget | null): FocusEvent =>
    new FocusEvent("focusout", { relatedTarget: to });

  it("is true only when focus went to something outside", () => {
    const { field, inner, sibling } = shadowed();
    expect(focusLeft(out(sibling), field)).toBe(true);
    expect(focusLeft(out(inner), field)).toBe(false);
    // Nowhere (the window lost focus, or a press on something that takes
    // none): not leaving; the outside-press watcher closes on a press outside.
    expect(focusLeft(out(null), field)).toBe(false);
  });
});

describe("placePopup", () => {
  const rect = (r: Partial<DOMRect>): DOMRect => ({ ...new DOMRect(), ...r }) as DOMRect;

  /** The classes and the shortened height a placement ends with. */
  function place(anchor: Partial<DOMRect>, popup: Partial<DOMRect>): string[] {
    const a = document.createElement("input");
    const p = document.createElement("div");
    p.className = "pop up end";
    p.style.maxHeight = "1px";
    a.getBoundingClientRect = () => rect(anchor);
    p.getBoundingClientRect = () => rect(popup);
    placePopup(p, a);
    return [
      ...[...p.classList].filter((c) => c !== "pop"),
      ...(p.style.maxHeight ? [p.style.maxHeight] : []),
    ];
  }

  it("opens downwards from the leading edge when it fits", () => {
    expect(
      place({ top: 100, bottom: 136, right: 400 }, { height: 240, width: 300, right: 400 }),
    ).toEqual([]);
  });

  it("opens upwards when it only fits above", () => {
    const bottom = window.innerHeight - 40;
    expect(
      place({ top: bottom - 36, bottom, right: 400 }, { height: 240, width: 300, right: 400 }),
    ).toEqual(["up"]);
  });

  it("takes the roomier side, shortened to it, when it fits neither", () => {
    // Flipped whole, a tall popup would leave the top of the viewport instead
    // of the bottom.
    const vh = window.innerHeight;
    const top = vh / 2 + 20;
    expect(
      place({ top, bottom: top + 36, right: 400 }, { height: vh, width: 300, right: 400 }),
    ).toEqual(["up", `${top - 64 - 8}px`]);
    // More room below: it stays there, as tall as the room.
    expect(
      place({ top: 100, bottom: 136, right: 400 }, { height: vh, width: 300, right: 400 }),
    ).toEqual([`${vh - 136 - 8}px`]);
    // Never shortened to a sliver.
    expect(
      place({ top: 70, bottom: vh - 40, right: 400 }, { height: 240, width: 300, right: 400 }),
    ).toEqual(["160px"]);
  });

  it("opens from the trailing edge when the leading one would overflow", () => {
    const right = window.innerWidth - 10;
    expect(
      place({ top: 100, bottom: 136, right }, { height: 100, width: 280, right: right + 135 }),
    ).toEqual(["end"]);
    // Wider than the space to the anchor's trailing edge: flipping would
    // push it off the other side.
    expect(
      place(
        { top: 100, bottom: 136, right: 150 },
        { height: 100, width: 280, right: window.innerWidth + 5 },
      ),
    ).toEqual([]);
  });
});
