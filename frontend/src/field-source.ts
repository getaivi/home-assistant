// Where a field row's value comes from: the source menu at the row's
// trailing edge and the control each source needs (the entity picker, the
// attribute menu, the Jinja editor), for a field whose point is an entity
// and for a literal that may follow live state instead. The stored shape
// is value-source.ts's; switching goes through it, so what each source
// held is remembered for the session.

import { html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import "./aivi-bands-field";
import type { AiviEditor } from "./aivi-editor";
import type { AiviFieldRow } from "./aivi-field-row";
import { type BandsBinding, bandsTemplate, parseBands, readingOf, seedBands } from "./bands";
import { fieldHint, sources } from "./const";
import { t } from "./i18n";
import { note } from "./notice";
import { attributePicker, type TemplateSpec, templateEditor, watchedIds } from "./source-editor";
import { asString, type Bindings } from "./types/bindings";
import type { FieldFeedback } from "./types/content";
import type { EntityFilter, FieldMeta } from "./types/meta";
import { labelFor, quotable } from "./util";
import {
  entityKey,
  markerKey,
  readSource,
  type SlotBare,
  type SlotMeta,
  type SlotMode,
  setSlotMode,
  slotMode,
} from "./value-source";

type Source = "entity" | "attribute" | "template";

/** The source menu: a quiet select at the trailing edge of a label
 * line, outlined once the value no longer comes from its default
 * source. */
export function sourceMenu(
  options: readonly { id: string; label: string }[],
  value: string,
  onChange: (next: string) => void,
  label: string,
  live: boolean,
): TemplateResult {
  return html`<select
      class=${`srcsel${live ? " live" : ""}`}
      aria-label=${label}
      @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
    >${options.map(
      (o) => html`<option value=${o.id} ?selected=${o.id === value}>${o.label}</option>`,
    )}</select>`;
}

/** A field whose point is an entity: the entity picker, or the same
 * with an attribute, or a template. The source is derived from which
 * marker key is present (even empty), so a just-switched mode sticks
 * across the re-render; empty values are pruned at save time. */
export function sourcedBody(row: AiviFieldRow, field: FieldMeta): unknown {
  const b = row.bindings;
  const label = labelFor(field.key);
  // An entity-bare slot is never literal: without a marker it is entity.
  const source = slotMode(b, field.key, "entity") as Source;
  row.headControl = sourceMenu(
    sources(),
    source,
    // The same switch as any slot's, whose bare key holds the entity.
    (next) => {
      setSlotMode(b, field.key, next as SlotMode, "entity");
      row.requestUpdate();
      row.editor.schedulePreview();
      row.editor.updateValidation();
    },
    t("field.source-label", { field: label }),
    source !== "entity",
  );
  const body =
    source === "template"
      ? templateBox(row, field.key, label, field.slots?.[""]?.kind ?? "text")
      : html`${entityPicker(row, field.key, label, {
          filter: field.filter,
          attribute: source === "attribute",
          bare: "entity",
        })}${source === "attribute" ? attributeMenu(row, field.key, "entity") : nothing}${statusNote(
          row,
          field.key,
        )}`;
  // Keyed on the source alone: an entity pick must not rebuild the
  // picker it was made in (focus stays there). The attribute menu
  // re-keys itself on the entity.
  return keyed(source, body);
}

/**
 * Wrap a literal control so its value can come from live state. The mode
 * set comes from the backend's slot metadata.
 *
 * - In a dynamic mode the literal control stays, relabeled as the
 *   fallback, because that is what the runtime uses when the source
 *   can't be read (except entity-bare slots, which have no literal).
 * - Mode is derived from which marker key is present, even when empty,
 *   so a just-switched mode sticks; that invariant lives in
 *   value-source.ts.
 */
export function sourceable(
  row: AiviFieldRow,
  addr: string,
  slot: SlotMeta,
  label: string,
  literal: () => unknown,
  opts: { filter?: EntityFilter | undefined; row?: boolean } = {},
): unknown {
  const b = row.bindings;
  const bare = slot.bare;
  const mode = slotMode(b, addr, bare);
  const switcher = sourceMenu(
    [
      { id: "literal", label: t("source.fixed") },
      // A color by value sits next to its fixed value: the two hold colors.
      ...(slot.sources.includes("bands") ? [{ id: "bands", label: t("source.bands") }] : []),
      ...sources().filter((source) => slot.sources.includes(source.id)),
    ],
    mode,
    (next) => {
      setSlotMode(b, addr, next as SlotMode, bare, () => bandsSeed(row));
      row.requestUpdate();
      row.editor.schedulePreview();
      row.editor.updateValidation();
    },
    t("field.source-of", { field: label }),
    mode !== "literal",
  );
  const body =
    mode === "literal"
      ? literal()
      : html`${
          mode === "template"
            ? templateBox(row, addr, label, slot.kind)
            : mode === "bands"
              ? bandsBody(
                  row,
                  addr,
                  label,
                  slot.options ?? row.editor.panel.meta.colors,
                  (bands) => {
                    // The same bands as Jinja, over whatever template was
                    // there before.
                    setSlotMode(b, addr, "template", bare);
                    b[markerKey(addr, "template")] = bandsTemplate(bands);
                    row.requestUpdate();
                    row.editor.schedulePreview();
                    row.editor.updateValidation();
                  },
                )
              : html`${entityPicker(row, addr, label, {
                  filter: opts.filter,
                  attribute: mode === "attribute",
                  bare,
                })}${
                  mode === "attribute" ? attributeMenu(row, addr, bare) : nothing
                }${statusNote(row, addr)}`
        }${
          bare === "entity"
            ? nothing
            : html`<div class="ctl fallback"><span class="k">${t("field.fallback")}</span>${literal()}<div class="fhint">${t("field.fallback-hint")}</div></div>`
        }`;
  // The row already names a top-level slot and carries its menu; a
  // sub-slot (a value's text color) is an option row of its own, with
  // its menu at the same trailing edge. Keyed on the source only, so
  // neither typing nor an entity pick rebuilds the control in use.
  const content = keyed(mode, body);
  if (addr === row.field.key) {
    row.headControl = switcher;
    return html`<div class="vsrc">${content}</div>`;
  }
  // A second row of the field itself (an icon's color): the same
  // three cells, so its control and menu line up with every other row.
  if (opts.row)
    return html`<div class="flab r2"><span class="flabel">${label}</span></div><div class="fmain r2"><div class="vsrc">${content}</div></div><div class="fsrc r2">${switcher}</div>`;
  // Following a source, its control takes the row's width under the
  // label and the menu: a template box or an entity picker squeezed
  // beside the label would wrap every few characters.
  return html`<div class=${mode === "literal" ? "orow" : "orow stack"}><span class="k">${label}</span><div class="vsrc">${content}</div>${switcher}</div>`;
}

/** The entity a color by value starts from: the reading of the field
 * it colors, else the first number the widget reads. */
export function bandsSeed(row: AiviFieldRow, span: [number, number] | null = null): BandsBinding {
  const states = row.editor.panel.hass.states;
  const own = readSource(row.bindings, row.field.key, row.field.source ? "entity" : "literal");
  const ids = [
    ...(own && own.kind !== "template" && own.kind !== "bands" ? [own.entity] : []),
    ...row.editor.boundEntityIds(),
  ];
  const id = ids.find((x) => readingOf(states[x]?.state) !== null) ?? "";
  return seedBands(id, states[id], span);
}

/** A color by value: the bands editor over the bands stored at `addr`.
 * `onTemplate` writes them out as a template, where the value takes one;
 * `span` is the field's own span for the ruler (a gauge's dial). */
export function bandsBody(
  row: AiviFieldRow,
  addr: string,
  label: string,
  colors: string[],
  onTemplate: ((bands: BandsBinding) => void) | null,
  span: [number, number] | null = null,
): unknown {
  const b = row.bindings;
  const editor = row.editor;
  const key = markerKey(addr, "bands");
  const bands = parseBands(b[key]) ?? bandsSeed(row, span);
  return html`<aivi-bands-field
    class="bands"
    .bands=${bands}
    .colors=${colors}
    .hass=${editor.panel.hass}
    .options=${editor.panel.entities({ numeric: true })}
    .label=${label}
    .span=${span}
    .lockHint=${!!bands.entity && !editor.boundEntityIds().includes(bands.entity)}
    .onChange=${(next: BandsBinding) => {
      b[key] = next;
      row.requestUpdate();
      editor.schedulePreview();
      editor.updateValidation();
    }}
    .onTemplate=${onTemplate ? () => onTemplate(bands) : null}
  ></aivi-bands-field>`;
}

/** The note under an entity picker whose entity Home Assistant no
 * longer has (renamed, removed, or its integration not loaded): a
 * warning, never a block, since it may be back. */
export function missingNote(row: AiviFieldRow, id: string | null, noteId: string): unknown {
  if (!id || row.editor.panel.hass.states[id]) return nothing;
  return note("warn", t("field.entity-missing"), { id: noteId });
}

/** The entity picker for any slot address (`entityKey` decides where
 * the entity id is stored). */
export function entityPicker(
  row: AiviFieldRow,
  addr: string,
  label: string,
  opts: {
    filter?: EntityFilter | undefined;
    attribute?: boolean;
    bare?: SlotBare;
  } = {},
): TemplateResult {
  const b = row.bindings;
  const bare = opts.bare ?? "literal";
  const key = entityKey(addr, bare);
  const noteId = `${addr}-missing`;
  const missing = missingNote(row, asString(b[key]), noteId);
  return html`<aivi-entity-combobox
      class="cbx"
      .options=${row.editor.panel.entities(opts.filter)}
      .label=${label}
      .describedby=${missing === nothing ? null : noteId}
      .value=${asString(b[key])}
      .onSelect=${(id: string | null) => {
        const before = asString(b[key]) ?? "";
        b[key] = id ?? "";
        // Another entity means a fresh attribute pick: stay in attribute
        // mode (keep the marker) and rebuild the attribute menu (it is
        // keyed on the entity). The same entity picked again keeps its
        // attribute, which the menu still shows.
        if (opts.attribute && b[key] !== before) b[markerKey(addr, "attribute")] = "";
        row.editor.schedulePreview();
        row.editor.updateValidation();
        row.requestUpdate();
      }}
    ></aivi-entity-combobox>${missing}`;
}

export function attributeMenu(row: AiviFieldRow, addr: string, bare: SlotBare): unknown {
  const b = row.bindings;
  const entityId = asString(b[entityKey(addr, bare)]);
  // Rebuilt per entity: the menu lists that entity's attributes.
  return keyed(
    entityId ?? "",
    attributePicker({
      hass: row.editor.panel.hass,
      entityId,
      selected: asString(b[markerKey(addr, "attribute")]) ?? undefined,
      wrap: "subrow",
      onChange: (attribute) => {
        // Keep the (possibly empty) key so the source switch stays on
        // Attribute; empties are pruned at save.
        b[markerKey(addr, "attribute")] = attribute;
        row.editor.schedulePreview();
        row.editor.updateValidation();
        row.requestUpdate();
      },
    }),
  );
}

/** What a slot's template box needs of its row: the template workspace
 * builds one of these without a row (template-slots.ts). */
export interface TemplateRow {
  bindings: Bindings;
  editor: AiviEditor;
  field: FieldMeta;
  requestUpdate(): void;
}

/** A slot's template box. `kind` is the slot's kind (or "points"):
 * which recipes the template workspace offers. */
export function templateBox(
  row: AiviFieldRow,
  addr: string,
  label: string,
  kind: string,
): TemplateResult {
  return templateEditor(slotTemplateSpec(row, addr, label, kind));
}

/** What a slot's template box is drawn from. */
export function slotTemplateSpec(
  row: TemplateRow,
  addr: string,
  label: string,
  kind: string,
): TemplateSpec {
  const b = row.bindings;
  const editor = row.editor;
  const text = asString(b[markerKey(addr, "template")]) ?? "";
  // Stored on every render (idempotent), so the watch list follows the
  // text; the server re-derives the real one on save.
  const ids = watchedIds(text, editor.panel.hass);
  if (ids.length) b[markerKey(addr, "watched")] = ids;
  else delete b[markerKey(addr, "watched")];
  const feedback = editor.editorState.fieldFeedback?.[addr];
  return {
    text,
    address: addr,
    label,
    hint:
      addr === row.field.key
        ? fieldHint(addr, editor.editorState.template, true, editor.editorState.kind)
        : undefined,
    kind,
    hass: editor.panel.hass,
    editor,
    feedback,
    // Feedback computed for older template text stays, dimmed, until
    // the next answer replaces it.
    stale: editor.previewedTemplate(addr) !== text,
    // The result line and the error are the template's own; the
    // warnings (renders to nothing, a value the field can't use) stay
    // the slot's.
    note: feedback?.status === "error" ? nothing : statusNote(row, addr, false),
    noteId: `${addr}-tnote`,
    onInput: (value) => {
      b[markerKey(addr, "template")] = value;
      row.requestUpdate();
      editor.templateEdited();
      editor.schedulePreview();
      editor.updateValidation();
    },
    onBlur: () => editor.settleFeedback(),
  };
}

/** Whether a slot has a fallback for when its source can't be read: a
 * literal-bare slot holding a value. An entity-bare slot never has one;
 * a slot the field's metadata does not list (a segment's weight) is
 * taken to have one, as its own editor stores it. */
function hasFallback(row: StatusRow, addr: string): boolean {
  const key = row.field.key;
  const slot = addr.startsWith(key) ? row.field.slots?.[addr.slice(key.length)] : undefined;
  if (!slot) return true;
  const literal = row.bindings[addr];
  return slot.bare === "literal" && literal !== undefined && literal !== null && literal !== "";
}

/** What a slot's note is read from. */
interface StatusRow {
  editor: AiviEditor;
  field: FieldMeta;
  bindings: Bindings;
}

/** What a source that can't be read means for the slot: the fallback
 * applies, nothing is sent (a required field with no fallback), or the
 * value is left out. */
function fallbackText(row: StatusRow, addr: string, fb: FieldFeedback): string {
  if (hasFallback(row, addr))
    return fb.value
      ? t("field.source-unusable", { value: fb.value })
      : t("field.source-unavailable");
  if (row.field.required && addr === row.field.key) {
    const value = fb.value ?? (quotable(fb.reading ?? null) ? fb.reading : undefined);
    return value ? t("field.source-waiting", { value }) : t("field.source-waiting-none");
  }
  return fb.value
    ? t("field.source-unusable-left-out", { value: fb.value })
    : t("field.source-left-out");
}

/** The note for a slot's status in the last aivi/preview, tied to its
 * control via aria-describedby; role="status" announces it politely once
 * the debounced preview lands, so it never interrupts typing. `fallback`
 * means the source can't be read, or resolved to something unusable on
 * the wire (e.g. a color outside the palette): the stored literal is in
 * effect, or with none the value is left out, or for a required field
 * nothing is sent; it is a warning, never blocking. */
function statusNote(row: StatusRow, addr: string, own = true): unknown {
  const fb = row.editor.editorState.fieldFeedback?.[addr];
  // Under a template box the note sits inside the box's described
  // region, which carries the id.
  const id = own ? `${addr}-tnote` : nothing;
  if (fb?.status === "error")
    return note(
      "error",
      html`<span class="k">${t("field.template-error")}</span><code>${fb.error ?? ""}</code>`,
      { id, role: "status" },
    );
  if (fb?.status === "empty")
    return note("warn", t("field.template-empty"), { id, role: "status" });
  if (fb?.status === "fallback")
    return note("warn", fallbackText(row, addr, fb), { id, role: "status" });
  return nothing;
}
