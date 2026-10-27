// The live preview (aivi-preview-pane): the widget and Live Activity
// mocks, and the canvas regions that press through to the form.
//
// Class names: `pv-<part>` for what every template shares (pv-canvas,
// pv-name, pv-hero, pv-ghost), `pv-<template>-<part>` for one template's
// own (pv-status-row, pv-switchboard-tile), and a state or variant as a
// separate modifier class beside them (is-medium, is-off, has-icon). The
// pane's card and title row (.pcard, .phead) are the panel kit's, which
// other cards use too.

import { css } from "lit";

export const previewStyles = css`
  /* preview */
  /* The pane's own chrome is the kit's (a section card, its title, the
     kit's type scale); only the device mocks below keep iOS's own point
     sizes and colors. */
  .pcard { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow);
    padding: var(--aivi-sp4) var(--aivi-sp4) var(--aivi-sp3); }
  .pcard .phead { display: flex; align-items: center; gap: var(--aivi-sp2);
    margin-bottom: var(--aivi-sp3); }
  .pcard .phead h3 { font-size: var(--aivi-fs-lg); margin: 0; font-weight: 600;
    letter-spacing: -.01em; }
  /* The size switch (the kit's segmented control) rides the title row. */
  .pcard .phead .seg { margin-left: auto; }

  /* 1:1 mock of the system-family widgets: a 158×158 pt canvas (338×158
     at Medium) with 16 pt margins, mirroring the app's widget templates
     (fonts, colors, spacing), rendered at that size and scaled to the
     card width. Always dark, on the gradient the app's own renders have
     (#212121 → #0a0a0a, radius 22). The hairline that sets it off the
     card is a shadow, not a border: a border would take a point of the
     margin on every side. Each template's own layout is in
     styles/preview/<template>.ts. */
  .pv-scale { width: 100%; position: relative; }
  .pv-canvas { width: 158px; height: 158px; border-radius: 22px; padding: 16px;
    transform-origin: top left; position: absolute; top: 0; left: 0;
    display: flex; flex-direction: column; overflow: hidden;
    background: linear-gradient(180deg, #212121, #0a0a0a);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  /* Text roles: name 15/500 secondary, state line 13/500, meta line
     12/500 tertiary. A one-line Text is as tall as its font (1.193 of
     the size for the system face), not its text style's leading. */
  .pv-canvas .pv-name { font-size: 15px; font-weight: 500; color: rgba(235,235,245,.6);
    line-height: 1.193; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-canvas .pv-state { font-size: 13px; font-weight: 500; margin-top: 2px; line-height: 1.193;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-canvas .pv-meta { font-size: 12px; font-weight: 500; line-height: 1.193;
    color: rgba(235,235,245,.3); }
  /* Heroes truncate with an ellipsis, like iOS Text with lineLimit(1),
     in the system face's own tracking. */
  .pv-canvas .pv-hero { line-height: 1.193; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .pv-canvas .pv-chip, .pv-banner .pv-chip { width: 28px; height: 28px;
    border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 14px;
    font-weight: 600; }
  /* A symbol's stand-in icon (<ha-icon>): the size an SF Symbol takes at
     its holder's font size, in the holder's color. A Material icon is
     drawn inside a margin of its box, so the box is that much larger
     than the symbol and gives the margin back around it. */
  .pv-icon { --mdc-icon-size: 1.4em; display: inline-flex; flex: none;
    width: 1.4em; height: 1.4em; margin: -.1em; vertical-align: top; }
  .pv-canvas.is-medium { width: 338px; }
  .pv-canvas .pv-grow { flex: 1 1 0; min-height: 0; }
  /* Medium columns (energy nodes, battery rings): equal shares of the
     width, each a centered stack, the row centered on the canvas. */
  .pv-canvas .pv-cols { flex: 1; display: flex; align-items: center; min-height: 0; }
  .pv-canvas .pv-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
    align-items: center; }
  .pv-canvas .pv-col-value, .pv-canvas .pv-col-caption { max-width: 100%;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Medium split (budget, prices, trend): a text column as wide as what
     it says, half of what the 16 pt spacing leaves at most (the stack
     offers its two children equal shares), beside the chart or the rows. */
  .pv-canvas .pv-split { flex: 1; display: flex; gap: 16px; min-width: 0; min-height: 0; }
  .pv-canvas .pv-lead { display: flex; flex-direction: column; min-width: 0;
    max-width: calc((100% - 16px) / 2); }
  .pv-canvas .pv-chart { flex: 1 1 0; min-width: 0; position: relative; }
  .pv-canvas .pv-bar { height: 6px; border-radius: 3px; background: rgba(235,235,245,.18);
    margin-top: 6px; overflow: hidden; flex: none; }
  .pv-canvas .pv-bar i { display: block; height: 100%; border-radius: 3px; min-width: 6px; }
  .pv-canvas .pv-waiting { margin: auto; text-align: center; color: var(--aivi-muted);
    font-size: 12px; line-height: 1.6; padding: 0 6px; }
  .pv-empty { display: grid; place-items: center; min-height: 160px; padding: var(--aivi-sp4);
    border: 1px dashed var(--aivi-line); border-radius: 22px;
    color: var(--aivi-muted); font-size: var(--aivi-fs-sm); line-height: 1.6; text-align: center; }

  /* Live Activity preview: a Lock Screen banner mock. The device banner
     is black (activityBackgroundTint(.black)) with 16 pt padding; the
     hairline border delineates it on the card, standing in for the
     system's rounded cutout against the wallpaper. */
  .pv-banner { border-radius: 24px; padding: 16px;
    background: #000;
    border: 1px solid rgba(255,255,255,.12); color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    font-variant-numeric: tabular-nums; }
  /* The banner name: headline (17 semibold) in full white. The widget
     name role does not exist on the banner. */
  .pv-banner .pv-banner-name { font-size: 17px; font-weight: 600; color: #fff; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The simple bar's track is gray at 30 % (not the widget's
     quaternary), and its fill has no minimum width on the device. */
  .pv-banner .pv-bar { background: rgba(142,142,147,.3); overflow: hidden; }
  /* The value fill is an <i>, inline by default: without this it never
     paints and the banner shows a bare track. */
  .pv-banner .pv-bar i { display: block; height: 100%; border-radius: inherit; min-width: 0; }

  /* Slots, the preview as a control: the ring is drawn on the painted
     region itself (via an attribute the pane writes), so the canvas's
     scale() and reflows carry it. Outline, not border/box-shadow, so a
     ringed region never shifts the 1:1 mock. */
  .pv-stage { position: relative; }
  .pv-stage .pv-hint { margin: 0 0 var(--aivi-sp2); }
  .pv-stage [data-slot] { cursor: pointer; }
  /* The ring's corners, for a region with no shape of its own: :where()
     keeps this below the mock's own radii (the round icon chip). */
  .pv-stage :where([data-slot]) { border-radius: 4px; }
  /* Hover only where there is a pointer to hover with: on touch this
     matches on tap and sticks until the next tap elsewhere. */
  @media (hover: hover) {
    .pv-stage [data-slot]:hover {
      outline: 1.5px solid rgba(255,255,255,.45); outline-offset: 1px; }
  }
  /* The selection is the panel's, not the widget's: the accent, so it
     can't be read as part of the design. */
  .pv-stage [data-slot][data-slot-on] {
    outline: 2px solid var(--aivi-accent); outline-offset: 2px; }
  /* Keyboard focus on a region: the same accent ring, drawn as an
     outline (the panel's box-shadow ring would be clipped by the mock). */
  .pv-stage [data-slot]:focus-visible { box-shadow: none;
    outline: 2px solid var(--aivi-accent); outline-offset: 2px; }
  /* A skeleton is all placeholders: slightly receded as a whole. */
  .pv-stage.is-skeleton .pv-canvas, .pv-stage.is-skeleton .pv-banner,
  .pv-stage.is-skeleton .pv-island-pill { opacity: .85; }
  @media (prefers-reduced-motion: no-preference) {
    .pv-stage [data-slot] { transition: outline-color .12s ease; }
  }

  /* A region this payload does not fill: dashed and muted so it can't be
     mistaken for device content, but present so every region is
     pressable, including ones not yet set. */
  .pv-ghost { border: 1px dashed rgba(255,255,255,.34); border-radius: 4px;
    color: rgba(235,235,245,.55); font-size: 9px; font-weight: 500;
    line-height: 1; padding: 4px 5px; min-height: 17px; display: flex;
    align-items: center; justify-content: center; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-ghost.is-grow { flex: 1; min-width: 0; }
  /* Room for a neighbor's highlight ring: the device leaves only 2 px
     under a widget's hero. The space goes on the placeholder (editor
     chrome), not on the mock. */
  .pv-canvas .pv-ghost:not(.is-chip) { margin-top: 5px; }
  .pv-ghost.is-chip { width: 28px; height: 28px; border-radius: 50%; padding: 0;
    font-size: 7.5px; flex: none; }
  /* The activity surfaces are pure black, so the dashes need a little
     more presence there than on the widget's lighter gradient. */
  .pv-banner .pv-ghost, .pv-island-pill .pv-ghost { border-color: rgba(255,255,255,.44); }

  /* Touch: rather than inflate the mock, each region grows an invisible,
     absolutely positioned pad toward the 44 px target. */
  @media (pointer: coarse) {
    .ramp .rdot, .ramp .rmv, .ramp .rdel { width: 44px; height: 44px; }
    .pv-stage [data-slot] { position: relative; }
    .pv-stage [data-slot]::after {
      content: ""; position: absolute; inset: -11px; }
  }

  /* The flash on fields of a pressed region: color only, never reflow. */
  @keyframes aivi-flash {
    from { background: color-mix(in srgb, var(--aivi-accent) 16%, transparent); }
    to   { background: transparent; }
  }
  .field.flash { animation: aivi-flash 1.1s ease-out; border-radius: var(--aivi-r-md); }
  @media (prefers-reduced-motion: reduce) {
    .field.flash { animation: none;
      box-shadow: inset 3px 0 0 var(--aivi-accent); }
  }
`;
