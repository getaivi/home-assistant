// What content waiting for a value says where it is shown now: the
// editor's preview and a hub card. Present tense ("Nothing is sent
// while…"); the Activity log says what a past push did (activity-rows.ts).

import { html, type TemplateResult } from "lit";
import { tSplit } from "./i18n";
import { fieldName } from "./layout";
import type { Waiting } from "./types/content";
import type { EditorKind } from "./types/editor";
import { quotable } from "./util";

/** Why nothing is sent, the field named as the editor names it, in bold. */
export function waitingLine(waiting: Waiting, template: string, kind: EditorKind): TemplateResult {
  const fields = waiting.field === null ? waiting.fields : [waiting.field];
  const names = fields.map((key) => fieldName(key, template, kind)).join(", ");
  const [before, after] =
    waiting.field === null
      ? tSplit("preview.waiting-any", "fields")
      : quotable(waiting.reading)
        ? tSplit("preview.waiting", "field", { reading: waiting.reading })
        : tSplit("preview.waiting-none", "field");
  return html`${before}<b>${names}</b>${after}`;
}
