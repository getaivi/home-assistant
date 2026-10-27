// Styles of the Trend widget's preview (preview/trend.ts).

import { css } from "lit";

export const trendPreviewStyles = css`
  /* Small: one leading column filling the canvas. */
  .pv-canvas .pv-trend { flex: 1; min-width: 0; min-height: 0; display: flex;
    flex-direction: column; }
  /* The app's text lines are as tall as their font (SF: 1.193 em), not the
     text style's leading; the values below are fitted to the app's own
     renders, to a third of a point: the name's line is 19 pt, the reading
     follows it directly with 1.5 pt more under its baseline than the font
     gives it, the state 2 pt under that. The chart's height is what they
     leave. SF sets its own tracking. */
  .pv-canvas .pv-trend .pv-name, .pv-canvas .pv-trend .pv-state { flex: none; }
  .pv-canvas .pv-trend .pv-name { line-height: 19px; }
  .pv-canvas .pv-trend .pv-state { line-height: 1.193; }
  .pv-canvas .pv-trend .pv-hero { flex: none; line-height: 1.193; letter-spacing: 0;
    margin-top: 0; padding-bottom: 1.5px; }
  /* The band along the bottom: what the text leaves under a 4 pt gap,
     the sparkline bottom-aligned in it at 56 pt tall at most and half
     strength (line, area and dot alike). */
  .pv-canvas .pv-trend .pv-trend-chart { flex: 1 1 0; min-height: 0; margin-top: 4px; display: flex;
    align-items: flex-end; }
  .pv-canvas .pv-trend .pv-trend-spark { position: relative; flex: 1; min-width: 0; height: 100%;
    max-height: 56px; opacity: .5; }
  /* Medium: a row. The text column is as wide as what it says, up to its
     even share of the row (half of what the 16 pt gap leaves); the chart
     takes the rest, 6 pt in from top and bottom, at full strength and
     full height. */
  .pv-canvas .pv-split.pv-trend { flex-direction: row; }
  .pv-canvas .pv-split.pv-trend .pv-lead { flex: none; max-width: calc((100% - 16px) / 2); }
  .pv-canvas .pv-split.pv-trend .pv-trend-chart { margin: 6px 0; align-items: stretch;
    min-width: 0; }
  .pv-canvas .pv-split.pv-trend .pv-trend-spark { max-height: none; opacity: 1; }
  /* The sparkline's layers: the area over the whole box (its gradient runs
     the box's height), the line and its end dot in the box the 3 pt insets
     leave (round caps, joins and the dot overhang into them). */
  .pv-canvas .pv-trend-area { position: absolute; inset: 0; }
  .pv-canvas .pv-trend-line { position: absolute; inset: 3px; }
  .pv-canvas .pv-trend-line svg { display: block; overflow: visible; }
  /* No points yet: the placeholder stands where the sparkline would, at
     full strength. */
  .pv-canvas .pv-trend .pv-ghost.pv-trend-spark { margin-top: 0; opacity: 1; }
`;
