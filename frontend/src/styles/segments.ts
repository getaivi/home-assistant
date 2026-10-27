// The progress bar's segments editor (aivi-segments-editor).

import { css } from "lit";

export const segmentsStyles = css`
  /* segments editor */
  .seged { display: flex; flex-direction: column; gap: var(--aivi-sp2); }
  .segrow { display: flex; gap: var(--aivi-sp2); align-items: center; }
  .segrow .pct, .seginline .pct { width: 72px; flex: none; text-align: right; }
  .segrow .rm, .ordrow .mv { flex: none; border: 1px solid var(--aivi-line);
    background: none; border-radius: var(--aivi-r-sm); padding: var(--aivi-sp1) 10px; cursor: pointer;
    color: var(--aivi-muted); font-size: var(--aivi-fs-md); }
  .ordrow .mv { display: inline-flex; align-items: center; justify-content: center; }
  .ordrow .mv .icon { width: 14px; height: 14px; }
  .seginline .segrow .rm { min-height: 32px; padding: var(--aivi-sp1) 14px; }
  .segrow .rm:hover, .ordrow .mv:hover:not(:disabled) { color: inherit;
    border-color: var(--aivi-muted); }
  /* A move that cannot happen (up, in first place) looks unavailable. */
  .ordrow .mv:disabled { opacity: .35; cursor: default; }
  /* Split on a phase too thin to halve: still focusable, and a press says
     why nothing happens. */
  .segrow .rm[aria-disabled="true"] { opacity: .5; cursor: default; }
  .segrow .rm[aria-disabled="true"]:hover { color: var(--aivi-muted); border-color: var(--aivi-line); }
  .segbar-note { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); line-height: 1.5; }

  /* the visual segments editor */
  .segbarrow { display: flex; align-items: center; gap: var(--aivi-sp2); margin: 6px 0 2px; }
  /* Capsule/fill styling comes inline from segments-bar.ts, shared with
     the preview. The column holds the bar plus its caption row
     (labelsRow), so labels align under the bar, not the add button. */
  .segcol { flex: 1; min-width: 0; }
  /* Fixed layer order: capsules under handles/ring under the one hit
     overlay. Only .seghit takes pointers; the rest is pointer-inert. */
  .segbar { position: relative; display: flex; min-width: 0; }
  .segcap { border: 0; padding: 0; margin: 0; min-width: 0;
    pointer-events: none;
    display: flex; align-items: center; justify-content: center; }
  .segcap.sel { box-shadow: 0 0 0 2px var(--aivi-card), 0 0 0 4px var(--aivi-accent); }
  .segcap:focus-visible { outline: 2px solid var(--aivi-accent); outline-offset: 3px; }
  .seghandle { position: absolute; top: -7px; bottom: -7px; width: 18px;
    transform: translateX(-50%); background: none; border: 0; padding: 0;
    pointer-events: none; z-index: 2; }
  .seghandle::before { content: ""; position: absolute; top: 0; bottom: 0;
    left: 50%; width: 4px; transform: translateX(-50%); border-radius: var(--aivi-r-pill);
    background: var(--aivi-muted); opacity: .7; }
  .seghandle.dragging::before, .seghandle:focus-visible::before {
    background: var(--aivi-accent); opacity: 1; }
  .seghandle:focus-visible { outline: 2px solid var(--aivi-accent);
    outline-offset: 2px; border-radius: var(--aivi-r-sm); }
  /* The hit layer spans the bar plus a vertical tolerance band; its
     cursor is set live from the seam math. */
  .seghit { position: absolute; left: 0; right: 0; top: -10px; bottom: -10px;
    z-index: 3; touch-action: none; cursor: pointer; }
  /* A sourced capsule carries a dashed inset ring (its share is live);
     a boundary adjacent to one is locked. */
  .segcap.src::after { content: ""; position: absolute; inset: 2px;
    border: 1.5px dashed rgba(255,255,255,.8); border-radius: inherit;
    pointer-events: none; }
  /* A hard template error tints the ring; the inline note carries the
     message. */
  .segcap.srcerr::after {
    border-color: color-mix(in srgb, var(--aivi-danger) 80%, #fff); }
  .seghandle.locked::before { width: 0; border-left: 3px dashed var(--aivi-muted);
    background: none; border-radius: 0; }
  .seghandle.locked:focus-visible::before { border-color: var(--aivi-accent);
    background: none; opacity: 1; }
  .segadd { flex: none; width: 28px; height: 28px; border: 1px dashed var(--aivi-line);
    background: none; border-radius: var(--aivi-r-md); cursor: pointer;
    color: var(--aivi-muted); font-size: var(--aivi-fs-lg); line-height: 1; }
  .segadd:hover { color: inherit; border-color: var(--aivi-muted); }
  /* The selected segment's inline editor is a .foldbody in markup. */
  .seginline { margin-top: var(--aivi-sp2); }
`;
