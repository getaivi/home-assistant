// The Suggest chat (aivi-suggest-box) and the sidebar it docks in.

import { css } from "lit";

export const suggestStyles = css`
  /* The sidebar: a column beside the editor, sticky, full remaining
     height, so the conversation stays beside the form while it is used.
     The transcript scrolls; the composer stays at the bottom. */
  .edwrap { display: flex; gap: var(--aivi-sp4); align-items: flex-start; }
  /* The sticky sidebar is as tall as the viewport under the bar; without
     this the page's bottom padding pushes it up under the bar at the end
     of a long form. */
  .edwrap.ai { margin-bottom: -58px; }
  :host([narrow]) .edwrap.ai { margin-bottom: 0; }
  .edwrap > .editor { flex: 1; min-width: 0; }
  /* While the chat is open the preview moves above the form, as a stage
     pinned under the bar: what the conversation changes is next to it at
     every width, and the form keeps the column to itself. Only the mock
     and what still blocks Save stay; the title, the hint, the payload and
     the press log return with the side column when the chat closes. */
  .edwrap.ai .editor { grid-template-columns: minmax(0, 1fr); }
  .edwrap.ai .side { order: -1; z-index: 5; max-height: none; overflow: visible;
    background: var(--aivi-bg); margin-bottom: calc(-1 * var(--aivi-sp2));
    padding-bottom: var(--aivi-sp2); }
  .edwrap.ai .side .pcard { padding: var(--aivi-sp3) var(--aivi-sp4); }
  .edwrap.ai .side .phead h3, .edwrap.ai .side .pv-hint, .edwrap.ai .side details.payload,
  .edwrap.ai .side aivi-recent-presses { display: none; }
  /* The size switch stays, centered over the mock. */
  .edwrap.ai .side .phead { justify-content: center; margin-bottom: var(--aivi-sp2); }
  .edwrap.ai .side .phead:not(:has(.seg)) { display: none; }
  .edwrap.ai .side .phead .seg { margin-left: 0; }
  .edwrap.ai .side .pv-stage > * { max-width: 190px;
    margin-left: auto; margin-right: auto; }
  /* A Live Activity is wider than a small widget, and its captions go
     with the title. */
  .edwrap.ai .side .pv-stage > *:has(.pv-banner) { max-width: 300px; }
  .edwrap.ai .side .pv-stage > *:has(.pv-canvas.is-medium) { max-width: 406px; }
  .edwrap.ai .side .pv-stage .fhint { display: none; }
  .edwrap.ai .side .pv-stage .pv-banner { margin-top: var(--aivi-sp2); }
  .edwrap.ai .side .missing { text-align: center; }
  /* Nothing of the form shows between the bar and the stage, and a field
     jumped to lands under the stage, not behind it. */
  .edwrap.ai .side { box-shadow: 0 -16px 0 var(--aivi-bg); }
  .edwrap.ai .field, .edwrap.ai .form .tnote, .edwrap.ai .form > .banner { scroll-margin-top: 340px; }
  @media (max-width: 899px) {
    :host(:not([narrow])) .aiside { width: 300px; }
  }
  .aiside { position: sticky; top: 72px; height: calc(100dvh - 86px); min-height: 360px;
    width: 340px; flex: none; display: flex; flex-direction: column; min-width: 0;
    background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow); }
  .aihead { display: flex; align-items: center; gap: var(--aivi-sp2);
    padding: var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp4);
    border-bottom: 1px solid var(--aivi-line); flex: none; }
  .aihead h3 { flex: 1; margin: 0; font-size: var(--aivi-fs-base); font-weight: 600;
    letter-spacing: -.01em; }
  .aihead .dclose { width: 32px; height: 32px; }
  .aihead .dclose .icon { width: 18px; height: 18px; }
  .aiside > .suggest { flex: 1; min-height: 0; }

  .suggest { display: flex; flex-direction: column; gap: var(--aivi-sp2);
    padding: var(--aivi-sp3) var(--aivi-sp3) var(--aivi-sp2); }
  .suggest .chat { flex: 1; min-height: 0; display: flex; flex-direction: column;
    gap: var(--aivi-sp3); overflow: auto; overscroll-behavior: contain; padding: 2px 2px 6px; }
  .suggest .intro { color: var(--aivi-muted); font-size: var(--aivi-fs-md); line-height: 1.5;
    margin: auto 0; text-align: center; padding: 0 var(--aivi-sp3);
    display: flex; flex-direction: column; align-items: center; gap: var(--aivi-sp3); }
  .suggest .intro p { margin: 0; }
  /* Conversation starters: pills that send their ask in one press. */
  .suggest .starters { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .suggest .starter { display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
    font: inherit; font-size: var(--aivi-fs-sm); color: var(--aivi-fg);
    background: var(--aivi-bg); border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-pill); padding: 6px var(--aivi-sp3); cursor: pointer;
    transition: background-color .12s, border-color .12s; }
  .suggest .starter span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .suggest .starter svg { width: 14px; height: 14px; flex: none; color: var(--aivi-muted); }
  .suggest .starter:hover { background: var(--aivi-surface-2); }
  .suggest .starter:focus-visible { outline: 2px solid var(--aivi-ring); outline-offset: 2px; }
  .suggest .msg { display: flex; flex-direction: column; align-items: stretch; gap: var(--aivi-sp1); }
  /* The ask: a small bubble at the trailing edge, on the muted surface. */
  .suggest .msg.user { align-items: flex-end; }
  .suggest .bubble { max-width: 85%; padding: var(--aivi-sp2) var(--aivi-sp3);
    border-radius: var(--aivi-r-lg); border-bottom-right-radius: var(--aivi-r-sm);
    font-size: var(--aivi-fs-md); line-height: 1.45; background: var(--aivi-surface-2);
    overflow-wrap: anywhere; white-space: pre-wrap; }
  /* The reply: plain text, full width, no bubble. */
  .suggest .reply { font-size: var(--aivi-fs-md); line-height: 1.55; overflow-wrap: anywhere; }
  .suggest .rchanges { margin-top: var(--aivi-sp1); font-size: var(--aivi-fs-sm); color: var(--aivi-muted);
    line-height: 1.5; }
  .suggest .rchanges .chip { display: inline; font: inherit; color: inherit; border: 0;
    padding: 0; background: none; white-space: normal; }
  .suggest .rsame { margin-top: var(--aivi-sp1); font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  .suggest .rchanges .chip + .chip::before { content: " · "; }
  .suggest .rchanges .chip.cleared, .suggest .rchanges .chip.unsourced { color: var(--aivi-danger-ink); }
  /* What the answer said that was not applied: beside the reply, so a
     reply never appears without its correction. */
  .suggest .rrejected { margin-top: var(--aivi-sp1); font-size: var(--aivi-fs-sm); line-height: 1.5;
    color: var(--aivi-attn-ink); }
  /* A turn that applied nothing: why, and Retry. */
  .suggest .msg.problem .rtext { color: var(--aivi-muted); }
  .suggest .redo { display: flex; align-items: center; gap: var(--aivi-sp2);
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  /* Actions under a reply: ghost, quiet until hovered. */
  .suggest .ractions { display: flex; gap: 2px; margin: 2px 0 0 -8px; }
  .suggest .ractions .btn { min-height: 28px; padding: 0 var(--aivi-sp2); font-size: var(--aivi-fs-sm); gap: 5px; }
  .suggest .ractions .btn .icon { width: 15px; height: 15px; }
  /* Thinking: a shimmer across the word, not a bubble. */
  .suggest .thinking { align-self: flex-start; font-size: var(--aivi-fs-md); color: var(--aivi-muted);
    background: linear-gradient(90deg, var(--aivi-muted) 0 35%, var(--aivi-fg) 50%, var(--aivi-muted) 65% 100%);
    background-size: 220% 100%; -webkit-background-clip: text; background-clip: text;
    color: transparent; animation: aivi-shimmer 1.8s linear infinite; }
  @keyframes aivi-shimmer { from { background-position: 110% 0; } to { background-position: -110% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .suggest .thinking { animation: none; color: var(--aivi-muted); background: none; }
  }

  /* Starting points for the next ask: outlined pills that fill the
     composer. */
  .suggest .hints { display: flex; flex-wrap: wrap; gap: 6px; flex: none; }
  .suggest .hint { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); background: none;
    border: 1px solid var(--aivi-input-line); border-radius: var(--aivi-r-pill); padding: var(--aivi-sp1) 10px;
    cursor: pointer; transition: background-color .12s, color .12s; }
  .suggest .hint:hover:not(:disabled) { color: inherit; background: var(--aivi-surface-2); }
  .suggest .hint:disabled { opacity: .5; cursor: default; }
  /* What the answer offers next sends in one press: it reads as a choice
     (ink, not muted), where a generic hint reads as a suggestion. */
  .suggest .hint.opt { color: var(--aivi-fg); background: var(--aivi-bg); }
  .suggest .hint.opt:hover:not(:disabled) { background: var(--aivi-surface-2); }

  /* The composer: a bordered card holding a growing textarea and a
     toolbar with the round send button (a stop square while thinking). */
  .suggest .composer { flex: none; display: flex; flex-direction: column;
    background: var(--aivi-input-bg); border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-lg); transition: border-color .12s, box-shadow .12s; }
  .suggest .composer:focus-within { border-color: var(--aivi-accent); box-shadow: 0 0 0 3px var(--aivi-ring); }
  .suggest .composer textarea { font-family: inherit; font-size: var(--aivi-fs-md); line-height: 1.45;
    background: none; border: 0; border-radius: var(--aivi-r-lg) var(--aivi-r-lg) 0 0; resize: none;
    min-height: 0; max-height: 160px; padding: 10px var(--aivi-sp3) var(--aivi-sp1); overflow: auto; }
  .suggest .composer textarea:focus, .suggest .composer textarea:hover { box-shadow: none; border: 0; }
  .suggest .srow { display: flex; align-items: center; gap: var(--aivi-sp2); padding: var(--aivi-sp1) 6px 6px var(--aivi-sp3); }
  .suggest .chint { flex: 1; min-width: 0; font-size: var(--aivi-fs-xs); color: var(--aivi-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The model, as a quiet select in the toolbar (ghost until hovered). */
  .suggest .modelsel { width: auto; max-width: 55%; min-height: 28px; padding: 2px var(--aivi-sp6) 2px var(--aivi-sp2);
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); background-color: transparent;
    border-color: transparent; background-position: right 6px center; background-size: 14px; }
  .suggest .modelsel:hover { color: inherit; background-color: var(--aivi-surface-2); }
  .suggest .sendbtn { flex: none; display: inline-grid; place-items: center; width: 30px; height: 30px;
    border-radius: 50%; border: 0; cursor: pointer; padding: 0;
    background: var(--aivi-accent-fill); color: var(--aivi-on-accent); transition: background-color .12s; }
  .suggest .sendbtn:hover:not([aria-disabled="true"]) { background: color-mix(in srgb, var(--aivi-accent-fill) 88%, #fff); }
  /* Nothing to send: dimmed, still focusable (it says why it is idle). */
  .suggest .sendbtn[aria-disabled="true"] { opacity: .4; cursor: not-allowed; }
  .suggest .srow .rgrow { flex: 1; }
  .suggest .sendbtn .icon { width: 18px; height: 18px; }
  .suggest .sendbtn.stop { background: var(--aivi-fg); color: var(--aivi-card); }
  .suggest .sendbtn.stop .icon { width: 14px; height: 14px; }
  .suggest .foot { margin: 0; flex: none; font-size: var(--aivi-fs-xs); }
  /* No working AI Task backend: what the feature is, and where to fix it. */
  .suggest.off { justify-content: center; }
  .suggest.off .why { font-size: var(--aivi-fs-base); color: inherit; line-height: 1.55;
    text-align: center; padding: var(--aivi-sp4); }
  .suggest .why a { color: inherit; text-decoration: underline; }

  /* Narrow: the chat is a sheet over the lower screen, and the preview
     is the stage pinned above the form (not the bottom sheet it is while
     the chat is closed), smaller, so both fit on a phone with the form
     between them. */
  :host([narrow]) .edwrap.ai .side { position: sticky; top: 60px; left: auto; right: auto;
    bottom: auto; display: block; border-top: 0; box-shadow: none; padding: 0 0 var(--aivi-sp2); }
  :host([narrow]) .edwrap.ai .side .pvtoggle { display: none; }
  :host([narrow]) .edwrap.ai .side .sidebody { display: flex; max-height: none; overflow: visible; margin-top: 0; }
  :host([narrow]) .edwrap.ai .side .pv-stage > * { max-width: 132px; }
  :host([narrow]) .edwrap.ai .side .pv-stage > *:has(.pv-banner) { max-width: 250px; }
  :host([narrow]) .edwrap.ai .side .pv-stage > *:has(.pv-canvas.is-medium) { max-width: 282px; }
  :host([narrow]) .edwrap.ai .editor { padding-bottom: min(52dvh, 480px); }
  :host([narrow]) .aiside { position: fixed; width: auto; top: auto; left: 0; right: 0; bottom: 0; z-index: 45;
    height: min(52dvh, 480px); min-height: 0; border-radius: var(--aivi-r-lg) var(--aivi-r-lg) 0 0;
    border-bottom: 0; box-shadow: var(--aivi-shadow-sheet);
    padding-bottom: env(safe-area-inset-bottom, 0px); }
  /* Touch: the kit's 44px floor, and no hint about keys a phone lacks. */
  @media (pointer: coarse) {
    .suggest .sendbtn { width: 44px; height: 44px; }
    .suggest .hint, .suggest .starter { min-height: 44px; padding: 0 14px; }
    .suggest .ractions .btn { min-height: 44px; }
    .suggest .chint { visibility: hidden; }
    .suggest .modelsel { min-height: 44px; }
    .aihead .dclose { width: 44px; height: 44px; }
  }
`;
