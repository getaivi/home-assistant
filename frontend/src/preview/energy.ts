// The Energy widget's preview, matched to the app's Energy template.

import { COLOR_HEX, colorHex, WP } from "../const";
import { type HChild, h } from "../dom";
import { i18nLocale, t } from "../i18n";
import { energyPreviewStyles } from "../styles/preview/energy";
import type { PreviewEnergyNode, WidgetContent } from "../types/content";
import { fittedSize, textWidth } from "./fit";
import { ghost, glyphFor, iconColorHex } from "./kit";
import type { TemplateRenderer, WidgetTemplate } from "./types";

type EnergyKind = "source" | "grid" | "battery" | "home";

/** A node resolved for presentation: its kind and the color it takes. */
interface EnergyDisplayNode {
  kind: EnergyKind;
  node: PreviewEnergyNode;
  color: string;
}

/** The symbol a node of each kind takes when it brings none. */
const DEFAULT_ICON: Readonly<Record<EnergyKind, string>> = {
  source: "sun.max.fill",
  grid: "bolt.fill",
  battery: "minus.plus.batteryblock.fill",
  home: "house.fill",
};

/** The width the canvas leaves its content: the family's less the 16 pt
 * margins. */
const SMALL_WIDTH = 126;
const MEDIUM_WIDTH = 306;

/** A number with at most one decimal, as the app's
 * `.number.precision(.fractionLength(0...1))` writes it: a tie rounds to
 * the even digit (1250 W is "1.2 kW"). */
function fraction01(value: number): string {
  const options: Intl.NumberFormatOptions & { roundingMode?: string } = {
    maximumFractionDigits: 1,
    roundingMode: "halfEven",
  };
  return value.toLocaleString(i18nLocale(), options);
}

/** Watts as the app writes them: whole watts below 950, kilowatts with
 * at most one decimal from there, so readings stay short. The sign stays:
 * an exporting grid and a discharging battery read negative. */
export function formatPower(power: number): string {
  const magnitude = Math.abs(power);
  // Swift's rounded() takes a half away from zero; `|| 0` drops a "-0".
  if (magnitude < 950) return `${Math.sign(power) * Math.round(magnitude) || 0} W`;
  return `${fraction01(power / 1000)} kW`;
}

/** Today's energy: kWh with at most one decimal. */
export function formatEnergy(kilowattHours: number): string {
  return `${fraction01(kilowattHours)} kWh`;
}

/** The present nodes in the app's order (sources, grid, battery, home),
 * each in its own color, else its icon's, else its kind's: an exporting
 * grid reads green (selling), an importing one orange (drawing). */
export function energyNodes(content: WidgetContent): EnergyDisplayNode[] {
  const of = (
    kind: EnergyKind,
    node: PreviewEnergyNode | undefined,
    fallback: string,
  ): EnergyDisplayNode[] =>
    node
      ? [{ kind, node, color: colorHex(node.color) ?? iconColorHex(node.icon) ?? fallback }]
      : [];
  return [
    ...(content.sources ?? []).flatMap((node) => of("source", node, COLOR_HEX.yellow)),
    ...of(
      "grid",
      content.grid,
      (content.grid?.power ?? 0) < 0 ? COLOR_HEX.green : COLOR_HEX.orange,
    ),
    ...of("battery", content.battery, COLOR_HEX.mint),
    ...of("home", content.home, COLOR_HEX.blue),
  ];
}

/** The node Small headlines: home, else the first present. */
export function energyHeadline(content: WidgetContent): EnergyDisplayNode | null {
  const nodes = energyNodes(content);
  return nodes.find((n) => n.kind === "home") ?? nodes[0] ?? null;
}

/** A battery captions its charge beside its label; the others their
 * label alone: the node's name, else its kind's ("Solar" for a source). */
function nodeCaption({ kind, node }: EnergyDisplayNode): string {
  const label = node.name ?? t(`preview.energy-${kind}`);
  return kind === "battery" && node.level != null ? `${label} ${Math.round(node.level)}%` : label;
}

/** A node's own symbol, else its kind's. */
function nodeGlyph({ kind, node }: EnergyDisplayNode): HTMLElement | string {
  const own = typeof node.icon === "string" ? node.icon : node.icon?.name;
  if (own) return glyphFor({ name: own });
  const symbol = DEFAULT_ICON[kind];
  return glyphFor({ name: symbol });
}

/** The icon chip: the symbol in the node's color (at half the chip's
 * size, semibold) on a circle of that color at 16 %. */
function nodeChip(display: EnergyDisplayNode, extra = ""): HTMLElement {
  const { color } = display;
  return h(
    "div",
    {
      class: `pv-chip ${extra}`.trim(),
      style: `background:color-mix(in srgb, ${color} 16%, transparent);color:${color}`,
    },
    nodeGlyph(display),
  );
}

