// Styles of the Progress widget's preview (preview/progress.ts).

import { css } from "lit";

export const progressPreviewStyles = css`
  /* A line of text is as tall as its font on the device (1.193 of the
     size for the system font: 18 pt for the name, 43 and 48 pt for the
     heroes, 15.5 pt for the state line), not the looser text-style
     leading, and the lines stack with no gap but the ones named here. */
  .pv-canvas .pv-progress-top { display: flex; flex: none; }
  .pv-canvas .pv-name.pv-progress-name { line-height: 1.193; flex: none; }
  /* Relative, so a hero shrunk to fit is as tall as the size it lands on. */
  .pv-canvas .pv-hero.pv-progress-hero { line-height: 1.193; letter-spacing: 0; margin-top: 0;
    flex: none; }
  /* Small only: 2 pt between the name and the hero. */
  .pv-canvas .pv-hero.pv-progress-hero.is-spaced { margin-top: 2px; }
  /* The state line: 2 pt under the hero, the state word and the finish
     time 4 pt apart on one baseline, each a single line. */
  .pv-canvas .pv-progress-line { display: flex; align-items: baseline; gap: 4px; margin-top: 2px;
    min-width: 0; flex: none; }
  .pv-canvas .pv-state.pv-progress-state { margin-top: 0; line-height: 1.193; min-width: 0; }
  /* The finish time is the shorter text, so it is laid out first and the
     state word truncates before it does. */
  .pv-canvas .pv-meta.pv-progress-meta { line-height: 1.193; flex: none; white-space: nowrap; }
  /* While a timer runs the bar is the system's linear ProgressView: 4 pt
     on the system fill, and its fill has no minimum width. */
  .pv-canvas .pv-bar.is-live { height: 4px; border-radius: 2px;
    background: rgba(120,120,128,.28); }
  .pv-canvas .pv-bar.is-live i { min-width: 0; border-radius: 2px; }
  /* Medium, a simple bar: the text column takes the width the ring
     leaves, 16 pt from it, and the full height; the ring is centered. */
  .pv-canvas .pv-progress-split { flex: 1; display: flex; align-items: center; gap: 16px;
    min-width: 0; min-height: 0; }
  .pv-canvas .pv-progress-col { flex: 1 1 0; min-width: 0; align-self: stretch; display: flex;
    flex-direction: column; }
  .pv-canvas .pv-progress-ring { position: relative; width: 56px; height: 56px; flex: none;
    border-radius: 50%; }
  .pv-canvas .pv-progress-ring svg { display: block; overflow: visible; }
  /* The percent in the ring: subheadline semibold. */
  .pv-canvas .pv-progress-percent { position: absolute; inset: 0; display: grid;
    place-items: center; font-size: 15px; font-weight: 600; white-space: nowrap; }
`;
