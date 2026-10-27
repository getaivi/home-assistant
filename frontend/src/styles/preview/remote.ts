// Styles of the Remote widget's preview (preview/remote.ts). The header,
// the picture and the reading are the showcase's (styles/preview/showcase.ts),
// a marked button the switchboard's tile.

import { css } from "lit";

export const remotePreviewStyles = css`
  /* Small: the reading under the name, 2 pt down, and the picture beside
     it taking the spare height, 36 to 66 pt wide, a group's 6 pt apart. */
  .pv-canvas .pv-remote-zone { flex: 1 1 0; min-height: 0; display: flex; gap: 6px;
    align-items: flex-start; margin-top: 2px; }
  .pv-canvas .pv-remote-zone > .pv-showcase-hero, .pv-canvas .pv-remote-zone > .pv-ghost {
    flex: none; max-width: 100%; }
  .pv-canvas .pv-remote-slot { flex: 0 1 66px; min-width: 36px; margin-left: auto;
    align-self: stretch; display: flex; }

  /* Medium: the header, then the picture bottom-leading (up to 150 pt)
     and the reading bottom-trailing, 16 pt apart, over the buttons. */
  .pv-canvas .pv-remote-top { flex: 1 1 0; min-height: 0; display: flex;
    flex-direction: column; }
  .pv-canvas .pv-remote-bottom { flex: 1 1 0; min-height: 0; display: flex;
    align-items: flex-end; gap: 16px; margin-top: 2px; }
  .pv-canvas .pv-remote-bottom .pv-showcase-slot { max-width: 150px; }
  .pv-canvas .pv-remote-bottom > .pv-showcase-hero { flex: none; margin-left: auto; }

  /* A photo: Small's fills the widget, its scrim's foot rising from a
     fifth of the way down; Medium's bleeds from the top and leading edges
     across 44 % of the width, down to the buttons, its one inner corner
     rounded, the header and the reading 14 pt beside it. */
  .pv-canvas .pv-showcase-photo.is-fill.is-remote::after { content: ""; position: absolute;
    inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 20%,
      rgba(0,0,0,.75) 60%, rgba(0,0,0,.85) 100%); }
  .pv-canvas .pv-remote-onphoto { position: absolute; top: 14px; left: 14px; right: 14px;
    bottom: 58px; display: flex; flex-direction: column; color: #fff;
    text-shadow: 0 1px 4px rgba(0,0,0,.45); }
  .pv-canvas .pv-remote-beside { position: relative; flex: 1 1 0; min-height: 0;
    display: flex; flex-direction: column; padding-left: 147px; }
  .pv-canvas .pv-showcase-photo.is-bled { top: -16px; left: -16px; bottom: 0; width: 149px;
    border-bottom-right-radius: 14px; }
  .pv-canvas .pv-remote-beside > .pv-showcase-hero { flex: none; }

  /* The buttons: one row along the bottom margin sharing its width, 6 pt
     apart, over a group's 6 pt in Small and a picture gap (12 pt) in
     Medium; 36 pt tall in Small, 40 in Medium, 50 as tiles (6 pt down). */
  .pv-canvas .pv-remote-buttons { flex: none; display: flex; gap: 6px; height: 36px;
    margin-top: 6px; position: relative; }
  .pv-canvas .pv-remote-buttons.is-medium { height: 40px; margin-top: 12px; }
  .pv-canvas .pv-remote-buttons.is-marked { height: 50px; }
  .pv-canvas .pv-remote-buttons > * { flex: 1 1 0; min-width: 0; }
  .pv-canvas .pv-remote-button { border-radius: 14px; display: grid; place-items: center;
    font-size: 16px; font-weight: 600; line-height: 1; }
`;
