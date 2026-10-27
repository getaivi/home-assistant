// The control of a field row whose value is set here rather than read
// from an entity, by field kind: a color, a choice, a number, a symbol, a
// list of rows, the bar's phases, a trend's points, or plain text. A value
// the backend marks sourceable is wrapped so it can follow live state
// instead (field-source.ts).
//
// Text inputs bind their value as an attribute (initial content only), so
// in-place re-renders never touch what the user is typing.

import { html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { AiviFieldRow } from "./aivi-field-row";
import { mentionsEntity } from "./const";
import { fieldUrlProblem, isUrlField } from "./editor-validation";
import {
  attributeMenu,
  bandsBody,
  bandsSeed,
  entityPicker,
  missingNote,
  sourceable,
  sourceMenu,
  templateBox,
} from "./field-source";
import { t, tOpt, tTemplate } from "./i18n";
import { note } from "./notice";
import { asNumber, asString, asStringArray } from "./types/bindings";
import type { FieldMeta } from "./types/meta";
import { durationLabel, enumLabel, labelFor } from "./util";
import { markerKey, setSlotMode, slotMode, swapSource } from "./value-source";

/** Short values get short inputs: a unit, a currency code. */
const SHORT_KEYS = new Set(["unit", "currency"]);

export function plainBody(row: AiviFieldRow, field: FieldMeta, idle: boolean): unknown {
  const b = row.bindings;
  const editor = row.editor;
  const meta = editor.panel.meta;
  const label = labelFor(field.key);
  const preview = (): void => editor.schedulePreview();
  const orSourced = (literal: () => unknown): unknown => {
    const slot = field.slots?.[""];
    return slot ? sourceable(row, field.key, slot, label, literal) : literal();
  };
  switch (field.kind) {
    case "rows":
      return html`<aivi-rows-checklist class="checks" .editor=${editor} .field=${field}></aivi-rows-checklist>`;
    case "color":
      return orSourced(
        () => html`<aivi-color-field
          class="cfield"
          .colors=${field.options ?? meta.colors}
          .label=${label}
          .value=${asString(b[field.key]) ?? null}
          .onChange=${(c: string | null) => {
            if (c) b[field.key] = c;
            else delete b[field.key];
            preview();
          }}
        ></aivi-color-field>`,
      );
    case "enum": {
      // An enum with a default always holds an option, its default
      // stored as nothing; any other offers None.
      const fallback = field.default;
      const picked = asString(b[field.key]) ?? fallback ?? "";
      return html`<select
          aria-label=${label}
          ?disabled=${idle}
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v && v !== fallback) b[field.key] = v;
            else delete b[field.key];
            preview();
          }}
        >${fallback ? nothing : html`<option value="">${t("common.none")}</option>`}${(
          field.options ?? []
        ).map(
          // A generic enum's catalog group is its field key
          // (enum.<field-key>.<value>); the option value stays raw wire data.
          (o) =>
            html`<option value=${o} ?selected=${picked === o}>${enumLabel(field.key, o)}</option>`,
        )}</select>`;
    }
    case "segments":
      return html`<aivi-segments-editor class="seged" .editor=${editor} .field=${field}></aivi-segments-editor>`;
    case "colors":
      return html`<aivi-color-ramp
          class="ramp"
          .colors=${field.options ?? meta.colors}
          .label=${label}
          .value=${asStringArray(b[field.key])}
          .maxStops=${field.max ?? 4}
          .rangeMin=${asNumber(b["min_value"]) ?? 0}
          .rangeMax=${asNumber(b["max_value"]) ?? 1}
          .unit=${literalUnit(row)}
          .onChange=${(c: string[] | null) => {
            if (c) b[field.key] = c;
            else delete b[field.key];
            preview();
          }}
          .byValueOn=${slotMode(b, field.key) === "bands"}
          .onByValue=${
            field.slots?.[""]?.sources.includes("bands")
              ? (on: boolean) => {
                  setSlotMode(b, field.key, on ? "bands" : "literal", "literal", () =>
                    bandsSeed(row, dialSpan(row)),
                  );
                  preview();
                  row.requestUpdate();
                }
              : null
          }
          .byValue=${slotMode(b, field.key) === "bands" ? ringByValue(row, field, label) : nothing}
        ></aivi-color-ramp>`;
    case "number_literal":
      return orSourced(
        () => html`<input
          type="text" inputmode="decimal"
          aria-label=${label}
          value=${b[field.key] != null ? String(b[field.key]) : ""}
          placeholder=${placeholder(row, field.key) ?? t("field.number-placeholder")} spellcheck="false"
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            const n = parseFloat(raw);
            if (raw.trim() !== "" && !Number.isNaN(n)) b[field.key] = n;
            else delete b[field.key];
            preview();
          }}
        />`,
      );
    case "points":
      return pointsControl(row, field);
    case "icon":
      return orSourced(
        () => html`<aivi-icon-field
          class="iconfield"
          .value=${asString(b[field.key]) ?? null}
          .label=${label}
          .placeholder=${t("field.icon-placeholder")}
          .onChange=${(name: string | null) => {
            if (name) b[field.key] = name;
            else delete b[field.key];
            preview();
          }}
        ></aivi-icon-field>`,
      );
    default: {
      const url = isUrlField(field);
      const noteId = `${field.key}-urlnote`;
      return orSourced(() => {
        const problem = url ? fieldUrlProblem(field, asString(b[field.key]) ?? "") : null;
        return html`<input
            type="text"
            class=${(problem ? "bad" : "") + (SHORT_KEYS.has(field.key) ? " short" : "")}
            aria-label=${label}
            aria-invalid=${problem ? "true" : "false"}
            aria-describedby=${problem ? noteId : nothing}
            placeholder=${placeholder(row, field.key) ?? nothing}
            value=${asString(b[field.key]) ?? ""} spellcheck="false"
            @input=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) b[field.key] = v;
              else delete b[field.key];
              preview();
              if (url) editor.updateValidation();
            }}
          />${problem ? note("error", t(problem), { id: noteId, role: "alert" }) : nothing}`;
      });
    }
  }
}

/** The dial's span, where both ends are typed. */
function dialSpan(row: AiviFieldRow): [number, number] | null {
  const min = asNumber(row.bindings["min_value"]);
  const max = asNumber(row.bindings["max_value"]);
  return min !== null && max !== null && max > min ? [min, max] : null;
}

/** The ring as one color by value: its bands, drawn on the dial's span,
 * and the color it takes without a reading to place. */
function ringByValue(row: AiviFieldRow, field: FieldMeta, label: string): TemplateResult {
  const b = row.bindings;
  const colors = field.options ?? row.editor.panel.meta.colors;
  const fallback = asStringArray(b[field.key])[0] ?? null;
  return html`${bandsBody(row, field.key, label, colors, null, dialSpan(row))}<div class="ctl fallback"><span class="k">${t(
    "field.fallback",
  )}</span><aivi-color-field
      class="cfield"
      .colors=${colors}
      .label=${t("ramp.fallback-aria", { field: label })}
      .value=${fallback}
      .clearable=${false}
      .emptyLabel=${t("ramp.solid-pick")}
      .onChange=${(c: string | null) => {
        if (c) b[field.key] = [c];
        row.editor.schedulePreview();
        row.requestUpdate();
      }}
    ></aivi-color-field><div class="fhint">${t(fallback ? "ramp.fallback-hint" : "ramp.fallback-empty")}</div></div>`;
}

/** A realistic example for the field, per template or in general. */
function placeholder(row: AiviFieldRow, key: string): string | undefined {
  return (
    tTemplate(
      "field-placeholder",
      row.editor.editorState.template,
      key,
      row.editor.editorState.kind,
    ) ?? tOpt(`field-placeholder.${key}`)
  );
}

/** The gauge's unit, only when it is a plain literal: a sourced unit
 * resolves on the device, so it can't be shown on stop labels here. */
function literalUnit(row: AiviFieldRow): string | null {
  const b = row.bindings;
  if (slotMode(b, "unit") === "template") return null;
  const raw = asString(b["unit"]);
  if (!raw || mentionsEntity(raw)) return null;
  return raw.trim() || null;
}

/** A trend's points: the recorded history of the field it follows (or
 * of another entity) over a picked time span, or a list an attribute
 * or a template holds. */
function pointsControl(row: AiviFieldRow, field: FieldMeta): TemplateResult {
  const b = row.bindings;
  const editor = row.editor;
  const key = field.key;
  const follows = field.follows ?? "value";
  // The points' own names for the slot's modes: a list is an
  // attribute, and an entity (or none) is the recorded history.
  const slot = slotMode(b, key);
  const mode = slot === "template" ? "template" : slot === "attribute" ? "list" : "history";
  const entityMarker = markerKey(key, "entity");
  row.headControl = sourceMenu(
    [
      { id: "history", label: t("field.points-history") },
      { id: "list", label: t("field.points-list") },
      { id: "template", label: t("field.points-template") },
    ],
    mode,
    (next) => {
      if (next === mode) return;
      // What the source being left held is remembered for the session
      // and comes back with it (value-source.ts).
      const keys = {
        history: [entityMarker],
        list: [entityMarker, markerKey(key, "attribute")],
        template: [markerKey(key, "template"), markerKey(key, "watched")],
      };
      swapSource(b, key, { name: mode, keys: keys[mode] }, next);
      if (next === "template") b[markerKey(key, "template")] ??= "";
      if (next === "list") b[markerKey(key, "attribute")] ??= "";
      row.requestUpdate();
      editor.schedulePreview();
    },
    t("field.points-source"),
    mode !== "history",
  );
  const followed = asString(b[markerKey(follows, "entity")]) ?? asString(b[follows]);
  const hours = field.hours ?? [];
  const picked = asNumber(b[`${key}__hours`]) ?? field.default_hours ?? 24;
  const missingOther = missingNote(
    row,
    mode === "history" ? asString(b[entityMarker]) : null,
    `${key}-missing`,
  );
  const body =
    mode === "template"
      ? html`${templateBox(row, key, labelFor(key), "points")}<div class="fhint">${t("field.points-template-hint")}</div>`
      : mode === "list"
        ? html`${entityPicker(row, key, labelFor(key), { attribute: true })}${attributeMenu(row, key, "literal")}<div class="fhint">${t("field.points-list-hint")}</div>`
        : html`<div class="ctl"><span class="k">${t("field.points-window")}</span><select
                aria-label=${t("field.points-window")}
                @change=${(e: Event) => {
                  const v = Number((e.target as HTMLSelectElement).value);
                  if (v === field.default_hours) delete b[`${key}__hours`];
                  else b[`${key}__hours`] = v;
                  editor.schedulePreview();
                }}
              >${hours.map(
                (h) =>
                  html`<option value=${String(h)} ?selected=${h === picked}>${durationLabel(h * 3600)}</option>`,
              )}</select></div><div class="ctl"><span class="k">${t("field.points-entity")}</span><aivi-entity-combobox
                class="cbx"
                .options=${editor.panel.entities({ domain: ["sensor", "input_number"] })}
                .label=${t("field.points-entity")}
                .placeholder=${t("field.points-same", { field: labelFor(follows) })}
                .describedby=${missingOther === nothing ? null : `${key}-missing`}
                .value=${asString(b[entityMarker])}
                .onSelect=${(id: string | null) => {
                  if (id) b[entityMarker] = id;
                  else delete b[entityMarker];
                  editor.schedulePreview();
                  editor.updateValidation();
                  row.requestUpdate();
                }}
              ></aivi-entity-combobox>${missingOther}</div>${
                followed || b[entityMarker]
                  ? nothing
                  : note("warn", t("field.points-no-history", { field: labelFor(follows) }))
              }`;
  return html`<div class="vsrc">${keyed(mode, body)}</div>`;
}
