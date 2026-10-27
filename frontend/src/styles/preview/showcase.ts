// Styles of the Showcase widget's preview (preview/showcase.ts).

import { css } from "lit";

export const showcasePreviewStyles = css`
  /* The header: the name leading (subheadline semibold in Small,
     headline in Medium), then the report time and the badge trailing,
     on the name's baseline. */
  .pv-canvas .pv-showcase-head { flex: none; display: flex; align-items: baseline; gap: 6px;
    min-width: 0; }
  .pv-canvas .pv-showcase-name { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 600;
    line-height: 1.193; color: #fff; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .pv-canvas .pv-showcase-name.is-headline { font-size: 17px; }
  .pv-canvas .pv-showcase-meta { flex: none; display: inline-flex; align-items: center; gap: 3px;
    font-size: 12px; font-weight: 500; line-height: 1.193; color: rgba(235,235,245,.6);
    white-space: nowrap; }
  .pv-canvas .pv-showcase-clock { font-size: 9px; display: inline-flex; }
  .pv-canvas .pv-showcase-badge { flex: none; width: 20px; height: 20px; object-fit: contain;
    align-self: center; }
  /* Small's state mark: its glyph, else its word, else a 7 pt dot. */
  .pv-canvas .pv-showcase-glyph { flex: none; font-size: 13px; font-weight: 600;
    line-height: 1.193; white-space: nowrap; }
  .pv-canvas .pv-showcase-glyph.is-dot { width: 7px; height: 7px; border-radius: 50%;
    background: currentColor; align-self: center; }
  .pv-canvas .pv-showcase-head .pv-ghost.pv-showcase-ghost { flex: none; margin-top: 0;
    align-self: center; }

  /* The state mark under the name: footnote semibold, its symbol and
     word 4 pt apart, 2 pt under the name. */
  .pv-canvas .pv-showcase-state { flex: none; display: flex; align-items: center; gap: 4px;
    margin-top: 2px; min-width: 0; font-size: 13px; font-weight: 600; line-height: 1.193;
    white-space: nowrap; overflow: hidden; }
  .pv-canvas .pv-showcase-state-icon { flex: none; display: inline-flex; }
  .pv-canvas .pv-showcase-state-word { min-width: 0; overflow: hidden; text-overflow: ellipsis; }

  /* Small: the picture's zone takes the spare height between the header
     and the reading, a group's 6 pt either side. */
  .pv-canvas .pv-showcase-zone { flex: 1 1 0; min-height: 0; display: flex; margin: 6px 0;
    align-items: stretch; justify-content: center; }
  .pv-canvas .pv-showcase-lead { flex: none; display: flex; align-items: baseline; gap: 5px;
    min-width: 0; }
  .pv-canvas .pv-showcase-lead.is-stacked { flex-direction: column; align-items: flex-start;
    gap: 0; }
  .pv-canvas .pv-showcase-hero { flex: none; line-height: 1.193; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .pv-canvas .pv-showcase-caption { min-width: 0; font-size: 13px; line-height: 1.193;
    color: rgba(235,235,245,.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* A cut-out fitted in its slot, standing on a soft contact shadow; the
     icon standing in sits on the slot's bottom edge. */
  .pv-canvas .pv-showcase-cutout { position: relative; flex: 1 1 auto; min-width: 0;
    min-height: 0; display: flex; align-items: flex-end; justify-content: center; }
  .pv-canvas .pv-showcase-cutout .pv-showcase-img { display: block; max-width: 100%;
    max-height: 100%; object-fit: contain; position: relative; z-index: 1; }
  .pv-canvas .pv-showcase-shadow { position: absolute; left: 26px; right: 26px; bottom: -1px;
    height: 5px; border-radius: 50%; background: rgba(0,0,0,.1); filter: blur(3px); }
  .pv-canvas .pv-showcase-cutout.is-icon { line-height: 1; }
  .pv-canvas .pv-showcase-cutout.is-ghost { flex: 1 1 auto; margin-top: 0; }

  /* Medium: the picture bottom-leading, up to 150 pt wide, and the rows
     trailing, the last one's line on the bottom margin; a picture gap
     (12 pt) over both. */
  .pv-canvas .pv-showcase-bottom { flex: 1 1 0; min-height: 0; display: flex;
    align-items: flex-end; gap: 16px; margin-top: 12px; }
  .pv-canvas .pv-showcase-slot { flex: 1 1 auto; align-self: stretch; display: flex;
    min-width: 0; }
  .pv-canvas .pv-showcase-slot .pv-showcase-cutout { justify-content: flex-start; }
  .pv-canvas .pv-showcase-rows { flex: none; display: grid; grid-template-columns: auto auto;
    column-gap: 5px; row-gap: 3px; align-items: baseline; min-width: 0; max-width: 100%; }
  .pv-canvas .pv-showcase-row { display: contents; }
  .pv-canvas .pv-showcase-label { min-width: 0; font-size: 15px; line-height: 1.193;
    color: rgba(235,235,245,.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pv-canvas .pv-showcase-value { justify-self: end; font-size: 17px; font-weight: 600;
    line-height: 1.193; white-space: nowrap; }
  .pv-canvas .pv-showcase-value .pv-showcase-unit { font-size: 15px; font-weight: 400; }

  /* A photo: Small fills the widget, Medium bleeds across its leading
     44 %. The text is laid on it 14 pt in, white, over a scrim. */
  .pv-canvas .pv-showcase-photo { position: absolute; top: 0; bottom: 0; left: 0;
    overflow: hidden; background: rgba(142,142,147,.35); }
  .pv-canvas .pv-showcase-photo.is-fill { right: 0; }
  .pv-canvas .pv-showcase-photo.is-side { width: 44%; }
  .pv-canvas .pv-showcase-photo .pv-showcase-img { width: 100%; height: 100%; object-fit: cover;
    display: block; }
  .pv-canvas .pv-showcase-photo.is-fill::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 30%,
      rgba(0,0,0,0) 40%, rgba(0,0,0,.75) 80%, rgba(0,0,0,.85) 100%); }
  .pv-canvas .pv-showcase-onphoto { position: absolute; inset: 14px; display: flex;
    flex-direction: column; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.45); }
  .pv-canvas .pv-showcase-onphoto .pv-showcase-state { color: #fff; }
  .pv-canvas .pv-showcase-beside { position: absolute; top: 16px; bottom: 16px; right: 16px;
    left: calc(44% + 14px); display: flex; flex-direction: column; min-width: 0; }
  /* Beside a photo the rows span the column, 11 pt between a label and
     its value; the label keeps 40 % of the row before it truncates. */
  .pv-canvas .pv-showcase-beside .pv-showcase-rows { width: 100%;
    grid-template-columns: minmax(min(40%, max-content), 1fr) minmax(0, auto);
    column-gap: 11px; }
  .pv-canvas .pv-showcase-beside .pv-showcase-value { overflow: hidden;
    text-overflow: ellipsis; max-width: 100%; }
`;
