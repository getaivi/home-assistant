// Preview renderers approximating how the Aivi app renders each template
// (small and medium widget families, Live Activity banner and collapsed
// Dynamic Island). SF Symbols can't render in a browser: the closest
// Material icon stands in (symbol-icons.ts), a neutral glyph where there
// is none.
//
// Each widget template draws itself at both families' sizes in its own
// module (preview/<template>.ts); the Live Activity surfaces in
// preview/activity.ts.
//
// Pure functions of the preview payload that build a throwaway DOM tree
// (the pane memoizes on payload identity), hence `h` rather than Lit
// templates.

import { colorHex, SYSTEM_BLUE } from "./const";
import { type HChild, h } from "./dom";
import { t } from "./i18n";
import { iconColorHex } from "./preview/kit";
import { TEMPLATES } from "./preview/templates";
import type { WidgetContent } from "./types/content";

/** The widget families the preview draws. */
export type PreviewSize = "small" | "medium";

/** The canvas of each family in points (the 6.1" iPhone's). */
const CANVAS: Record<PreviewSize, { w: number; h: number }> = {
  small: { w: 158, h: 158 },
  medium: { w: 338, h: 158 },
};

/** Templates whose small family drops data the medium one shows. */
const MEDIUM_FIRST: ReadonlySet<string> = new Set([
  "energy",
  "switchboard",
  "list",
  "battery",
  "budget",
  "prices",
  "trend",
  "showcase",
  "remote",
]);

/** The size a template's preview opens at: Medium where Small would hide
 * what is being configured, else Small. */
export function defaultPreviewSize(template: string): PreviewSize {
  return MEDIUM_FIRST.has(template) ? "medium" : "small";
}

/** The widget at one family's size, drawn by its template's own module
 * (preview/<template>.ts). A template this panel has no module for (a
 * newer aivi than the panel) says so instead. */
export function previewWidget(
  template: string,
  name: string,
  content: WidgetContent,
  size: PreviewSize = "small",
): HTMLElement {
  const accent = colorHex(content.accent) ?? iconColorHex(content.icon) ?? SYSTEM_BLUE;
  const kids: HChild[] = TEMPLATES[template]?.[size]?.(name, content, accent) ?? [
    h("div", { class: "pv-waiting" }, t("preview.none-for-template", { template })),
  ];
  const { w: cw, h: ch } = CANVAS[size];
  const canvas = h("div", { class: `pv-canvas is-${size}` }, kids);
  // Render at the family's native points and scale to the card.
  const wrap = h("div", { class: "pv-scale" });
  wrap.append(canvas);
  const fit = (): void => {
    const w = wrap.clientWidth;
    if (!w) return;
    canvas.style.transform = `scale(${w / cw})`;
    wrap.style.height = `${(w * ch) / cw}px`;
  };
  new ResizeObserver(fit).observe(wrap);
  requestAnimationFrame(fit);
  return wrap;
}
