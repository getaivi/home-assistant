// The gauge ring's color ramp editor (aivi-color-ramp).

import { css } from "lit";

export const rampStyles = css`
  .ramp { display: block; }
  .ramp-body { display: flex; flex-direction: column; gap: var(--aivi-sp3); }
  /* The mode control hugs its buttons instead of stretching to the row. */
  .ramp-body > .seg { align-self: flex-start; }
  .rsolid { display: flex; flex-direction: column; gap: var(--aivi-sp2); align-items: flex-start; }

  /* Preset cards render the gradient they actually produce. */
  .rpresets { display: grid; gap: var(--aivi-sp2);
    grid-template-columns: repeat(auto-fit, minmax(122px, 1fr)); }
  .rpreset { display: flex; flex-direction: column; gap: 6px; cursor: pointer;
    padding: var(--aivi-sp2); border-radius: var(--aivi-r-md); background: none; text-align: left;
    border: 1px solid var(--aivi-line); }
  .rpreset:hover { background: var(--aivi-surface-2); }
  /* Selected like the kit's other choices: the muted fill, no accent. */
  .rpreset.on { border-color: color-mix(in srgb, var(--aivi-fg) 30%, transparent);
    background: var(--aivi-surface-3); }
  .rpbar { display: block; height: 12px; border-radius: var(--aivi-r-sm); }
  .rpname { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .rpreset.on .rpname { color: inherit; }

  /* The ramp as the dial interpolates it, with a tick under each stop to
     show the even spacing the device imposes. */
  .rstrip { position: relative; padding-bottom: 7px; }
  .rstripbar { display: block; height: 14px; border-radius: var(--aivi-r-sm); }
  .rtick { position: absolute; bottom: 0; width: 1px; height: 5px;
    background: var(--aivi-muted); transform: translateX(-0.5px); }

  .rlist { display: flex; flex-direction: column; gap: var(--aivi-sp2); }
  .rstop { display: flex; align-items: center; gap: var(--aivi-sp2);
    flex-wrap: wrap; }
  .rnum { flex: none; width: 18px; text-align: right; font-size: var(--aivi-fs-sm);
    color: var(--aivi-muted); font-variant-numeric: tabular-nums; }
  .rdot { flex: none; width: 26px; height: 26px; border-radius: var(--aivi-r-md);
    cursor: pointer; border: 1px solid var(--aivi-mark-ring); }
  /* One line per stop at every width: the name truncates, never the
     position beside it. */
  .rname { flex: 1; min-width: 0; font-size: var(--aivi-fs-base); display: flex;
    gap: var(--aivi-sp2); align-items: baseline; white-space: nowrap; overflow: hidden; }
  .rname .rlabel { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .rwhere { font-variant-numeric: tabular-nums; flex: none; font-size: var(--aivi-fs-sm);
    color: var(--aivi-muted); }
  .rmv, .rdel { flex: none; width: 28px; height: 28px; border-radius: var(--aivi-r-sm);
    cursor: pointer; background: none; display: inline-grid; place-items: center;
    border: 1px solid var(--aivi-line); color: var(--aivi-muted); }
  .rmv .icon, .rdel .icon { width: 15px; height: 15px; }
  .rmv:hover:not(:disabled), .rdel:hover { color: inherit;
    border-color: var(--aivi-muted); }
  .rmv:disabled, .rdel:disabled { opacity: .35; cursor: not-allowed; }
  /* The picker opens under its own row, full width. */
  .rpick { flex-basis: 100%; padding: 2px 0 var(--aivi-sp1) 26px; }
  .rfull { margin: 0; }
  .rfoot { display: flex; align-items: center; gap: var(--aivi-sp2);
    flex-wrap: wrap; }
  .rgrow { flex: 1; }
  .rcount { font-variant-numeric: tabular-nums; font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .rfoot .btn:disabled { opacity: .45; cursor: not-allowed; }
  /* A color by value (aivi-bands-field): the ruler, a row per band, the
     reading now. */
  .bands { display: flex; flex-direction: column; gap: var(--aivi-sp2); }
  .bruler { position: relative; padding: var(--aivi-sp1) 0 18px; }
  .bbar { display: block; height: 10px; border-radius: var(--aivi-r-sm); }
  .bnowmark { position: absolute; top: 0; width: 3px; height: 18px; border-radius: var(--aivi-r-pill);
    background: var(--aivi-fg); box-shadow: 0 0 0 2px var(--aivi-card); transform: translateX(-1.5px); }
  .bticks { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; }
  .btick { position: absolute; transform: translateX(-50%); font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .btick.end:first-child { transform: none; }
  .btick.end:last-child { transform: translateX(-100%); }
  .blist { display: flex; flex-direction: column; gap: var(--aivi-sp2); }
  /* The bands share four columns, so the limits, the colors and the
     removes line up down the list: the words before a limit, the limit
     (with its unit), the color, the remove. The top band's words take the
     first two. */
  .blist { display: grid; grid-template-columns: max-content max-content minmax(0, max-content) 28px;
    justify-content: start; align-items: center; gap: var(--aivi-sp2); }
  .brow { display: contents; }
  .bpre, .brange { grid-column: 1; font-size: var(--aivi-fs-md); font-variant-numeric: tabular-nums;
    white-space: nowrap; }
  .brange { grid-column: 1 / 3; }
  .blim { grid-column: 2; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .blim input.blimit { width: 4.5em; }
  .bunit { color: var(--aivi-muted); }
  .brow > .cfield { grid-column: 3; min-width: 0; }
  .brow > .rdel { grid-column: 4; }
  .brow > .tnote { grid-column: 1 / -1; }
  .bnow:empty { display: none; }

  /* Touch: the palette's swatches get the gaps and reach the color
     field's popover gives them. */
  @media (pointer: coarse) {
    .rpick { padding-left: 0; }
    .rpick .swatches { display: grid; grid-template-columns: repeat(auto-fill, 30px); gap: 14px; }
    .rpick .swatches .sw { width: 30px; height: 30px; }
  }
`;
