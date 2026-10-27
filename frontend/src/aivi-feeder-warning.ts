// Automations that feed a widget or Live Activity by its slug (Aivi's
// blueprints, or hand-written ones): fed from here too, the two overwrite
// each other. The hub's cards and the editor warn of it and offer to turn the
// automation off. Nothing is turned off without the press, and never an
// automation that feeds other slugs or comes back on at every start.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import type { AiviPanel } from "./aivi-panel";
import { define } from "./define";
import { type TranslationKey, t, tSplit } from "./i18n";
import { icon } from "./icons";
import { banner } from "./notice";
import { navigateLocal } from "./onboarding";
import { focusLeft, watchOutsidePress } from "./popover";
import type { Feeder } from "./types/accounts";
import type { EditorKind } from "./types/editor";

/** Where Home Assistant edits an automation; its list for one written in
 * YAML without an id. */
export function automationPath(feeder: Feeder): string {
  return feeder.config_id
    ? `/config/automation/edit/${encodeURIComponent(feeder.config_id)}`
    : "/config/automation/dashboard";
}

function names(key: TranslationKey, feeders: Feeder[]): TemplateResult {
  const [before, after] = tSplit(key, "names");
  return html`${before}${feeders.map(
    (f, i) => html`${i ? ", " : ""}<a
        class="flink" href=${automationPath(f)}
        @click=${(e: MouseEvent) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault();
          navigateLocal(automationPath(f));
        }}
      >${f.name}</a>`,
  )}${after}`;
}

/** The button names automations only when it turns off some of those
 * listed, not all of them. */
function turnOffLabel(easy: Feeder[], feeders: Feeder[]): string {
  if (easy.length < feeders.length)
    return t("conflict.turn-off-named", { names: easy.map((f) => f.name).join(", ") });
  return t(feeders.length > 1 ? "conflict.turn-off-all" : "conflict.turn-off");
}

/** What the notice says: the automations by name, and why some are
 * left alone. */
function conflictText(feeders: Feeder[]): TemplateResult {
  const kept = feeders.filter((f) => f.keep !== null);
  const said = feeders.length > 1 ? "conflict.also-fed-several" : "conflict.also-fed";
  return html`<div>${names(said, feeders)}</div>${kept.map(
    (f) =>
      html`<div class="fkeep">${t(
        f.keep === "shared" ? "conflict.keep-shared" : "conflict.keep-initial_state",
        { name: f.name },
      )}</div>`,
  )}`;
}

/** The button that turns off the automations it may. */
function conflictAction(panel: AiviPanel, feeders: Feeder[]): TemplateResult | typeof nothing {
  const easy = feeders.filter((f) => f.keep === null);
  return easy.length
    ? html`<button
        type="button" class="btn secondary small"
        @click=${() => void panel.turnOffFeeders(easy)}
      >${turnOffLabel(easy, feeders)}</button>`
    : nothing;
}

/** The notice above the editor's form: the enabled automations feeding
 * the slug being edited. */
export function feederConflict(
  panel: AiviPanel,
  kind: EditorKind,
  slug: string,
): TemplateResult | typeof nothing {
  const feeders = panel.feedersOf(kind, slug);
  if (!feeders.length) return nothing;
  return banner("warn", conflictText(feeders), {
    role: "status",
    cls: "feeders",
    action: conflictAction(panel, feeders),
  });
}

/** On a hub card: a warning mark beside the name. Pressing it opens the
 * notice in a popup, so a card with a conflict stays as calm as one
 * without. A press outside, Escape, or focus leaving closes it. */
class AiviFeederWarning extends LitElement {
  static override properties = {
    panel: { attribute: false },
    kind: { attribute: false },
    slug: { attribute: false },
    // Read through the panel; a property so the mark follows a change.
    automations: { attribute: false },
    _open: { state: true },
  };
  declare panel: AiviPanel;
  declare kind: EditorKind;
  declare slug: string;
  declare private _open: boolean;
  private _unwatch: (() => void) | null = null;

  constructor() {
    super();
    this._open = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unwatch?.();
    this._unwatch = null;
  }

  private _toggle(open: boolean, refocus = false): void {
    this._open = open;
    if (refocus) this.querySelector<HTMLElement>(".fwbtn")?.focus();
  }

  protected override updated(): void {
    const pop = this.querySelector<HTMLDialogElement>("dialog.fwpop");
    if (pop && pop.open !== this._open) {
      if (this._open) {
        if (typeof pop.show === "function") pop.show();
        else pop.setAttribute("open", "");
        pop.focus();
      } else if (typeof pop.close === "function") pop.close();
      else pop.removeAttribute("open");
    }
    if (this._open && !this._unwatch)
      this._unwatch = watchOutsidePress(this, () => this._toggle(false));
    else if (!this._open && this._unwatch) {
      this._unwatch();
      this._unwatch = null;
    }
  }

  override render(): unknown {
    const feeders = this.panel.feedersOf(this.kind, this.slug);
    if (!feeders.length) return nothing;
    return html`<span
      class="fwwrap"
      @keydown=${(e: KeyboardEvent) => {
        if (e.key !== "Escape" || !this._open) return;
        e.stopPropagation();
        this._toggle(false, true);
      }}
      @focusout=${(e: FocusEvent) => {
        if (this._open && focusLeft(e, e.currentTarget as HTMLElement)) this._toggle(false);
      }}
    ><button
        type="button" class="fwbtn"
        aria-label=${t("conflict.mark")} title=${t("conflict.mark")}
        aria-haspopup="dialog" aria-expanded=${this._open ? "true" : "false"}
        @click=${() => this._toggle(!this._open)}
      >${icon("alert-outline")}</button><dialog
        class="fwpop" tabindex="-1" aria-label=${t("conflict.mark")}
        @close=${() => {
          this._open = false;
        }}
      ><div class="grow">${conflictText(feeders)}</div>${conflictAction(this.panel, feeders)}</dialog></span>`;
  }
}

define("aivi-feeder-warning", AiviFeederWarning);

/** The line for something this panel does not feed: who does. */
export function feederNote(
  panel: AiviPanel,
  kind: EditorKind,
  slug: string,
): TemplateResult | typeof nothing {
  const feeders = panel.feedersOf(kind, slug);
  return feeders.length
    ? html`<div class="sum fedby">${names("conflict.fed", feeders)}</div>`
    : nothing;
}
