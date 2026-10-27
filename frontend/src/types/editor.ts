// An open editor's state, and the Suggest conversation it carries. Held
// in memory only; what is saved goes through bindings.ts.

import type { PreviewAs } from "../preview-as";
import type { Bindings } from "./bindings";
import type { ContentSize, FieldFeedback, Waiting, WidgetContent } from "./content";

export type EditorKind = "widget" | "activity";

/** The progress bar's configuration mode. UI state only, never stored or
 * sent; configs map onto a mode via `deriveBarMode` (bar-mode.ts). */
export type BarMode = "solid" | "segmented" | "layered";

export interface EditorState {
  kind: EditorKind;
  entryId: string;
  subentryId: string | null;
  slug: string;
  name: string;
  template: string;
  /** Live Activities only: the lifecycle entity. */
  active: string | null;
  /** Widgets only: see `BoundWidget.stale_after`; undefined leaves the
   * widget's own setting alone. */
  staleAfter?: number | undefined;
  /** Live Activities only: see `BoundWidget.throttle`; undefined is the
   * integration's default. */
  throttle?: number | undefined;
  bindings: Bindings;
  /** undefined = loading, null = unresolvable, object = content. */
  preview: WidgetContent | null | undefined;
  /** Per-field template feedback from the last preview; undefined until
   * the first preview lands. */
  fieldFeedback?: Record<string, FieldFeedback>;
  /** Why the last preview's content does not resolve; null or
   * undefined while it does. */
  waiting?: Waiting | null | undefined;
  /** A switchboard's size as Aivi will measure it, from the last
   * preview; undefined for other templates. */
  size?: ContentSize | undefined;
  saving: boolean;
  /** The Suggest conversation so far, oldest first (in memory only). */
  chat: ChatTurn[];
  /** What is typed in the chat's composer, kept while the sidebar is
   * closed. Undefined until the composer has been used. */
  chatDraft?: string | undefined;
  /** What this home has that the name points at, offered as starters on
   * an empty form: undefined until asked for, then the answer (possibly
   * empty; an integration older than this bundle answers nothing). */
  homeStarters?: string[] | undefined;
  /** The user's explicit bar-mode choice for this session; undefined means
   * derive it from the bindings. Switching is non-destructive: the
   * inactive mode's data stays in `bindings` until save prunes it. */
  barMode?: BarMode | undefined;
  /** The preview drawn as if an entity read a value in one of its
   * bands; undefined draws it as it is. UI state only. */
  previewAs?: PreviewAs | undefined;
}

/** What one applied suggestion round did to a form field, grouped per base
 * field (entity/template/color/formatter changes are one entry).
 * `unsourced`: a field that followed live state now holds a fixed value,
 * because the suggestion replaced it. */
export interface SuggestChange {
  key: string;
  kind: "set" | "changed" | "unsourced" | "cleared";
  /** What changed inside the field, when it is more than its own value:
   * a list's rows ("Porch light: label, color"), a value's dressing
   * ("color, format"). */
  detail?: string | undefined;
}

/** Something the model's answer said that did not hold up (mirrors
 * Rejected in custom_components/aivi/suggest/). */
export interface SuggestRejected {
  key: string;
  value: string;
  reason: string;
}

/** One exchange of the Suggest conversation: what the user asked, what
 * the model replied, what it changed, and the form state before the turn
 * (what undoing it restores). */
export interface ChatTurn {
  ask: string;
  reply: string | null;
  changes: SuggestChange[];
  before: Bindings;
  /** The form state the turn left: undo reverts only what still equals
   * this, so edits made by hand since are kept. */
  after: Bindings;
  /** What the answer said that the server did not apply. */
  rejected: SuggestRejected[];
  /** What the user could say next, offered by the answer: the candidates
   * it passed over when it had to choose, or the closest things the home
   * has when it could not do what was asked. One press sends one. */
  options?: string[] | undefined;
  /** How the request met the home ("clear", "guess", "none"), when the
   * backend says. */
  match?: string | null | undefined;
  /** A turn that applied nothing and why (the model failed, returned
   * nothing usable, or the form changed under it): kept in the
   * transcript with Retry, and never sent as history. */
  problem?: string | undefined;
}
