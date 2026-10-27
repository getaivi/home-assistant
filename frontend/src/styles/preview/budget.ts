// Styles of the Budget widget's preview (preview/budget.ts).

import { css } from "lit";

export const budgetPreviewStyles = css`
  /* Every line is as tall as the system font sets it (1.193 of its size:
     a 15 pt name is 17.9 pt, a 12 pt caption 14.3 pt), which is what the
     app's stacks add their gaps to. */
  .pv-canvas .pv-budget-name { line-height: 1.193; padding-bottom: 8px; flex: none; }
  /* The total: the 29 pt ring 8 pt from the hero, centered on each
     other. The hero carries no tracking of its own and scales to the
     width left beside the ring. */
  .pv-canvas .pv-budget-total { display: flex; align-items: center; gap: 8px; min-width: 0;
    flex: none; }
  .pv-canvas .pv-budget-hero { flex: 0 1 auto; min-width: 0; margin-top: 0; line-height: 1.193;
    letter-spacing: 0; }
  /* The meta line, 8 pt under the total: "of $1,500", a dot and the
     subtitle 4 pt apart, centered on each other. The subtitle is a
     caption2 (11, regular). */
  .pv-canvas .pv-budget-meta { display: flex; align-items: center; gap: 4px; margin-top: 8px;
    min-width: 0; flex: none; line-height: 1.193; white-space: nowrap; }
  .pv-canvas .pv-budget-meta > span { flex: 0 1 auto; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; }
  .pv-canvas .pv-budget-subtitle { font-size: 11px; font-weight: 400; }
  /* What the line drops when the pair does not fit: the budget first,
     and the subtitle only when it does not fit alone either. */
  .pv-canvas .pv-budget-meta[data-fit="subtitle"] > :is(.pv-budget-of, .pv-budget-dot),
  .pv-canvas .pv-budget-meta[data-fit="budget"] > :is(.pv-budget-dot, .pv-budget-subtitle) {
    display: none; }
  /* Small: at least 8 pt between the meta line and the legends. */
  .pv-canvas .pv-budget-gap { min-height: 8px; }
  /* The legends: equal shares of the width 12 pt apart, a caption (12)
     label 3 pt over a caption medium amount. */
  .pv-canvas .pv-budget-legends { display: flex; align-items: flex-start; gap: 12px; flex: none; }
  .pv-canvas .pv-budget-legend { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
    gap: 3px; }
  .pv-canvas .pv-budget-legend .pv-budget-label,
  .pv-canvas .pv-budget-legend .pv-budget-amount { font-size: 12px; line-height: 1.193; }
  .pv-canvas .pv-budget-legend .pv-budget-amount { font-weight: 500; }
  /* Medium: the total takes what the rows leave, and the rows take what
     they say, up to an even share of the width less the 16 pt between
     the two (145 pt). */
  .pv-canvas .pv-budget-split { align-items: flex-start; }
  .pv-canvas .pv-budget-lead { flex: 1 1 0; max-width: none; align-self: stretch; }
  .pv-canvas .pv-budget-rows { flex: none; max-width: 145px; display: flex; flex-direction: column;
    gap: 14px; }
  .pv-canvas .pv-budget-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pv-canvas .pv-budget-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pv-canvas .pv-budget-label, .pv-canvas .pv-budget-amount { white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; }
  .pv-canvas .pv-budget-row .pv-budget-label { font-size: 13px; line-height: 1.193; }
  .pv-canvas .pv-budget-row .pv-budget-amount { font-size: 12px; line-height: 1.193;
    color: rgba(235,235,245,.6); }
`;
