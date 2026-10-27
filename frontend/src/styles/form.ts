// The form primitives every field row uses: groups and rows,
// labels, captions, labeled controls, folds, segmented switches, inputs,
// the entity combobox, the template editor and its notes, swatches.

import { css } from "lit";

export const formStyles = css`
  /* Related fields sit together in a group with no divider between them;
     dividers (and more space) separate groups. A titled group names what
     its rows have in common. */
  .fgroup { display: flex; flex-direction: column; gap: var(--aivi-sp2);
    padding: var(--aivi-sp3) 0; border-bottom: 1px solid var(--aivi-line); }
  .fgroup:last-child { border-bottom: 0; }
  .fgl { font-size: var(--aivi-fs-sm); font-weight: 600; letter-spacing: .02em;
    color: var(--aivi-muted); }

  /* The row: the label at the leading edge, the control in the middle,
     the source menu at the trailing edge. The menu's column is reserved
     in every row, so controls line up down the form. */
  .field, .frow { display: grid; align-items: start;
    grid-template-columns: minmax(112px, 28%) minmax(0, 1fr) var(--aivi-src-w);
    column-gap: var(--aivi-sp3); row-gap: var(--aivi-sp1); border-radius: var(--aivi-r-md); }
  .flab { grid-column: 1; display: flex; flex-wrap: wrap; align-items: center;
    column-gap: var(--aivi-sp2); min-height: var(--aivi-ctl-h); min-width: 0; }
  .fsrc { grid-column: 3; grid-row: 1; display: flex; justify-content: flex-end;
    align-items: center; min-height: var(--aivi-ctl-h); }
  .fmain { grid-column: 2; grid-row: 1; display: flex; flex-direction: column;
    gap: var(--aivi-sp2); min-width: 0; }
  /* A field's further rows (an icon's color, then its styling). */
  /* A step below the first row and its hint, so "Icon color" reads as its
     own line and not as the hint's continuation. */
  .field > .r2 { grid-row: 2; margin-top: var(--aivi-sp3); }
  .field > .r3 { grid-row: 3; }
  .fmain > select { width: auto; align-self: flex-start; max-width: 100%; }
  /* Short values (a unit, a currency code, a number) get short inputs. */
  .fmain input.short, .fmain input[inputmode=decimal] { max-width: 11em; }
  .fmain .subrow { margin-top: 0; }
  .flabel { font-size: var(--aivi-fs-base); font-weight: 500; }
  /* On another surface too: a tag on the label, not a second hint. */
  .flab { align-content: center; }
  .ftag { flex-basis: 100%; font-size: var(--aivi-fs-xs); line-height: 1.2;
    color: var(--aivi-muted); }
  .freq { display: inline-flex; align-items: center; font-size: var(--aivi-fs-xs); font-weight: 600;
    color: var(--aivi-danger-ink); border: 1px solid var(--aivi-danger-line);
    border-radius: var(--aivi-r-pill); padding: 1px 7px; }
  .freq .icon { width: 12px; height: 12px; }
  .freq.done { color: var(--aivi-ok-ink); border-color: var(--aivi-ok-line); }
  .freq.err { background: var(--aivi-danger-tint); }
  /* Filled in, but nothing to read: the error badge's shape, in the
     warning color. */
  .freq.warn { color: var(--aivi-attn-ink); border-color: var(--aivi-attn-line);
    background: var(--aivi-attn-tint); }
  /* The caption style: under the control it explains. */
  .fhint { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); line-height: 1.5; }
  /* A set field's hint is hidden for good (it stays on the label as a
     tooltip). It does not come back on focus: text appearing above a
     control between press and release moves the control, and the click
     lands on nothing. */
  .fhint.settled { display: none; }

  /* A block: a control that needs the full width (a list of rows, the
     bar editor). Label line, its hint, then the control. */
  .field.block { grid-template-columns: minmax(0, 1fr) auto; }
  .field.block > .fsrc { grid-column: 2; }
  .field.block > .fhint { grid-column: 1 / -1; grid-row: 2; margin-top: -6px; }
  .field.block > .fmain { grid-column: 1 / -1; grid-row: 3; }

  /* An inline group: short sibling fields on one row, each a small label
     over its control. */
  .finline { display: flex; flex-wrap: wrap; gap: var(--aivi-sp3); }
  .field.mini { display: flex; flex-direction: column; gap: var(--aivi-sp1);
    flex: 0 1 150px; min-width: 0; }
  .field.mini > .k { font-size: var(--aivi-fs-sm); font-weight: 500; color: var(--aivi-muted); }

  /* The option row, for a setting inside a fold or a list row: the same
     shape as a field row, a size down. .orow adds the source menu. */
  .ctl, .orow { display: grid; align-items: start; min-width: 0;
    grid-template-columns: minmax(88px, 24%) minmax(0, 1fr);
    column-gap: var(--aivi-sp3); row-gap: var(--aivi-sp1); }
  .orow { grid-template-columns: minmax(88px, 24%) minmax(0, 1fr) auto; }
  .ctl > .k, .orow > .k { grid-column: 1; display: flex; align-items: center;
    min-height: var(--aivi-ctl-h); font-size: var(--aivi-fs-md); font-weight: 500;
    color: var(--aivi-muted); }
  .ctl > :not(.k) { grid-column: 2; min-width: 0; }
  .ctl > select, .ctl > .cfield, .ctl > .seg, .ctl > .chk { justify-self: start; }
  .ctl select { width: auto; max-width: 100%; }
  .orow > .vsrc { grid-column: 2; min-width: 0; }
  .orow > select.srcsel { grid-column: 3; margin-top: var(--aivi-sp1); }
  /* Following a source, the option row stacks: the label and the menu on
     one line, the source's control under them at the row's width. */
  .orow.stack { grid-template-columns: minmax(0, 1fr) auto; }
  .orow.stack > .vsrc { grid-column: 1 / -1; grid-row: 2; }
  .orow.stack > select.srcsel { grid-column: 2; grid-row: 1; margin-top: 0; align-self: center; }
  /* A fold under a field's row (a value's style, an icon's symbol
     styling) has no menu of its own: it takes the menu's column too, so
     the menus of its option rows line up with the form's. */
  .field > .fmain.wide { grid-column: 2 / -1; }
  /* Directly in a block (a trend's history, the bar's color), an option
     row takes the field row's columns so its control lines up with them. */
  .field.block > .fmain > .vsrc > .ctl, .field.block > .fmain > * > .ctl {
    grid-template-columns: minmax(112px, 28%) minmax(0, 1fr) var(--aivi-src-w); }
  .ctlrow { display: flex; align-items: center; gap: var(--aivi-sp2); }

  /* A narrow form (a phone, a slim window): rows stack. The label and
     the source menu share the first line; the control takes the next. */
  @container fsect (max-width: 520px) {
    .field:not(.mini), .frow { grid-template-columns: minmax(0, 1fr) auto; }
    .fsrc { grid-column: 2; }
    .fmain { grid-column: 1 / -1; grid-row: 2; }
    .field > .flab.r2, .field > .fsrc.r2 { grid-row: 3; }
    .field > .fmain.r2 { grid-row: 4; }
    .field > .fmain.r3 { grid-row: 5; }
    .field > .fmain.wide { grid-column: 1 / -1; }
    .field.block > .fmain { grid-row: 3; }
    .field.block > .fmain.r2 { grid-row: 4; }
    .ctl, .orow, .field.block > .fmain > .vsrc > .ctl,
    .field.block > .fmain > * > .ctl { grid-template-columns: minmax(0, 1fr) auto; }
    .ctl > .k, .orow > .k { min-height: 0; }
    .ctl > :not(.k) { grid-column: 1 / -1; }
    .orow > .vsrc { grid-column: 1 / -1; grid-row: 2; }
    .orow > select.srcsel { grid-column: 2; grid-row: 1; margin-top: 0; }
  }

  /* The fold treatment: an indented block on a rail, never a second
     card (no bordered box sits inside another). */
  .foldbody { border-left: 2px solid var(--aivi-line);
    padding: var(--aivi-sp1) 0 var(--aivi-sp1) var(--aivi-sp3);
    display: flex; flex-direction: column; align-items: stretch; gap: var(--aivi-sp2); }

  .seg { display: inline-flex; background: var(--aivi-field); border: 1px solid var(--aivi-line);
    border-radius: var(--aivi-r-md); padding: 2px; }
  .seg button { border: 0; background: none; border-radius: var(--aivi-r-sm); padding: var(--aivi-sp1) 11px;
    font-size: var(--aivi-fs-sm); color: var(--aivi-muted); cursor: pointer; }
  .seg button:hover { color: inherit; }
  .seg button.on { background: var(--aivi-card); color: inherit; box-shadow: 0 1px 2px rgba(0,0,0,.35);
    outline: 1px solid var(--aivi-line); }

  /* One control height: every input/select meets --aivi-ctl-h on fine
     pointers (the 44px coarse floor is below). */
  input[type=text], input[type=search], textarea, select { width: 100%; font: inherit; font-size: var(--aivi-fs-base);
    color: inherit; background: var(--aivi-input-bg); border: 1px solid var(--aivi-input-line);
    border-radius: var(--aivi-r-md); padding: var(--aivi-sp2) 11px; min-height: var(--aivi-ctl-h); }
  /* Selects drop the platform chrome for the same box as an input, with
     a chevron drawn in the current color (srcsel keeps its own). */
  select { appearance: none; -webkit-appearance: none; padding-right: 30px; cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239b9b9b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 9px center; background-size: 16px; }
  input:hover, textarea:hover, select:hover { border-color: color-mix(in srgb, var(--aivi-fg) 28%, transparent); }
  input:focus, textarea:focus, select:focus, .cbx input:focus { outline: none;
    border-color: var(--aivi-accent); box-shadow: 0 0 0 3px var(--aivi-ring); }
  textarea { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-md);
    min-height: 60px; resize: vertical; }
  /* A template box grows with its text, from three lines to ten, then
     scrolls (field-sizing where the browser has it, else
     source-editor.ts sets the height). */
  textarea.tmpl { field-sizing: content; line-height: 1.45;
    min-height: calc(3lh + 18px); max-height: calc(10lh + 18px); overflow-y: auto; }
  /* The code editor that replaces it once loaded (code-editor/theme.ts
     draws the box at the same sizes). */
  .tcode { font-size: var(--aivi-fs-md); }
  .field input.bad { border-color: var(--aivi-danger); }

  /* combobox */
  .cbx { position: relative; }
  .cbx input { padding-right: 30px; }
  .cbx .clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    border: 0; background: none; color: var(--aivi-muted); cursor: pointer;
    padding: var(--aivi-sp1) 6px; border-radius: var(--aivi-r-sm); }
  .cbx .clear .icon { width: 16px; height: 16px; }
  .cbx .clear:hover { color: inherit; }
  .cbx-pop { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px);
    background: var(--aivi-card); border: 1px solid var(--aivi-line); border-radius: var(--aivi-r-md);
    max-height: 240px; overflow: auto; box-shadow: var(--aivi-shadow-pop);
    /* A short input (inside a fold) still gets a list names fit in. */
    min-width: min(280px, calc(100vw - 32px)); }
  /* Placed by popover.ts: above the input when there is no room under
     it, from the trailing edge when the leading one would overflow. */
  .cbx-pop.up { top: auto; bottom: calc(100% + 4px); }
  .cbx-pop.end { left: auto; right: 0; }
  .cbx-pop .more { padding: var(--aivi-sp2) 11px; font-size: var(--aivi-fs-sm); color: var(--aivi-muted);
    border-top: 1px solid var(--aivi-line); }
  .cbx-pop .opt { padding: var(--aivi-sp2) 11px; font-size: var(--aivi-fs-md); cursor: pointer; display: flex;
    justify-content: space-between; gap: 10px; align-items: baseline; }
  .cbx-pop .opt .eid { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    color: var(--aivi-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cbx-pop .opt.hi { background: color-mix(in srgb, var(--aivi-accent) 16%, transparent); }
  .cbx-pop .none { padding: 10px 11px; font-size: var(--aivi-fs-md); color: var(--aivi-muted); }

  .subrow { margin-top: var(--aivi-sp2); }
  /* A field's own checkbox (a meter's reversed sign). */
  .fmain > .chk { display: flex; gap: var(--aivi-sp2); align-items: center;
    font-size: var(--aivi-fs-md); cursor: pointer; }
  .fmain > .chk input { width: auto; margin: 0; }

  /* template editor */
  .tchips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: var(--aivi-sp2); }
  .tchips .chip { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs); }
  .tchips .none { font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }

  /* The note (notice.ts): every per-field warning and error, and a
     card's or the preview's waiting line. One inline line under what it
     is about: the severity's mark, then its words, both in the
     severity's ink. Never boxed; boxes are page and section banners. */
  .tnote { display: flex; align-items: flex-start; gap: var(--aivi-sp2);
    margin-top: var(--aivi-sp2); font-size: var(--aivi-fs-sm); line-height: 1.45; }
  .tnote > .icon { width: 16px; height: 16px; flex: none; margin-top: 1px; }
  .tnote > .tnbody { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .tnote.warn { color: var(--aivi-attn-ink); }
  .tnote.error { color: var(--aivi-danger-ink); }
  .tnote b { color: inherit; font-weight: 600; }
  .tnote .k { font-weight: 600; margin-right: 6px; }
  .tnote code { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    overflow-wrap: anywhere; }
  /* Home Assistant's own message, under the plain words, behind
     Details. */
  .tnote .tdetails { margin-top: var(--aivi-sp1); }
  .tnote .tdetails > summary { width: fit-content; cursor: pointer; font-size: var(--aivi-fs-xs);
    font-weight: 500; }
  .tnote .traw { display: block; margin-top: var(--aivi-sp1); }
  .tunknown .tnbody > div + div { margin-top: var(--aivi-sp1); }
  .tfix { font: inherit; font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    color: inherit; background: transparent; cursor: pointer; padding: 1px 7px; margin: 2px var(--aivi-sp1) 0 0;
    border: 1px solid currentColor; border-radius: var(--aivi-r-sm); }
  .tfix:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
  .tfix:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--aivi-ring); }

  /* The template's result: the value in full, wrapping, then its kind. */
  .tres { margin-top: var(--aivi-sp2); font-size: var(--aivi-fs-sm); line-height: 1.45; display: flex;
    flex-wrap: wrap; align-items: baseline; gap: var(--aivi-sp1) var(--aivi-sp2); }
  .tres .k { font-weight: 600; }
  .tres .tval { font-family: ui-monospace, Menlo, monospace; font-size: var(--aivi-fs-xs);
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 9.5em; overflow-y: auto;
    padding: 1px 7px; border-radius: var(--aivi-r-sm); background: var(--aivi-input-bg);
    border: 1px solid var(--aivi-input-line); max-width: 100%; }
  .tres .tkind { color: var(--aivi-muted); }
  /* Feedback for text the box no longer holds, until the next answer. */
  .tfb.stale { opacity: .55; transition: opacity .15s; }

  /* per-field style disclosure. Child combinators throughout, so a nested
     fold's summary never inherits an ancestor fold's chrome. */
  details.style { margin-top: 0; }
  details.style > summary { list-style: none; cursor: pointer; display: inline-flex;
    align-items: center; gap: 6px; font-size: var(--aivi-fs-sm); color: var(--aivi-muted); }
  details.style > summary::-webkit-details-marker { display: none; }
  details.style > summary .tri { transition: transform .15s; }
  details.style[open] > summary .tri { transform: rotate(90deg); }
  details.style > .body { margin-top: var(--aivi-sp2); }

  /* Disclosure chevrons: rotated by the [open] transforms above. */
  .tri { display: inline-flex; }
  .tri .icon { width: 16px; height: 16px; }

  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  /* Every dot carries a 1px hairline ring mixed from the theme's text
     color: dark grays on a dark card and bright hues on a light card fall
     under the 3:1 non-text minimum (WCAG 1.4.11) on their own. The ring
     measures >=3.6:1 against the card in both themes. Selected dots swap
     it for their 2px text-color border. */
  .sw { width: 21px; height: 21px; border-radius: var(--aivi-r-sm); border: 2px solid transparent;
    cursor: pointer; padding: 0; position: relative;
    box-shadow: 0 0 0 1px var(--aivi-mark-ring); }
  .sw.sel { border-color: var(--aivi-fg); box-shadow: 0 0 0 1.5px var(--aivi-card) inset; }
`;
