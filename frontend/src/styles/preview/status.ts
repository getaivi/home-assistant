// Styles of the Status widget's preview (preview/status.ts).

import { css } from "lit";

export const statusPreviewStyles = css`
  /* A one-line Text is as tall as its font (SF: 1.193 of the size), so
     the name is 18 pt, the state line 15.5 and the 40 pt hero 47.7, each
     shrinking with its type when it scales to fit. */
  .pv-canvas .pv-status-name, .pv-canvas .pv-status-hero, .pv-canvas .pv-status-state {
    line-height: 1.193; }
  /* The hero is plain system type: no tracking of its own. Small sets it
     2 pt under the name; medium pins it to the bottom with no padding.
     A browser sets the system font's baseline a little lower in its line
     than the device does (1.3 pt at 40): the line is lifted by that much,
     which leaves the lines around it where they are. */
  .pv-canvas .pv-status-hero { letter-spacing: 0; margin: calc(2px - .032em) 0 .032em; }
  .pv-canvas .pv-status-col .pv-status-hero { margin-top: -.032em; }
  .pv-canvas .pv-status-box { flex: 1; min-width: 0; min-height: 0; display: flex;
    flex-direction: column; }
  .pv-canvas .pv-status-top { display: flex; flex: none; }
  /* Medium: the text column is as wide as what it says, up to 32 pt
     short of the chip, which sits top-right. */
  .pv-canvas .pv-status-row { flex-direction: row; align-items: flex-start; position: relative; }
  .pv-canvas .pv-status-col { flex: 0 1 auto; align-self: stretch; min-width: 0; margin-right: 32px;
    display: flex; flex-direction: column; }
  .pv-canvas .pv-status-row > .pv-chip, .pv-canvas .pv-status-row > .pv-ghost.is-chip {
    margin-left: auto; }
  /* With no icon the app draws no chip and the text has the full width:
     the placeholder floats over the corner instead of taking a column,
     and only the name beside it gives way. */
  .pv-canvas .pv-status-row.is-iconless > .pv-ghost.is-chip { position: absolute; top: 0; right: 0;
    font-size: 9px; }
  .pv-canvas .pv-status-row.is-iconless .pv-status-col { margin-right: 0; }
  .pv-canvas .pv-status-row.is-iconless .pv-status-name { max-width: 246px; }
`;
