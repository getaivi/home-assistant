// Narrow mode (phones, the companion app) and touch targets.

import { css } from "lit";

export const responsiveStyles = css`
  /* A banner's button goes under its text on a phone, so the text keeps
     the width (account names can be long). */
  :host([narrow]) .banner { flex-wrap: wrap; row-gap: var(--aivi-sp2); }
  :host([narrow]) .banner .grow { flex-basis: calc(100% - 32px); }
  :host([narrow]) .banner > .btn { margin-left: 32px; }
  /* Narrow mode is keyed off :host([narrow]), reflected from HA's narrow
     property. */
  :host([narrow]) .wrap { padding: var(--aivi-sp3) 14px 72px; }
  :host([narrow]) .hubbar input[type=search] { flex-basis: 100%; max-width: none; }
  /* An empty account's steps keep the width for their text. */
  :host([narrow]) .acct-empty { padding: 22px 20px 20px; margin-top: 20px; }

  /* The editor stacks to one column; the preview becomes a bottom sheet
     toggled by pure CSS state, so the form keeps focus and scroll.
     column-reverse keeps the toggle first in focus order but at the
     bottom edge. */
  :host([narrow]) .editor { grid-template-columns: 1fr; padding-bottom: 60px; }
  /* Narrow undoes the desktop height bound: the sheet sizes itself, and
     an outer scroller would nest inside it. */
  :host([narrow]) .side { position: fixed; top: auto; left: 0; right: 0; bottom: 0;
    max-height: none; overflow: visible;
    z-index: 40; display: flex; flex-direction: column-reverse; gap: 0;
    background: var(--aivi-bg);
    border-top: 1px solid var(--aivi-line);
    box-shadow: var(--aivi-shadow-sheet);
    padding: 0 14px calc(6px + env(safe-area-inset-bottom, 0px)); }
  :host([narrow]) .pvtoggle { display: flex; align-items: center; gap: var(--aivi-sp2);
    width: 100%; min-height: 48px; padding: 6px 2px; background: none; border: 0;
    cursor: pointer; font-size: var(--aivi-fs-md); font-weight: 600; text-align: left; }
  :host([narrow]) .pvtoggle .n { font-size: var(--aivi-fs-xs); font-weight: 600;
    color: var(--aivi-attn-ink); border: 1px solid
    var(--aivi-attn-line); border-radius: var(--aivi-r-pill); padding: 1.5px var(--aivi-sp2); }
  :host([narrow]) .pvtoggle .grow { flex: 1; }
  :host([narrow]) .pvtoggle .tri { color: var(--aivi-muted);
    transform: rotate(-90deg); transition: transform .15s; }
  :host([narrow]) .side.open .pvtoggle .tri { transform: rotate(90deg); }
  :host([narrow]) .side .sidebody { display: none; }
  :host([narrow]) .side.open .sidebody { display: flex; margin-top: var(--aivi-sp2);
    max-height: min(62dvh, 520px); overflow: auto; overscroll-behavior: contain; }
  /* Cap and center the widget mock so it doesn't scale to sheet width. */
  :host([narrow]) .side .pv-scale, :host([narrow]) .side .pv-empty {
    max-width: 250px; margin-left: auto; margin-right: auto; }

  /* On-screen keyboard: the popup gets a viewport-bounded height with
     internal scroll, and the focused field scrolls to the top of the view
     (aivi-entity-combobox.ts) with room left for its label. */
  :host([narrow]) aivi-entity-combobox { scroll-margin-top: 108px; }
  :host([narrow]) .cbx-pop { max-height: min(240px, 38dvh); }
  :host([narrow]) aivi-icon-field { scroll-margin-top: 108px; }
  :host([narrow]) .icpop { max-height: min(320px, 44dvh); }
  /* The category chips are one row that scrolls sideways: wrapped, they
     would take the popup's whole height and leave the list a sliver. */
  :host([narrow]) .iccats { flex: none; flex-wrap: nowrap; overflow-x: auto;
    overscroll-behavior-x: contain; scrollbar-width: none; }
  :host([narrow]) .iccats .fchip { flex: none; white-space: nowrap; }

  /* A list row is two lines on a phone: the name gets the first to
     itself (beside the grip and the buttons it would have 67 px), the move and
     remove buttons take the second. */
  :host([narrow]) .ordhead { flex-wrap: wrap; }
  :host([narrow]) .ordhead .rowtoggle { flex: 1 1 60%; }
  :host([narrow]) .ordhead .rowacts { margin-left: auto; }

  /* Touch targets (~44 px, HIG/Material) are keyed on pointer coarseness,
     not width: a touch tablet needs them at any size, a narrow desktop
     window with a mouse does not. */
  @media (pointer: coarse) {
    .btn { min-height: 44px; }
    .btn.small { min-height: 44px; padding: var(--aivi-sp2) 14px; }
    .backbtn { min-height: 44px; }
    .fchip { min-height: 44px; padding: var(--aivi-sp2) 10px var(--aivi-sp2) 14px; }
    .seg button { min-height: 40px; padding: var(--aivi-sp2) 14px; font-size: var(--aivi-fs-md); }
    .cbx input { padding-right: 46px; }
    .cbx .clear { right: 0; padding: 0; min-width: 44px; min-height: 44px;
      display: grid; place-items: center; }
    .cbx .clear .icon { width: 18px; height: 18px; }
    .cbx-pop .opt { min-height: 44px; align-items: center; }
    .checks label { min-height: 44px; }
    details.style > summary { min-height: 44px; }
    details.payload > summary { display: flex; align-items: center; min-height: 44px; }
    /* The inline editor's own .rm rule is more specific than .segrow .rm,
       so it is named here too. */
    .segrow .rm, .seginline .segrow .rm, .ordrow .mv { min-width: 44px; min-height: 44px; }
    .ordhead .grip { min-width: 44px; min-height: 44px; justify-content: center; }
    .ordhead .rowtoggle { min-height: 44px; }
    .rowfoot { min-height: 44px; }
    /* Boundary handles: a wider, taller hit zone around the 4 px pill
       (the bar itself stays 28 px so proportions read true). */
    .seghandle { width: 28px; top: -10px; bottom: -10px; }
    .segadd { min-width: 44px; min-height: 44px; }
    .urlsug .chip { min-height: 36px; padding: 6px var(--aivi-sp3); }
    /* Color swatches: the dot stays 21 px (44 px squares would dominate
       the rows) but a pseudo-element extends the hit area to 45×45 px and
       the gap widens to limit overlap. */
    .swatches { gap: 14px; }
    .sw::after { content: ""; position: absolute; inset: -12px; }
    /* 16 px stops iOS WebViews auto-zooming focused inputs. */
    input[type=text], input[type=search], textarea, select { font-size: var(--aivi-fs-lg); min-height: 44px; }
    .tcode { font-size: var(--aivi-fs-lg); }
  }
`;
