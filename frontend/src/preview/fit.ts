// Text fitting for the preview. The app's one-line texts shrink to fit
// their width, down to a floor (SwiftUI's minimumScaleFactor), and only
// then truncate. A line whose width is known up front gets its size while
// the render is built (fittedSize); a line whose width comes from the
// layout around it is fitted once it is laid out (fitted, fitToBox).

import { h } from "../dom";

/** The canvas's text face (styles/preview.ts, `.pv-canvas`), restated for
 * the ruler, which measures outside the canvas. */
const FACE = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

/** What a fitted line keeps clear of its width, in px, so that a line
 * that fits to the pixel is not cut by rounding. */
const CLEAR = 0.5;

let ruler: HTMLElement | undefined;

/** The width of `text` on one line at `size` px and `weight`, as the
 * canvas sets it: its face, with tabular digits. Null where nothing lays
 * text out (outside a browser). A render is a tree that is not laid out
 * yet, so the text is measured on a hidden element in the document. */
export function textWidth(text: string, size: number, weight: number): number | null {
  ruler ??= h("span", {
    style:
      `position:absolute;visibility:hidden;white-space:pre;font-family:${FACE};` +
      "font-variant-numeric:tabular-nums;letter-spacing:normal",
  });
  ruler.style.fontSize = `${size}px`;
  ruler.style.fontWeight = String(weight);
  ruler.textContent = text;
  document.body.append(ruler);
  const width = ruler.getBoundingClientRect().width;
  ruler.remove();
  return width > 0 ? width : null;
}

/** The font size at which a line fits `avail` px: its own `size` where it
 * fits, else scaled down, to `floor` of it at most; past that the line
 * truncates. `width` is the line's width at a size (null where it cannot
 * be measured, which leaves the size as it is). The system face tracks
 * wider as it gets smaller, so a width does not scale with the size and
 * each candidate is measured again. */
export function fittedSize(
  width: (size: number) => number | null,
  size: number,
  avail: number,
  floor: number,
): number {
  const least = size * floor;
  let fitted = size;
  for (let pass = 0; pass < 4 && fitted > least; pass++) {
    const measured = width(fitted);
    if (measured === null || measured <= avail) break;
    fitted = Math.max(least, Math.floor(((fitted * (avail - CLEAR)) / measured) * 100) / 100);
  }
  return fitted;
}

/** The fitted size of a plain run of text (see fittedSize). */
export function fittedTextSize(
  text: string,
  size: number,
  weight: number,
  avail: number,
  floor: number,
): number {
  return fittedSize((px) => textWidth(text, px, weight), size, avail, floor);
}

/** The widths of a laid-out line's text and of its box. */
function widths(el: Element): { text: number; box: number } {
  const text = document.createRange();
  text.selectNodeContents(el);
  return { text: text.getBoundingClientRect().width, box: el.getBoundingClientRect().width };
}

/** Whether a line's text is wider than its box, to a fraction of a
 * point (a box's scroll width is rounded, and a hair too wide already
 * truncates). */
export function clipped(el: Element): boolean {
  const { text, box } = widths(el);
  return text > box + 0.01;
}

/** Shrink a laid-out line's type until its text fits its box, to `floor`
 * of its `size` at most; what still overflows there truncates. Nothing
 * to measure before layout. */
export function fitToBox(el: HTMLElement, size: number, floor: number): void {
  const least = size * floor;
  let px = size;
  el.style.fontSize = `${px}px`;
  const layoutWidth = el.clientWidth;
  if (!layoutWidth) return;
  for (let pass = 0; pass < 6 && px > least; pass++) {
    const { text, box } = widths(el);
    if (!(text > box + 0.01)) break;
    // The widths are the canvas's, scaled to the card: the clearance is
    // taken as a share of the box.
    const room = box * (1 - CLEAR / layoutWidth);
    px = Math.max(least, Math.floor(((px * room) / text) * 100) / 100);
    el.style.fontSize = `${px}px`;
  }
}

/** Keep a one-line region fitted to its box (see fitToBox): once it is
 * laid out, and again whenever its box changes. */
export function fitted(el: HTMLElement, size: number, floor: number): HTMLElement {
  new ResizeObserver(() => fitToBox(el, size, floor)).observe(el);
  return el;
}
