// A sourceable value: the mode switch and the fallback literal.

import { css } from "lit";

export const sourceStyles = css`
  /* The fixed control, or the source with the fixed value kept below as
     the fallback. Quiet: most values stay fixed. */
  .vsrc { display: flex; flex-direction: column; gap: var(--aivi-sp2); }
  /* The source menu: quiet while the value is fixed, outlined once it
     follows a source. Always at the trailing edge of its label line. */
  select.srcsel { width: auto; min-height: 28px; padding: 2px var(--aivi-sp6) 2px var(--aivi-sp2);
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); cursor: pointer;
    background-color: transparent; background-position: right 6px center; background-size: 14px;
    border-color: transparent; text-align: right; text-align-last: right; }
  select.srcsel:hover { border-color: var(--aivi-input-line); color: inherit; }
  select.srcsel.live { color: inherit;
    border-color: color-mix(in srgb, var(--aivi-accent) 60%, transparent); }
  @media (pointer: coarse) {
    select.srcsel { min-height: 44px; font-size: var(--aivi-fs-lg); }
  }
  .vsrc .fallback { border-left: 2px solid var(--aivi-line);
    padding-left: var(--aivi-sp3); }
`;
