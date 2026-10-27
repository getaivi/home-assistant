// Pure list-reordering helpers for the rows checklist, DOM-free so they
// are unit-testable.

/** The list with the item at `from` moved to `to`; out-of-range indices
 * (or a no-op move) return an unchanged copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** Pointer travel (px, either way) before a press on the grip becomes a
 * drag: a tap that wobbles, or a touch that slips, is not a reorder. */
export const DRAG_THRESHOLD = 5;

/** Whether a press that has traveled `dy` has become a drag. */
export function isDrag(dy: number): boolean {
  return Math.abs(dy) >= DRAG_THRESHOLD;
}

/** The index (in `moveItem` terms) the row dragged from `from` lands on
 * with the pointer at `y`, given the rows' vertical midpoints in document
 * order: one position per neighbor whose middle the pointer has crossed.
 * The dragged row's own middle never counts, so nothing moves until the
 * pointer is past a neighbor's. An out-of-range `from` yields 0. */
export function dropIndex(midpoints: readonly number[], from: number, y: number): number {
  if (from < 0 || from >= midpoints.length) return 0;
  let to = from;
  midpoints.forEach((mid, i) => {
    if (i > from && y > mid) to += 1;
    else if (i < from && y < mid) to -= 1;
  });
  return to;
}

/** The gap (0..length, counting from above the first row) where the
 * insertion line renders while a drag from `from` targets `to` (in
 * `moveItem` terms): above the target row when moving up, below it when
 * moving down. `from === to` maps to the origin gap, a no-op drop the
 * caller may prefer not to draw at all. */
export function indicatorSlot(from: number, to: number): number {
  return to <= from ? to : to + 1;
}

/** The y offset (in the rows' own coordinate space) where the line for
 * gap `slot` sits, given each row's top/bottom edge in document order:
 * centered between the neighboring rows, flush with the outer edge at the
 * first and last gaps. An empty list yields 0. */
export function indicatorOffset(
  rows: readonly { top: number; bottom: number }[],
  slot: number,
): number {
  const above = rows[slot - 1];
  const below = rows[slot];
  if (above && below) return (above.bottom + below.top) / 2;
  if (below) return below.top; // slot 0: above the first row
  if (above) return above.bottom; // slot length: below the last row
  return 0;
}
