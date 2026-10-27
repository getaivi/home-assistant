// The state an editor opens with. The remote widget or activity fixes the
// identity (slug, name, template); the binding, when there is one,
// carries what was saved.

import type { Account, BoundWidget, RemoteActivity, RemoteWidget } from "./types/accounts";
import type { ChatTurn, EditorKind, EditorState } from "./types/editor";

/** `chat` is the conversation kept for this widget; null when there is
 * neither a remote widget nor a binding to open. */
export function widgetEditorState(
  acc: Account,
  remote: RemoteWidget | null,
  bound: BoundWidget | null,
  chat: ChatTurn[],
): EditorState | null {
  const w = remote ?? bound;
  if (!w) return null;
  return {
    kind: "widget",
    entryId: acc.entry_id,
    subentryId: bound ? bound.subentry_id : null,
    slug: w.slug,
    name: w.name,
    template: w.template,
    active: null,
    staleAfter: bound?.stale_after ?? undefined,
    bindings: bound ? structuredClone(bound.bindings ?? {}) : {},
    preview: undefined, // undefined = loading, null = unresolvable
    saving: false,
    // A copy: turns of an editor that is then discarded must not land
    // in the kept conversation.
    chat: [...chat],
  };
}

/** Mirrors widgetEditorState, with the activity's lifecycle entity and
 * throttle in place of the widget's staleness. */
export function activityEditorState(
  acc: Account,
  remote: RemoteActivity | null,
  bound: BoundWidget | null,
  chat: ChatTurn[],
): EditorState | null {
  const a = remote ?? bound;
  if (!a) return null;
  return {
    kind: "activity",
    entryId: acc.entry_id,
    subentryId: bound ? bound.subentry_id : null,
    slug: a.slug,
    name: a.name,
    template: a.template,
    active: bound ? (bound.active ?? null) : null,
    throttle: bound?.throttle,
    bindings: bound ? structuredClone(bound.bindings ?? {}) : {},
    preview: undefined,
    saving: false,
    chat: [...chat],
  };
}

/** What a slug names in an account, for opening its editor by route. */
interface Found {
  acc: Account;
  remote: RemoteWidget | null;
  bound: BoundWidget | null;
}

/** The first account that can open an editor for `slug`: one that binds
 * it, or lists it as supported. Null when none does (vanished,
 * unreachable and unbound, or unsupported and unbound). */
export function findBySlug(
  kind: EditorKind,
  slug: string,
  accounts: Account[],
  listed: Record<string, RemoteWidget[] | null>,
): Found | null {
  for (const acc of accounts) {
    const bindings = kind === "widget" ? acc.widgets : (acc.activities ?? []);
    const bound = bindings.find((w) => w.slug === slug) ?? null;
    const remote = (listed[acc.entry_id] ?? []).find((w) => w.slug === slug) ?? null;
    if (bound || (remote && remote.supported !== false)) return { acc, remote, bound };
  }
  return null;
}
