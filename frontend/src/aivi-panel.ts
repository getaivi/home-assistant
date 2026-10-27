// The Aivi panel: the primary configuration UI. Bundled by Vite into the single module panel.py serves.
//
// <aivi-panel> owns the shadow root and the stylesheet; every internal
// aivi-* element renders into light DOM inside it, so one sheet styles the
// whole tree and HA's theme variables cascade straight through.
//
// The element holds what was read from the integration (accounts, their
// widgets and Live Activities) and which view shows: the hub, one
// editor, or the activity log. What surrounds that has a module each: the URL (panel-router.ts),
// the live event streams (inputs-feed.ts), the Refresh button
// (change-check.ts), the hub's bar (hub-bar.ts) and its accounts panel
// (accounts-menu.ts).

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { AccountsMenu } from "./accounts-menu";
import { AiviApi, isSubscriptionInactive, type SuggestModel, type SuggestState } from "./api";
import { BUILD_STAMP } from "./build-info";
import { ChangeCheck } from "./change-check";
import { define } from "./define";
import { activityEditorState, findBySlug, widgetEditorState } from "./editor-state";
import { EntityOptions } from "./entity-options";
import { hubBar } from "./hub-bar";
import type { HubChip } from "./hub-filter";
import { loadCatalog, t } from "./i18n";
import { icon } from "./icons";
import { InputsFeed } from "./inputs-feed";
import { PanelRouter } from "./panel-router";
import type { PreviewSize } from "./preview-render";
import type { HostRoute } from "./router";
import { panelStyles } from "./styles";
import { findTemplateSlot } from "./template-slots";
import { Toasts } from "./toasts";
import type {
  Account,
  BindingStatus,
  BoundWidget,
  Feeder,
  PressRow,
  PushRow,
  RemoteActivity,
  RemoteWidget,
  StreamStatus,
} from "./types/accounts";
import type { ChatTurn, EditorKind, EditorState } from "./types/editor";
import type { EntityOption, HassLike } from "./types/hass";
import type { EntityFilter, Meta } from "./types/meta";
import { errMsg } from "./util";

// Side-effect imports register the internal custom elements.
import "./aivi-hub";
import "./aivi-editor";
import "./aivi-field-row";
import "./aivi-entity-combobox";
import "./aivi-preview-pane";
import "./aivi-suggest-box";
import "./aivi-rows-checklist";
import "./aivi-segments-editor";
import "./aivi-swatches";
import "./aivi-color-field";
import "./aivi-icon-field";
import "./aivi-gradient-field";
import "./aivi-color-ramp";
import "./aivi-events";
import "./aivi-recent-activity";
import "./aivi-activity-log";

import type { Show } from "./aivi-activity-log";
import type { AiviEditor } from "./aivi-editor";

// Staleness beacon: identifies the bundle's commit in the browser console
// (see qa/README.md).
console.info(`Aivi panel build ${BUILD_STAMP}`);

export class AiviPanel extends LitElement {
  static override styles = panelStyles;
  static override properties = {
    _rev: { state: true },
    // Assigned by <ha-panel-custom> at HA's own breakpoint (~870 px).
    // Reflected so the stylesheet keys structural layout off
    // :host([narrow]); fine-grained sizing uses media queries instead.
    narrow: { type: Boolean, reflect: true },
  };
  declare private _rev: number;
  declare narrow: boolean;

  readonly api: AiviApi = new AiviApi(() => this.hass);

