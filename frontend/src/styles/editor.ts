// Editor extras: tap URL suggestions, the activity lifecycle card,
// the what's-missing lines and the payload disclosure.

import { css } from "lit";

export const editorStyles = css`
  /* tap-url suggestions */
  .urlsug { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
  .urlsug .chip { cursor: pointer; border-radius: var(--aivi-r-pill); padding: 3px 10px;
    font-weight: 400; transition: background-color .12s, color .12s; }
  .urlsug .chip:hover { color: inherit; background: var(--aivi-surface-2); }

  /* activity lifecycle card in the editor */
  .setup { margin-bottom: var(--aivi-sp3); }
  .missing { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); padding: 2px 2px 0; }
  .missing > .tnote { margin-top: 0; }
  .missing b { color: var(--aivi-attn-ink); font-weight: 560; }
  .missing.blocked b { color: var(--aivi-danger-ink); }

  /* The editor's bar stays in view: Save, and what it is waiting for,
     are reachable from anywhere in the form. It spans the wrap's gutter
     so nothing scrolls past beside it. */
  /* Layers, bottom to top: field popups (30: the entity list, the color
     and icon pickers), this bar (35: a popup scrolled up goes under it),
     the phone's preview sheet (40), the chat sheet (45), toasts (50).
     Modal dialogs are in the top layer, above everything. */
  .edbar { position: sticky; top: 0; z-index: 35;
    background: var(--aivi-bg);
    margin: 0 -20px var(--aivi-sp2); padding: 0 20px; }
  .edbar > .topbar { min-height: 60px; padding: 0; }
  :host([narrow]) .edbar { margin: 0 -14px var(--aivi-sp2); padding: 0 14px; }
  /* A phone's bar has room for the name and Save: Suggest goes by its
     icon (its label still names it for a screen reader). */
  :host([narrow]) .aibtn { min-width: 44px; padding: 0; }
  :host([narrow]) .aibtn > span { position: absolute; width: 1px; height: 1px;
    margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .edbar .btn, .edbar .backbtn { flex: none; }
  .edbar [aria-disabled=true] { opacity: .5; cursor: not-allowed; }
  /* A failed save is reported beside Save until the form changes. */
  .saveerr { font-size: var(--aivi-fs-md); color: var(--aivi-danger-ink); text-align: right;
    padding: 0 0 var(--aivi-sp2); overflow-wrap: anywhere; }
  .saveerr:empty { display: none; }
  /* What the bar's chip (or a preview region) jumps to lands below the
     sticky bar, not under it. */
  .field, .form .tnote, .form > .banner { scroll-margin-top: 76px; }
  .edname { min-width: 0; }
  .edname .title, .edname .subtitle { overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  /* The widget's slug: the id Aivi, repairs and automations know it by. */
  .edname .slug { font-family: ui-monospace, Menlo, monospace;
    font-size: .92em; user-select: all; }
  /* What Save still waits for: a quiet button of the bar's own height,
     in the attention ink, that jumps to the first field missing. */
  .btn.needchip { color: var(--aivi-attn-ink); white-space: nowrap; }
  .btn.needchip .icon { width: 16px; height: 16px; }
  .btn.needchip:hover:not(:disabled) { color: var(--aivi-attn-ink);
    background: color-mix(in srgb, var(--aivi-attn) 12%, transparent); }
  .aibtn { display: inline-flex; align-items: center; gap: 6px; }
  .aibtn .icon { width: 18px; height: 18px; color: var(--aivi-accent); }
  .aibtn.on { color: inherit; border-color: var(--aivi-accent); }

  /* the leave question, a modal dialog */
  dialog.dlg { background: var(--aivi-card); color: var(--aivi-fg);
    border: 1px solid var(--aivi-card-line); border-radius: var(--aivi-r-lg);
    box-shadow: var(--aivi-shadow-dlg); padding: var(--aivi-sp4) 20px;
    width: min(440px, calc(100vw - 32px)); }
  dialog.dlg::backdrop { background: rgba(0,0,0,.45); }
  /* A name with no break in it wraps instead of widening the dialog. */
  dialog.dlg h3 { margin: 0; font-size: var(--aivi-fs-lg); font-weight: 600;
    overflow-wrap: anywhere; }
  dialog.dlg p { margin: var(--aivi-sp2) 0 0; color: var(--aivi-muted); font-size: var(--aivi-fs-base);
    overflow-wrap: anywhere; }
  dialog.dlg .dactions { display: flex; gap: var(--aivi-sp2); justify-content: flex-end;
    margin-top: var(--aivi-sp4); }
  dialog.dlg .dhead { display: flex; align-items: center; gap: var(--aivi-sp2);
    margin: -6px -10px var(--aivi-sp2) 0; }
  dialog.dlg .dhead h3 { flex: 1; }
  dialog.dlg .dclose { width: 36px; height: 36px; }

  /* Recent presses (bindings that accept input): a log under the
     preview, a line for what was pressed and one for what became of it. */
  .recent { display: block; }
  .recent .phead { margin-bottom: var(--aivi-sp1); }
  /* Compact rows (styles/activity.ts has the shape): the list sits in
     a side card, so what happened is a size smaller. */
  ul.recentlist { margin-top: var(--aivi-sp2); }
  ul.recentlist .arow { padding: var(--aivi-sp2) 0; }
  ul.recentlist .arow:first-child { border-top: 1px solid var(--aivi-line); }
  ul.recentlist .awhat { font-size: var(--aivi-fs-md); }
  /* The rest are on the Log page. */
  .recentfoot { padding-top: var(--aivi-sp2); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .outcome.played { color: var(--aivi-ok-ink); }
  .outcome.failed { color: var(--aivi-danger-ink); }
  .outcome.expired, .outcome.not_bound, .outcome.ignored { color: var(--aivi-attn-ink); }
  .perr { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); word-break: break-word; }
  .pempty { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); padding: var(--aivi-sp2) 0 0; }

  /* "What will be pushed": a disclosure that reads as one (a chevron and
     a pressable row), not a caption under the preview. */
  /* "Preview as": a chip per band of each reading colors follow. */
  .pvas { display: flex; flex-direction: column; gap: 6px; margin-top: var(--aivi-sp3); }
  .pvas > .k { font-size: var(--aivi-fs-sm); font-weight: 500; color: var(--aivi-muted); }
  .pvasname { flex-basis: 100%; font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .pvasdot { width: 8px; height: 8px; border-radius: 50%; flex: none;
    box-shadow: 0 0 0 1px var(--aivi-mark-ring); }
  details.payload { margin-top: var(--aivi-sp2); }
  details.payload > summary { list-style: none; cursor: pointer; display: flex; align-items: center;
    gap: var(--aivi-sp1); font-size: var(--aivi-fs-sm); font-weight: 500; color: var(--aivi-muted);
    min-height: 32px; padding: 0 var(--aivi-sp2) 0 var(--aivi-sp1); margin: 0 calc(-1 * var(--aivi-sp1));
    border-radius: var(--aivi-r-md); transition: background-color .12s, color .12s; }
  details.payload > summary:hover { background: var(--aivi-surface-2); color: inherit; }
  details.payload[open] > summary { color: inherit; }
  details.payload > summary .tri { display: inline-grid; transition: transform .15s; }
  details.payload > summary .tri .icon { width: 16px; height: 16px; }
  details.payload[open] > summary .tri { transform: rotate(90deg); }
  details.payload > summary::-webkit-details-marker { display: none; }
  details.payload pre { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); background: var(--aivi-field); border: 1px solid var(--aivi-line);
    border-radius: var(--aivi-r-md); padding: 10px; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }
`;
