// Suggest (AI-assisted binding), as a conversation: each ask goes to
// aivi/suggest with the exchanges so far and the present form state; the
// answer lands as pre-filled form state and a short reply in the
// transcript, with what it changed and an undo back to before any turn.
// Never a save. The host carries class="suggest". Without a working AI
// Task backend it explains what is missing and links to fix it.

import { html, LitElement, nothing } from "lit";
import type { AiviEditor } from "./aivi-editor";
import type { SuggestState } from "./api";
import { define } from "./define";
import { type TranslationKey, t, tOpt } from "./i18n";
import { icon } from "./icons";
import { navigateLocal } from "./onboarding";
import { asRowOptionsMap, asStringArray, type Bindings } from "./types/bindings";
import type { ChatTurn, SuggestChange, SuggestRejected } from "./types/editor";
import { canonical, errMsg, labelFor } from "./util";
import { isDerivedKey, type Marker, markerKey } from "./value-source";

/** In-instance My Home Assistant redirects (see onboarding.ts).
 * `config_ai_task` (the AI preferences page) exists since HA 2025.8; AI
 * Task shipped in 2025.7, so only that version shows the my panel's
 * "unknown redirect" notice for it. */
const INTEGRATIONS_PATH = "/_my_redirect/integrations";
const AI_TASK_PREFS_PATH = "/_my_redirect/config_ai_task";

/** What a suggestion round did, per base form field (`state`, its
 * source markers and options are one entry). Watch lists are derived
 * server-side and ignored. The trust-critical case is "cleared": the
 * complete-config contract lets a model silently empty a hand-set field
 * by omitting it. A change inside a field (a row's options, a value's
 * color) carries a `detail` saying where. */
// The marker keys that make a field follow live state.
const SOURCE_MARKERS: readonly Marker[] = ["template", "entity", "attribute"];

export function diffSuggestion(
  previous: Bindings,
  next: Bindings,
  nameOf: (entityId: string) => string = (id) => id,
): SuggestChange[] {
  const group = (bindings: Bindings): Map<string, Record<string, unknown>> => {
    const fields = new Map<string, Record<string, unknown>>();
    for (const [key, value] of Object.entries(bindings)) {
      if (isDerivedKey(key)) continue;
      const base = key.split("__")[0] ?? key;
      const sub = fields.get(base) ?? {};
      sub[key] = value;
      fields.set(base, sub);
    }
    return fields;
  };
  const sourced = (key: string, sub: Record<string, unknown>): boolean =>
    SOURCE_MARKERS.some((marker) => sub[markerKey(key, marker)] != null);
  const before = group(previous);
  const after = group(next);
  const changes: SuggestChange[] = [];
  for (const [key, sub] of after) {
    const was = before.get(key);
    if (!was) changes.push({ key, kind: "set" });
    else if (canonical(was) !== canonical(sub))
      changes.push({
        key,
        kind: sourced(key, was) && !sourced(key, sub) ? "unsourced" : "changed",
        detail: changeDetail(key, was, sub, nameOf),
      });
  }
  for (const key of before.keys()) if (!after.has(key)) changes.push({ key, kind: "cleared" });
  return changes;
}

/** Where inside a field the change is, when it is not (only) the field's
 * own value: which rows of a list, which dressing of a value. */
