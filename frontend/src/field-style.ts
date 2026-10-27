// What dresses a field row's value rather than supplying it: a number's
// sign flip, a value's text color and format behind the Style fold, and an
// icon's color and symbol styling in rows of their own under its name.

import { html, nothing, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import type { AiviFieldRow } from "./aivi-field-row";
import { sourceable } from "./field-source";
import { fold } from "./form-kit";
import { t } from "./i18n";
import { asString } from "./types/bindings";
import type { FieldMeta } from "./types/meta";
import { enumLabel } from "./util";
import { slotMode } from "./value-source";

/** A meter whose direction is the other way round: the stored
 * `<key>__invert` flag flips the sign before it is sent. */
export function invertToggle(row: AiviFieldRow, field: FieldMeta): TemplateResult {
  const b = row.bindings;
  const key = `${field.key}__invert`;
  return html`<label class="chk"><input
        type="checkbox" .checked=${live(b[key] === true)}
        @change=${(e: Event) => {
          if ((e.target as HTMLInputElement).checked) b[key] = true;
          else delete b[key];
          row.editor.schedulePreview();
        }}
      /><span>${t("field.invert")}</span></label>`;
}

/** The text color of a value field: its own slot, sourced
 * independently of the value. */
function colorSubSlot(
  row: AiviFieldRow,
  field: FieldMeta,
  addr: string,
  label: string,
  ownRow = false,
): unknown {
  const b = row.bindings;
  const meta = row.editor.panel.meta;
  const swatches = (): unknown => html`<aivi-color-field
        class="cfield"
        .colors=${meta.colors}
        .label=${label}
        .value=${asString(b[addr]) ?? null}
        .onChange=${(c: string | null) => {
          if (c) b[addr] = c;
          else delete b[addr];
          row.editor.schedulePreview();
          row.requestUpdate();
        }}
      ></aivi-color-field>`;
  const slot = field.slots?.[addr.slice(field.key.length)];
  if (slot) return sourceable(row, addr, slot, label, swatches, { row: ownRow });
  return ownRow
    ? html`<div class="flab r2"><span class="flabel">${label}</span></div><div class="fmain r2">${swatches()}</div>`
    : html`<div class="ctl"><span class="k">${label}</span>${swatches()}</div>`;
}

/** A picked color's display name, or the source it follows. */
function colorSummary(row: AiviFieldRow, addr: string): string | null {
  const b = row.bindings;
  const mode = slotMode(b, addr);
  if (mode === "template") return t("source.template");
  if (mode === "bands") return t("source.bands");
  if (mode === "attribute") return t("source.attribute");
  if (mode === "entity") return t("source.entity");
  const color = asString(b[addr]);
  return color ? enumLabel("color", color) : null;
}

function formatterLabel(formatter: string): string {
  return formatter === "time_since"
    ? t("formatter.time-since")
    : formatter === "time_until"
      ? t("formatter.time-until")
      : formatter;
}

/** The Style fold of a value: its text color and its format. */
export function styleFold(row: AiviFieldRow, field: FieldMeta): TemplateResult {
  const b = row.bindings;
  const meta = row.editor.panel.meta;
  const formatter = asString(b[`${field.key}__formatter`]);
  const set = [
    field.color ? colorSummary(row, `${field.key}__color`) : null,
    formatter ? formatterLabel(formatter) : null,
  ].filter((part): part is string => !!part);
  return fold({
    title: t("field.style-title"),
    summary: set.join(", ") || null,
    open: row.folds.open("style", () => set.length > 0),
    onToggle: (open) => row.folds.set("style", open),
    body: html`${
      field.color ? colorSubSlot(row, field, `${field.key}__color`, t("common.color")) : nothing
    }${
      field.formatter
        ? html`<div class="ctl"><span class="k">${t("field.format")}</span><select
              aria-label=${t("field.format")}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v) b[`${field.key}__formatter`] = v;
                else delete b[`${field.key}__formatter`];
                row.editor.schedulePreview();
                row.requestUpdate();
              }}
            ><option value="">${t("field.format-as-is")}</option>${meta.formatters.map(
              (f) =>
                html`<option value=${f} ?selected=${formatter === f}>${formatterLabel(f)}</option>`,
            )}</select></div>`
        : nothing
    }`,
  });
}

/** The rows under the symbol name: the icon's color, then the
 * advanced styling. Direct children of the field, like its first row. */
export function iconRows(row: AiviFieldRow, field: FieldMeta): unknown {
  return html`${
    field.color
      ? colorSubSlot(row, field, `${field.key}__color`, t("field.icon-color"), true)
      : nothing
  }${
    field.rendering_modes
      ? html`<div class="fmain r3 wide">${iconStyling(row, field)}</div>`
      : nothing
  }`;
}

/** Advanced SF Symbol styling: rendering mode, secondary/tertiary
 * colors (each sourceable like the icon's own color), flat/gradient: the
 * full Icon wire object. */
function iconStyling(row: AiviFieldRow, field: FieldMeta): TemplateResult {
  const b = row.bindings;
  const k = (suffix: string): string => `${field.key}__${suffix}`;
  const suffixes = ["rendering_mode", "secondary_color", "tertiary_color", "color_rendering"];
  // A color counts as set once it holds a swatch or follows a source.
  const count = suffixes.filter(
    (suffix) => !!b[k(suffix)] || slotMode(b, k(suffix)) !== "literal",
  ).length;
  const select = (
    suffix: string,
    label: string,
    group: string,
    options: string[],
    noneLabel: string,
  ): TemplateResult =>
    html`<div class="ctl"><span class="k">${label}</span><select
          aria-label=${label}
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) b[k(suffix)] = v;
            else delete b[k(suffix)];
            row.editor.schedulePreview();
            row.requestUpdate();
          }}
        ><option value="">${noneLabel}</option>${options.map(
          (o) =>
            html`<option value=${o} ?selected=${b[k(suffix)] === o}>${enumLabel(group, o)}</option>`,
        )}</select></div>`;
  return fold({
    title: t("field.symbol-styling"),
    summary: count ? t("fold.set", { count }) : null,
    open: row.folds.open("icon", () => count > 0),
    onToggle: (open) => row.folds.set("icon", open),
    body: html`${select(
      "rendering_mode",
      t("field.rendering"),
      "rendering-mode",
      field.rendering_modes ?? [],
      t("common.default"),
    )}${colorSubSlot(row, field, k("secondary_color"), t("field.secondary"))}${colorSubSlot(
      row,
      field,
      k("tertiary_color"),
      t("field.tertiary"),
    )}${select(
      "color_rendering",
      t("field.color-style"),
      "color-rendering",
      field.color_renderings ?? [],
      // Unset means the wire default, flat, shown by its display name.
      enumLabel("color-rendering", "flat"),
    )}`,
  });
}
