// The stateful half of routing (router.ts has the scheme): keeping the
// panel's view and the URL in step.
//
// `open` and `close` are what the UI calls: they change the view and move
// the URL. `apply` is what a host `route` assignment drives: it changes
// only the view, so back/forward and deep links never push history
// entries of their own. Opening pushes an entry; closing returns to the
// hub entry the editor was opened from when there is one, so browser Back
// from the hub does not reopen the editor just left.
//
// A template workspace (`openTemplate`) is a page of its editor: it
// pushes an entry over the form's, and leaving it returns to that entry
// the same way. Moving between the form and its workspace never asks
// about unsaved changes: both edit the same draft.
//
// The activity log (`openLog`) is a page beside the hub: opened from the
// hub it goes back to the hub's entry, and an editor opened from a row
// of it comes back to it the same way.

import type { AiviEditor } from "./aivi-editor";
import { t } from "./i18n";
import { formatRoute, type HostRoute, type PanelRoute, parseRoute } from "./router";
import type { EditorKind, EditorState } from "./types/editor";

/** What the router needs from the panel it steers. */
interface RouterHost {
  view(): "home" | "editor" | "log";
  editorState(): EditorState | null;
  /** Show the editor for `state` (its form), the activity log, or the
   * hub for null. */
  show(target: EditorState | "log" | null): void;
  /** The address of the template workspace in view, or null for the
   * form (or the hub). */
  workspace(): string | null;
  /** Show the open editor's template workspace for `address`, or its
   * form for null. */
  showWorkspace(address: string | null): void;
  /** Whether `state`'s editor has a template box at `address`. */
  templateAt(state: EditorState, address: string): boolean;
  /** The state a slug's editor opens with; null when no account has it. */
  stateFor(kind: EditorKind, slug: string): EditorState | null;
  /** Whether every account's list of `kind` was read. */
  listsRead(kind: EditorKind): boolean;
  /** The mounted editor element, if any. */
  editor(): AiviEditor | null;
  toast(text: string): void;
}

export class PanelRouter {
  private readonly _host: RouterHost;
  /** The route the host last assigned, or the one last pushed here. */
  route: HostRoute | null = null;
  /** Whether the history entry under the open editor's is the hub's, put
   * there in this session (the editor was opened from the hub): closing
   * the editor then goes back to it instead of adding another. */
  private _hubBelow = false;
  /** Whether the history entry under the open workspace's is its
   * editor's form, put there in this session. */
  private _formBelow = false;
  /** Whether the history entry under the open editor's is the activity
   * log's (the editor was opened from one of its rows). */
  private _logBelow = false;
  /** Whether the hub's entry is under the log's, for when the log comes
   * back into view from an editor opened from it. */
  private _hubBelowLog = false;

  constructor(host: RouterHost) {
    this._host = host;
  }

  /** Open an editor from the UI; nothing happens without a state. */
  open(state: EditorState | null): void {
    if (!state) return;
    const from = this._host.view();
    this._host.show(state);
    this._hubBelow = from === "home";
    this._logBelow = from === "log";
    this._navigate();
  }

  /** Open the activity log (from the hub bar's Log button, or a link). */
  openLog(): void {
    const host = this._host;
    if (host.view() === "log") return;
    const fromHub = host.view() === "home";
    host.show("log");
    this._hubBelow = this._hubBelowLog = fromHub;
    this._logBelow = false;
    this._formBelow = false;
    this._navigate();
  }

  /** Back from the activity log to the hub. */
  closeLog(): void {
    const host = this._host;
    if (host.view() !== "log") return;
    host.show(null);
    this._hubBelowLog = false;
    if (this._hubBelow) {
      this._hubBelow = false;
      this.route = { prefix: this.route?.prefix ?? "/aivi", path: "" };
      history.back();
    } else this._navigate(true);
  }

  /** Open the editor's template workspace for `address` (Expand). */
  openTemplate(address: string): void {
    const host = this._host;
    const state = host.editorState();
    if (host.view() !== "editor" || !state || !host.templateAt(state, address)) return;
    if (host.workspace() === address) return;
    this._formBelow = host.workspace() === null;
    host.showWorkspace(address);
    this._navigate(!this._formBelow);
  }

  /** Back from the template workspace to its editor's form. */
  closeTemplate(): void {
    const host = this._host;
    if (host.workspace() === null) return;
    host.showWorkspace(null);
    if (this._formBelow) {
      // The form's own entry is right below: go back to it.
      this._formBelow = false;
      this.route = { prefix: this.route?.prefix ?? "/aivi", path: formatRoute(this._current()) };
      history.back();
    } else this._navigate(true);
  }

  /** Leave the editor (Back, Save, Discard). `to` is the route path a
   * held-back navigation asked for (a dirty editor's Discard, see
   * `apply`): the panel then continues there instead of the hub. */
  close(to: string | null): void {
    const host = this._host;
    // From a workspace over its form, the form's entry goes too.
    const steps = host.workspace() !== null && this._formBelow ? 2 : 1;
    this._formBelow = false;
    const asked = to === null ? null : parseRoute(to);
    // To the log the editor was opened from: back to its entry, below.
    if (to !== null && asked?.view !== "hub" && !(asked?.view === "log" && this._logBelow)) {
      // The editor's URL was put back on top of the asked one (or the
      // editor links on, as its Log card does); take its place rather
      // than stack another entry. What was below the editor's entry is
      // below the new one.
      const hubBelow = this._hubBelow && steps === 1;
      host.show(null);
      this._hubBelow = this._logBelow = false;
      this.apply(to); // opens it, or lands on the hub and says why
      if (host.view() === "log") this._hubBelow = this._hubBelowLog = hubBelow;
      if (host.view() !== "home") this._navigate(true);
      return;
    }
    const below = this._hubBelow ? "" : this._logBelow ? "/log" : null;
    // Back on the log, the hub is under it again if it was before.
    this._hubBelow = below === "/log" && this._hubBelowLog;
    this._logBelow = false;
    host.show(below === "/log" ? "log" : null);
    if (below !== null) {
      // The entry the editor was opened from (the hub's, the log's) is
      // right below: go back to it. The host echoes the route once the
      // browser has moved.
      this.route = { prefix: this.route?.prefix ?? "/aivi", path: below };
      if (steps === 1) history.back();
      else history.go(-steps);
    } else this._navigate(true);
  }