function changeDetail(
  key: string,
  was: Record<string, unknown>,
  now: Record<string, unknown>,
  nameOf: (entityId: string) => string,
): string | undefined {
  const parts: string[] = [];
  if (Array.isArray(now[key]) && typeof (now[key] as unknown[])[0] === "string") {
    const before = asStringArray(was[key] as Bindings[string]);
    const after = asStringArray(now[key] as Bindings[string]);
    const added = after.filter((id) => !before.includes(id)).length;
    const removed = before.filter((id) => !after.includes(id)).length;
    const kept = after.filter((id) => before.includes(id));
    if (added) parts.push(t("suggest.detail-added", { count: added }));
    if (removed) parts.push(t("suggest.detail-removed", { count: removed }));
    if (canonical(kept) !== canonical(before.filter((id) => after.includes(id))))
      parts.push(t("suggest.detail-reordered"));
    const optionsWas = asRowOptionsMap(was[`${key}__options`] as Bindings[string]);
    const optionsNow = asRowOptionsMap(now[`${key}__options`] as Bindings[string]);
    const touched = kept.filter(
      (id) => canonical(optionsWas[id] ?? {}) !== canonical(optionsNow[id] ?? {}),
    );
    parts.push(...touched.slice(0, 3).map(nameOf));
    if (touched.length > 3) parts.push(t("suggest.detail-more", { count: touched.length - 3 }));
    return parts.length ? parts.join(", ") : undefined;
  }
  if (canonical(was[key]) !== canonical(now[key])) return undefined;
  const changed = (suffix: string): boolean =>
    Object.keys({ ...was, ...now }).some(
      (k) => k.startsWith(`${key}__${suffix}`) && canonical(was[k]) !== canonical(now[k]),
    );
  if (SOURCE_MARKERS.some((marker) => changed(marker))) parts.push(t("suggest.detail-source"));
  if (changed("color") || changed("secondary_color") || changed("tertiary_color"))
    parts.push(t("suggest.detail-color"));
  if (changed("formatter")) parts.push(t("suggest.detail-format"));
  if (changed("rendering_mode") || changed("color_rendering"))
    parts.push(t("suggest.detail-style"));
  return parts.length ? parts.join(", ") : undefined;
}

/** Undo as a three-way revert: every key still as the conversation left
 * it (`base`) goes back to `target`; a key changed by hand since keeps
 * the hand edit. Returns the bindings and whether anything was kept. */
export function revertTurn(
  current: Bindings,
  base: Bindings,
  target: Bindings,
): { bindings: Bindings; kept: boolean } {
  const out: Bindings = {};
  let kept = false;
  for (const key of new Set([
    ...Object.keys(current),
    ...Object.keys(base),
    ...Object.keys(target),
  ])) {
    const derived = isDerivedKey(key);
    const untouched = canonical(current[key]) === canonical(base[key]);
    if (!untouched && !derived) kept = true;
    const value = untouched || derived ? target[key] : current[key];
    if (value !== undefined) out[key] = structuredClone(value);
  }
  return { bindings: out, kept };
}

/** The asks worth offering after a turn, from what the template has. */
function hintsFor(fields: readonly { key: string; kind?: string | undefined }[]): TranslationKey[] {
  const has = (test: (f: { key: string; kind?: string | undefined }) => boolean): boolean =>
    fields.some(test);
  const hints: TranslationKey[] = [];
  if (has((f) => f.key === "actions")) hints.push("suggest.hint-tile");
  else if (has((f) => f.kind === "rows")) hints.push("suggest.hint-rows");
  if (has((f) => f.kind === "segments")) hints.push("suggest.hint-phases");
  if (has((f) => f.key === "accent")) hints.push("suggest.hint-accent");
  if (has((f) => f.kind === "value" || f.kind === "number")) hints.push("suggest.hint-sensor");
  if (has((f) => f.kind === "icon")) hints.push("suggest.hint-icon");
  return [...hints.slice(0, 2), "suggest.hint-simpler"];
}

/** Where a conversation can start: a whole setup for an empty form, a
 * restyle for one that already shows something. Each is something a
 * person would say, and is sent as said: the integration already knows
 * the widget's name and that an empty form wants designing. */
const STARTERS: { blank: readonly TranslationKey[]; set: readonly TranslationKey[] } = {
  blank: ["suggest.starter-setup", "suggest.starter-bold", "suggest.starter-calm"],
  set: ["suggest.starter-restyle", "suggest.starter-bold", "suggest.starter-simpler"],
};

/** After this long the shimmer says the model is still working. */
const SLOW_MS = 4000;
/** The longest ask (the server holds the same cap, MAX_ASK). */
const MAX_ASK = 2000;

interface Redo {
  turns: ChatTurn[];
  bindings: Bindings;
}

class AiviSuggestBox extends LitElement {
  static override properties = {
    editor: { attribute: false },
    _busy: { state: true },
    _pending: { state: true },
    _slow: { state: true },
    _empty: { state: true },
    _redo: { state: true },
  };
  declare editor: AiviEditor;
  declare private _busy: boolean;
  /** The ask in flight: in the transcript from the moment it is sent. */
  declare private _pending: string | null;
  declare private _slow: boolean;
  /** Whether the composer holds nothing to send. */
  declare private _empty: boolean;
  /** The turns the last undo removed, until the next ask. */
  declare private _redo: Redo | null;

