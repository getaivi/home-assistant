// URL routing for the panel. Home Assistant's <ha-panel-custom> host
// assigns a `route` property ({ prefix: "/aivi", path: "/widget/x" }) onto
// the panel element and re-assigns it on every navigation (back/forward
// included); the panel pushes its own navigations with history.pushState
// plus a `location-changed` event on window, the contract of HA's
// navigate() helper. The stateful half lives in aivi-panel.ts.
//
// The scheme:
//   ""                the hub (i.e. /aivi)
//   /log              the activity log: what went to Aivi and what the
//                     devices sent back, across the accounts.
//   /widget/<slug>    the widget editor. Keyed by Aivi slug, not subentry
//                     id: the slug exists before a binding does (a subentry
//                     id is only minted on first save, so a bind-flow deep
//                     link needs it), and it survives reloads.
//   /activity/<slug>  the Live Activity editor, keyed by remote slug.
//   /widget/<slug>/<address>/template
//   /activity/<slug>/<address>/template
//                     the template workspace of one template box in that
//                     editor. The address is the box's key in the
//                     preview's feedback, which names every template box
//                     there is: a field (`state`), a field's color
//                     (`value__color`), a trend's points (`points`) and a
//                     phase's size in a bar (`segments.1.source`).

export interface HostRoute {
  prefix: string;
  path: string;
}

export type PanelRoute =
  | { view: "hub" }
  | { view: "log" }
  | { view: "widget" | "activity"; slug: string; template?: string | undefined };

/** Decodes a path segment; null for one that is not valid
 * percent-encoding. */
function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The panel view a route path addresses; null when unrecognized. A
 * segment that is not valid percent-encoding (`/widget/%E0%A4%A`) is
 * unrecognized like any other typo, never an exception. */
export function parseRoute(path: string): PanelRoute | null {
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return { view: "hub" };
  if (parts.length === 1 && parts[0] === "log") return { view: "log" };
  const [kind, id, address, page] = parts;
  if (kind !== "widget" && kind !== "activity") return null;
  if (!id || (parts.length !== 2 && (parts.length !== 4 || page !== "template"))) return null;
  const slug = decode(id);
  if (slug === null) return null;
  if (address === undefined) return { view: kind, slug };
  const template = decode(address);
  return template ? { view: kind, slug, template } : null;
}

/** The canonical route path for a panel view (hub is the bare prefix). */
export function formatRoute(route: PanelRoute): string {
  if (route.view === "hub") return "";
  if (route.view === "log") return "/log";
  const editor = `/${route.view}/${encodeURIComponent(route.slug)}`;
  return route.template ? `${editor}/${encodeURIComponent(route.template)}/template` : editor;
}
