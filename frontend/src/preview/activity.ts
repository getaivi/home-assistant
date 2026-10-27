// The Live Activity preview: the collapsed Dynamic Island stacked over
// the Lock Screen banner, approximating how the Aivi app renders the
// progress and monitor activities. Like the widget families, a pure
// function of the payload that builds a throwaway DOM tree.

import { COLOR_HEX, colorHex } from "../const";
import { type HChild, h } from "../dom";
import { t } from "../i18n";
import { layeredBar, segmentedBar } from "../segments-bar";
import type { PreviewColumn, PreviewProgress, PreviewValue, WidgetContent } from "../types/content";
import {
  remoteCard,
  remoteCompactColor,
  remoteCompactText,
  remoteIslandIcon,
} from "./activity-remote";
import { clamp01, ghost, glyphFor, iconColorHex, setSvg, slot, valueColor, valueText } from "./kit";

/** Device pt → preview px. The collapsed island renders at 1.5× the
 * hardware metrics (a ~37 pt pill, 12 pt caption text) so the compact
 * value is legible in the pane. */
const DI = 1.5;

/** The bar's active color: the simple bar's color, or, for a segmented
 * bar, the fill of the segment the progress cursor currently sits in (the
 * last segment past the end); system blue when nothing is bound. */
function activeBarColor(bar: PreviewProgress): string {
  if (bar.style === "segmented" && bar.segments?.length) {
    const v = bar.value ?? 0;
    let cumulative = 0;
    for (const s of bar.segments) {
      cumulative += s.value ?? 0;
      if (v <= cumulative) return colorHex(s.fill_color) ?? COLOR_HEX.blue;
    }
    return colorHex(bar.segments[bar.segments.length - 1]?.fill_color) ?? COLOR_HEX.blue;
  }
  return colorHex(bar.color) ?? COLOR_HEX.blue;
}

/** The compact progress ring: a 24 pt ring with a 2.5 pt stroke (a full
 * track in white at 15 %, the value arc from 12 o'clock in the bar's
 * active color) and the icon (or its "progress.indicator" default) at
 * 10 pt in the middle, in the icon's color, else white. */
function islandRing(content: WidgetContent): HTMLElement {
  const size = 24 * DI,
    lw = 2.5 * DI,
    r = (size - lw) / 2,
    c = size / 2;
  const bar = content.progress ?? {};
  const frac = clamp01(bar.value ?? 0);
  const circ = 2 * Math.PI * r;
  // 2 pt trailing padding on the compact leading slot.
  const ring = h("div", {
    "data-slot": "island-ring",
    style: `position:relative;width:${size}px;height:${size}px;flex:none;margin-right:${2 * DI}px`,
  });
  setSvg(
    ring,
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<circle cx="${c}" cy="${c}" r="${r}" stroke="rgba(255,255,255,.15)" stroke-width="${lw}" fill="none"/>` +
      (frac > 0
        ? `<circle cx="${c}" cy="${c}" r="${r}" stroke="${activeBarColor(bar)}" stroke-width="${lw}" fill="none"` +
          ` stroke-linecap="round" stroke-dasharray="${(circ * frac).toFixed(2)} ${circ.toFixed(2)}"` +
          ` transform="rotate(-90 ${c} ${c})"/>`
        : "") +
      "</svg>",
  );
  ring.append(
    h(
      "div",
      {
        style: `position:absolute;inset:0;display:grid;place-items:center;font-size:${10 * DI}px;color:${iconColorHex(content.icon) ?? "#fff"}`,
      },
      glyphFor(content.icon ?? "progress.indicator"),
    ),
  );
  return ring;
}

/** The collapsed Dynamic Island, mirroring the `compactLeading` and
 * `compactTrailing` presentations of the progress and monitor activities.
 * The pill is the hardware: pure black in every theme, with the camera
 * sensor housing between the two slots (leading renders left of the
 * sensor, trailing right of it). Null for templates without a compact
 * presentation. */
function islandPill(template: string, content: WidgetContent): HTMLElement | null {
  const slotText = (
    v: PreviewValue | string | undefined,
    size: number,
    color: string | null,
    weight = 400,
  ): HTMLElement | null => {
    const text = typeof v === "string" ? v : valueText(v);
    return text == null
      ? null
      : h(
          "div",
          {
            "data-slot": "island-value",
            style:
              `font-size:${size}px;font-weight:${weight};color:${color ?? "#fff"};` +
              `max-width:${100 * DI}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`,
          },
          text,
        );
  };
  let leading: HTMLElement | null;
  let trailing: HTMLElement | null;
  if (template === "progress") {
    leading = islandRing(content);
    // compactTrailing: the compact value at caption (12) in its
    // text_color, else white. On the device an unbound compact value
    // renders nothing and the slot collapses; here it keeps a dashed
    // rectangle so it can be pressed (see `ghost`).
    trailing =
      slotText(content.compact_value, 12 * DI, valueColor(content.compact_value)) ??
      ghost("island-value", "compact_value", "is-dark");
  } else if (template === "monitor") {
    // compactLeading: the icon (or "progress.indicator") at the slot's
    // default (body, 17 pt) size, in the icon's color, else white.
    leading = h(
      "div",
      {
        "data-slot": "island-icon",
        style: `flex:none;font-size:${17 * DI}px;color:${iconColorHex(content.icon) ?? "#fff"}`,
      },
      glyphFor(content.icon ?? "progress.indicator"),
    );
    // compactTrailing: the primary column, which is the primary_column
    // pick (device default: right), then left, then right. Its value
    // renders untinted (the device applies no foreground style in this
    // slot), so it is always white here, whatever text_color says.
    const picked = content.primary_column === "left" ? content.left_column : content.right_column;
    const column = picked ?? content.left_column ?? content.right_column;
    trailing =
      slotText(column?.value, 17 * DI, null) ?? ghost("island-value", "primary_column", "is-dark");
  } else if (template === "remote") {
    // compactLeading: the bare symbol; compactTrailing: the compact value,
    // else the value and its unit, at caption (12) semibold.
    leading = remoteIslandIcon(content, DI);
    trailing =
      slotText(
        remoteCompactText(content) ?? undefined,
        12 * DI,
        remoteCompactColor(content),
        600,
      ) ?? ghost("island-value", "compact_value", "is-dark");
  } else return null;
  return h(
    "div",
    { class: "pv-island", style: "display:flex;justify-content:center" },
    h(
      "div",
      {
        class: "pv-island-pill",
        // The faint border keeps the black pill visible against the pane's
        // dark theme. The sensor housing is black on black on the device;
        // its faint inset ring here is an approximation that lets the gap
        // read as the camera rather than dead space.
        style:
          `display:inline-flex;align-items:center;height:${37 * DI}px;` +
          `border-radius:${18.5 * DI}px;background:#000;padding:0 ${10 * DI}px;` +
          "max-width:100%;border:1px solid rgba(255,255,255,.14);color:#fff;" +
          "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;" +
          "font-variant-numeric:tabular-nums",
      },
      leading,
      h("div", {
        class: "pv-island-camera",
        style:
          `width:${66 * DI}px;height:${22 * DI}px;border-radius:${11 * DI}px;` +
          `flex:none;margin:0 ${6 * DI}px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)`,
      }),
      trailing,
    ),
  );
}

