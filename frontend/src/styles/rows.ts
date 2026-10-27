// The rows checklist's ordered selection: reordering, drag
// affordances and the per-row options.

import { css } from "lit";

export const rowsStyles = css`
  /* ordered selection (rows reordering + per-row options) */
  .ordlist { display: flex; flex-direction: column; gap: 2px; padding: var(--aivi-sp1); }
  .ordrow { font-size: var(--aivi-fs-md); padding: 2px var(--aivi-sp1); border-radius: var(--aivi-r-sm); }
  .ordhead { display: flex; gap: 6px; align-items: center; }
  /* The row's header opens its options: the whole name is the target,
     and it shows how many options are set. */
  .ordhead .rowtoggle { flex: 1; min-width: 0; display: flex; align-items: center;
    gap: 6px; min-height: 32px; padding: 0 var(--aivi-sp1); background: none; border: 0;
    border-radius: var(--aivi-r-sm); cursor: pointer; text-align: left; }
  .ordhead .rowtoggle:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
  .ordhead .rowtoggle .tri { color: var(--aivi-muted); transition: transform .15s; }
  .ordhead .rowtoggle[aria-expanded="true"] .tri { transform: rotate(90deg); }
  .ordhead .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ordhead .rsum { flex: none; font-size: var(--aivi-fs-xs); color: var(--aivi-muted);
    border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-pill); padding: 0 7px; }
  /* A row with an option that holds Save shows it on its header, open or
     closed: the name and the chip turn to the error ink. */
  .ordhead .rowtoggle.bad .n { color: var(--aivi-danger-ink); }
  .ordhead .rsum.bad { color: var(--aivi-danger-ink); font-weight: 600;
    border-color: var(--aivi-danger-line); }
  /* Move up, Move down, Remove: one group, so a phone can wrap it whole. */
  .ordhead .rowacts { flex: none; display: flex; gap: 6px; align-items: center; }
  .ordhead .i { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); flex: none; }
  .ordhead .grip { flex: none; border: 0; background: none; padding: var(--aivi-sp1) 2px;
    color: var(--aivi-muted); cursor: grab; touch-action: none;
    display: inline-flex; align-items: center; border-radius: var(--aivi-r-sm); }
  .ordhead .grip .icon { width: 16px; height: 16px; }
  .ordhead .grip:hover { color: inherit; }
  /* Per-row options are a fold surface (.foldbody in markup) too. */
  .rowopts { margin: var(--aivi-sp2) 2px var(--aivi-sp1); }
  .rowopts input.bad { border-color: var(--aivi-danger); }
  .pressline .pressdoes { display: flex; align-items: center;
    min-height: var(--aivi-ctl-h); font-size: var(--aivi-fs-md); }
  .rowopts .chk, .rowopts .wordhide { display: flex; gap: var(--aivi-sp2); align-items: center;
    font-size: var(--aivi-fs-md); }
  .rowopts .ctl > .tnote { align-self: stretch; }
  .rowopts .words { display: flex; flex-direction: column; gap: var(--aivi-sp1);
    align-self: stretch; }
  .rowopts .wordrow { display: flex; gap: var(--aivi-sp2); align-items: center; }
  .rowopts .wordrow .wk { flex: none; width: 7.5em; font-size: var(--aivi-fs-md);
    color: var(--aivi-muted); }
  .rowopts .wordrow input[type="text"] { flex: 1; min-width: 0; }

  /* Drag affordances: the grabbed row lifts and follows the pointer
     (inline translateY, so nothing reflows), a dashed slot marks its
     origin, and an accent line marks the drop gap. Transition-free, so
     mid-drag screenshots don't depend on animation timing. */
  .ordlist { position: relative; }
  .ordrow.draglift { position: relative; z-index: 3; cursor: grabbing;
    background: var(--aivi-card); outline: 1px solid var(--aivi-line);
    box-shadow: 0 6px 18px rgba(0,0,0,.30), 0 1px 4px rgba(0,0,0,.18);
    will-change: transform; }
  .ordrow.draglift .grip { cursor: grabbing; }
  .dragslot { position: absolute; left: var(--aivi-sp2); right: var(--aivi-sp2); box-sizing: border-box;
    border: 1.5px dashed var(--aivi-line); border-radius: var(--aivi-r-sm);
    opacity: .9; pointer-events: none; }
  .dragline { position: absolute; left: var(--aivi-sp2); right: var(--aivi-sp2); height: 2px;
    margin-top: -1px; background: var(--aivi-accent); border-radius: var(--aivi-r-pill);
    pointer-events: none; }
`;
