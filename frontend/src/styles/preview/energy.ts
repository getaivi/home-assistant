// Styles of the Energy widget's preview (preview/energy.ts).

import { css } from "lit";

export const energyPreviewStyles = css`
  /* Small's text lines are as tall as the system face sets them (ascent
     plus descent, 1.193 em), 2 pt apart: SwiftUI stacks the name, the
     hero and today's line with no leading of their own. */
  .pv-canvas .pv-energy-line { line-height: 1.193; }
  .pv-canvas .pv-hero.pv-energy-line { margin-top: 2px; letter-spacing: 0; }
  /* Medium columns: the 32 pt chip (its glyph 16), the power and the
     caption, 6 pt apart. A line keeps its full height when its text
     scales down, so the columns stay level. */
  .pv-canvas .pv-energy-col { gap: 6px; }
  .pv-canvas .pv-energy-chip { width: 32px; height: 32px; font-size: 16px; }
  .pv-canvas .pv-energy-value { font-weight: 600; line-height: 17.9px; }
  .pv-canvas .pv-energy-caption { line-height: 14.3px; }
`;
