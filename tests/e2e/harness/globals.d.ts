// What the harness pages put on `window` (frontend/harness/index.html,
// ha-icon.js), plus the motion-freeze bookkeeping of fixtures.ts.
interface Window {
  __panel: HTMLElement & {
    editorState?: { bindings?: Record<string, unknown> };
  };
  __iconsLoading?: number;
  __motionFrozen?: WeakSet<Document | ShadowRoot>;
}
