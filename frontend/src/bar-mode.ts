// Mode-first progress bar configuration: Solid | Segmented | Layered. The
// mode is UI state, never wire data: stored configs map onto a mode here
// (no migration), and switching is non-destructive within the session:
// the inactive mode's bindings are pruned only when the preview or a save
// asks for the active mode's payload.
//
// When data carries both a fill color and segments, segments win,
// mirroring the backend (blocks.SegmentList resolves after bar_color and
// flips the style to "segmented"). The dormant bar_color survives the
// session as the remembered Solid color.

import { asSegments, asString, type Bindings } from "./types/bindings";
import type { BarMode, EditorKind } from "./types/editor";

/** The solid fill color field: every progress template names it
 * `bar_color` (path progress.color). */
export const BAR_COLOR_KEY = "bar_color";

/** Widgets always render split on-device, so Layered (the Live Activity's
 * continuous bar) is activity-only. */
export function barModes(kind: EditorKind): BarMode[] {
  return kind === "activity" ? ["solid", "segmented", "layered"] : ["solid", "segmented"];
}

/** The mode a stored shape maps onto (no migration: UI state):
 *
 * - no segments (with or without bar_color)          -> solid
 * - segments, no display marker / display "split"    -> segmented
 * - segments + display "layered", activity surface   -> layered
 * - segments + display "layered", widget surface     -> segmented
 *   (widgets always render split; the stray marker is dropped on the
 *   next save, since Layered is not in the widget mode set)
 * - bar_color alongside segments                     -> segmented/layered
 */
export function deriveBarMode(bindings: Bindings, key: string, kind: EditorKind): BarMode {
  if (!asSegments(bindings[key]).length) return "solid";
  const display = asString(bindings[`${key}__display`]);
  return kind === "activity" && display === "layered" ? "layered" : "segmented";
}

/** The bindings as the active mode would push and save them: the inactive
 * mode's keys dropped, the layered marker derived from the mode. Pure, so
 * in-session switching stays non-destructive. */
export function pruneForBarMode(bindings: Bindings, key: string, mode: BarMode): Bindings {
  const out = { ...bindings };
  if (mode === "solid") {
    delete out[key];
    delete out[`${key}__display`];
    return out;
  }
  delete out[BAR_COLOR_KEY];
  // The marker only ever rides along with actual segments.
  if (mode === "layered" && asSegments(out[key]).length) out[`${key}__display`] = "layered";
  else delete out[`${key}__display`];
  return out;
}
