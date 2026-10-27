// Styles of the Switchboard widget's preview (preview/switchboard.ts).

import { css } from "lit";

export const switchboardPreviewStyles = css`
  /* The grid: two columns, 6 pt gutters both ways, filling the canvas
     inside its 16 pt margins. Two rows on small, three on medium. The
     mock's hairline border is the card's, not the widget's: the grid
     takes its point back, so a tile is the device's 60 × 60 (small) or
     150 × 38 (medium). */
  .pv-canvas .pv-switchboard-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr; gap: 6px; min-height: 0; }
  .pv-canvas .pv-switchboard-grid.is-three-rows { grid-template-rows: repeat(3, 1fr); }
  /* A tile: 14 pt continuous corners. Stacked (small): the orb over the
     label, 4 pt apart and centered, 4 pt in from the sides. Text is
     primary unless the renderer inks it for a fill. */
  .pv-canvas .pv-switchboard-tile { border-radius: 14px; padding: 0 4px; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    min-width: 0; min-height: 0; color: #fff; }
  .pv-canvas .pv-switchboard-tile.is-off { color: #fff; }
  /* An empty slot: the plate at 40 %, as the app draws its placeholder. */
  .pv-canvas .pv-switchboard-tile.is-empty { opacity: .4; }
  /* Row (medium): the orb leading, 8 pt from the label over the second
     line, 9 pt in from the sides. */
  .pv-canvas .pv-switchboard-tile.is-row { flex-direction: row;
    justify-content: flex-start; gap: 8px; padding: 0 9px; }
  /* The orb: the renderer sets its diameter, glyph size, paint and, on a
     lit tile, its shadow. */
  .pv-canvas .pv-switchboard-orb { border-radius: 50%; flex: none; display: grid;
    place-items: center; font-weight: 600; color: #fff; box-shadow: none;
    position: relative; }
  /* A gradient orb's sheen: a soft highlight up and left, over the mark. */
  .pv-canvas .pv-switchboard-sheen { position: absolute; inset: 0; border-radius: 50%; }
  /* The preview does not load a tile's picture: it draws the fallback
     mark with a dashed outline. */
  .pv-canvas .pv-switchboard-orb.has-picture { outline: 1.5px dashed rgba(255,255,255,.6);
    outline-offset: 1px; }
  /* The label: one line, as tall as its font (a single line of SwiftUI
     text takes the font's own height, 1.19 of its size, not the text
     style's leading). Stacked, caption2 (11) semibold, centered, following
     the size the renderer shrinks a long one to. Row, footnote (13)
     semibold. */
  .pv-canvas .pv-switchboard-label { font-size: 11px; font-weight: 600; line-height: 1.19;
    max-width: 100%; text-align: center; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .pv-canvas .pv-switchboard-tile.is-row .pv-switchboard-label { font-size: 13px;
    line-height: 1.19; text-align: left; }
  /* The text beside a row tile's orb: the label and the second line with
     nothing between them. */
  .pv-canvas .pv-switchboard-text { display: flex; flex-direction: column; min-width: 0;
    flex: 1 1 auto; }
  /* The second line: caption2 (11) regular, one line, in the color the
     renderer gives it. */
  .pv-canvas .pv-switchboard-second,
  .pv-canvas .pv-switchboard-tile.is-row .pv-switchboard-second { font-size: 11px;
    font-weight: 400; line-height: 1.19; opacity: 1; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
`;
