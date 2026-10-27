// The editor's form column. Every editor has the same sections in the
// same order: what the widget shows (by where it lands on the device),
// how it looks, how it behaves. Nothing is hidden: each section is an open
// card. Which section a field is in comes from slots.ts, how fields group
// inside one from layout.ts.

import { html, nothing, type TemplateResult } from "lit";
import type { AiviEditor } from "./aivi-editor";
import { BAR_COLOR_KEY } from "./bar-mode";
import { deliveryField } from "./delivery";
import { t, tOpt } from "./i18n";
import { icon } from "./icons";
import { type FormGroup, groupHint, groupLabel, groupsFor } from "./layout";
import { banner } from "./notice";
import { widgetTemplate } from "./preview/templates";
import { type FormCheck, problemRowsText, tooBigText } from "./save-blockers";
import { type FormSection, sectionsFor, surfaceLabel, unpaintedFields } from "./slots";
import type { Bindings } from "./types/bindings";
import type { EditorState } from "./types/editor";
import type { FieldMeta, TemplateMeta } from "./types/meta";

/** The field kinds that only style the widget; they are filed under the
 * form's look group wherever their region is. */
const LOOK_KINDS = new Set(["icon", "color", "colors"]);

/** Whether a field holds anything: its own key or any of its source and
 * styling keys (`accent`, its source markers, `accent__color`, …). */
function hasValue(bindings: Bindings, key: string): boolean {
  return Object.entries(bindings).some(
    ([k, v]) =>
      (k === key || k.startsWith(`${key}__`)) &&
      v !== undefined &&
      v !== null &&
      v !== "" &&
      !(Array.isArray(v) && v.length === 0),
  );
}

/** The fields the form shows. The segments field's Solid mode owns
 * bar_color, so no separate row; a field the layout paints nowhere is
 * left out unless already set. */
function visibleFields(editor: AiviEditor, template: TemplateMeta): FieldMeta[] {
  const editorState = editor.editorState;
  const unpainted = unpaintedFields(editorState.kind, editorState.template);
  return template.fields.filter(
    (f) =>
      !(editor.segmentsField() && f.key === BAR_COLOR_KEY) &&
      !(unpainted.includes(f.key) && !hasValue(editorState.bindings, f.key)),
  );
}

/** The keys of a section in form order. The look reads in one order
 * everywhere: the template's own colors, then the icon, then the accent.
 * A content section opens with what the widget needs, the optional rest
 * following in region order (a gauge starts with its Value, not its
 * optional Label). Sorts are stable. */
function ordered(section: FormSection, byKey: Map<string, FieldMeta>): readonly string[] {
  if (section.id === "behavior") return section.keys;
  const lookRank = (key: string): number =>
    key === "accent" ? 2 : byKey.get(key)?.kind === "icon" ? 1 : 0;
  const needRank = (key: string): number => (byKey.get(key)?.required ? 0 : 1);
  const rank = section.id === "look" ? lookRank : needRank;
  return [...section.keys].sort((a, b) => rank(a) - rank(b));
}

function sectionTitle(section: FormSection): string {
  return section.id === "look"
    ? t("section.look")
    : section.id === "behavior"
      ? t("section.behavior")
      : section.surface
        ? surfaceLabel(section.surface)
        : t("section.content");
}

function card(id: string, title: string, body: unknown): TemplateResult {
  return html`<section class="fsect" data-section=${id}><h3 class="fsecth">${title}</h3>${body}</section>`;
}

export function editorForm(
  editor: AiviEditor,
  template: TemplateMeta,
  check: FormCheck,
): TemplateResult {
  const editorState = editor.editorState;
  const visible = visibleFields(editor, template);
  const byKey = new Map(visible.map((f) => [f.key, f]));
  const fieldRow = (
    key: string,
    label: string | null = null,
    mini = false,
  ): TemplateResult | typeof nothing => {
    const f = byKey.get(key);
    if (!f) return nothing;
    return html`<aivi-field-row class="field" data-key=${f.key} .editor=${editor} .field=${f} .label=${label} .mini=${mini}></aivi-field-row>`;
  };
  // Related fields sit together as one group with no divider between
  // them; dividers separate groups. Inside a titled group a field goes
  // by its short label ("Value" under "Left column"); an inline group
  // is one row of short sibling fields.
  const short = (key: string): string | null => tOpt(`field-short.${key}`) ?? null;
  const groupBlock = (group: FormGroup): TemplateResult => {
    if (!group.id) return html`<div class="fgroup">${group.keys.map((key) => fieldRow(key))}</div>`;
    const title = groupLabel(group.id, editorState.template, editorState.kind);
    if (!group.inline)
      return html`<div class="fgroup titled" role="group" aria-label=${title} data-group=${group.id}><div class="fgl">${title}</div>${group.keys.map(
        (key) => fieldRow(key, short(key)),
      )}</div>`;
    const hint = groupHint(group.id, editorState.template, editorState.kind);
    return html`<div class="fgroup" role="group" aria-label=${title} data-group=${group.id}><div class="frow"><div class="flab"><span class="flabel">${title}</span></div><div class="fsrc"></div><div class="fmain"><div class="finline">${group.keys.map(
      (key) => fieldRow(key, short(key), true),
    )}</div>${hint ? html`<div class="fhint">${hint}</div>` : nothing}</div></div></div>`;
  };
  const groups = (keys: readonly string[]): TemplateResult[] =>
    groupsFor(editorState.kind, editorState.template, keys).map(groupBlock);

  const sections = sectionsFor(
    editorState.kind,
    editorState.template,
    visible.map((f) => f.key),
    (key) =>
      LOOK_KINDS.has(byKey.get(key)?.kind ?? "") &&
      !(
        editorState.kind === "widget" &&
        widgetTemplate(editorState.template)?.content?.includes(key)
      ),
  );
  const behavior = sections.find((section) => section.id === "behavior");
  // What holds Save that no single row shows comes first.
  return html`<div class="form">${
    check.tooBig ? banner("error", tooBigText(check.tooBig)) : nothing
  }${
    check.problemRows.length
      ? banner("error", problemRowsText(check.problemRows, editor.panel.hass), {
          role: "status",
          cls: "rowfix",
        })
      : nothing
  }${
    check.badUrls.length ? banner("error", t("editor.fix-fields"), { role: "status" }) : nothing
  }${sections
    .filter((section) => section !== behavior)
    .map((section) =>
      card(section.id, sectionTitle(section), groups(ordered(section, byKey))),
    )}${card(
    "behavior",
    t("section.behavior"),
    html`${groups(behavior?.keys ?? [])}${deliveryField(editorState, () => editor.requestUpdate())}`,
  )}</div>`;
}

/** The activity lifecycle card: just the required active entity. */
export function setupCard(editor: AiviEditor, editorState: EditorState): TemplateResult {
  return html`<section class="fsect setup" data-section="runs"><h3 class="fsecth">${t("section.runs")}</h3><div class="fgroup"><div class="field"><div class="flab"><span class="flabel">${t("editor.active-label")}</span><span class=${`freq${editorState.active ? " done" : ""}`}>${editorState.active ? icon("check") : t("common.required")}</span></div><div class="fsrc"></div><div class="fmain"><aivi-entity-combobox
          class="cbx"
          .options=${editor.panel.entities()}
          .label=${t("editor.active-label")}
          .value=${editorState.active}
          .onSelect=${(id: string | null) => {
            editorState.active = id;
            editor.updateValidation();
          }}
        ></aivi-entity-combobox><div class="fhint">${t("editor.active-hint")}</div></div></div></div></section>`;
}