/** How much tighter a scaled-down line is set, in em: a browser tracks
 * the system face wider as it gets smaller, the app scales the line as
 * it is. */
const TIGHT = 0.02;

/** The type a line takes in `width`, as a style: its own size where it
 * fits, else scaled down to fit, to `floor` of it at most (SwiftUI's
 * minimumScaleFactor); past that the line truncates. A scaled-down line
 * is measured as tightly as it is then set. */
function fitStyle(
  text: string,
  size: number,
  weight: number,
  width: number,
  floor: number,
): string {
  const scaled = fittedSize(
    (px) => {
      const measured = textWidth(text, px, weight);
      return measured === null || px === size ? measured : measured - text.length * TIGHT * px;
    },
    size,
    width,
    floor,
  );
  return `font-size:${scaled}px${scaled < size ? `;letter-spacing:-${TIGHT}em` : ""}`;
}

/** Small: the headline node's chip top left; at the bottom the name, its
 * power (32) and today's energy in the node's color. The app draws
 * nothing for a line that is missing; the placeholders stand in. */
function energySmall(name: string, content: WidgetContent): HChild[] {
  const headline = energyHeadline(content);
  if (!headline)
    return [
      h("div", { class: "pv-grow" }),
      ghost("hero", "home_power", "is-dark"),
      ghost("caption", "home_today", "is-dark"),
    ];
  const { node, color } = headline;
  const power = formatPower(node.power ?? 0);
  return [
    h("div", { style: "display:flex;flex:none" }, nodeChip(headline)),
    h("div", { class: "pv-grow" }),
    // The name scales to 80 % and the hero (32, so Regular on the hero
    // weight ladder) to 60 % before truncating.
    h(
      "div",
      { class: "pv-name pv-energy-line", style: fitStyle(name, 15, 500, SMALL_WIDTH, 0.8) },
      name,
    ),
    h(
      "div",
      {
        class: "pv-hero pv-energy-line",
        "data-slot": "hero",
        style: `font-weight:400;${fitStyle(power, 32, 400, SMALL_WIDTH, 0.6)}`,
      },
      power,
    ),
    node.today != null
      ? h(
          "div",
          { class: "pv-state pv-energy-line", "data-slot": "caption", style: `color:${color}` },
          t("preview.energy-today", { energy: formatEnergy(node.today) }),
        )
      : ghost("caption", node === content.home ? "home_today" : "grid_today", "is-dark"),
  ];
}

/** Medium: every node a column of equal width (chip 32, power, caption),
 * the row centered on the canvas, with no name. Each line scales down on
 * its own to 70 % when its column is too narrow for it (five or six
 * nodes), so "Battery 76%" shrinks before it truncates. */
function energyMedium(_name: string, content: WidgetContent): HChild[] {
  const nodes = energyNodes(content);
  if (!nodes.length)
    return [
      h("div", { class: "pv-grow" }),
      ghost("hero", "home_power", "is-dark"),
      ghost("caption", "home_today", "is-dark"),
    ];
  const width = MEDIUM_WIDTH / nodes.length;
  return [
    h(
      "div",
      { class: "pv-cols", "data-slot": "hero" },
      nodes.map((display) => {
        const power = formatPower(display.node.power ?? 0);
        const caption = nodeCaption(display);
        return h(
          "div",
          { class: "pv-col pv-energy-col", "data-node": display.kind },
          nodeChip(display, "pv-energy-chip"),
          // subheadline (15) semibold in primary over a caption (12) in
          // secondary.
          h(
            "div",
            { class: "pv-col-value pv-energy-value", style: fitStyle(power, 15, 600, width, 0.7) },
            power,
          ),
          h(
            "div",
            {
              class: "pv-col-caption pv-energy-caption",
              style: `${fitStyle(caption, 12, 400, width, 0.7)};color:${WP.secondary}`,
            },
            caption,
          ),
        );
      }),
    ),
  ];
}

const renders: TemplateRenderer = { small: energySmall, medium: energyMedium };

/** The energy template as the panel knows it: renders, styles, the regions
 * the form's fields paint (slots.ts) and the form's order (layout.ts). */
export const energy: WidgetTemplate = {
  ...renders,
  styles: energyPreviewStyles,
  // The small energy widget headlines one node: home, else the first.
  slots: [
    {
      id: "hero",
      fields: ["sources", "grid_power", "battery_power", "battery_level", "home_power"],
    },
    { id: "caption", fields: ["home_today", "grid_today"] },
    { id: "global", fields: ["icon", "accent", "tap_url"], global: true },
  ],
  layout: [
    "sources",
    { id: "grid", fields: ["grid_power", "grid_today"] },
    { id: "battery", fields: ["battery_power", "battery_level"] },
    { id: "home", fields: ["home_power", "home_today"] },
  ],
};
