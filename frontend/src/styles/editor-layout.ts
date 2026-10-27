// The editor's layout: the form, a column of section cards, beside the
// sticky side column that holds the preview.

import { css } from "lit";

export const editorLayoutStyles = css`
  /* The side column holds a Medium widget (338 pt) at close to its size. */
  .editor { display: grid; grid-template-columns: minmax(0, 1fr) 372px;
    gap: var(--aivi-sp4); align-items: start; }
  /* The form is a column of section cards (the kit's top level): what the
     widget shows, how it looks, how it behaves. The section title is the
     strongest text in the form after the page title. */
  .form { display: flex; flex-direction: column; gap: var(--aivi-sp3); }
  .form > .banner { margin-bottom: 0; }
  .fsect { background: var(--aivi-card); border: 1px solid var(--aivi-card-line);
    border-radius: var(--aivi-radius); box-shadow: var(--aivi-shadow);
    padding: var(--aivi-sp4) var(--aivi-sp4) var(--aivi-sp1);
    container: fsect / inline-size; }
  .fsecth { margin: 0; font-size: var(--aivi-fs-lg); font-weight: 600;
    letter-spacing: -.01em; }
  .formcol { min-width: 0; }
  /* Sticky under the editor's bar, with a height bound and its own
     scroll, so an expanded payload is reachable on short viewports. */
  .side { position: sticky; top: 72px; max-height: calc(100dvh - 86px); overflow: auto;
    overscroll-behavior: contain; }
  .sidebody { display: flex; flex-direction: column; gap: var(--aivi-sp3); }
  .pvtoggle { display: none; }
`;