  /** Bumped by Stop: a round still in flight sees it changed and drops
   * its answer when it lands. */
  private _round = 0;
  private _slowTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this._busy = false;
    this._pending = null;
    this._slow = false;
    this._empty = true;
    this._redo = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private get _input(): HTMLTextAreaElement | null {
    return this.querySelector("textarea");
  }

  /** The composer's text: mirrored on the editor state, so a draft
   * survives the sidebar closing. */
  private _setDraft(text: string): void {
    const input = this._input;
    if (input) {
      input.value = text;
      grow(input);
    }
    this.editor.editorState.chatDraft = text;
    this._empty = !text.trim();
  }

  /** A draft left behind comes back; a fresh conversation starts with
   * an empty composer and the starters above it. */
  protected override firstUpdated(): void {
    this._setDraft(this.editor.editorState.chatDraft ?? "");
    void this._loadHomeStarters();
  }

  /** Ask once per editor what the home has that the widget's name points
   * at. An integration older than this bundle has no such command: the
   * generic starters stay. */
  private async _loadHomeStarters(): Promise<void> {
    const editor = this.editor;
    const editorState = editor.editorState;
    if (editorState.homeStarters !== undefined || editor.panel.suggestState !== "ready") return;
    editorState.homeStarters = [];
    try {
      const res = await editor.panel.api.suggestStarters(
        editorState.template,
        editorState.kind,
        editorState.name,
      );
      editorState.homeStarters = res.starters.filter(
        (s): s is string => typeof s === "string" && !!s.trim(),
      );
    } catch {
      return;
    }
    if (editor.panel.editorState === editorState) this.requestUpdate();
  }

