// Badges (.chip) and buttons (.btn).

import { css } from "lit";

export const buttonStyles = css`
  /* A badge is a small label, not a pill. Secondary badges (a template's
     name) sit on the muted surface; outline badges (status) keep the
     hairline and color their ink. */
  .chip { display: inline-flex; align-items: center; gap: 5px; font-size: var(--aivi-fs-sm);
    font-weight: 500; line-height: 1.3; color: var(--aivi-muted); background: none;
    border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-sm); padding: 2px var(--aivi-sp2);
    white-space: nowrap; }
  .chip.secondary { background: var(--aivi-surface-2); border-color: transparent;
    color: inherit; }
  .chip.ok { color: var(--aivi-ok-ink); border-color: var(--aivi-ok-line); }

  /* One height (--aivi-ctl-h), one weight, one radius; the variants are
     a hierarchy, not a palette: one primary per screen (the accent fill),
     secondary for the rest of the real actions (muted fill, no border),
     quiet for the hairline outline, ghost for actions that only show
     themselves on hover, danger for the destructive one. */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    font-size: var(--aivi-fs-base); font-weight: 500; line-height: 1.2; min-height: var(--aivi-ctl-h);
    border-radius: var(--aivi-r-md); padding: 0 14px; border: 1px solid transparent;
    cursor: pointer; background: none; white-space: nowrap;
    transition: background-color .12s, border-color .12s, color .12s; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.primary { background: var(--aivi-accent-fill); color: var(--aivi-on-accent); }
  .btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--aivi-accent-fill) 88%, #fff); }
  .btn.secondary { background: var(--aivi-surface-2); color: inherit; }
  .btn.secondary:hover:not(:disabled) { background: var(--aivi-surface-3); }
  .btn.quiet { border-color: var(--aivi-input-line); color: inherit; }
  .btn.quiet:hover:not(:disabled) { background: var(--aivi-surface-2); }
  .btn.ghost { color: var(--aivi-muted); }
  .btn.ghost:hover:not(:disabled) { background: var(--aivi-surface-2); color: inherit; }
  .btn.danger { color: var(--aivi-danger-ink); border-color: var(--aivi-danger-line); }
  .btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--aivi-danger) 12%, transparent); }
  .btn.small { min-height: 32px; padding: 0 10px; font-size: var(--aivi-fs-md); }
  /* Link-shaped buttons are real anchors so open-in-new-tab works. */
  a.btn { text-decoration: none; display: inline-flex; align-items: center;
    justify-content: center; }
`;
