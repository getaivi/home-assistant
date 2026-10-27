// Shared primitives: theme tokens, the form kit's scales, focus and the
// component hosts.

import { css, unsafeCSS } from "lit";
import { ACCENT } from "../const";

export const baseStyles = css`
  :host {
    display: block; min-height: 100%;
    /* The theme's surfaces and inks. The fallbacks are Home Assistant's
       own default dark theme, so a themeless install (and the dev
       harness) looks like production: neutral grays, no tint. */
    --aivi-bg: var(--primary-background-color, #111111);
    --aivi-fg: var(--primary-text-color, #e1e1e1);
    background: var(--aivi-bg);
    color: var(--aivi-fg);
    font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
    --aivi-card: var(--ha-card-background, var(--card-background-color, #1c1c1c));
    --aivi-line: var(--divider-color, rgba(225, 225, 225, .12));
    /* Card chrome reads the --ha-card-* theme tokens. */
    --aivi-card-line: var(--ha-card-border-color, var(--aivi-line));
    --aivi-radius: var(--ha-card-border-radius, 12px);
    --aivi-shadow: var(--ha-card-box-shadow, none);
    --aivi-muted: var(--secondary-text-color, #9b9b9b);
    --aivi-field: var(--secondary-background-color, #202020);
    /* A secondary surface: muted fills (secondary buttons, badges, the
       asked side of a chat) sit on the text color at low alpha, so they
       read on any card color, light or dark. The hover step is one notch
       stronger; the ghost fill is the hover step alone. */
    --aivi-surface-2: color-mix(in srgb, var(--aivi-fg) 7%, transparent);
    --aivi-surface-3: color-mix(in srgb, var(--aivi-fg) 11%, transparent);
    /* Inputs: a faint fill on the card (not a solid box), a hairline
       border, and a soft 3px ring on focus. */
    --aivi-input-bg: color-mix(in srgb, var(--aivi-fg) 3%, transparent);
    --aivi-input-line: color-mix(in srgb, var(--aivi-fg) 16%, transparent);
    --aivi-ring: color-mix(in srgb, var(--aivi-accent) 28%, transparent);
    /* The chrome accent is the user's theme accent; the brand blue is only
       the themeless fallback. The fill variant darkens the accent until
       white button text clears 4.5:1 (72% toward black takes HA's default
       #03a9f4 to 4.8:1 and the brand fallback to 5.9:1). */
    --aivi-accent: var(--primary-color, ${unsafeCSS(ACCENT)});
    --aivi-accent-fill: color-mix(in srgb, var(--aivi-accent) 72%, #000);
    /* Status hues follow the theme's semantic colors; the fallbacks are
       what the ink contrast figures below were measured against. */
    --aivi-ok: var(--success-color, #2e9e5b);
    --aivi-attn: var(--warning-color, #cf9016);
    --aivi-danger: var(--error-color, #e5484d);
    /* The form kit. Every editor rule consumes these primitives:
       - One spacing scale: 4/8/12/16/24 (--aivi-sp1..sp6).
       - Sections (.fsect) hold groups (.fgroup) of rows (.field): the
         label at the leading edge, the control in the middle, the source
         menu at the trailing edge. Rows stack in a narrow form.
       - One option row for a setting in a fold or a list row: .ctl > .k
         (.orow adds a source menu); .ctlrow clusters controls.
       - One fold treatment: disclosure content sits on .foldbody, an
         indented block on a rail.
       - One caption/help style: .fhint, under the control it explains.
       - One control height: --aivi-ctl-h on fine pointers, 44px coarse.
       Measured on the card (harness themes, dark/light): muted text
       5.57/4.73:1, danger ink 5.90/5.61:1, warn ink 6.58/5.18:1, and
       ≥4.69:1 on HA's default themes, all over the 4.5:1 AA floor. */
    --aivi-sp1: 4px;
    --aivi-sp2: 8px;
    --aivi-sp3: 12px;
    --aivi-sp4: 16px;
    --aivi-sp6: 24px;
    --aivi-ctl-h: 36px;
    /* The width every row reserves for its source menu. */
    --aivi-src-w: 104px;
    /* One type scale and one radius scale for the panel's chrome (the
       iOS preview mocks keep their own point sizes): captions and badges
       are xs/sm, body text md, controls and field labels base, section
       titles lg, the page title "title". Controls are r-md, cards and
       folds r-lg, small marks r-sm. */
    --aivi-fs-xs: 11px;
    --aivi-fs-sm: 12px;
    --aivi-fs-md: 13px;
    --aivi-fs-base: 14px;
    --aivi-fs-lg: 16px;
    --aivi-fs-title: 20px;
    --aivi-r-sm: 6px;
    --aivi-r-md: 9px;
    --aivi-r-lg: 12px;
    --aivi-r-pill: 999px;
    /* Status inks: the raw status hues fail 4.5:1 as text in at least one
       theme, so text uses each hue mixed toward the theme's own text
       color, which adapts to light/dark (measured: green 6.5/5.2, amber
       8.0/4.8, red 5.6/5.9 dark/light). Non-text dots, borders and
       tints keep the raw hues. */
    --aivi-ok-ink: color-mix(in srgb, var(--aivi-ok) 72%, var(--aivi-fg));
    --aivi-attn-ink: color-mix(in srgb, var(--aivi-attn) 66%, var(--aivi-fg));
    --aivi-danger-ink: color-mix(in srgb, var(--aivi-danger) 72%, var(--aivi-fg));
    /* Severity surfaces, one pair per status hue: the hairline and the
       tint of a banner, a badge or a status chip. A notice's severity
       picks its hue's ink, line and tint, never a mix of its own. */
    --aivi-ok-line: color-mix(in srgb, var(--aivi-ok) 45%, transparent);
    --aivi-ok-tint: color-mix(in srgb, var(--aivi-ok) 10%, transparent);
    --aivi-attn-line: color-mix(in srgb, var(--aivi-attn) 45%, transparent);
    --aivi-attn-tint: color-mix(in srgb, var(--aivi-attn) 10%, transparent);
    --aivi-danger-line: color-mix(in srgb, var(--aivi-danger) 45%, transparent);
    --aivi-danger-tint: color-mix(in srgb, var(--aivi-danger) 10%, transparent);
    /* Text on the accent fill (primary buttons, Send). */
    --aivi-on-accent: #fff;
    /* The hairline ring around a color mark (a swatch, a color field's
       dot, a band's dot): >=3.6:1 against the card in both themes, the
       WCAG 1.4.11 non-text minimum, where a dark gray on a dark card or a
       bright hue on a light one would fall under it alone. */
    --aivi-mark-ring: color-mix(in srgb, var(--aivi-fg) 55%, transparent);
    /* Elevation: a popup under its control (a list, a picker), a menu or
       dialog over the page, and a sheet rising from the bottom edge. */
    --aivi-shadow-pop: 0 12px 32px -8px rgba(0,0,0,.55);
    --aivi-shadow-dlg: 0 24px 64px -24px rgba(0,0,0,.6);
    --aivi-shadow-sheet: 0 -14px 34px -16px rgba(0,0,0,.55);
  }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }

  /* Visible keyboard focus everywhere. HA has no single focus token, so
     the accent draws the ring. Text fields use their border+shadow focus
     style below instead; :focus-visible keeps mouse clicks ring-free. */
  button:focus-visible, a:focus-visible, summary:focus-visible,
  [tabindex]:focus-visible, input[type=checkbox]:focus-visible {
    outline: none; box-shadow: 0 0 0 3px var(--aivi-ring);
  }

  /* Visually hidden, still read by screen readers (live regions). */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0;
    margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
    border: 0; }

  /* Internal component hosts (light-DOM Lit elements): layout-neutral
     wrappers or block-level class carriers. */
  aivi-hub, aivi-editor, aivi-unbind-button { display: contents; }
  aivi-field-row, aivi-entity-combobox, aivi-preview-pane,
  aivi-rows-checklist, aivi-color-ramp, aivi-code-editor { display: block; }
  aivi-color-field { display: inline-block; }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 20px 72px; }
`;
