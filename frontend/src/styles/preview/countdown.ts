// Styles of the Countdown widget's preview (preview/countdown.ts).

import { css } from "lit";

export const countdownPreviewStyles = css`
  .pv-canvas .pv-countdown-col, .pv-canvas .pv-countdown-row { flex: 1; min-width: 0;
    min-height: 0; display: flex; }
  .pv-canvas .pv-countdown-col { flex-direction: column; }
  .pv-canvas .pv-countdown-top { display: flex; flex: none; }
  /* A SwiftUI line is as tall as its font (1.193 of the size for the
     system face), not its text style's leading: the name 17.9 pt, the
     subtitle 15.5, the target date 14.3, and a hero scaled to fit takes
     a line scaled with it. */
  .pv-canvas .pv-countdown-name, .pv-canvas .pv-countdown-state,
  .pv-canvas .pv-countdown-meta, .pv-canvas .pv-countdown-hero { line-height: 1.193;
    flex: none; max-width: 100%; }
  /* The hero at the system font's own tracking. */
  .pv-canvas .pv-countdown-hero { letter-spacing: normal; }
  .pv-canvas .pv-countdown-meta { margin-top: 2px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  /* Medium: the text column and the chip both hang from the top; the
     chip keeps the stack's 16 pt spacing on both sides of the spacer
     between them. The hero has no top padding here. */
  .pv-canvas .pv-countdown-row { align-items: flex-start; position: relative; }
  .pv-canvas .pv-countdown-lead { flex: 1 1 0; min-width: 0; align-self: stretch; display: flex;
    flex-direction: column; align-items: flex-start; }
  .pv-canvas .pv-countdown-lead .pv-countdown-hero { margin-top: 0; }
  .pv-canvas .pv-countdown-chip-large { width: 44px; height: 44px; font-size: 22px;
    margin-left: 32px; }
  .pv-canvas .pv-ghost.pv-countdown-chip-large { font-size: 9px; }
  /* With no icon the app draws no chip and the text has the full width:
     the placeholder floats over the corner instead of taking a column. */
  .pv-canvas .pv-countdown-row.is-iconless > .pv-ghost.pv-countdown-chip-large {
    position: absolute; top: 0; right: 0; margin-left: 0; }
`;
