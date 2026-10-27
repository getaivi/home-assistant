// The hub: the accounts panel behind the bar's gear, widget cards, the
// feeder warning, banners, the empty/onboarding card.

import { css } from "lit";

export const hubStyles = css`
  /* Accounts: behind the bar's gear, a panel under it. */
  .acctwrap { position: relative; flex: none; }
  .acctbtn { position: relative; }
  .acctbtn.attn::after { content: ""; position: absolute; top: 9px; right: 9px;
    width: 8px; height: 8px; border-radius: 50%; background: var(--aivi-attn);
    box-shadow: 0 0 0 2px var(--aivi-bg); }
  /* Anchored to the gear (its wrapper), so it sits under it at any
     width and scrolls with the bar. */
  /* A small menu: a quiet heading, one row per account, then the two
     ways on. Rows are a fixed height with their content centered in it,
     and the space above the first row equals the space under the last,
     so the list sits evenly between the heading and the rule. */
  dialog.acctpop { position: absolute; top: calc(100% + var(--aivi-sp1)); right: 0; left: auto;
    margin: 0; z-index: 30;
    width: min(340px, calc(100vw - 28px)); padding: var(--aivi-sp3) var(--aivi-sp4) var(--aivi-sp4);
    background: var(--aivi-card); color: var(--aivi-fg);
    border: 1px solid var(--aivi-card-line); border-radius: var(--aivi-r-lg);
    box-shadow: var(--aivi-shadow-dlg); }
  /* The panel itself takes focus when it opens (not its first button,
     which would then show a focus ring). */
  dialog.acctpop:focus, dialog.acctpop:focus-visible { outline: none;
    box-shadow: var(--aivi-shadow-dlg); }
  dialog.acctpop h3 { margin: 0; font-size: var(--aivi-fs-sm); font-weight: 500;
    color: var(--aivi-muted); line-height: 20px; }
  .acctlist { list-style: none; margin: var(--aivi-sp1) 0; padding: 0;
    display: flex; flex-direction: column; }
  /* Name over status: a long name keeps the row's width, and a long
     status ("Subscription ended …") never squeezes the name. */
  .acct { display: flex; align-items: flex-start; gap: 10px; padding: var(--aivi-sp2) 0;
    font-size: var(--aivi-fs-base); line-height: 1; }
  .acct .ainfo { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .acct + .acct { border-top: 1px solid var(--aivi-line); }
  .acct .dot { width: 8px; height: 8px; margin-top: 6px; }
  .acct .an { font-weight: 500; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; line-height: 20px; }
  .acct .as { color: var(--aivi-muted); font-size: var(--aivi-fs-sm); line-height: 18px; }
  .acct.ok .dot { background: var(--aivi-ok); }
  .acct.warn .dot { background: var(--aivi-attn); }
  .acct.warn .as { color: var(--aivi-attn-ink); }
  .acct.bad .dot { background: var(--aivi-danger); }
  .acct.bad .as { color: var(--aivi-danger-ink); }
  .acctactions { display: flex; gap: var(--aivi-sp2); flex-wrap: wrap;
    padding-top: var(--aivi-sp3); border-top: 1px solid var(--aivi-line); }
  /* About: where to read, where to ask, and which version this is; one
     per line, quiet. */
  .acctabout { display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    margin-top: var(--aivi-sp3); padding-top: var(--aivi-sp3);
    border-top: 1px solid var(--aivi-line); font-size: var(--aivi-fs-md); line-height: 20px; }
  .acctabout a { color: inherit; text-decoration: none; border-radius: var(--aivi-r-sm); }
  .acctabout a:hover { text-decoration: underline; }
  .acctabout a:focus-visible { outline: 2px solid var(--aivi-ring); outline-offset: 2px; }
  .acctabout .ver { color: var(--aivi-muted); font-variant-numeric: tabular-nums; }

  /* Section headers, HA style: plain sentence-case text. */
  .eyebrow { font-size: var(--aivi-fs-base); font-weight: 500; color: var(--aivi-muted);
    margin: 20px 2px 10px; }
  .eyebrow:has(.eb-name) { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .eyebrow .eb-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eyebrow .eb-kind, .eyebrow .chip { flex: none; }
  .chip.warn { color: var(--aivi-attn-ink); border-color: var(--aivi-attn-line); }
  .chip.bad { color: var(--aivi-danger-ink); border-color: var(--aivi-danger-line); }
  /* min(): a viewport narrower than a card's minimum gets one column
     of what there is, not a sideways scroll. */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: var(--aivi-sp3); }
  .wcard { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow);
    padding: 15px 15px 13px; display: flex; flex-direction: column; gap: 10px;
    min-width: 0; transition: border-color .12s; }
  .wcard:hover { border-color: color-mix(in srgb, var(--aivi-fg) 22%, transparent); }
  /* The whole card opens its editor (a dim one has none). */
  .wcard:not(.dim) { cursor: pointer; }
  .wcard:not(.dim):active { background: color-mix(in srgb, var(--aivi-fg) 3%, var(--aivi-card)); }
  /* Unsupported: visibly inert without an opacity fade, which would drop
     the muted text below AA contrast. */
  .wcard.dim { background: transparent; border-style: dashed; }
  .wcard.dim .nm { color: var(--aivi-muted); }
  .wcard .head { display: flex; align-items: center; gap: 10px; }
  /* A name with no break in it wraps inside the card instead of
     widening it (and the phone's page with it). */
  .wcard .nm { font-weight: 600; font-size: var(--aivi-fs-lg); letter-spacing: -.01em;
    min-width: 0; overflow-wrap: anywhere; }
  .wcard .head .grow { flex: 1; }
  .wcard .head .chip { flex: none; }
  .wcard .sum { font-size: var(--aivi-fs-md); color: var(--aivi-muted); min-height: 17px;
    overflow-wrap: anywhere; }
  /* A card's notes (gone from the app, waiting for a value) are the
     form's notes; the card's gap spaces them. */
  .wcard > .tnote { margin-top: 0; }
  .wcard .sum b { color: inherit; font-weight: 600; }
  .wcard .foot { display: flex; gap: var(--aivi-sp2); align-items: center; margin-top: 2px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot.on { background: var(--aivi-ok); } .dot.off { background: var(--aivi-line); }
  .dot.warn { background: var(--aivi-attn); }

  /* An automation feeding the same slug: a banner above the editor's
     form, and on a card a popup from its warning mark. */
  .feeders .fkeep { color: var(--aivi-muted); }
  .flink { color: inherit; font-weight: 600; text-decoration: underline;
    text-underline-offset: 2px; }
  .wcard .sum.fedby { color: var(--aivi-muted); }
  /* On a card: a warning mark beside the name, and the notice in a popup
     hanging from the card's head. The mark is drawn small with a touch
     target around it, and takes no height of its own. */
  .wcard { position: relative; }
  aivi-feeder-warning { display: contents; }
  .fwbtn { position: relative; flex: none; display: inline-grid; place-items: center;
    width: 24px; height: 24px; margin: -4px 0; padding: 0; border: 0; border-radius: 50%;
    background: none; color: var(--aivi-attn-ink); cursor: pointer; }
  .fwbtn::after { content: ""; position: absolute; inset: -10px; }
  .fwbtn:hover, .fwbtn[aria-expanded="true"] {
    background: color-mix(in srgb, var(--aivi-attn) 16%, transparent); }
  .fwbtn .icon { width: 18px; height: 18px; }
  dialog.fwpop { position: absolute; top: 46px; left: var(--aivi-sp3); right: var(--aivi-sp3);
    width: auto; margin: 0; z-index: 20; padding: var(--aivi-sp3) var(--aivi-sp4);
    background: var(--aivi-card); color: var(--aivi-fg);
    border: 1px solid var(--aivi-card-line); border-radius: var(--aivi-r-lg);
    box-shadow: var(--aivi-shadow-dlg);
    font-size: var(--aivi-fs-sm); line-height: 1.45; cursor: default; }
  dialog.fwpop[open] { display: flex; flex-direction: column; align-items: flex-start;
    gap: var(--aivi-sp3); }
  dialog.fwpop:focus, dialog.fwpop:focus-visible { outline: none; }
  dialog.fwpop .grow { overflow-wrap: anywhere; }
  dialog.fwpop .fkeep { color: var(--aivi-muted); margin-top: var(--aivi-sp1); }
  /* The banner (notice.ts): a page's or a section's message (Aivi out
     of reach, a paused subscription, the first binding, an automation
     feeding the slug, what holds the form's Save). Boxed in its
     severity's line and tint, the mark in its ink, the action trailing.
     A single field's note is never a banner (.tnote). */
  .banner { display: flex; align-items: center; gap: var(--aivi-sp3);
    border: 1px solid var(--aivi-attn-line); background: var(--aivi-attn-tint);
    border-radius: var(--aivi-r-lg); padding: var(--aivi-sp3) var(--aivi-sp4);
    font-size: var(--aivi-fs-md); line-height: 1.45; margin-bottom: var(--aivi-sp4); }
  /* Under the search row, as far from it as a section heading is. */
  .hubbar + .banner { margin-top: 20px; }
  .banner .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .banner > .icon { width: 20px; height: 20px; flex: none; color: var(--aivi-attn-ink); }
  .banner > .btn { flex: none; }
  .banner.ok { border-color: var(--aivi-ok-line); background: var(--aivi-ok-tint); }
  .banner.ok > .icon { color: var(--aivi-ok-ink); }
  .banner.error { border-color: var(--aivi-danger-line); background: var(--aivi-danger-tint); }
  .banner.error > .icon { color: var(--aivi-danger-ink); }
  .banner b { font-weight: 600; }

  .hero-empty { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow);
    padding: 34px 28px; max-width: 560px; margin: 40px auto; text-align: center; }
  .hero-empty h2 { margin: 0 0 6px; font-size: var(--aivi-fs-title); }
  .hero-empty p { margin: 0; color: var(--aivi-muted); font-size: var(--aivi-fs-base); line-height: 1.55; }
  .hero-empty .actions { margin-top: 18px; display: flex; gap: 10px;
    justify-content: center; flex-wrap: wrap; }
  .hero-empty .subnote { margin-top: 14px; font-size: var(--aivi-fs-sm); }
  .hero-empty .subnote a { color: var(--aivi-muted); }
  .hero-empty .subnote a:hover { color: inherit; }

  /* An account with nothing on it yet: how widgets and Live Activities
     get here, as numbered steps. Alone on the page it sits centered like
     the onboarding card; under an account's name it starts at the edge,
     like the cards it stands in for. */
  .acct-empty { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow);
    padding: 26px 28px var(--aivi-sp6); max-width: 560px; margin: 40px auto; }
  .acct-empty.in-section { margin: 0; }
  .acct-empty h2 { margin: 0 0 6px; font-size: var(--aivi-fs-title); line-height: 1.3;
    letter-spacing: -.01em; overflow-wrap: anywhere; }
  .acct-empty .lead { margin: 0; color: var(--aivi-muted); font-size: var(--aivi-fs-base);
    line-height: 1.55; }
  .acct-empty .steps { list-style: none; counter-reset: step; margin: 20px 0 0; padding: 0;
    display: flex; flex-direction: column; gap: var(--aivi-sp3); }
  .acct-empty .steps li { counter-increment: step; display: grid;
    grid-template-columns: 24px 1fr; gap: var(--aivi-sp3); align-items: start;
    font-size: var(--aivi-fs-base); line-height: 24px; overflow-wrap: anywhere; }
  .acct-empty .steps li::before { content: counter(step); display: grid; place-items: center;
    width: 24px; height: 24px; border-radius: 50%; background: var(--aivi-surface-2);
    font-size: var(--aivi-fs-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
  .acct-empty .actions { margin-top: 22px; display: flex; gap: 10px; flex-wrap: wrap; }
  .acct-empty .rfnote { margin: var(--aivi-sp3) 0 0; color: var(--aivi-muted); font-size: var(--aivi-fs-sm); }
  .acct-empty .btn .icon, .empty-note .btn .icon { width: 16px; height: 16px; }

  /* One list empty while the other has cards: a dashed slot where its
     cards would be, one line and its two ways on. */
  .empty-note { display: flex; align-items: center; flex-wrap: wrap; gap: 6px var(--aivi-sp4);
    border: 1px dashed var(--aivi-card-line); border-radius: var(--aivi-radius);
    padding: var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp2) var(--aivi-sp4); }
  .empty-note p { margin: 0; flex: 1 1 280px; color: var(--aivi-muted);
    font-size: var(--aivi-fs-md); line-height: 1.45; padding: 6px 0; }
  /* Pulled left by a ghost button's padding, so their text lines up
     with the line's when they wrap under it. */
  .empty-note .actions { display: flex; gap: var(--aivi-sp1); flex-wrap: wrap; margin-left: -10px; }`;
