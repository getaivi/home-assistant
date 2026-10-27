// What the editor remembers but never stores: the content of the sources
// a value is not using right now (the template typed before the switch to
// Entity), so a detour through the source menu loses nothing. It hangs
// off the bindings object itself, in a WeakMap, so it lives exactly as
// long as the editor's working copy and is in nothing a save, a preview
// or the unsaved-changes check reads.

const SESSION = new WeakMap<object, Map<string, unknown>>();

/** What was remembered for `scope` under `key` in this editor session. */
export function recall(scope: object, key: string): unknown {
  return SESSION.get(scope)?.get(key);
}

/** Remember `value` for `scope` under `key` until the scope is gone. */
export function remember(scope: object, key: string, value: unknown): void {
  let notes = SESSION.get(scope);
  if (!notes) {
    notes = new Map();
    SESSION.set(scope, notes);
  }
  notes.set(key, value);
}