  /** React to a host route assignment (boot restore, back/forward, a deep
   * link, or the echo of our own push). Unknown or vanished targets land
   * on the hub (with a toast when an id has gone away), and the URL is
   * normalized with replaceState to match the view. Never a blank screen. */
  apply(path: string, boot = false): void {
    const host = this._host;
    const target = parseRoute(path);
    if (target && formatRoute(target) === formatRoute(this._current())) return; // already showing it (e.g. the echo of our own push)
    const open = host.editorState();
    if (
      target &&
      target.view !== "hub" &&
      host.view() === "editor" &&
      open &&
      open.kind === target.view &&
      open.slug === target.slug
    ) {
      // The same editor: its form and its workspace (Back, forward, a
      // link). The draft is the same either way, so nothing is asked.
      this._showTemplate(open, target.template ?? null, !boot);
      return;
    }
    // Leaving an editor with unsaved changes (browser back, a deep link),
    // or one in the middle of a save: stay, put its URL back, and let its
    // leave dialog ask. It remembers where the user was going, for Discard.
    const editor = host.editor();
    if (host.view() === "editor" && editor && (editor.isDirty() || host.editorState()?.saving)) {
      // Put back on top of the hub's entry (browser back), the hub is
      // below again; on top of anything else, it is not.
      this._hubBelow = target?.view === "hub";
      this._logBelow = target?.view === "log";
      this._formBelow = false;
      this._navigate();
      editor.requestLeave(path);
      return;
    }
    // An editor the host opens over the mounted hub (a link, forward) has
    // the hub's entry below it; one restored at boot or reached from
    // another editor has not.
    const overHub = !boot && host.view() === "home";
    const overLog = !boot && host.view() === "log";
    if (target?.view === "log") {
      // Browser back from an editor opened from the log lands on the
      // log's own entry, with whatever was under it still there.
      const back = host.view() === "editor" && this._logBelow;
      host.show("log");
      this._hubBelowLog = overHub || (back && this._hubBelowLog);
      this._hubBelow = this._hubBelowLog;
      this._logBelow = false;
      this._formBelow = false;
      return;
    }
    const state =
      target?.view === "widget" || target?.view === "activity"
        ? host.stateFor(target.view, target.slug)
        : null;
    if (state) {
      host.show(state);
      this._hubBelow = overHub;
      this._logBelow = overLog;
      this._formBelow = false;
      if (target?.view !== "hub" && target?.template)
        this._showTemplate(state, target.template, false);
      return;
    }
    // "Isn't available anymore" is a claim about the account's list: only
    // made when every list was read. An unreachable or paused account's
    // banner on the hub already says why nothing opens.
    const known = host.listsRead(target?.view === "activity" ? "activity" : "widget");
    const toastKey = !known
      ? null
      : target?.view === "widget"
        ? ("route.widget-missing" as const)
        : target?.view === "activity"
          ? ("route.activity-missing" as const)
          : null;
    host.show(null);
    this._hubBelow = this._logBelow = false;
    if (target?.view === "hub") return; // canonical hub path; nothing to fix
    this._navigate(true);
    if (toastKey) host.toast(t(toastKey));
  }

  /** Show the open editor's workspace for `address` (its form for
   * null). An address the editor has no template box at shows the form,
   * and the URL says so. `fromForm`: the form's entry is the one below. */
  private _showTemplate(state: EditorState, address: string | null, fromForm: boolean): void {
    const host = this._host;
    const shown = address !== null && host.templateAt(state, address) ? address : null;
    const before = host.workspace();
    host.showWorkspace(shown);
    if (shown !== null) this._formBelow = before === null && fromForm;
    else this._formBelow = false;
    if (shown !== address) this._navigate(true);
  }

  /** The route the current view state canonically lives at. */
  private _current(): PanelRoute {
    const editorState = this._host.editorState();
    if (this._host.view() === "log") return { view: "log" };
    if (this._host.view() === "editor" && editorState) {
      const template = this._host.workspace();
      return template === null
        ? { view: editorState.kind, slug: editorState.slug }
        : { view: editorState.kind, slug: editorState.slug, template };
    }
    return { view: "hub" };
  }

  /** Push (or replace) the URL for the current view and notify HA's
   * router the way its own navigate() helper does: history.pushState plus
   * a `location-changed` event on window with `{replace}` in the detail. */
  private _navigate(replace = false): void {
    const prefix = this.route?.prefix ?? "/aivi";
    const path = formatRoute(this._current());
    if (this.route?.path === path && !replace) return; // already there
    this.route = { prefix, path };
    if (replace) history.replaceState(null, "", `${prefix}${path}`);
    else history.pushState(null, "", `${prefix}${path}`);
    window.dispatchEvent(
      new CustomEvent("location-changed", {
        bubbles: true,
        composed: true,
        detail: { replace },
      }),
    );
  }
}
