// The rows field (aivi-rows-checklist): the list's frame, and the picker
// that adds to it.

import { css } from "lit";

export const checklistStyles = css`
  /* Not clipped: a row option's popover (the color field, an entity
     picker) may reach past the frame. */
  .checks .ordlist { border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-md);
    margin-bottom: var(--aivi-sp2); }
  /* As tall as the picker whether it holds the picker or the reason there
     is none, so the count beside it never jumps. */
  .rowfoot { display: flex; align-items: center; gap: var(--aivi-sp3);
    min-height: var(--aivi-ctl-h); }
  .rowfoot .rowadd, .rowfoot .rowfull { flex: 1; min-width: 0; }
  .rowfoot .tnote { margin-top: 0; }
  .rowfoot .count { flex: none; font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .checks > .tnote { margin-top: var(--aivi-sp2); }
`;
