// The hub's search field and status chips (hub-filter.ts): view-local
// state, the route stays /aivi.

import { css } from "lit";

export const hubFilterStyles = css`
  .hubbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 2px 0 var(--aivi-sp1); }
  .hubbar input[type=search] { width: auto; flex: 1 1 220px; max-width: 340px; min-width: 160px; }
  .fchips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
  /* Filter chips: outlined, the active one filled like a secondary
     button; the count is a small badge inside. They share the search
     field's row, so they share its box: one control height, one radius. */
  .fchip { display: inline-flex; align-items: center; gap: 7px; font-size: var(--aivi-fs-sm);
    font-weight: 500; color: var(--aivi-muted); background: none; border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-md); padding: 0 var(--aivi-sp2) 0 var(--aivi-sp3); min-height: var(--aivi-ctl-h);
    cursor: pointer; transition: background-color .12s, color .12s; }
  .fchip:hover { color: inherit; background: var(--aivi-surface-2); }
  .fchip.on { color: inherit; border-color: transparent; background: var(--aivi-surface-3); }
  .fchip .n { font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); background: var(--aivi-surface-2); border-radius: var(--aivi-r-pill);
    padding: 1.5px 6px; }
  .fchip.on .n { color: inherit; background: var(--aivi-card); }
`;
