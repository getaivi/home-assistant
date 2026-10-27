// Styles of the List widget's preview (preview/list.ts).

import { css } from "lit";

export const listPreviewStyles = css`
  /* The name line: the name takes the width, the "+N" hint (caption
     12/500 tertiary) sits 6 pt after it, centered on it, 2 pt above the
     rows. The name's line is 18 pt on the device, which puts the first
     row at 36 pt. */
  .pv-canvas .pv-list-head { flex: none; display: flex; align-items: center; gap: 6px;
    padding-bottom: 2px; }
  .pv-canvas .pv-list-head .pv-name { flex: 1; min-width: 0; line-height: 18px; }
  .pv-canvas .pv-list-head .pv-meta { flex: none; line-height: 16px; white-space: nowrap; }

  /* Rows share the height left under the name equally, however many
     there are, with a hairline between them: none above the first or
     under the last. The hairline is a device pixel (a third of a point)
     of the separator color, drawn as a box so that it scales with the
     canvas where a border would round up to a whole pixel. */
  .pv-canvas .pv-list-rows { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .pv-canvas .pv-list-rows > .pv-list-row { flex: 1 1 0; min-height: 0; min-width: 0; display: grid;
    align-items: center; gap: 0 10px; border: 0; position: relative; }
  .pv-canvas .pv-list-rows > .pv-list-row + .pv-list-row { margin-top: calc(1px / 3); }
  .pv-canvas .pv-list-rows > .pv-list-row + .pv-list-row::before { content: "";
    position: absolute; left: 0; right: 0; bottom: 100%; height: calc(1px / 3);
    background: rgba(84,84,88,.6); }

  /* A row is an HStack 10 pt apart: the 20 pt icon slot (only on a row
     with an icon), the label, a spacer of 8 pt at least, the value. A
     text track takes its text's width; when label and value don't both
     fit they split what is left evenly, the shorter one staying whole,
     and the longer one truncates. */
  .pv-canvas .pv-list-rows > .pv-list-row {
    grid-template-columns: minmax(0, max-content) minmax(8px, 1fr); }
  .pv-canvas .pv-list-rows > .pv-list-row.has-icon {
    grid-template-columns: 20px minmax(0, max-content) minmax(8px, 1fr); }
  .pv-canvas .pv-list-rows > .pv-list-row.has-value {
    grid-template-columns: minmax(0, max-content) minmax(8px, 1fr) minmax(0, max-content); }
  .pv-canvas .pv-list-rows > .pv-list-row.has-icon.has-value {
    grid-template-columns: 20px minmax(0, max-content) minmax(8px, 1fr) minmax(0, max-content); }
  /* Small: icon, spacer, value; a row without a value is icon, label and
     a spacer that may close completely. */
  .pv-canvas .pv-list-rows.is-small > .pv-list-row {
    grid-template-columns: minmax(0, max-content) minmax(0, 1fr); }
  .pv-canvas .pv-list-rows.is-small > .pv-list-row.has-icon {
    grid-template-columns: 20px minmax(0, max-content) minmax(0, 1fr); }
  .pv-canvas .pv-list-rows.is-small > .pv-list-row.has-value {
    grid-template-columns: minmax(8px, 1fr) minmax(0, max-content); }
  .pv-canvas .pv-list-rows.is-small > .pv-list-row.has-icon.has-value {
    grid-template-columns: 20px minmax(8px, 1fr) minmax(0, max-content); }

  /* The symbol is footnote (13), centered in its slot. */
  .pv-canvas .pv-list-rows .pv-list-icon { grid-column: 1; width: 20px; display: grid;
    place-items: center; font-size: 13px; }
  /* Label and value are one line each, footnote (13), the value
     semibold against the trailing edge; Small sets its value at
     subheadline (15). */
  .pv-canvas .pv-list-rows .pv-list-label, .pv-canvas .pv-list-rows .pv-list-value {
    min-width: 0; font-size: 13px; line-height: 18px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .pv-canvas .pv-list-rows .pv-list-value { grid-column: -2 / -1; font-weight: 600;
    text-align: right; }
  .pv-canvas .pv-list-rows.is-small .pv-list-value { font-size: 15px; line-height: 20px; }
`;
