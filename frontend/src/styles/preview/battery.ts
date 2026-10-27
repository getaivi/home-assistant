// Styles of the Battery widget's preview (preview/battery.ts).

import { css } from "lit";

export const batteryPreviewStyles = css`
  /* Small: two rows sharing the height, 10 pt apart, each a centered pair
     of rings 18 pt apart. */
  .pv-canvas .pv-battery-grid { flex: 1; display: flex; flex-direction: column; gap: 10px;
    min-height: 0; }
  .pv-canvas .pv-battery-row { flex: 1 1 0; min-height: 0; display: flex; align-items: center;
    justify-content: center; gap: 18px; }
  /* The ring's frame is 50 pt; its line is centered on the frame's edge
     and the charging bolt rides the top of it, so both overhang. */
  .pv-canvas .pv-battery-ring { position: relative; width: 50px; height: 50px; flex: none; }
  .pv-canvas .pv-battery-ring svg { display: block; overflow: visible; }
  /* The device's symbol: 38 % of the ring's size, medium. */
  .pv-canvas .pv-battery-glyph { position: absolute; inset: 0; display: grid; place-items: center;
    font-size: 19px; font-weight: 500; }
  /* An empty slot's ring, its line inside the frame. */
  .pv-canvas .pv-battery-placeholder { box-sizing: border-box; width: 50px; height: 50px;
    flex: none; border-radius: 50%; }
  /* Medium: the percent 10 pt under its ring, subheadline (15/20) in
     primary. */
  .pv-canvas .pv-battery-cols .pv-col { gap: 10px; }
  .pv-canvas .pv-battery-percent { font-size: 15px; line-height: 20px; color: #fff; }
`;
