// How the template workspace lays out its three zones (the Insert rail,
// the editor and the output) for the width it has. The width is the
// workspace's own, so Home Assistant's sidebar, open or not, is already
// taken out of it; on a phone (the panel's narrow mode) it is the phone
// layout whatever the width.
//
//   docked   all three side by side; the rail, when open, takes its own
//            column and the editor gives it the room
//   overlay  the rail, when open, lies over the editor's leading edge, so
//            opening it does not reflow the code; the output is docked
//   strip    the output is a one-line strip under the header (the result,
//            or the error) that expands to show it all
//   phone    full screen: the strip, the editor, the key row; Insert is a
//            sheet over the lower half
//
// Whether the rail is open is the user's to say (the header's Insert
// and Mod+I), and it is remembered for the browser session.

export type WorkspaceLayout = "docked" | "overlay" | "strip" | "phone";

/** The rail's width. */
export const RAIL_WIDTH = 288;
/** The output column's width: room for the Medium widget. */
export const OUTPUT_WIDTH = 380;
/** The least the editor gets beside the others: about 70 characters of
 * code, line numbers aside. */
export const EDITOR_MIN = 580;

/** The layout for a workspace `width` px wide. */
export function workspaceLayout(width: number, narrow: boolean): WorkspaceLayout {
  if (narrow) return "phone";
  if (width >= RAIL_WIDTH + EDITOR_MIN + OUTPUT_WIDTH) return "docked";
  if (width >= EDITOR_MIN + OUTPUT_WIDTH) return "overlay";
  return "strip";
}

const RAIL_KEY = "aivi-insert-rail";

/** Whether the rail was left open in this browser session; open the
 * first time. */
export function railRemembered(): boolean {
  try {
    return sessionStorage.getItem(RAIL_KEY) !== "closed";
  } catch {
    return true;
  }
}

export function rememberRail(open: boolean): void {
  try {
    sessionStorage.setItem(RAIL_KEY, open ? "open" : "closed");
  } catch {
    // Storage blocked: the choice holds until the panel reloads.
  }
}
