// The top bar's Refresh button, and the glow on a card it found.

import { css } from "lit";

export const refreshStyles = css`
  /* Refresh asks Aivi again what the account holds. It turns while it
     asks, then shows a tick (a warning when Aivi could not be reached)
     for a moment, during which it is inert. No message is shown: the
     button itself reports the result. */
  .refreshbtn { position: relative; }
  .refreshbtn > .icon { transition: opacity .2s; }
  .refreshbtn.busy > .icon { animation: aivi-turn .6s cubic-bezier(.5, 0, .5, 1) infinite; }
  .refreshbtn[aria-disabled="true"] { cursor: default; }
  .refreshbtn[aria-disabled="true"]:hover { background: none; }
  .refreshbtn.done > .icon, .refreshbtn.failed > .icon { opacity: .45; }
  .rbadge { position: absolute; right: 6px; bottom: 6px; width: 16px; height: 16px;
    display: grid; place-items: center; border-radius: 50%; color: #fff;
    background: var(--aivi-ok); box-shadow: 0 0 0 2px var(--aivi-bg);
    transform: scale(0); opacity: 0; }
  .rbadge .icon { width: 11px; height: 11px; }
  .refreshbtn.failed .rbadge { background: var(--aivi-attn); }
  .refreshbtn.done .rbadge, .refreshbtn.failed .rbadge { opacity: 1; transform: scale(1);
    animation: aivi-pop .32s cubic-bezier(.3, 1.6, .5, 1); }
  /* The same Refresh, spelled out where an empty account says to use
     it: it turns while it asks and takes no press until it is done. */
  .rfbtn.busy > .icon { animation: aivi-turn .6s cubic-bezier(.5, 0, .5, 1) infinite; }
  .rfbtn[aria-disabled="true"] { cursor: default; }
  @keyframes aivi-turn { to { transform: rotate(360deg); } }
  @keyframes aivi-pop { from { transform: scale(0); opacity: 0; } }
  /* What the refresh found: the new card glows once. */
  .wcard.fresh { animation: aivi-fresh 1.8s ease-out; }
  @keyframes aivi-fresh {
    from { border-color: var(--aivi-ok);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--aivi-ok) 30%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .refreshbtn.busy > .icon, .rfbtn.busy > .icon { animation: none; opacity: .45; }
    .refreshbtn.done .rbadge, .refreshbtn.failed .rbadge { animation: none; }
    .wcard.fresh { animation: none; border-color: var(--aivi-ok); }
  }
`;