  private _hass: HassLike | null = null;
  private _booted = false;
  private _meta: Meta | null = null;
  private _accounts: Account[] = [];
  private _aiviWidgets: Record<string, RemoteWidget[] | null> = {};
  private _aiviActivities: Record<string, RemoteActivity[] | null> = {};
  private _inactive: Record<string, boolean> = {};
  private _suggestState: SuggestState = "not_loaded";
  /** The AI Task models a conversation can ask, the preferred one first. */
  suggestModels: SuggestModel[] = [];
  /** Automations that feed a slug by calling Aivi's rest_command. */
  automations: Feeder[] = [];
  /** The integration's version, for the accounts panel's About lines. */
  version: string | null = null;
  /** The model the user picked for this panel's lifetime; null = the
   * first (preferred) one. */
  suggestModel: string | null = null;
  /** Whether the editor's chat sidebar is open: kept across editors for
   * this panel's lifetime, a tool left as the user set it. */
  suggestOpen = false;
  /** Conversations of saved editors, by widget: reopening one after a
   * save continues it. A discarded editor's conversation is dropped,
   * since its turns describe changes the form no longer has. */
  private _chats = new Map<string, ChatTurn[]>();
  // Named `_view`/`view` (not `route`): Home Assistant's <ha-panel-custom>
  // host assigns `route`, `panel` and `narrow` properties onto the custom
  // element, so `route` here is reserved for the host's {prefix, path}
  // object (and must always stay assignable: a getter-only accessor
  // throws on panel load).
  private _view: "home" | "editor" | "log" = "home";
  /** The address of the open editor's template workspace (router.ts),
   * or null while its form shows. */
  private _workspace: string | null = null;
  /** The hub's search text and status chip. Kept here, not on the hub
   * element, so they survive a visit to an editor (which unmounts the
   * hub); still not in the URL (see hub-filter.ts). */
  hubQuery = "";
  hubChip: HubChip = "all";
  /** What the Log page opens narrowed to: the account and the "For"
   * subject of the editor whose Log card links there, or the "Show" of
   * the Events panel's link. Panel state like the hub's search, not in
   * the URL; the page takes it once, and the editor's "Keep editing"
   * drops it. */
  logPreset: { entryId?: string; subject?: string; show?: Show } | null = null;
  /** The size each template's widget preview was last switched to, for
   * the session: kept here so it survives the editor closing. */
  previewSizes = new Map<string, PreviewSize>();
  private _bootError: unknown = null;
  // Set when a save takes the account's bound count 0 -> 1; rendered by
  // the hub as a dismissible banner (not a toast, so it doesn't expire).
  private _firstBindName: string | null = null;

  // Assigned by <ha-panel-custom> alongside hass/route/narrow; unused, but
  // it must remain a plain assignable property (see the note on _view).
  declare panel?: unknown;

  /** Editor state; non-null while the editor route is open. */
  editorState: EditorState | null = null;

  private readonly _entityOptions = new EntityOptions();
  private readonly _toasts = new Toasts();
  private readonly _accountsMenu = new AccountsMenu(this);

  private readonly _router = new PanelRouter({
    view: () => this._view,
    editorState: () => this.editorState,
    show: (state) => this._show(state),
    workspace: () => this._workspace,
    showWorkspace: (address) => {
      this._workspace = address;
      this._bump();
    },
    templateAt: (state, address) =>
      findTemplateSlot(
        (state.kind === "activity" ? this._meta?.activity_templates : this._meta?.templates)?.[
          state.template
        ],
        state.bindings,
        address,
      ) !== null,
    stateFor: (kind, slug) => this._stateFor(kind, slug),
    listsRead: (kind) => {
      const lists = kind === "activity" ? this._aiviActivities : this._aiviWidgets;
      return (
        this._accounts.length > 0 &&
        this._accounts.every((acc) => Array.isArray(lists[acc.entry_id]))
      );
    },
    editor: () => this._editorEl(),
    toast: (text) => this.toast(text),
  });

  private readonly _inputs = new InputsFeed(this, {
    api: this.api,
    accounts: () => this._accounts.map((acc) => acc.entry_id),
    changed: () => {
      this._bump();
      for (const live of this.shadowRoot?.querySelectorAll<LitElement>(
        "aivi-recent-activity, aivi-events, aivi-activity-log",
      ) ?? [])
        live.requestUpdate();
    },
  });

  private readonly _changes = new ChangeCheck(this, {
    refresh: () => this.refresh(),
    listed: () => this._listedSlugs(),
    unreachable: () =>
      this._accounts.some(
        (acc) => this._aiviWidgets[acc.entry_id] === null && !this._inactive[acc.entry_id],
      ),
    changed: () => this._bump(),
  });

  constructor() {
    super();
    this._rev = 0;
    this.narrow = false;
  }

