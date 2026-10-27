// The top app bar and its icon buttons, shared by the hub and the
// editor.

import { css } from "lit";

export const topbarStyles = css`
  /* HA toolbar anatomy: 56px bar, leading icon buttons, 20px title,
     trailing actions. The first icon button's negative margin aligns its
     glyph (not its hit circle) with the content edge, as HA's bars do. */
  .topbar { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 0 0 var(--aivi-sp2); }
  .topbar > .iconbtn:first-child { margin-left: -10px; }
  /* The brand mark already carries its own rounded square, so no radius
     or background here. */
  .logo { width: 26px; height: 26px; flex: none; display: block; }
  .title { font-size: var(--aivi-fs-title); font-weight: 500; letter-spacing: -.01em; }
  .subtitle { font-size: var(--aivi-fs-md); color: var(--aivi-muted); margin-top: 1px; }
  .topbar .grow { flex: 1; }

  /* Icon buttons, HA-style: a 44px round hit target around a 24px glyph. */
  .icon { display: block; fill: currentColor; width: 24px; height: 24px; }
  .iconbtn { display: inline-grid; place-items: center; width: 44px; height: 44px;
    flex: none; background: none; border: 0; border-radius: 50%; padding: 0;
    cursor: pointer; color: inherit; }
  .iconbtn:hover { background: var(--aivi-surface-2); }
  /* The hub's four trailing buttons (Log, Events, Refresh, the gear) on
     the narrowest phones: their hit circles touch, as HA's bars do, so
     the bar still fits. */
  @media (max-width: 359px) {
    .topbar > .grow ~ :is(.iconbtn, aivi-events, .acctwrap) { margin-left: -10px; }
  }
`;
