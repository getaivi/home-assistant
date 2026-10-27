// Activity rows (activity-rows.ts), shared by the bar's Events panel, the
// Activity page (aivi-activity-log) and the editor's Recent activity, and
// the page's own layout.

import { css } from "lit";

export const activityStyles = css`
  /* A row: what happened and what was asked on one line, then where and
     when against what became of it. A push's content waits behind a
     disclosure under them. */
  ul.alist { list-style: none; margin: 0; padding: 0; }
  .arow { padding: 10px 0; }
  .arow + .arow { border-top: 1px solid var(--aivi-line); }
  .awhat, .ameta { display: flex; justify-content: space-between; align-items: baseline;
    gap: var(--aivi-sp3); }
  .awhat { font-size: var(--aivi-fs-base); line-height: 20px; }
  .aname { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  .aname .evlink { font-weight: inherit; }
  .areq { flex: none; }
  .areq .n, .ameta .n { font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }
  .ameta { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); margin-top: 2px; line-height: 18px; }
  .awhere { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ameta .aout, .ameta .outcome { flex: none; }
  .atook { font-variant-numeric: tabular-nums; }
  .evlink { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer;
    text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    text-underline-offset: 2px; border-radius: var(--aivi-r-sm); }
  .evlink:hover { color: var(--aivi-fg); }
  .arow .perr { font-size: var(--aivi-fs-sm); color: var(--aivi-danger-ink); margin-top: 2px;
    overflow-wrap: anywhere; }
  .arow .fhint { margin-top: 2px; }
  .arow .pwarn { font-size: var(--aivi-fs-sm); color: var(--aivi-attn-ink); margin-top: 2px;
    overflow-wrap: anywhere; }
  /* What a push sent: a disclosure like the editor's "what will be
     pushed", a row's size. */
  .arow details.abody { margin-top: 2px; }
  .arow details.abody > summary { list-style: none; cursor: pointer; display: flex;
    align-items: center; gap: var(--aivi-sp1); font-size: var(--aivi-fs-sm); font-weight: 500;
    color: var(--aivi-muted); min-height: 28px; padding: 0 var(--aivi-sp2) 0 var(--aivi-sp1);
    margin: 0 calc(-1 * var(--aivi-sp1)); border-radius: var(--aivi-r-md);
    transition: background-color .12s, color .12s; }
  .arow details.abody > summary:hover { background: var(--aivi-surface-2); color: inherit; }
  .arow details.abody[open] > summary { color: inherit; }
  .arow details.abody > summary .tri { display: inline-grid; transition: transform .15s; }
  .arow details.abody > summary .tri .icon { width: 16px; height: 16px; }
  .arow details.abody[open] > summary .tri { transform: rotate(90deg); }
  .arow details.abody > summary::-webkit-details-marker { display: none; }
  .arow details.abody pre { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); background: var(--aivi-field); border: 1px solid var(--aivi-line);
    border-radius: var(--aivi-r-md); padding: 10px; margin: 6px 0 0; white-space: pre-wrap;
    word-break: break-all; max-height: 320px; overflow: auto; }
  .arow details.abody .fhint { margin: var(--aivi-sp1) 0 0; }
  .outcome.delivered { color: var(--aivi-ok-ink); }
  .outcome.unchanged { color: var(--aivi-muted); }
  .outcome.retrying, .outcome.waiting { color: var(--aivi-attn-ink); }
  .outcome.held { color: var(--aivi-muted); }

  /* The Activity page: the hub's width, a filter bar like the hub's, the
     list in a card. */
  .logpage { display: block; }
  .logaccts { margin: 2px 0 var(--aivi-sp3); }
  .evstreams.logstreams { padding: 0 2px var(--aivi-sp2); border-bottom: 0; }
  /* The two selects, labeled like the form kit's controls, in one row
     that stacks on a phone; under them, how much of the log shows. */
  .logsels { display: flex; flex-wrap: wrap; gap: var(--aivi-sp3) var(--aivi-sp4);
    margin: var(--aivi-sp2) 0 var(--aivi-sp3); }
  .logsel { display: flex; align-items: center; gap: var(--aivi-sp2); min-width: 0; }
  .logsel > .k { font-size: var(--aivi-fs-sm); font-weight: 500; color: var(--aivi-muted);
    flex: none; }
  .logsel > select { width: auto; max-width: 100%; }
  .logcount { display: flex; align-items: center; gap: var(--aivi-sp3); flex-wrap: wrap;
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); margin: 0 2px var(--aivi-sp3); }
  .logcard { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow); padding: 0 var(--aivi-sp4); }
  .logcard .evempty { padding: var(--aivi-sp6) var(--aivi-sp2); }
  .logcard .evempty > div { margin-top: var(--aivi-sp3); }
  .loglist .arow { padding: var(--aivi-sp3) 0; }
  .logfoot { font-size: var(--aivi-fs-xs); color: var(--aivi-muted); line-height: 1.45;
    margin: var(--aivi-sp3) 2px 0; }
  :host([narrow]) .logsels { flex-direction: column; gap: var(--aivi-sp2); }
  :host([narrow]) .logsel > select { flex: 1; }
`;
