// Events (aivi-events): what the phone sends back, behind the bar's
// pulse, and the panel that lists it.

import { css } from "lit";

export const eventsStyles = css`
  /* The button shows the stream's state as a dot (the worst of the
     accounts') and blinks once when an event lands. */
  aivi-events { flex: none; }
  .evbtn { position: relative; }
  .evdot { position: absolute; top: 9px; right: 8px; width: 8px; height: 8px;
    border-radius: 50%; background: var(--aivi-ok); box-shadow: 0 0 0 2px var(--aivi-bg); }
  .evbtn.warn .evdot { background: var(--aivi-attn); }
  .evbtn.bad .evdot { background: var(--aivi-danger); }
  /* Not listening: a hollow dot, a state and not an alarm. */
  .evbtn.idle .evdot, .evstream.idle .dot { background: var(--aivi-bg);
    border: 1.5px solid var(--aivi-muted); box-sizing: border-box; }
  .evstream.idle .dot { background: transparent; }
  .evstreams:last-child { border-bottom: 0; }
  .evbtn.ping .evdot::after { content: ""; position: absolute; inset: 0; border-radius: 50%;
    background: inherit; animation: aivi-ping 1.2s ease-out; }
  .evbtn.ping > .icon { color: var(--aivi-ok-ink); transition: color .15s; }
  @keyframes aivi-ping { to { transform: scale(3.4); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .evbtn.ping .evdot::after { animation: none; } }
  /* The panel: how each account's stream stands, then the feed. It hangs
     from the bar's trailing edge whichever button opened it, so it never
     leaves a phone's screen. */
  .topbar { position: relative; }
  .evwrap { position: static; }
  dialog.evpop { position: absolute; top: calc(100% - var(--aivi-sp1)); right: 0; left: auto;
    margin: 0; z-index: 30; width: min(400px, 100%); padding: 0;
    max-height: min(560px, calc(100vh - 96px)); overflow: hidden;
    background: var(--aivi-card); color: var(--aivi-fg);
    border: 1px solid var(--aivi-card-line); border-radius: var(--aivi-r-lg);
    box-shadow: var(--aivi-shadow-dlg); }
  dialog.evpop[open] { display: flex; flex-direction: column; }
  dialog.evpop:focus, dialog.evpop:focus-visible { outline: none; }
  dialog.evpop h3 { margin: 0; padding: var(--aivi-sp3) var(--aivi-sp4) 0;
    font-size: var(--aivi-fs-sm); font-weight: 500; color: var(--aivi-muted); line-height: 20px; }
  .evstreams { list-style: none; margin: 0; padding: var(--aivi-sp1) var(--aivi-sp4) var(--aivi-sp3);
    border-bottom: 1px solid var(--aivi-line); flex: none; }
  .evstream { display: grid; grid-template-columns: 8px minmax(0, 1fr); column-gap: 10px;
    align-items: center; padding: 6px 0; font-size: var(--aivi-fs-base); line-height: 20px; }
  .evstream .dot { width: 8px; height: 8px; background: var(--aivi-ok); }
  .evstream.warn .dot { background: var(--aivi-attn); }
  .evstream.bad .dot { background: var(--aivi-danger); }
  .evstream .evs { font-weight: 500; }
  .evstream .evs b { font-weight: 600; }
  .evstream .evd { grid-column: 2; font-size: var(--aivi-fs-sm); color: var(--aivi-muted);
    overflow-wrap: anywhere; }
  .evstream.warn .evd { color: var(--aivi-attn-ink); }
  .evstream.bad .evd { color: var(--aivi-danger-ink); }
  /* The feed: activity rows (styles/activity.ts) that scroll inside the
     panel, inset like the rest of it (over ul.alist's bare list). */
  dialog.evpop .evlist { padding: 0 var(--aivi-sp4); overflow: auto; overscroll-behavior: contain;
    flex: 1; min-height: 0; }
  .evempty { padding: var(--aivi-sp6) var(--aivi-sp4); text-align: center;
    color: var(--aivi-muted); font-size: var(--aivi-fs-md); line-height: 1.5; }
  /* The way on to the rest of the events, on the Log page. */
  .evfoot { flex: none; padding: 10px var(--aivi-sp4); border-top: 1px solid var(--aivi-line);
    font-size: var(--aivi-fs-sm); line-height: 1.45; }
`;
