// What every popup under a control shares (the entity picker's list, the
// icon picker, the color popover): closing on a press outside, closing
// when focus leaves, and staying inside the viewport.
//
// A popover takes focus when it opens and
// hands it back to its trigger on a pick or Escape; a press outside or
// focus moving elsewhere closes it, so only one is ever open.

/** Whether the event happened inside `host`. The panel renders in a shadow
 * root, so a document-level listener sees `event.target` retargeted to the
 * panel itself, for a press inside the popup as much as for one outside;
 * the composed path still holds the real elements. */
export function eventInside(e: Event, host: Element): boolean {
  return e.composedPath().includes(host);
}

/**
 * Call `onOutside` for every press that lands outside `host`, until the
 * returned function is called. Mouse, touch and pen all arrive as
 * `pointerdown`; the capture phase sees it even when something on the way
 * stops it.
 */
export function watchOutsidePress(host: Element, onOutside: () => void): () => void {
  const listener = (e: Event): void => {
    if (!eventInside(e, host)) onOutside();
  };
  document.addEventListener("pointerdown", listener, true);
  return () => document.removeEventListener("pointerdown", listener, true);
}

/** Whether a `focusout` moved focus to somewhere outside `host`. Focus
 * going nowhere (the window lost it, or a press on something that takes
 * no focus) is not leaving: watchOutsidePress handles a press outside. */
export function focusLeft(e: FocusEvent, host: Element): boolean {
  const to = e.relatedTarget;
  return to instanceof Node && !host.contains(to);
}

/** Room kept between a popup and the viewport's edge. */
const EDGE = 8;
/** The sticky top bar a popup opening upwards must stay under. */
const HEAD = 64;
/** The least height a popup is shortened to. */
const LEAST = 160;

/**
 * Keep an open popup in view. Under its anchor when it fits there; `up`
 * when it only fits above; where it fits neither, on the roomier side
 * and shortened to it (its list scrolls). `end` when its trailing edge
 * would leave the viewport (a popup wider than a short input). The
 * classes are the stylesheet's; only the shortened height is set here.
 */
export function placePopup(pop: HTMLElement, anchor: Element): void {
  pop.classList.remove("up", "end");
  pop.style.maxHeight = "";
  const a = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const below = window.innerHeight - a.bottom - EDGE;
  const above = a.top - HEAD - EDGE;
  if (p.height > below) {
    const up = above > below;
    if (up) pop.classList.add("up");
    const room = up ? above : below;
    if (p.height > room) pop.style.maxHeight = `${Math.max(LEAST, room)}px`;
  }
  if (p.right > window.innerWidth - EDGE && p.width <= a.right - EDGE) pop.classList.add("end");
}
