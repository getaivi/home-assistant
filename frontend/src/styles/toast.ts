// Toasts.

import { css } from "lit";

export const toastStyles = css`
  /* toast: bottom-left, where HA's own toasts live. A long one wraps
     inside the viewport, keeping the same gap on the right. */
  .toast { position: fixed; bottom: 16px; left: 16px; max-width: calc(100vw - 32px);
    background: var(--aivi-card); border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-lg);
    padding: 9px 18px; font-size: var(--aivi-fs-md); box-shadow: var(--aivi-shadow-pop);
    overflow-wrap: anywhere; animation: toastin .2s ease; z-index: 50; }
  /* On a phone the editor's preview bar occupies the bottom edge: the toast
     sits above it instead of over its toggle. */
  :host([narrow]) .wrap:has(aivi-editor) ~ .toasts .toast {
    bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }
  @keyframes toastin { from { opacity: 0; transform: translateY(8px); } }
`;
