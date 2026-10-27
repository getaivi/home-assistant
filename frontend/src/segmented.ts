// The segmented switch (source picker, activity template picker).
//
// ARIA: an APG radiogroup. Roving tabindex: the active segment is the
// single tab stop; arrows move and select (selection follows focus, as the
// APG prescribes for radio groups); Home/End jump to the ends.

import { html, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";

interface SegmentedOption {
  id: string;
  label: string;
}

function moveTo(
  group: HTMLElement,
  options: readonly SegmentedOption[],
  next: number,
  onChange: (id: string) => void,
  value: string,
): void {
  const target = options[next];
  if (!target) return;
  // Focus the target button before the re-render: Lit reuses the button
  // elements, so focus survives the tabindex/aria swap.
  group.querySelectorAll("button")[next]?.focus();
  if (target.id !== value) onChange(target.id);
}

export function segmented(
  options: readonly SegmentedOption[],
  value: string,
  onChange: (id: string) => void,
  label?: string,
): TemplateResult {
  const active = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const onKeydown = (e: KeyboardEvent): void => {
    const group = e.currentTarget as HTMLElement;
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active >= last ? 0 : active + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active <= 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    moveTo(group, options, next, onChange, value);
  };
  return html`<div
    class="seg"
    role="radiogroup"
    aria-label=${ifDefined(label)}
    @keydown=${onKeydown}
  >${options.map(
    (o, i) =>
      html`<button
        type="button"
        class=${o.id === value ? "on" : ""}
        role="radio"
        aria-checked=${o.id === value ? "true" : "false"}
        tabindex=${i === active ? "0" : "-1"}
        @click=${() => {
          if (o.id !== value) onChange(o.id);
        }}
      >${o.label}</button>`,
  )}</div>`;
}
