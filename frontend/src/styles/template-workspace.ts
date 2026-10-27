// A template box's Expand button, and the template workspace it opens
// (aivi-template-workspace.ts): a header over one card of three zones,
// the Insert rail (aivi-insert-list.ts), the editor and the output, as
// workspace-layout.ts arranges them; on a phone, the whole screen with
// a key row above the keyboard and Insert as a sheet.

import { css } from "lit";

const mono = css`ui-monospace, Menlo, monospace`;

export const templateWorkspaceStyles = css`
  /* Expand sits in the box's corner; the text keeps clear of it. */
  .tbox { position: relative; }
  .texpand { position: absolute; top: 5px; right: 5px; z-index: 1; display: grid;
    place-items: center; width: 28px; height: 28px; padding: 0; border: 0;
    border-radius: var(--aivi-r-sm); cursor: pointer; color: var(--aivi-muted);
    background: color-mix(in srgb, var(--aivi-card) 80%, transparent); }
  .texpand:hover { color: inherit; background: var(--aivi-surface-2); }
  .texpand .icon { width: 16px; height: 16px; }
  .tbox .tcode .cm-content, .tbox textarea.tmpl { padding-right: 32px; }

  /* The form, kept mounted under a workspace. */
  .edpage[hidden] { display: none; }

  /* Pages keep the frame's width; the workspace is a tool and takes the
     panel's, up to a cap past which wider code helps nobody. */
  .wrap.ws { max-width: 1760px; padding: 0 20px; }
  aivi-template-workspace { display: block; }
  .ws { display: flex; flex-direction: column; height: 100dvh; padding-bottom: 20px; }
  .wshead { flex: none; min-height: 60px; padding: 0; }
  .wshead .edname { min-width: 0; }
  .wshead h2.title { margin: 0; font-size: var(--aivi-fs-title); font-weight: 500;
    line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wshead .subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wshead .btn { flex: none; }
  .wshead .btn .icon { width: 18px; height: 18px; }
  .wshead [aria-disabled=true] { opacity: .5; cursor: not-allowed; }
  .wsinsert.on { background: var(--aivi-surface-2); border-color: transparent; }
  .wsinsert.on .icon { color: var(--aivi-accent); }
  .wsdocs .icon { width: 16px; height: 16px; }
  .ws > .saveerr { flex: none; }

  /* One card, the zones divided by hairlines; the editor is its surface,
     with no box of its own. */
  .wsbody { flex: 1; min-height: 0; position: relative; display: flex;
    background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow); overflow: hidden; }
  .wsrail { width: 288px; flex: none; min-height: 0; display: flex; flex-direction: column;
    background: var(--aivi-card); border-right: 1px solid var(--aivi-line); }
  /* Over the editor's leading edge where three zones do not fit: opening
     it does not reflow the code. */
  .ws.overlay .wsrail, .ws.strip .wsrail { position: absolute; top: 0; bottom: 0; left: 0;
    z-index: 5; box-shadow: 16px 0 40px -16px rgba(0,0,0,.55); }
  .wsmain { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex;
    flex-direction: column; }
  .wsout { width: clamp(380px, 24%, 440px); flex: none; min-height: 0; overflow: auto; overscroll-behavior: contain;
    border-left: 1px solid var(--aivi-line); padding: var(--aivi-sp4);
    display: flex; flex-direction: column; gap: var(--aivi-sp4); }

  /* The editor fills its zone. */
  .wsed { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .wsed .tcode { flex: 1; min-height: 0; display: flex; flex-direction: column;
    font-size: var(--aivi-fs-md); }
  .wsed .tcode .cm-editor { flex: 1; min-height: 0; max-height: none; border: 0;
    border-radius: 0; background: transparent; line-height: 1.6; }
  .wsed .tcode .cm-editor.cm-focused { box-shadow: none; }
  .wsed .cm-content { padding: var(--aivi-sp3) 0; }
  .wsed .cm-content:focus-visible { outline: none; box-shadow: none; }
  .wsed .cm-line { padding: 0 var(--aivi-sp4) 0 var(--aivi-sp3); }
  .wsed .cm-gutters { border-radius: 0; padding-left: var(--aivi-sp1); }
  .wsed .cm-lineNumbers .cm-gutterElement { min-width: 32px; }
  .wsed .cm-aivi-match { background: color-mix(in srgb, var(--aivi-attn) 28%, transparent); }
  .wsed textarea.tmpl { flex: 1; max-height: none; resize: none; field-sizing: fixed;
    border: 0; border-radius: 0; background: transparent; padding: var(--aivi-sp3) var(--aivi-sp4); }

  /* Under the text: where the caret is, what Tab does, and wrapping. */
  .wsstatus { flex: none; display: flex; align-items: center; gap: var(--aivi-sp3);
    min-height: 36px; padding: 0 var(--aivi-sp2) 0 var(--aivi-sp4);
    border-top: 1px solid var(--aivi-line); font-size: var(--aivi-fs-sm); color: var(--aivi-muted);
    white-space: nowrap; }
  .wsstatus .grow { flex: 1; }
  .wsstatus #aivi-ws-keys { overflow: hidden; text-overflow: ellipsis; }
  .wsstatus .btn.small { min-height: 26px; padding: 0 var(--aivi-sp2); font-size: var(--aivi-fs-sm); }
  .wswrap.on { color: inherit; background: var(--aivi-surface-2); }

  /* The find bar, over the text. */
  .wsfind { flex: none; display: flex; align-items: center; gap: var(--aivi-sp1);
    padding: var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp3);
    border-bottom: 1px solid var(--aivi-line); }
  .wsfind input { flex: 0 1 320px; min-width: 0; height: 32px; }
  .wsfcount { min-width: 72px; padding: 0 var(--aivi-sp2); font-size: var(--aivi-fs-sm);
    color: var(--aivi-muted); white-space: nowrap; }
  .wsfind .iconbtn { width: 32px; height: 32px; border-radius: var(--aivi-r-md); }
  .wsfind .iconbtn .icon { width: 18px; height: 18px; }

  /* The output: the preview without a card of its own (it is in one),
     then the result, roomier than under the inline box. */
  .wsout .pcard, .wsstripbody .pcard { padding: 0; border: 0; border-radius: 0;
    background: none; box-shadow: none; }
  /* A Small widget at about its size, not stretched to the column. */
  .wsout .pv-stage, .wsstripbody .pv-stage { max-width: 100%; }
  .wsout .pv-scale:has(> .pv-canvas.is-small),
  .wsstripbody .pv-scale:has(> .pv-canvas.is-small) { max-width: 236px; margin: 0 auto; }
  .wsres { border-top: 1px solid var(--aivi-line); padding-top: var(--aivi-sp4); }
  .wsres .tfb > :first-child { margin-top: 0; }
  .wsresh { margin: 0 0 var(--aivi-sp2); font-size: var(--aivi-fs-lg); font-weight: 600;
    letter-spacing: -.01em; }
  .wsres .tres { display: grid; grid-template-columns: 1fr auto; align-items: baseline;
    gap: var(--aivi-sp2); margin-top: 0; font-size: var(--aivi-fs-md); }
  .wsres .tres > .k { font-size: var(--aivi-fs-lg); letter-spacing: -.01em; }
  .wsres .tres .tkind { grid-row: 1; grid-column: 2; font-size: var(--aivi-fs-sm); }
  .wsres .tres .tval { grid-column: 1 / -1; display: block; padding: var(--aivi-sp2) 10px;
    font-size: var(--aivi-fs-md); line-height: 1.5; max-height: 14em;
    border-radius: var(--aivi-r-md); background: var(--aivi-field); border-color: var(--aivi-line); }
  /* "Updates on" on a line of its own, the chips wrapping under it. */
  .wsres .tchips { margin-top: var(--aivi-sp3); }
  .wsres .tchips > .none:first-child { flex-basis: 100%; }
  .wsres .tnote { margin-top: var(--aivi-sp3); }
  .wsres .tnote.error:first-child { margin-top: 0; }

  /* Hints on the result, each with its fix. */
  .wshints { list-style: none; margin: var(--aivi-sp3) 0 0; padding: 0; display: flex;
    flex-direction: column; gap: var(--aivi-sp2); }
  .wshints.stale { opacity: .55; }
  .wshint { display: flex; flex-wrap: wrap; align-items: center; gap: var(--aivi-sp2) var(--aivi-sp3);
    padding: var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp3);
    border-radius: var(--aivi-r-md); font-size: var(--aivi-fs-sm); line-height: 1.45;
    background: color-mix(in srgb, var(--aivi-accent) 9%, transparent); }
  .wshint > .icon { width: 18px; height: 18px; flex: none; color: var(--aivi-accent); }
  .wshtext { flex: 1 1 160px; min-width: 0; }
  .wshint .wsfix { flex: none; margin-left: auto; min-height: 30px; padding: 0 var(--aivi-sp3);
    font-size: var(--aivi-fs-sm); background: var(--aivi-card); }

  /* An entity's card, over the text where the pointer or the caret
     rests on its id. */
  .entcardwrap { position: absolute; z-index: 8; width: 320px; max-width: calc(100% - 16px); }
  .entcard { padding: var(--aivi-sp3); font-size: var(--aivi-fs-sm); line-height: 1.4;
    background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-r-md); box-shadow: var(--aivi-shadow-pop); }
  .enthead { display: flex; align-items: baseline; gap: var(--aivi-sp3); }
  .entname { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  .entstate { flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums; }
  .entunit { font-weight: 400; color: var(--aivi-muted); }
  .entid { font-family: ${mono}; font-size: var(--aivi-fs-xs); color: var(--aivi-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entcard.missing .entid { font-family: inherit; font-size: var(--aivi-fs-sm); color: inherit;
    white-space: normal; }
  .entsince { margin-top: var(--aivi-sp1); font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }
  .entattrs { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px var(--aivi-sp3);
    margin: var(--aivi-sp2) 0 0; padding-top: var(--aivi-sp2); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-xs); }
  .entattrs dt { font-family: ${mono}; color: var(--aivi-muted); }
  .entattrs dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entmore { margin-top: var(--aivi-sp1); font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }

  /* The output as one line (narrow widths and phones): pressed, all of
     it. */
  .wsstrip { flex: none; margin-bottom: var(--aivi-sp3); background: var(--aivi-card);
    border: 1px solid var(--aivi-card-line); border-radius: var(--aivi-radius); }
  .wsstripbtn { width: 100%; min-height: 44px; display: flex; align-items: center;
    gap: var(--aivi-sp2); padding: 0 var(--aivi-sp3) 0 var(--aivi-sp4); border: 0; background: none;
    cursor: pointer; font-size: var(--aivi-fs-md); text-align: left; border-radius: inherit; }
  .wsstripbtn:hover .tri { color: inherit; }
  .wsstripbtn .k { font-weight: 600; flex: none; }
  .wsval { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wsval.mono { font-family: ${mono}; font-size: var(--aivi-fs-sm); }
  .wskind { flex: none; font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .wshintmark { flex: none; display: inline-grid; color: var(--aivi-accent); }
  .wshintmark .icon { width: 16px; height: 16px; }
  .wsdot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--aivi-ok); }
  .wsdot.bad { background: var(--aivi-danger); }
  .wsdot.idle { background: var(--aivi-muted); }
  .wsstrip.stale .wsval { opacity: .55; }
  .wsstripbtn .tri { display: inline-grid; color: var(--aivi-muted); transition: transform .15s; }
  .wsstripbtn .tri .icon { width: 18px; height: 18px; }
  .wsstrip.open .wsstripbtn .tri { transform: rotate(90deg); }
  .wsstripbody { max-height: min(60dvh, 560px); overflow: auto; overscroll-behavior: contain;
    padding: var(--aivi-sp3) var(--aivi-sp4) var(--aivi-sp4); border-top: 1px solid var(--aivi-line);
    display: flex; flex-direction: column; gap: var(--aivi-sp4); }
  .wsstripbody[hidden] { display: none; }
  /* Opened on a desktop: the preview and the result side by side. */
  .ws.strip .wsstripbody:not([hidden]) { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
    align-items: start; max-height: min(50dvh, 440px); }
  .ws.strip .wsstripbody .wsres { border-top: 0; padding-top: 0; }
  .wsphone { display: flex; gap: var(--aivi-sp3); align-items: flex-start; }
  .wsphone .wsres { flex: 1; min-width: 0; border: 0; padding: 0; }
  .wsmini { width: 112px; flex: none; }
  .wsmini.wide { width: 200px; }

  /* A phone: the screen the keyboard leaves, the strip under the header,
     the keys at the bottom. */
  .ws.phone { position: fixed; z-index: 36; left: 0; right: 0; top: var(--ws-top, 0px);
    height: var(--ws-height, 100dvh); padding: 0; background: var(--aivi-bg); }
  .ws.phone .wshead { padding: 0 var(--aivi-sp2) 0 14px; min-height: 56px; }
  .ws.phone .wshead h2.title { font-size: var(--aivi-fs-lg); font-weight: 600; }
  .ws.phone .wshead .subtitle { display: none; }
  .ws.phone .saveerr { padding: 0 14px var(--aivi-sp2); }
  .ws.phone .wsstrip { margin: 0; border-width: 1px 0; border-radius: 0; }
  .ws.phone .wsbody { border: 0; border-radius: 0; box-shadow: none; }
  /* Wrapped, a line's continuation hangs under its start. */
  .ws.phone .wsed .cm-line { padding: 0 14px 0 calc(14px + 2ch); text-indent: -2ch; }
  .wskeys { flex: none; display: flex; gap: 6px;
    padding: 6px var(--aivi-sp2) calc(6px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--aivi-line); background: var(--aivi-field); }
  .wskeyrow { flex: 1; min-width: 0; display: flex; gap: 6px; }
  /* The keys share the row evenly, each a finger wide. */
  .wskey { flex: 1 1 0; min-width: 44px; height: 44px; padding: 0 2px; cursor: pointer;
    display: inline-grid; place-items: center; font-family: ${mono}; font-size: var(--aivi-fs-md);
    white-space: nowrap; letter-spacing: -.04em;
    color: inherit; background: var(--aivi-card); border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-md); }
  .wskey .icon { width: 20px; height: 20px; }
  /* A phone's Insert is in the header: the sheet takes the keyboard's
     place, with no keys to name (it is touched, not typed at). */
  .ws.phone .wsinsert { min-height: 36px; padding: 0 var(--aivi-sp3); }
  .ws.phone .inskeys { display: none; }
  /* Insert on a phone: a sheet over the lower part of the editor. */
  .wssheet { position: absolute; left: 0; right: 0; bottom: 0; height: 62%; z-index: 6;
    display: flex; flex-direction: column; background: var(--aivi-card);
    border-top: 1px solid var(--aivi-line); border-radius: var(--aivi-r-lg) var(--aivi-r-lg) 0 0;
    box-shadow: var(--aivi-shadow-sheet); }
  .wssheethead { flex: none; display: flex; align-items: center; gap: var(--aivi-sp2);
    padding: var(--aivi-sp2) var(--aivi-sp2) 0 var(--aivi-sp4); }
  .wssheethead .title { flex: 1; font-size: var(--aivi-fs-lg); font-weight: 600; }
  .wssheethead .iconbtn { width: var(--aivi-ctl-h); height: var(--aivi-ctl-h);
    border-radius: var(--aivi-r-md); }

  /* The Insert list: one search over the sections. */
  aivi-insert-list { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .insfield { flex: none; position: relative; padding: var(--aivi-sp3) var(--aivi-sp3) var(--aivi-sp2); }
  .insfield > .icon { position: absolute; left: calc(var(--aivi-sp3) + 10px);
    top: calc(50% + 2px); transform: translateY(-50%); width: 18px; height: 18px;
    color: var(--aivi-muted); pointer-events: none; }
  input.inssearch { width: 100%; height: var(--aivi-ctl-h); padding: 0 10px 0 36px;
    text-overflow: ellipsis; }
  .inslist { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain;
    padding: 0 var(--aivi-sp2) var(--aivi-sp2); }
  .inshead { padding: var(--aivi-sp3) var(--aivi-sp2) var(--aivi-sp1); font-size: var(--aivi-fs-xs);
    font-weight: 600; color: var(--aivi-muted); }
  .insopt { display: flex; align-items: center; gap: 10px; min-height: 44px;
    padding: var(--aivi-sp1) var(--aivi-sp2); border-radius: var(--aivi-r-md); cursor: pointer; }
  .insopt:hover { background: var(--aivi-surface-2); }
  /* The highlighted row is the search's: shown while the search has the
     focus. */
  aivi-insert-list:focus-within .insopt.active {
    background: color-mix(in srgb, var(--aivi-accent) 16%, transparent); }
  /* On it the muted ink is too faint: a stronger mix, as in the
     completion list. */
  aivi-insert-list:focus-within .insopt.active :is(.insid, .icon) {
    color: color-mix(in srgb, var(--aivi-fg) 80%, transparent); }
  .insopt > .icon { width: 18px; height: 18px; flex: none; color: var(--aivi-muted); }
  /* An entity's recipes and attributes, under it. */
  .insopt.sub { min-height: 36px; padding-left: 36px; }
  .insopt.sub > .icon { width: 16px; height: 16px; }
  .insopt.recipe > .icon { color: var(--aivi-accent); }
  /* A recipe's entity step: back, and what the entity is picked for. */
  .insstep { flex: none; display: flex; align-items: center; gap: var(--aivi-sp1);
    padding: var(--aivi-sp2) var(--aivi-sp3) 0 var(--aivi-sp1); }
  .insstep .iconbtn { width: 36px; height: 36px; flex: none; border-radius: var(--aivi-r-md); }
  .insstep .iconbtn .icon { width: 20px; height: 20px; }
  .insstept { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .insstept .insname { font-weight: 600; white-space: normal; line-height: 1.3; }
  .insstepsub { font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }
  .instext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .insname, .insid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .insname { font-size: var(--aivi-fs-md); }
  .insname.mono { font-family: ${mono}; font-size: var(--aivi-fs-sm); }
  /* A recipe's title is its whole description: it wraps. */
  .insname.wraps { white-space: normal; line-height: 1.3; }
  .insopt.recipe { padding-top: 6px; padding-bottom: 6px; }
  /* What a recipe's highlighted entity will put in. */
  .insprev { flex: none; display: flex; flex-direction: column; gap: 2px;
    padding: var(--aivi-sp2) var(--aivi-sp4); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }
  .insprev code { font-family: ${mono}; color: var(--aivi-fg); white-space: pre-wrap;
    overflow-wrap: anywhere; line-height: 1.45; max-height: 4.4em; overflow: hidden; }
  .insid { font-family: ${mono}; font-size: var(--aivi-fs-xs); color: var(--aivi-muted); }
  .insmore-btn { width: 28px; height: 28px; flex: none; display: grid; place-items: center;
    border-radius: var(--aivi-r-sm); color: var(--aivi-muted); }
  .insmore-btn:hover { background: var(--aivi-surface-3); color: inherit; }
  .insmore-btn .icon { width: 16px; height: 16px; transition: transform .15s; }
  .insmore-btn.open .icon { transform: rotate(90deg); }
  .insnone, .insmore { margin: 0; padding: var(--aivi-sp2); font-size: var(--aivi-fs-sm);
    color: var(--aivi-muted); }
  /* As tall as the editor's status line beside it: the zones' bottom
     rows line up. */
  .inskeys { flex: none; margin: 0; min-height: 36px; display: flex; align-items: center;
    padding: 0 var(--aivi-sp4); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-xs); color: var(--aivi-muted); white-space: nowrap; overflow: hidden; }

  @media (pointer: coarse) {
    .texpand { top: 2px; right: 2px; width: 40px; height: 40px; }
    .tbox .tcode .cm-content, .tbox textarea.tmpl { padding-right: 42px; }
    .inskeys { display: none; }
    .insmore-btn { width: 44px; height: 44px; }
    .insopt.sub { min-height: 44px; }
    /* The completion list's rows, a finger's height. */
    aivi-code-editor .tcode .cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li {
      min-height: 44px; display: flex; align-items: center; }
  }
`;
