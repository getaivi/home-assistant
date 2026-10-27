// A phase's weight read from live state: the entity picker, attribute
// menu or Jinja editor under the inline editor's source switch, and the
// note the last preview left about it. The stored scheme is the scalar
// one scoped under the segment's `source` key, read and written through
// value-source.ts: the mode is carried by which marker key is present,
// even empty. The literal `value` stays in every mode: it is the
// fallback weight, so a broken source never blocks Save.

import { html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { AiviSegmentsEditor } from "./aivi-segments-editor";
import { t } from "./i18n";
import { note } from "./notice";
import { fractionsOf, percentages } from "./segments";
import { attributePicker, type TemplateSpec, templateEditor, watchedIds } from "./source-editor";
import type { SegmentBinding } from "./types/bindings";
import type { FieldFeedback } from "./types/content";
import {
  type SlotMode,
  segmentAttribute,
  segmentMode,
  segmentTemplate,
  setSegmentAttribute,
  setSegmentTemplate,
} from "./value-source";

export function sourceName(s: SegmentBinding): string {
  if (segmentMode(s) === "template") return t("source.template");
  return s.source || t("source.entity");
}

/** Preview feedback for segment `i`'s weight source (`<key>.<i>.source`).
 * Feedback computed for older template text is suppressed, the field-row
 * staleness rule. */
export function sourceFeedback(
  host: SegmentHost,
  s: SegmentBinding,
  i: number,
): FieldFeedback | undefined {
  if (segmentMode(s) === "literal") return undefined;
  const key = `${host.field.key}.${i}.source`;
  const fb = host.editor.editorState.fieldFeedback?.[key];
  if (!fb) return undefined;
  const template = segmentTemplate(s);
  if (template !== undefined && host.editor.previewedTemplate(key) !== template) return undefined;
  return fb;
}

/** What a phase's template box needs of the bar editor: the template
 * workspace builds one of these when the bar editor is not drawn
 * (template-slots.ts). */
export type SegmentHost = Pick<
  AiviSegmentsEditor,
  "editor" | "field" | "list" | "patch" | "sharePercents"
>;

function noteId(host: SegmentHost, i: number): string {
  return `${host.field.key}-${i}-srcnote`;
}

/** Note under the source editor: Jinja error, renders-to-nothing, or
 * fallback-active, each naming the fallback size in use. */
function sourceNote(host: SegmentHost, i: number, s: SegmentBinding, own = true): unknown {
  const fb = own
    ? sourceFeedback(host, s, i)
    : host.editor.editorState.fieldFeedback?.[`${host.field.key}.${i}.source`];
  if (!fb) return nothing;
  // Under a template box the note sits inside the box's described
  // region, which carries the id.
  const id = own ? noteId(host, i) : nothing;
  const fallback = percentages(fractionsOf(host.list))[i] ?? 0;
  if (fb.status === "error")
    return note(
      "error",
      html`<span class="k">${t("field.template-error")}</span><code>${fb.error ?? ""}</code> ${t("segments.fallback-in-use", { pct: fallback })}`,
      { id, role: "status" },
    );
  if (fb.status === "empty")
    return note("warn", t("segments.template-empty", { pct: fallback }), { id, role: "status" });
  if (fb.status === "fallback")
    return note("warn", t("segments.source-fallback", { pct: fallback }), { id, role: "status" });
  return nothing;
}

/** The control of segment `i`'s source, in a sourced `mode`. */
export function sourceBody(
  host: AiviSegmentsEditor,
  i: number,
  s: SegmentBinding,
  name: string,
  mode: SlotMode,
): TemplateResult {
  if (mode === "template") return templateBox(host, i, s, name);
  const note = sourceNote(host, i, s);
  return html`<div>${entityPicker(
    host,
    i,
    s,
    name,
    mode,
    note === nothing ? null : noteId(host, i),
  )}</div>${mode === "attribute" ? attributeMenu(host, i, s) : nothing}${note}`;
}

function entityPicker(
  host: AiviSegmentsEditor,
  i: number,
  s: SegmentBinding,
  name: string,
  mode: SlotMode,
  describedby: string | null,
): TemplateResult {
  return html`<aivi-entity-combobox
      class="cbx"
      .options=${host.editor.panel.entities()}
      .label=${t("segments.source-label", { name })}
      .describedby=${describedby}
      .value=${s.source || null}
      .onSelect=${(id: string | null) => {
        // No re-key: the combobox keeps its input, and with it the focus.
        // Only the attribute list depends on the entity (attributeMenu).
        host.patch(i, (seg) => {
          seg.source = id ?? "";
          // A new entity needs a fresh attribute pick; keep the marker.
          if (mode === "attribute") setSegmentAttribute(seg, "");
        });
      }}
    ></aivi-entity-combobox>`;
}

/** Keyed by the entity, so another entity's attribute list is a fresh
 * select and never inherits the previous pick. */
function attributeMenu(host: AiviSegmentsEditor, i: number, s: SegmentBinding): unknown {
  return keyed(
    s.source ?? "",
    attributePicker({
      hass: host.editor.panel.hass,
      entityId: s.source || null,
      selected: segmentAttribute(s),
      wrap: "",
      onChange: (attribute) => host.patch(i, (seg) => setSegmentAttribute(seg, attribute)),
    }),
  );
}

/** Entity ids in the template are auto-detected into the watched set,
 * like the scalar template editor. */
function templateBox(
  host: AiviSegmentsEditor,
  i: number,
  s: SegmentBinding,
  name: string,
): TemplateResult {
  return templateEditor(segmentTemplateSpec(host, i, s, name));
}

/** What phase `i`'s template box is drawn from. */
export function segmentTemplateSpec(
  host: SegmentHost,
  i: number,
  s: SegmentBinding,
  name: string,
): TemplateSpec {
  const text = segmentTemplate(s) ?? "";
  const editor = host.editor;
  const hass = editor.panel.hass;
  const key = `${host.field.key}.${i}.source`;
  const feedback = editor.editorState.fieldFeedback?.[key];
  const fallback = percentages(fractionsOf(host.list))[i] ?? 0;
  return {
    text,
    address: key,
    label: name,
    kind: "segment",
    hass,
    editor,
    feedback,
    stale: editor.previewedTemplate(key) !== text,
    // The error and the result are the template's; the fallback notes
    // stay the phase's.
    note:
      feedback?.status === "error" || feedback?.status === "ok"
        ? nothing
        : sourceNote(host, i, s, false),
    resultExtra:
      feedback?.status === "ok"
        ? t("segments.result-share", { pct: host.sharePercents()[i] ?? 0 })
        : undefined,
    errorExtra: t("segments.fallback-in-use", { pct: fallback }),
    noteId: noteId(host, i),
    onInput: (value) => {
      const watched = watchedIds(value, hass);
      editor.templateEdited();
      host.patch(i, (seg) => setSegmentTemplate(seg, value, watched));
    },
    onBlur: () => editor.settleFeedback(),
  };
}
