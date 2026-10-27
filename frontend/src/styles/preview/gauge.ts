// Styles of the Gauge widget's preview (preview/gauge.ts).

import { css } from "lit";

export const gaugePreviewStyles = css`
  /* Small: the name line 10 pt over the dial, which keeps its value dot
     clear of the name. */
  .pv-canvas .pv-gauge-head { display: flex; flex: none; margin-bottom: 10px; }
  .pv-canvas .pv-gauge-area { display: grid; place-items: center; }
  /* The dial is shifted down (an offset, so it takes no room) and its
     dot rides the edge of the square: nothing of it is clipped. */
  .pv-canvas .pv-gauge-dial { position: relative; flex: none; }
  .pv-canvas .pv-gauge-dial svg { display: block; overflow: visible; }
  /* Inside the ring: the glyph, the reading and the bounds, 2 pt apart
     and centered on the dial. */
  .pv-canvas .pv-gauge-stack { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 2px; }
  .pv-canvas .pv-gauge-icon { display: flex; line-height: 1; }
  .pv-canvas .pv-gauge-stack .pv-hero { margin-top: 0; max-width: none; text-align: center;
    line-height: 1.19; letter-spacing: 0; }
  .pv-canvas .pv-gauge-bounds { font-weight: 600; line-height: 1.19; white-space: nowrap;
    color: rgba(235,235,245,.6); }
  /* Medium: the square dial, then 20 pt, then the label (title3 medium,
     secondary) on at most two lines, centered on the dial's height. */
  .pv-canvas .pv-gauge-row { flex: 1; display: flex; align-items: center; gap: 20px;
    min-width: 0; min-height: 0; }
  .pv-canvas .pv-gauge-row .pv-gauge-area { width: 126px; height: 126px; flex: none; }
  .pv-canvas .pv-gauge-label { min-width: 0; font-weight: 500; line-height: 1.25;
    color: rgba(235,235,245,.6); overflow: hidden; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
`;