  // Toasts live outside Lit's managed DOM: their container is appended to
  // the shadow root once and used as the renderBefore anchor, so Lit's
  // root part range ends before it and no template swap can clear it.
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    root.append(this._toasts.host);
    this.renderOptions.renderBefore = this._toasts.host;
    return root;
  }

  // HA assigns `hass` on every state change; only an open editor reacts
  // (refreshing its preview when a bound entity changed).
  set hass(hass: HassLike) {
    const prev = this._hass;
    this._hass = hass;
    if (!prev && !this._booted) {
      this._booted = true;
      void this._boot();
    } else if (prev && this._view === "editor") {
      this._editorEl()?.hassChanged(prev, hass);
    }
  }

  get hass(): HassLike {
    // Only read after boot, which the first `hass` assignment triggers.
    return this._hass as HassLike;
  }

  // The host assigns a fresh route object on every navigation (deep link,
  // back/forward, our own pushes echoed back). Before boot it is only
  // stored; _boot applies it once the data it needs has loaded.
  set route(route: HostRoute | null) {
    this._router.route = route;
    if (route && this._meta) this._router.apply(route.path);
  }

  get route(): HostRoute | null {
    return this._router.route;
  }

  get meta(): Meta {
    return this._meta as Meta;
  }

  get accounts(): Account[] {
    return this._accounts;
  }

  get aiviWidgets(): Record<string, RemoteWidget[] | null> {
    return this._aiviWidgets;
  }

  get aiviActivities(): Record<string, RemoteActivity[] | null> {
    return this._aiviActivities;
  }

  /** Per account: paused because its subscription isn't active. */
  get inactive(): Record<string, boolean> {
    return this._inactive;
  }

  /** How the account's event stream stands; null while nothing it binds
   * accepts input. Live while subscribed, else aivi/config's snapshot. */
  streamOf(acc: Account): StreamStatus | null {
    const live = this._inputs.of(acc.entry_id);
    return live ? live.stream : (acc.stream ?? null);
  }

  /** Everything the devices sent the account lately, newest first. */
  eventsOf(acc: Account): PressRow[] {
    return this._inputs.of(acc.entry_id)?.presses ?? [];
  }

  /** Everything the account sent to Aivi lately, newest first. */
  pushesOf(acc: Account): PushRow[] {
    return this._inputs.of(acc.entry_id)?.pushes ?? [];
  }

  /** How a binding's pushing stands now, while the account says. */
  statusOf(acc: Account, subentryId: string): BindingStatus | null {
    return this._inputs.of(acc.entry_id)?.status?.[subentryId] ?? null;
  }

  /** The enabled automations feeding a widget or Live Activity. */
  feedersOf(kind: EditorKind, slug: string): Feeder[] {
    return this.automations.filter((f) => f.enabled && f.kind === kind && f.slug === slug);
  }

  /** Turn automations off, as the user: Home Assistant remembers it. */
  async turnOffFeeders(feeders: Feeder[]): Promise<void> {
    try {
      const res = await this.api.turnOffAutomations(feeders.map((f) => f.entity_id));
      this.automations = res.automations;
      this.toast(t("conflict.turned-off"));
    } catch (err) {
      this.toast(errMsg(err));
    }
    this._bump();
    this._editorEl()?.requestUpdate();
  }

  get suggestState(): SuggestState {
    return this._suggestState;
  }

  get view(): "home" | "editor" | "log" {
    return this._view;
  }

  /** The widget name to celebrate in the first-bind banner; null when
   * there is nothing to celebrate (or it was dismissed). */
  get firstBindName(): string | null {
    return this._firstBindName;
  }

  celebrateFirstBind(name: string): void {
    this._firstBindName = name;
    this._bump();
  }

  dismissFirstBind(): void {
    this._firstBindName = null;
    this._bump();
  }

  /** Sorted pickable entities for a field's filter (entity-options.ts).
   * Treat the result as read-only, it is shared. */
  entities(filter?: EntityFilter): EntityOption[] {
    return this._entityOptions.for(this.hass.states, filter);
  }

  toast(text: string): void {
    this._toasts.show(text);
  }

  private _bump(): void {
    this._rev++;
  }

  private _editorEl(): AiviEditor | null {
    return this.shadowRoot?.querySelector<AiviEditor>("aivi-editor") ?? null;
  }

  private async _boot(): Promise<void> {
    this._bootError = null;
    try {
      // The catalog loads before the first render so no string flashes
      // English. loadCatalog never throws (falls back to bundled en).
      const [meta] = await Promise.all([this.api.templates(), loadCatalog(this.hass)]);
      this._meta = meta;
      await this.refresh();
      // The URL carries view state: reopen a deep-linked editor now that
      // the widget lists exist to resolve it against.
      if (this._router.route) this._router.apply(this._router.route.path, true);
    } catch (err) {
      this._bootError = err;
      this._bump();
    }
  }

  async refresh(): Promise<void> {
    const res = await this.api.config();
    this._accounts = res.accounts;
    this._suggestState = res.suggest_state ?? "not_loaded";
    this.suggestModels = res.suggest_models ?? [];
    this.version = res.version ?? null;
    this.automations = res.automations ?? [];
    if (this.suggestModel && !this.suggestModels.some((m) => m.entity_id === this.suggestModel))
      this.suggestModel = null;
    // The listings are the latest word on the subscription: a refusal
    // means inactive, an answer active; neither keeps aivi/config's state.
    const answered = new Set<string>();
    const refused = new Set<string>();
    const listed = (acc: Account, err?: unknown): void => {
      if (err === undefined) answered.add(acc.entry_id);
      else if (isSubscriptionInactive(err)) refused.add(acc.entry_id);
    };
    await Promise.all(
      this._accounts.flatMap((acc) => [
        this.api.widgets(acc.entry_id).then(
          (r) => {
            this._aiviWidgets[acc.entry_id] = r.widgets;
            listed(acc);
          },
          (err: unknown) => {
            this._aiviWidgets[acc.entry_id] = null; // unreachable or paused
            listed(acc, err);
          },
        ),
        this.api.activities(acc.entry_id).then(
          (r) => {
            this._aiviActivities[acc.entry_id] = r.activities;
            listed(acc);
          },
          (err: unknown) => {
            this._aiviActivities[acc.entry_id] = null; // unreachable or paused
            listed(acc, err);
          },
        ),
      ]),
    );
    this._inactive = Object.fromEntries(
      this._accounts.map((acc) => [
        acc.entry_id,
        refused.has(acc.entry_id) ||
          (acc.subscription === "inactive" && !answered.has(acc.entry_id)),
      ]),
    );
    // The first-bind banner celebrates a binding: it goes when that
    // binding does.
    if (
      this._firstBindName !== null &&
      !this._accounts.some((acc) =>
        [...acc.widgets, ...(acc.activities ?? [])].some((w) => w.name === this._firstBindName),
      )
    )
      this._firstBindName = null;
    this._inputs.sync();
    this._bump();
  }

  /** What the Refresh button shows (change-check.ts). */
  get refreshState(): ChangeCheck["state"] {
    return this._changes.state;
  }

  /** The cards a refresh just found (`kind:slug`): they glow once. */
  get fresh(): Set<string> {
    return this._changes.fresh;
  }

  /** Ask Aivi again what the account holds: the Refresh button, and
   * nothing else. */
  checkForChanges(): Promise<void> {
    return this._changes.run();
  }

  /** Every listed widget and activity, as `kind:slug`. */
  private _listedSlugs(): Set<string> {
    const out = new Set<string>();
    for (const list of Object.values(this._aiviWidgets))
      for (const item of list ?? []) out.add(`widget:${item.slug}`);
    for (const list of Object.values(this._aiviActivities))
      for (const item of list ?? []) out.add(`activity:${item.slug}`);
    return out;
  }

  openEditor(acc: Account, remote: RemoteWidget | null, bound: BoundWidget | null): void {
    this._router.open(
      widgetEditorState(acc, remote, bound, this._chatOf(acc, "widget", (remote ?? bound)?.slug)),
    );
  }

  openActivityEditor(acc: Account, remote: RemoteActivity | null, bound: BoundWidget | null): void {
    this._router.open(
      activityEditorState(
        acc,
        remote,
        bound,
        this._chatOf(acc, "activity", (remote ?? bound)?.slug),
      ),
    );
  }

  /** Leave the editor (Back, Save, Discard). `to` is the route path a
   * held-back navigation asked for: the panel then continues there
   * instead of the hub. */
  closeEditor(to: string | null = null): void {
    this._router.close(to);
  }

  /** Open the open editor's template workspace for the box at
   * `address` (Expand). */
  openTemplate(address: string): void {
    this._router.openTemplate(address);
  }

  /** Back from the template workspace to its editor's form. */
  closeTemplate(): void {
    this._router.closeTemplate();
  }

  /** Open the activity log (the bar's Log button, and links). */
  openLog(): void {
    this._router.openLog();
  }

  /** Back from the activity log to the hub. */
  closeLog(): void {
    this._router.closeLog();
  }

  /** The address of the template workspace in view, or null. */
  get workspace(): string | null {
    return this._workspace;
  }

  /** Keep the open editor's conversation, as it is now, for when it is
   * opened again: turns after this are not kept unless kept again. */
  keepChat(): void {
    const editorState = this.editorState;
    if (editorState?.chat.some((turn) => !turn.problem))
      this._chats.set(`${editorState.entryId}:${editorState.kind}:${editorState.slug}`, [
        ...editorState.chat,
      ]);
  }

  private _chatOf(acc: Account, kind: EditorKind, slug: string | undefined): ChatTurn[] {
    return this._chats.get(`${acc.entry_id}:${kind}:${slug ?? ""}`) ?? [];
  }

  /** The state a route's slug opens an editor with; null when no account
   * has it. */
  private _stateFor(kind: EditorKind, slug: string): EditorState | null {
    const found = findBySlug(
      kind,
      slug,
      this._accounts,
      kind === "widget" ? this._aiviWidgets : this._aiviActivities,
    );
    if (!found) return null;
    const chat = this._chatOf(found.acc, kind, slug);
    return kind === "widget"
      ? widgetEditorState(found.acc, found.remote, found.bound, chat)
      : activityEditorState(found.acc, found.remote, found.bound, chat);
  }

  /** Show the editor for `state`, the activity log, or the hub for
   * null. */
  private _show(target: EditorState | "log" | null): void {
    if (target === "log") {
      this.editorState = null;
      this._view = "log";
    } else {
      this.editorState = target;
      this._view = target ? "editor" : "home";
    }
    this._workspace = null;
    this._bump();
  }

  errorCard(err: unknown): TemplateResult {
    return html`<div class="hero-empty"><h2>${t("error.boot-title")}</h2><p>${errMsg(err)}</p><div style="margin-top:14px"><button class="btn primary" @click=${() => void this._boot()}>${t("common.retry")}</button></div></div>`;
  }

  /** The narrow-mode sidebar toggle, HA's own toolbar contract: every
   * native panel renders a menu button when narrow, and without one the
   * companion app has no way back to the sidebar. The event is what
   * <ha-menu-button> fires; HA's app shell listens for it on the tree. */
  menuButton(): unknown {
    if (!this.narrow) return nothing;
    return html`<button
      class="iconbtn menubtn"
      aria-label=${t("common.menu")}
      @click=${() =>
        this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))}
    >${icon("menu")}</button>`;
  }

  override render(): unknown {
    if (this._bootError != null)
      return html`<div class="wrap">${this.errorCard(this._bootError)}</div>`;
    if (!this._meta) return nothing; // waiting for the first hass + boot
    if (this._view === "log")
      return html`<div class="wrap"><aivi-activity-log .panel=${this} .rev=${this._rev}></aivi-activity-log></div>`;
    if (this._view === "editor") {
      // Keyed by the editor's identity: an editor -> editor route change
      // swaps `editorState` but not `panel` (the only reactive prop), so an unkeyed
      // element would keep the old state. The same identity leaves the
      // mounted editor untouched, preserving focus.
      // A template workspace takes the panel's width (up to a cap); every
      // other page keeps the frame's.
      const editorState = this.editorState;
      return html`<div class=${this._workspace === null ? "wrap" : "wrap ws"}>${keyed(
        editorState ? `${editorState.kind}:${editorState.subentryId ?? editorState.slug}` : "",
        html`<aivi-editor .panel=${this} .workspace=${this._workspace}></aivi-editor>`,
      )}</div>`;
    }
    return html`<div class="wrap">${hubBar(this, this._accountsMenu)}<aivi-hub .panel=${this} .rev=${this._rev}></aivi-hub></div>`;
  }
}

define("aivi-panel", AiviPanel);