  /** The empty conversation: what Suggest does, and the starters, each
   * sent in one press. An empty form is offered a whole setup, a filled
   * one a restyle. */
  private _renderStart(): unknown {
    const blank = this.editor.isBlank();
    // On an empty form, what this home has that the name points at comes
    // right after the catch-all: a starter naming a subject is more
    // useful than one naming a style.
    const home = blank ? (this.editor.editorState.homeStarters ?? []) : [];
    const generic = STARTERS[blank ? "blank" : "set"].map((key) => t(key));
    const starters = home.length ? [generic[0] ?? "", ...home] : generic;
    return html`<div class="intro"><p>${t("suggest.intro")}</p><div class="starters">${starters.map(
      (text, i) =>
        html`<button type="button" class="starter" @click=${() => void this._run(text)}>${
          i === 0 ? icon("creation") : nothing
        }<span>${text}</span></button>`,
    )}</div></div>`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._slowTimer);
  }

  /** The newest exchange stays in view. */
  protected override updated(): void {
    const log = this.querySelector<HTMLElement>(".chat");
    if (log) log.scrollTop = log.scrollHeight;
  }

  override render(): unknown {
    // A round that resolves after the editor closed still clears _busy,
    // which re-renders this detached box.
    if (!this.editor.panel.editorState) return nothing;
    const state = this.editor.panel.suggestState;
    this.classList.toggle("off", state !== "ready");
    if (state !== "ready") return this._renderOff(state);
    const turns = this.editor.editorState.chat;
    // Starting points for the next ask, once there is something to adjust:
    // they go into the composer, to edit before sending.
    // They keep their place while the model thinks (idle, not removed):
    // taking them away and back would move the whole transcript.
    // What the last answer itself offers comes first: the alternatives
    // it passed over, or what the home has when it could not do what was
    // asked. Those send in one press; the generic hints only fill the
    // composer, and stand in when the answer offered nothing.
    const last = turns[turns.length - 1];
    const options = last && !last.problem ? (last.options ?? []) : [];
    const hints =
      !options.length && turns.some((turn) => !turn.problem)
        ? hintsFor(this.editor.templateMeta()?.fields ?? [])
        : [];
    return html`<div class="chat" role="log" aria-live="polite" aria-label=${t("suggest.title")}>${
      turns.length
        ? turns.map((turn, i) => this._turn(turn, i))
        : this._busy
          ? nothing // the first ask is at the top from the moment it is sent
          : this._renderStart()
    }${
      this._redo
        ? html`<div class="redo"><span>${t("suggest.undone-count", { count: this._redo.turns.length })}</span><button
            type="button" class="btn ghost small redobtn"
            @click=${() => this._doRedo()}
          >${t("suggest.redo")}</button></div>`
        : nothing
    }${
      this._busy
        ? html`<div class="msg user"><div class="bubble">${this._pending}</div></div><div class="msg bot"><div class="thinking">${t(this._slow ? "suggest.still-working" : "suggest.thinking")}</div></div>`
        : nothing
    }</div>${
      options.length
        ? html`<div class="hints opts" role="group" aria-label=${t("suggest.options-label")}>${options.map(
            (option) =>
              html`<button type="button" class="hint opt" ?disabled=${this._busy} @click=${() => void this._run(option)}>${option}</button>`,
          )}</div>`
        : nothing
    }${
      hints.length
        ? html`<div class="hints">${hints.map(
            (key) =>
              html`<button type="button" class="hint" ?disabled=${this._busy} @click=${() => this._fill(t(key))}>${t(key)}</button>`,
          )}</div>`
        : nothing
    }<div class="composer"><textarea
        rows="1"
        maxlength=${MAX_ASK}
        aria-label=${t("suggest.input-label")}
        placeholder=${
          turns.length ? t("suggest.placeholder-refine") : t("suggest.placeholder-initial")
        }
        spellcheck="false"
        @input=${(e: Event) => {
          const input = e.target as HTMLTextAreaElement;
          grow(input);
          this.editor.editorState.chatDraft = input.value;
          this._empty = !input.value.trim();
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            void this._run();
          }
        }}
      ></textarea><div class="srow">${this._modelPicker()}${
        this._busy
          ? html`<button
            type="button" class="sendbtn stop" aria-label=${t("suggest.stop")} title=${t("suggest.stop")}
            @click=${() => this._stop()}
          >${icon("stop")}</button>`
          : html`<button
            type="button" class="sendbtn" aria-label=${t("suggest.send")} title=${t("suggest.send")}
            aria-disabled=${this._empty ? "true" : "false"}
            @click=${() => void this._run()}
          >${icon("arrow-up")}</button>`
      }</div></div><div class="fhint foot">${t("suggest.footer")}</div>`;
  }

  /** Which model answers: a select in the composer's toolbar when the
   * user has more than one AI Task model, else the Enter hint. Each
   * model's own settings (reasoning effort, say) live with it in Home
   * Assistant; AI Task takes none per request. */
  private _modelPicker(): unknown {
    const panel = this.editor.panel;
    const models = panel.suggestModels;
    if (models.length < 2) return html`<span class="chint">${t("suggest.enter-hint")}</span>`;
    const chosen = panel.suggestModel ?? models[0]?.entity_id ?? "";
    return html`<select
      class="modelsel"
      aria-label=${t("suggest.model-label")}
      title=${t("suggest.model-hint")}
      .value=${chosen}
      @change=${(e: Event) => {
        panel.suggestModel = (e.target as HTMLSelectElement).value;
      }}
    >${models.map(
      (m) =>
        html`<option value=${m.entity_id} ?selected=${m.entity_id === chosen}>${m.name}</option>`,
    )}</select><span class="rgrow"></span>`;
  }

  /** A starting point into the composer, ready to edit: on its own in an
   * empty composer, after what is already typed otherwise. */
  private _fill(text: string): void {
    const input = this._input;
    if (!input) return;
    const draft = input.value.trim();
    const next = draft ? `${draft.replace(/[.\s]+$/, "")}. ${text}` : text;
    this._setDraft(next.slice(0, MAX_ASK));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** Drop the round in flight: its answer is ignored when it lands, and
   * the ask goes back to the composer to change or send again. */
  private _stop(): void {
    this._round += 1;
    this._settle();
    if (this._pending && this._empty) this._setDraft(this._pending);
    this.editor.panel.toast(t("suggest.stopped"));
  }

  private _settle(): void {
    this._busy = false;
    this._slow = false;
    clearTimeout(this._slowTimer);
  }

  /** One exchange: the ask, then the reply with what it changed, what was
   * not applied, and an undo back to before it (which drops it and every
   * later turn). A turn that applied nothing says why and offers Retry. */
  private _turn(turn: ChatTurn, i: number): unknown {
    const ask = html`<div class="msg user"><div class="bubble">${turn.ask}</div></div>`;
    if (turn.problem)
      return html`${ask}<div class="msg bot problem"><div class="reply"><span class="rtext">${turn.problem}</span></div><div class="ractions"><button
            type="button" class="btn ghost small retry"
            ?disabled=${this._busy}
            @click=${() => this._retry(i)}
          >${t("suggest.retry")}</button></div></div>`;
    const change = (c: SuggestChange): unknown =>
      html`<span class=${`chip ${c.kind}`}>${t(
        c.kind === "set"
          ? "suggest.change-set"
          : c.kind === "changed"
            ? "suggest.change-changed"
            : c.kind === "unsourced"
              ? "suggest.change-unsourced"
              : "suggest.change-cleared",
        { field: labelFor(c.key) },
      )}${c.detail ? ` (${c.detail})` : ""}</span>`;
    const turns = this.editor.editorState.chat;
    const after = turns.slice(i + 1).filter((other) => !other.problem);
    const later = after.length;
    // A turn that only asked back changed nothing: there is nothing to undo
    // unless a later turn did.
    const undoable = turn.changes.length > 0 || after.some((other) => other.changes.length > 0);
    return html`${ask}<div class="msg bot"><div class="reply"><span class="rtext">${
      turn.reply ?? (turn.changes.length ? t("suggest.done-quiet") : t("suggest.round-none"))
    }</span>${
      turn.changes.length
        ? html`<div class="rchanges">${turn.changes.map(change)}</div>`
        : // The reply is the model's own account, written before its
          // answer was applied: when it reports anything but a question
          // and the form is as it was, the panel states that nothing
          // changed.
          turn.reply &&
            !turn.rejected.length &&
            turn.match !== "none" &&
            turn.match !== "answer" &&
            !turn.reply.trim().endsWith("?")
          ? html`<div class="rsame">${t("suggest.round-none")}</div>`
          : nothing
    }${
      turn.rejected.length
        ? html`<div class="rrejected">${t("suggest.not-applied", {
            list: turn.rejected.map(rejectedText).join("; "),
          })}</div>`
        : nothing
    }</div>${
      undoable
        ? html`<div class="ractions"><button
          type="button" class="btn ghost small undo"
          aria-label=${
            later
              ? t("suggest.revert-label", { ask: turn.ask, count: later })
              : t("suggest.undo-label", { ask: turn.ask })
          }
          @click=${() => this._undoFrom(i)}
        >${icon("undo")}<span>${
          later ? t("suggest.revert", { count: later }) : t("suggest.undo")
        }</span></button></div>`
        : nothing
    }</div>`;
  }

  /** Without a working AI Task backend: one quiet line saying what the
   * feature is, what is missing, and where to fix it. Nothing to dismiss,
   * and no dead controls. */
  private _renderOff(state: Exclude<SuggestState, "ready">): unknown {
    const notLoaded = state === "not_loaded";
    const why = notLoaded ? t("suggest.off-not-loaded") : t("suggest.off-no-entity");
    const path = notLoaded ? INTEGRATIONS_PATH : AI_TASK_PREFS_PATH;
    const cta = notLoaded ? t("suggest.off-cta-not-loaded") : t("suggest.off-cta-no-entity");
    return html`<div class="why" id="suggest-off-why">${t("suggest.off-what")} ${why}
        <a
          href=${path}
          @click=${(e: Event) => {
            e.preventDefault();
            navigateLocal(path);
          }}
        >${cta}</a></div>`;
  }

  private async _run(text?: string): Promise<void> {
    const input = this._input;
    const description = (text ?? input?.value ?? "").trim().slice(0, MAX_ASK);
    if (!description || this._busy) return;
    const editor = this.editor;
    const editorState = editor.editorState;
    this._round += 1;
    const round = this._round;
    this._busy = true;
    this._slow = false;
    this._pending = description;
    this._redo = null;
    clearTimeout(this._slowTimer);
    this._slowTimer = setTimeout(() => {
      if (round === this._round && this._busy) this._slow = true;
    }, SLOW_MS);
    // The ask leaves the composer now, like a sent message: what the user
    // types while the model thinks is a new draft and stays.
    if (text === undefined) this._setDraft("");
    // The current form state is sent along (including hand edits made
    // between turns), with the conversation so far, so the model revises
    // instead of starting over. Turns that applied nothing are not part
    // of the conversation the model sees.
    const current = editor.prunedBindings();
    /** The ask stays in the transcript with what went wrong, and Retry. */
    const problem = (why: string): void => {
      editorState.chat.push({
        ask: description,
        reply: null,
        changes: [],
        before: structuredClone(current),
        after: structuredClone(current),
        rejected: [],
        problem: why,
      });
    };
    try {
      const res = await editor.panel.api.suggest({
        template: editorState.template,
        kind: editorState.kind,
        name: editorState.name,
        description,
        bindings: Object.keys(current).length ? current : undefined,
        history: editorState.chat.some((turn) => !turn.problem)
          ? editorState.chat
              .filter((turn) => !turn.problem)
              .map((turn) => ({ ask: turn.ask, reply: turn.reply ?? undefined }))
          : undefined,
        entity_id: editor.panel.suggestModel ?? undefined,
      });
      // The editor may have moved on while the model was thinking: closed
      // or stopped (drop the answer quietly), or edited by hand (applying
      // would silently undo those edits).
      if (editor.panel.editorState !== editorState || round !== this._round) return;
      if (JSON.stringify(editor.prunedBindings()) !== JSON.stringify(current)) {
        problem(t("suggest.stale"));
        return;
      }
      const bindings = res.bindings ?? {};
      const reply = res.reply ?? null;
      const rejected: SuggestRejected[] = res.rejected ?? [];
      const options = (res.options ?? []).filter((o) => typeof o === "string" && o.trim());
      if (!Object.keys(bindings).length && !reply && !rejected.length) {
        problem(t("suggest.no-mapping"));
        return;
      }
      const applied = Object.keys(bindings).length > 0;
      const states = editor.panel.hass.states;
      const changes = applied
        ? diffSuggestion(current, bindings, (id) => states[id]?.attributes.friendly_name || id)
        : [];
      // The pre-turn state, cloned so an undo shares no references with
      // anything the form later mutates.
      editorState.chat.push({
        ask: description,
        reply,
        changes,
        before: structuredClone(current),
        after: structuredClone(changes.length ? bindings : current),
        rejected,
        options,
        match: res.match ?? null,
      });
      if (changes.length) {
        editorState.bindings = bindings;
        editor.applySuggestion();
      }
    } catch (err) {
      if (round !== this._round || editor.panel.editorState !== editorState) return;
      problem(t("suggest.problem-failed", { error: errMsg(err) }));
    } finally {
      if (round === this._round) {
        this._settle();
        this.requestUpdate();
      }
    }
  }

  /** Send a turn's ask again, in place of the turn that applied nothing. */
  private _retry(i: number): void {
    const turn = this.editor.editorState.chat[i];
    if (!turn?.problem || this._busy) return;
    this.editor.editorState.chat.splice(i, 1);
    void this._run(turn.ask);
  }

  /** Back to before turn `i`: what the conversation changed since then
   * is reverted, edits made by hand since are kept, and the conversation
   * loses that turn and every later one (until Redo). */
  private _undoFrom(i: number): void {
    const editor = this.editor;
    const editorState = editor.editorState;
    const turn = editorState.chat[i];
    if (!turn || turn.problem) return;
    const applied = editorState.chat.filter((other) => !other.problem);
    const base = applied[applied.length - 1]?.after ?? turn.after;
    const current = structuredClone(editorState.bindings);
    const { bindings, kept } = revertTurn(current, base, turn.before);
    this._redo = { turns: editorState.chat.splice(i), bindings: current };
    editorState.bindings = bindings;
    editor.applySuggestion();
    editor.panel.toast(t(kept ? "suggest.undone-kept" : "suggest.undone"));
  }

  private _doRedo(): void {
    const redo = this._redo;
    if (!redo) return;
    const editor = this.editor;
    editor.editorState.chat.push(...redo.turns);
    editor.editorState.bindings = redo.bindings;
    this._redo = null;
    editor.applySuggestion();
  }
}

/** One rejection in words: the field, what was given, why not. */
function rejectedText(r: SuggestRejected): string {
  // A reason this bundle has no text for (the integration is newer than
  // this bundle) is shown as the general one.
  const key = `suggest.rejected.${r.reason}`;
  return t((tOpt(key) ? key : "suggest.rejected.bad_value") as TranslationKey, {
    field: labelFor(r.key),
    value: r.value,
  });
}

/** The composer grows with its text, up to a few lines, then scrolls. */
function grow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

define("aivi-suggest-box", AiviSuggestBox);
