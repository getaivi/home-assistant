// The shares the bar editor shows and speaks for its phases. Literal
// weights are their own shares. With a sourced phase the shares come from
// the preview, which lags an edit by a debounce and a round trip, so after
// an edit the editor works from what it just stored until a preview newer
// than the edit answers.

import type { AiviEditor } from "./aivi-editor";
import { displayFractions, fractionsOf, isSourced } from "./segments";
import type { SegmentBinding } from "./types/bindings";
import type { FieldMeta } from "./types/meta";

interface SharesHost {
  editor: AiviEditor;
  field: FieldMeta;
}

export class SegmentShares {
  private readonly _host: SharesHost;
  /** The shares to show for the stored list `list` (by identity: every
   * commit stores a new array) until a preview numbered above `after`
   * answers: what the last edit stored, as the bar will render it. */
  private _held: { list: SegmentBinding[]; fracs: number[]; after: number } | null = null;

  constructor(host: SharesHost) {
    this._host = host;
  }

  /** The shares the bar shows: the stored weights, or with a sourced
   * segment the preview's resolved shares, unless an edit newer than
   * that preview is being held. */
  of(list: SegmentBinding[]): number[] {
    if (!list.some(isSourced)) return fractionsOf(list);
    const editor = this._host.editor;
    const held = this._held;
    if (
      held &&
      held.list === editor.editorState.bindings[this._host.field.key] &&
      held.fracs.length === list.length &&
      editor.previewLanded <= held.after
    )
      return held.fracs;
    const resolved = editor.editorState.preview?.progress?.segments;
    return displayFractions(
      list,
      resolved?.map((s) => s.value),
    );
  }

  /** Holds `fracs` as the shares of `next` (about to be committed) until
   * a preview requested from now on answers. Only a bar with a sourced
   * segment reads the preview at all. */
  hold(next: SegmentBinding[], fracs: number[]): void {
    this._held = next.some(isSourced)
      ? { list: next, fracs, after: this._host.editor.previewRequested }
      : null;
  }

  /** `next` is being committed: held shares follow the list through
   * edits that keep its shape (a label, a color); a different number of
   * phases drops them. */
  follow(next: SegmentBinding[]): void {
    const held = this._held;
    if (held && held.list !== next)
      this._held = held.fracs.length === next.length ? { ...held, list: next } : null;
  }

  drop(): void {
    this._held = null;
  }
}
