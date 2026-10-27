// Styles of the Prices widget's preview (preview/prices.ts).

import { css } from "lit";

export const pricesPreviewStyles = css`
  /* The text lines at the font's own line height, as the device stacks
     them (subheadline 18, the hero 1.2 of its size, footnote 15.67):
     nothing between the name and the hero, the level word 2 pt under
     it. The hero is set untracked; tightened, it is narrower than the
     app's. */
  .pv-canvas .pv-prices-name { line-height: 18px; }
  .pv-canvas .pv-prices-hero { line-height: 1.2; margin-top: 0; letter-spacing: 0; }
  .pv-canvas .pv-prices-state { line-height: 15.67px; margin-top: 2px; }
  /* Small: 4 pt of padding under the level word and a spacer of at
     least 4 pt before the strip. */
  .pv-canvas .pv-prices-gap { min-height: 8px; }
  /* The chart: the bars over a 5 pt marker row, 4 pt apart. Small pins
     it to 34 pt; Medium gives it the height less 10 pt top and bottom,
     and the width the text column leaves. */
  .pv-canvas .pv-prices-chart { display: flex; flex-direction: column; gap: 4px;
    height: 34px; flex: none; }
  .pv-canvas .pv-prices-split .pv-prices-chart { flex: 1 1 0; min-width: 0; height: auto;
    margin: 10px 0; }
  .pv-canvas .pv-prices-bars { flex: 1; min-height: 0; display: flex;
    align-items: flex-end; gap: 2px; }
  .pv-canvas .pv-prices-bars i { flex: 1 1 0; min-width: 1px; min-height: 3px;
    border-radius: 99px; }
  .pv-canvas .pv-prices-dots { flex: none; height: 5px; display: flex; gap: 2px; }
  /* The dot is centered on its bar, wider than it at Medium. */
  .pv-canvas .pv-prices-dots i { flex: 1 1 0; min-width: 1px; position: relative; }
  .pv-canvas .pv-prices-dots b { position: absolute; left: 50%; margin-left: -2.5px;
    width: 5px; height: 5px; border-radius: 50%; }
  /* The text column gets half the row (less the gap) at most. */
  .pv-canvas .pv-prices-split .pv-lead { max-width: 145px; }
`;