/** Approximate Live Activity previews: the collapsed Dynamic Island
 * (islandPill above) stacked over the Lock Screen banner, which is the
 * `activityFamily == .medium` layouts of the progress and monitor
 * activities on the black `activityBackgroundTint`. The system's
 * `ViewThatFits` font ladders can't be measured in a throwaway DOM tree,
 * so they are approximated from text length (commented at each site). */
export function previewActivity(
  template: string,
  name: string,
  content: WidgetContent,
): HTMLElement {
  // Title row (both templates): the name in headline white, the icon a
  // plain trailing SF glyph at headline size in its own color (white by
  // default). The banner has no chip and no tinted circle.
  const header = h(
    "div",
    { style: "display:flex;align-items:center;gap:8px" },
    h("div", { class: "pv-banner-name", style: "flex:1" }, name),
    content.icon
      ? h(
          "div",
          {
            "data-slot": "banner-icon",
            style: `flex:none;font-size:17px;font-weight:600;color:${iconColorHex(content.icon) ?? "#fff"}`,
          },
          glyphFor(content.icon),
        )
      : ghost("banner-icon", "icon", "is-dark"),
  );

  // Only ever called for a bound value: an empty one becomes a ghost
  // instead, so sizing stays content-driven as on the device.
  const line = (
    v: PreviewValue | undefined,
    align: string,
    size: number,
    weight: number,
    fallback: string,
    slot: string,
  ): HTMLElement =>
    h(
      "div",
      {
        "data-slot": slot,
        style:
          `font-size:${size}px;font-weight:${weight};text-align:${align};` +
          `color:${valueColor(v) || fallback};overflow:hidden;` +
          "text-overflow:ellipsis;white-space:nowrap;min-width:0",
      },
      valueText(v) || "",
    );

  const kids: HChild[] = template === "remote" ? remoteCard(name, content) : [header];
  if (template === "progress") {
    {
      // ViewThatFits ladder title2 (22) → title3 (20) → headline (17) →
      // subheadline (15), approximated from the combined text length; both
      // slots render heavy, left defaulting to white and right to white
      // at 70 %. The device drops the whole row when neither side is
      // bound; the editor keeps it so both halves stay pressable.
      const n =
        (valueText(content.header_left) ?? "").length +
        (valueText(content.header_right) ?? "").length;
      const size = n <= 18 ? 22 : n <= 24 ? 20 : n <= 32 ? 17 : 15;
      kids.push(
        h(
          "div",
          { style: "display:flex;justify-content:space-between;gap:10px;margin-top:8px" },
          content.header_left
            ? line(content.header_left, "left", size, 800, "#fff", "header-left")
            : ghost("header-left", "header_left", "is-dark is-grow"),
          content.header_right
            ? line(content.header_right, "right", size, 800, "rgba(255,255,255,.7)", "header-right")
            : ghost("header-right", "header_right", "is-dark is-grow"),
        ),
      );
    }
    const bar = content.progress ?? {};
    // One 12 pt bar height for every style on the banner (6 for the
    // small family, else 12), 8 pt below the header row (the stack
    // spacing). Split and layered both show the caption row below the
    // bar; labels never ride the capsules.
    kids.push(
      slot(
        bar.style === "segmented"
          ? bar.display === "layered"
            ? layeredBar(bar, 12, true, 8)
            : segmentedBar(bar, 12, 6, true, 8)
          : // The simple bar: a track in gray at 30 %, the fill color, else
            // system blue, and no minimum fill width.
            h(
              "div",
              { class: "pv-bar", style: "height:12px;border-radius:6px;margin-top:8px" },
              h("i", {
                style: `width:${Math.round(clamp01(bar.value ?? 0) * 100)}%;background:${colorHex(bar.color) ?? COLOR_HEX.blue}`,
              }),
            ),
        "bar",
      ),
    );
    // Footers are caption (12) regular; the left defaults to 60 % white,
    // the right to full white; 4 pt below the bar row on top of the
    // 8 pt stack spacing. Kept present when unbound, like the header row.
    kids.push(
      h(
        "div",
        { style: "display:flex;justify-content:space-between;gap:10px;margin-top:12px" },
        content.footer_left
          ? line(content.footer_left, "left", 12, 400, "rgba(255,255,255,.6)", "footer-left")
          : ghost("footer-left", "footer_left", "is-dark is-grow"),
        content.footer_right
          ? line(content.footer_right, "right", 12, 400, "#fff", "footer-right")
          : ghost("footer-right", "footer_right", "is-dark is-grow"),
      ),
    );
  } else if (template === "monitor") {
    // Captions truncate on one line like the value lines do: wrapping
    // would push the two columns out of alignment.
    const caption = (text: string, upper: boolean, align: string): HTMLElement =>
      h(
        "div",
        {
          style:
            `font-size:13px;font-weight:${upper ? 600 : 400};color:${COLOR_HEX.gray};` +
            `${upper ? "text-transform:uppercase;" : ""}text-align:${align};` +
            "overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
        },
        text,
      );
    // The monitor columns' ViewThatFits ladder largeTitle (34) → title
    // (28) → title2 (22) → title3 (20), approximated from the combined
    // value length across both columns (they share one ladder step on
    // the device).
    const n =
      (valueText(content.left_column?.value) ?? "").length +
      (valueText(content.right_column?.value) ?? "").length;
    const size = n <= 9 ? 34 : n <= 14 ? 28 : n <= 20 ? 22 : 20;
    const col = (
      c: PreviewColumn | undefined,
      align: string,
      id: string,
      key: string,
    ): HTMLElement =>
      // The header is footnote semibold uppercase in gray, the value at
      // .black (900) weight in its text_color, else white, the footer
      // footnote regular in gray. The 2 px gap approximates the system
      // stack spacing between the text lines.
      // The whole column is one slot: its three fields are what you reach
      // for together, and the value line alone is too small a target. An
      // empty column becomes one ghost rather than three.
      !c || !(c.header || c.value || c.footer)
        ? ghost(id, key, "is-dark is-grow")
        : h(
            "div",
            {
              "data-slot": id,
              style: `min-width:0;display:flex;flex-direction:column;gap:2px;text-align:${align}`,
            },
            c.header ? caption(c.header, true, align) : null,
            c.value ? line(c.value, align, size, 900, "#fff", id) : null,
            c.footer ? caption(c.footer, false, align) : null,
          );
    // Columns sit top-aligned (HStack(alignment: .top)), 6 pt under the
    // name row (the medium VStack spacing).
    kids.push(
      h(
        "div",
        {
          style:
            "display:flex;justify-content:space-between;gap:14px;margin-top:6px;align-items:flex-start",
        },
        col(content.left_column, "left", "left-column", "left_value"),
        col(content.right_column, "right", "right-column", "right_value"),
      ),
    );
  }
  const canvas = h("div", { class: "pv-banner" }, kids);
  // The island is the only place the "Compact value" field shows up.
  const island = islandPill(template, content);
  return h(
    "div",
    {},
    island,
    island
      ? h(
          "div",
          { class: "fhint", style: "margin:6px 0 10px;text-align:center" },
          t("preview.island-note"),
        )
      : null,
    canvas,
    h(
      "div",
      { class: "fhint", style: "margin-top:6px;text-align:center" },
      t("preview.banner-note"),
    ),
  );
}
