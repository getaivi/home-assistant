// The form kit's own controls (form-kit.ts, aivi-color-field,
// aivi-gradient-field, aivi-icon-field): the fold's summary line, the
// color field and its popover, the gradient field, and the icon field.

import { css } from "lit";

export const kitStyles = css`
  /* A fold's summary: the title, then what is set inside. */
  details.fold > summary .ft { font-weight: 600; }
  details.fold > summary .fsum { overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  details.fold > summary .fsum::before { content: "·"; margin-right: 6px; }
  /* Something inside holds Save: the summary shows it, open or closed. */
  details.fold.bad > summary .fsum { color: var(--aivi-danger-ink); font-weight: 600; }

  .cfield { position: relative; display: inline-block; max-width: 100%; }
  .cfbtn { display: inline-flex; align-items: center; gap: var(--aivi-sp2);
    min-height: var(--aivi-ctl-h); padding: 0 var(--aivi-sp2);
    background: var(--aivi-input-bg); border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-md); cursor: pointer; font-size: var(--aivi-fs-base); }
  .cfbtn:hover { border-color: var(--aivi-muted); }
  /* Text that is not a color: marked on the button, popover open or not. */
  .cfbtn.bad, .cfbtn.bad:hover { border-color: var(--aivi-danger); }
  .cfield > .tnote { margin-top: var(--aivi-sp1); max-width: 200px; }
  .cfpop:focus { outline: none; }
  .cfbtn .tri { color: var(--aivi-muted); transform: rotate(90deg); }
  .cfname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The same hairline ring as a palette dot (WCAG 1.4.11, see .sw). */
  .cfdot { width: 18px; height: 18px; border-radius: var(--aivi-r-sm); flex: none;
    box-shadow: 0 0 0 1px var(--aivi-mark-ring); }
  .cfdot.empty { box-shadow: none; border: 1.5px dashed var(--aivi-muted); }
  .cfpop { position: absolute; z-index: 30; left: 0; top: calc(100% + var(--aivi-sp1));
    width: max-content; display: flex; flex-direction: column; gap: var(--aivi-sp3);
    align-items: flex-start; padding: var(--aivi-sp3);
    background: var(--aivi-card); border: 1px solid var(--aivi-line);
    border-radius: var(--aivi-r-lg); box-shadow: var(--aivi-shadow-pop); }
  .cfpop .swatches { display: grid; grid-template-columns: repeat(6, 21px);
    gap: var(--aivi-sp2); }
  .cfnone { display: inline-flex; align-items: center; gap: var(--aivi-sp2);
    background: none; border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-md);
    padding: var(--aivi-sp1) 10px var(--aivi-sp1) 6px; font-size: var(--aivi-fs-md);
    cursor: pointer; }
  .cfnone.on { border-color: var(--aivi-accent); }
  .cfhex { display: flex; gap: var(--aivi-sp2); align-items: center; align-self: stretch;
    border-top: 1px solid var(--aivi-line); padding-top: var(--aivi-sp3); }
  .cfhex input[type=color] { width: 40px; height: var(--aivi-ctl-h); flex: none;
    padding: 2px; background: var(--aivi-input-bg); cursor: pointer;
    border: 1px solid var(--aivi-input-line); border-radius: var(--aivi-r-md); }
  .cfhex .hexin { width: 7.5em; flex: 1; min-width: 0; }
  .cfhex .hexin.bad { border-color: var(--aivi-danger); }
  .cfpop .tnote { margin-top: 0; align-self: stretch; max-width: 200px; }

  .gfield { display: flex; flex-direction: column; gap: var(--aivi-sp2);
    align-items: flex-start; }
  .gstops { display: flex; flex-wrap: wrap; gap: var(--aivi-sp2); align-items: center; }
  .gstop { display: inline-flex; align-items: center; gap: 2px; }
  .gstop .rm { display: inline-grid; place-items: center; width: 28px; height: 28px;
    flex: none; padding: 0; background: none; border: 0; border-radius: 50%;
    color: var(--aivi-muted); cursor: pointer; }
  .gstop .rm:hover { color: inherit; }
  .gstop .rm .icon { width: 16px; height: 16px; }
  .gradsw { align-self: stretch; height: 14px; border-radius: var(--aivi-r-pill);
    border: 1px solid var(--aivi-line); }
  .gfield .tnote { margin-top: 0; align-self: stretch; }

  @media (pointer: coarse) {
    .cfbtn { min-height: 44px; }
    .cfnone { min-height: 44px; }
    .cfhex input[type=color] { width: 44px; height: 44px; }
    .cfpop .swatches { grid-template-columns: repeat(6, 21px); gap: 14px; }
    .gstop .rm { width: 44px; height: 44px; }
  }

  /* The icon field: the symbol picker under its input. */
  .iconfield { position: relative; display: block; }
  .icpop { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + var(--aivi-sp1));
    background: var(--aivi-card); border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-lg);
    box-shadow: var(--aivi-shadow-pop); display: flex; flex-direction: column;
    max-height: min(420px, 60dvh); }
  /* Above the input when there is no room under it (popover.ts). */
  .icpop.up { top: auto; bottom: calc(100% + var(--aivi-sp1)); }
  .iconfield > .fhint { margin-top: var(--aivi-sp1); }
  .iccats { display: flex; flex-wrap: wrap; gap: var(--aivi-sp1); padding: var(--aivi-sp2);
    border-bottom: 1px solid var(--aivi-line); }
  .iccats .fchip { padding: 3px 9px; font-size: var(--aivi-fs-xs); }
  .iclist { overflow: auto; overscroll-behavior: contain; padding: var(--aivi-sp1); flex: 1; min-height: 0; }
  .icopt { display: flex; align-items: baseline; gap: var(--aivi-sp2); padding: 7px 10px;
    border-radius: var(--aivi-r-sm); cursor: pointer; font-size: var(--aivi-fs-md); }
  .icopt.hi { background: color-mix(in srgb, var(--aivi-accent) 16%, transparent); }
  .icname { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-sm);
    flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icterms { color: var(--aivi-muted); font-size: var(--aivi-fs-sm); flex: 1 1 0; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icios { flex: none; margin-left: auto; font-size: var(--aivi-fs-xs); color: var(--aivi-muted);
    border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-pill); padding: 0 6px; }
  .icnote { padding: var(--aivi-sp3); font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .ichelp { padding: var(--aivi-sp2) var(--aivi-sp3); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-xs); color: var(--aivi-muted); line-height: 1.5; }
  @media (pointer: coarse) {
    .icopt { min-height: 44px; align-items: center; }
  }
`;
