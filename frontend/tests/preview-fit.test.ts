// The preview's text fitting (preview/fit.ts): the ruler, the size a line
// of known width takes, and the fit of a line to the box it is laid out
// in. happy-dom lays nothing out, so the widths are given here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "../src/dom";
import {
  clipped,
  fitToBox,
  fitted,
  fittedSize,
  fittedTextSize,
  textWidth,
} from "../src/preview/fit";

const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (rangeRect) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeRect);
  document.body.innerHTML = "";
});

/** Lay the ruler's text out at `per` of its font size per character. */
function layOut(per: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = (this.textContent ?? "").length * per * (parseFloat(this.style.fontSize) || 0);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  });
}

/** A line in a box `box` wide whose text is `per` wide per px of type. */
function line(box: number, per: number): HTMLElement {
  const el = h("div", {}, "A line");
  Object.defineProperty(el, "clientWidth", { get: () => box });
  el.getBoundingClientRect = () => ({ width: box }) as DOMRect;
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Range) {
      const of = this.startContainer as HTMLElement;
      return { width: parseFloat(of.style.fontSize) * per };
    },
  });
  return el;
}

describe("fit: the ruler", () => {
  it("has no width where nothing lays text out", () => {
    expect(textWidth("Living room", 15, 500)).toBeNull();
    expect(fittedTextSize("A name far too long to fit anywhere", 15, 500, 10, 0.8)).toBe(15);
  });

  it("measures in the canvas's face with tabular digits, and leaves the document as it was", () => {
    let style = "";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      style = this.style.cssText;
      expect(this.isConnected).toBe(true);
      return { width: 42 } as DOMRect;
    });
    expect(textWidth("21.5", 32, 300)).toBe(42);
    expect(style).toContain("font-size: 32px");
    expect(style).toContain("font-weight: 300");
    expect(style).toContain("font-variant-numeric: tabular-nums");
    expect(style).toContain("system-ui");
    expect(document.body.children).toHaveLength(0);
  });
});

describe("fit: a line of known width", () => {
  it("leaves a line that fits alone", () => {
    expect(fittedSize(() => 100, 40, 126, 0.6)).toBe(40);
    expect(fittedSize(() => 126, 40, 126, 0.6)).toBe(40);
    expect(fittedSize(() => null, 40, 126, 0.6)).toBe(40);
  });

  it("scales a line that does not, half a pixel clear of its width", () => {
    // 4.2 px wide per px of type: 168 at 40, 125.5 at 29.88.
    expect(fittedSize((px) => px * 4.2, 40, 126, 0.6)).toBe(29.88);
    layOut(0.7);
    // Six characters: 168 px wide at 40.
    expect(fittedTextSize("Living", 40, 300, 126, 0.6)).toBe(29.88);
  });

  it("measures each candidate again", () => {
    const seen: number[] = [];
    // A face that tracks wider as it gets smaller.
    const size = fittedSize(
      (px) => {
        seen.push(px);
        return px * 4.2 + (40 - px);
      },
      40,
      126,
      0.6,
    );
    expect(seen.length).toBeGreaterThan(2);
    expect(size).toBeLessThan(29.88);
    expect(size * 4.2 + (40 - size)).toBeLessThanOrEqual(126);
  });

  it("stops at the floor and leaves the rest to the ellipsis", () => {
    expect(fittedSize((px) => px * 25, 40, 126, 0.6)).toBe(24);
    expect(fittedSize((px) => px * 25, 15, 126, 0.8)).toBe(12);
  });
});

describe("fit: a line in its box", () => {
  it("knows a clipped line to a fraction of a point", () => {
    const el = line(126, 4);
    el.style.fontSize = "31.5px";
    expect(clipped(el)).toBe(false);
    el.style.fontSize = "31.6px";
    expect(clipped(el)).toBe(true);
  });

  it("leaves a line that fits, and one that is not laid out, at its size", () => {
    const fits = line(126, 3);
    fitToBox(fits, 40, 0.6);
    expect(fits.style.fontSize).toBe("40px");
    const bare = h("div", {}, "Not laid out");
    fitToBox(bare, 40, 0.6);
    expect(bare.style.fontSize).toBe("40px");
  });

  it("scales a line down to its box, to the floor at most, from the full size each time", () => {
    // 160 wide at 40: 125.5 at 31.37.
    const el = line(126, 4);
    fitToBox(el, 40, 0.6);
    expect(el.style.fontSize).toBe("31.37px");
    fitToBox(el, 40, 0.6);
    expect(el.style.fontSize).toBe("31.37px");
    const wide = line(126, 20);
    fitToBox(wide, 40, 0.6);
    expect(wide.style.fontSize).toBe("24px");
  });

  it("fits again whenever the box changes", () => {
    const observed: [Element, () => void][] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly cb: () => void) {}
        observe(el: Element): void {
          observed.push([el, this.cb]);
        }
      },
    );
    const el = line(126, 4);
    expect(fitted(el, 40, 0.6)).toBe(el);
    expect(el.style.fontSize).toBe("");
    expect(observed.map(([of]) => of)).toEqual([el]);
    observed[0]![1]();
    expect(el.style.fontSize).toBe("31.37px");
  });
});
