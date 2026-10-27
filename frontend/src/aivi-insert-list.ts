// <aivi-insert-list>: what the template workspace's Insert rail (and a
// phone's Insert sheet) offers to put in at the caret, in one list under
// one search: the entities the template names, the recipes that fit the
// field (template-recipes.ts), and every entity.
//
// A recipe is written for an entity, so it goes in finished: chosen from
// the list, it asks for the entity next (those it fits, the one at the
// caret first), or for none, and then the caret lands in the empty
// quotes; under an entity (Right, or its arrow), the recipes that fit it
// are listed with its attributes, and go in for it at once.
//
// It is a combobox: the focus stays in the search, Up and Down move
// through the list, Enter puts the highlighted item in, Right opens an
// entity and Left closes it, and Escape empties the search, then leaves a
// recipe's entity step. Nothing it puts in opens anything.

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { matchEntities } from "./aivi-entity-combobox";
import { define } from "./define";
import { t } from "./i18n";
import { icon } from "./icons";
import {
  type Recipe,
  recipeCode,
  recipesFor,
  recipesForEntity,
  recipeTitle,
} from "./template-recipes";
import type { EntityOption, HassLike } from "./types/hass";

/** Entities listed at once: past this the user narrows by searching. */
export const LISTED = 40;

/** Attributes not worth putting in a template. */
const HIDDEN_ATTRIBUTES = new Set(["friendly_name", "icon"]);

/** What a pick puts in: an entity's state or attribute, or a recipe for
 * an entity (or for none: its quotes left empty). */
export type InsertPick =
  | { kind: "entity"; id: string; attribute: string | null }
  | { kind: "recipe"; recipe: Recipe; id: string | null };

/** One row of the list: a pick, or a recipe that asks for its entity. */
interface Row {
  key: string;
  pick?: InsertPick;
  step?: Recipe;
}

/** The entities a template names that Home Assistant has, in order. */
export function entitiesIn(text: string, hass: HassLike): string[] {
  const found = text.match(/\b[a-z_]+\.[a-z0-9_]+\b/g) ?? [];
  return [...new Set(found.filter((id) => hass.states[id]))];
}

/** The list's entities: those matching `query`, without the ones the
 * template already names (they have their own section). */
export function browserMatches(
  options: readonly EntityOption[],
  query: string,
  named: readonly string[],
): EntityOption[] {
  return matchEntities(options, query).filter((o) => !named.includes(o.id));
}

/** The recipes of `kind` whose title or code holds every word of
 * `query`. */
export function recipeMatches(kind: string, query: string): readonly Recipe[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return recipesFor(kind).filter((r) => {
    const hay = `${t(recipeTitle(r))} ${recipeCode(r, null)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** An entity's state with its unit, as the list shows it. */
export function stateText(hass: HassLike, id: string): string {
  const entity = hass.states[id];
  if (!entity) return "";
  const unit = entity.attributes["unit_of_measurement"];
  return typeof unit === "string" && unit ? `${entity.state} ${unit}` : entity.state;
}

let nextId = 0;

export class AiviInsertList extends LitElement {
  static override properties = {
    hass: { attribute: false },
    options: { attribute: false },
    text: { attribute: false },
    kind: { attribute: false },
    near: { attribute: false },
    onPick: { attribute: false },
    _query: { state: true },
    _active: { state: true },
    _open: { state: true },
    _step: { state: true },
  };
  declare hass: HassLike;
  /** Every entity there is to pick from. */
  declare options: readonly EntityOption[];
  /** The template, for the entities it names. */
  declare text: string;
  /** The slot's kind: which recipes fit. */
  declare kind: string;
  /** The entity at the caret, or the one the template is about: a
   * recipe's entity step starts on it. */
  declare near: string | null;
  declare onPick: (pick: InsertPick) => void;
  declare private _query: string;
  /** The highlighted row's key. */
  declare private _active: string;
  /** Entities whose recipes and attributes are shown. */
  declare private _open: ReadonlySet<string>;
  /** The recipe whose entity is being picked. */
  declare private _step: Recipe | null;

  private readonly _id = `ins${nextId++}`;
  /** The rows in order, as last drawn. */
  private _rows: Row[] = [];

  constructor() {
    super();
    this.options = [];
    this.text = "";
    this.kind = "text";
    this.near = null;
    this.onPick = () => {};
    this._query = "";
    this._active = "";
    this._open = new Set();
    this._step = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /** Focus the search, ready to type or to move through the list. */
  focusSearch(): void {
    void this.updateComplete.then(() => this._search()?.focus());
  }

  private _search(): HTMLInputElement | null {
    return this.querySelector<HTMLInputElement>(".inssearch");
  }

  private _rowId(key: string): string {
    return `${this._id}-${key.replace(/[^\w-]/g, "_")}`;
  }

  private _name(id: string): string {
    const name = this.hass.states[id]?.attributes.friendly_name;
    return typeof name === "string" && name ? name : id;
  }

  private _attributes(id: string): string[] {
    return Object.keys(this.hass.states[id]?.attributes ?? {}).filter(
      (a) => !HIDDEN_ATTRIBUTES.has(a),
    );
  }

  /** The recipes that fit entity `id` in this field. */
  private _recipes(id: string): Recipe[] {
    const entity = this.hass.states[id];
    return entity ? recipesForEntity(this.kind, id, entity) : [];
  }

  /** Whether entity `id` opens: it has recipes or attributes. */
  private _opens(id: string): boolean {
    return this._recipes(id).length > 0 || this._attributes(id).length > 0;
  }

  private _choose(row: Row | undefined): void {
    if (!row) return;
    if (row.step) this._enter(row.step);
    else if (row.pick) {
      this.onPick(row.pick);
      if (this._step) this._leave(false);
    }
  }

  /** Ask for a recipe's entity. */
  private _enter(recipe: Recipe): void {
    this._step = recipe;
    this._query = "";
    this._active = "";
    const search = this._search();
    if (search) search.value = "";
    this.focusSearch();
  }

  /** Back from a recipe's entity step to the whole list, on the recipe. */
  private _leave(focus = true): void {
    const recipe = this._step;
    this._step = null;
    this._query = "";
    const search = this._search();
    if (search) search.value = "";
    this._active = recipe ? `r:${recipe.id}` : "";
    if (focus) this.focusSearch();
  }

  private _move(by: number): void {
    const rows = this._rows;
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.key === this._active);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
    if (next) this._active = next.key;
    void this.updateComplete.then(() =>
      this.querySelector(`#${this._rowId(this._active)}`)?.scrollIntoView({ block: "nearest" }),
    );
  }

  private _toggle(id: string, open: boolean): void {
    const next = new Set(this._open);
    if (open) next.add(id);
    else next.delete(id);
    this._open = next;
  }

  /** The entity a row belongs to: its own, or the one it is listed
   * under. */
  private _owner(row: Row | undefined): string | null {
    const pick = row?.pick;
    if (!pick || this._step) return null;
    if (pick.kind === "entity") return pick.id;
    return row.key.startsWith("x:") ? pick.id : null;
  }

  private _onKeydown(e: KeyboardEvent): void {
    const row = this._rows.find((r) => r.key === this._active);
    const input = e.target as HTMLInputElement;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        this._move(e.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        e.preventDefault();
        this._choose(row);
        return;
      case "ArrowRight": {
        if (row?.step) {
          e.preventDefault();
          this._enter(row.step);
          return;
        }
        const pick = row?.pick;
        if (this._step || pick?.kind !== "entity" || pick.attribute !== null) return;
        if (!this._opens(pick.id)) return;
        e.preventDefault();
        this._toggle(pick.id, true);
        return;
      }
      case "ArrowLeft": {
        if (this._step) {
          if (input.selectionStart !== 0 || input.selectionEnd !== 0) return;
          e.preventDefault();
          this._leave();
          return;
        }
        const owner = this._owner(row);
        if (!owner || (row?.key === `e:${owner}` && !this._open.has(owner))) return;
        e.preventDefault();
        this._toggle(owner, false);
        this._active = `e:${owner}`;
        return;
      }
      case "Backspace":
        if (this._step && !this._query) {
          e.preventDefault();
          this._leave();
        }
        return;
      case "Escape":
        if (!this._query && !this._step) return;
        // The list's own: emptied and back at the top, the next Escape
        // is the workspace's.
        e.preventDefault();
        e.stopPropagation();
        if (this._query) {
          this._query = "";
          input.value = "";
        } else this._leave();
        return;
    }
  }

  protected override render(): unknown {
    let rows: Row[] = [];
    const listId = `${this._id}-list`;
    const step = this._step;
    const build = (): unknown => (step ? this._stepBody(step, rows) : this._mainBody(rows));
    let body = build();
    if (!rows.some((r) => r.key === this._active)) {
      // Drawn again with the highlight where it starts.
      this._active = this._firstActive(rows);
      rows = [];
      body = build();
    }
    this._rows = rows;
    const label = step ? t("workspace.search-entity") : t("workspace.search");
    return html`${step ? this._stepHead(step) : nothing}<div class="insfield">${icon("magnify")}<input
        class="inssearch" type="text" role="combobox" autocomplete="off" spellcheck="false"
        aria-label=${label} placeholder=${label}
        aria-expanded="true" aria-controls=${listId} aria-autocomplete="list"
        aria-activedescendant=${this._active ? this._rowId(this._active) : nothing}
        .value=${this._query}
        @input=${(e: Event) => {
          this._query = (e.target as HTMLInputElement).value;
          this._active = "";
        }}
        @keydown=${(e: KeyboardEvent) => this._onKeydown(e)}
      /></div><div class="inslist" id=${listId} role="listbox" aria-label=${
        step ? t(recipeTitle(step)) : t("sheet.insert")
      }>${body}${rows.length ? nothing : html`<p class="insnone">${t("workspace.no-matches")}</p>`}</div>${
        step ? this._preview(step) : nothing
      }<p class="inskeys" aria-hidden="true">${
        step ? t("workspace.step-keys") : t("workspace.list-keys")
      }</p>`;
  }

  /** Where the highlight starts: in a recipe's step, on the entity at
   * the caret when it fits, else on the first row. */
  private _firstActive(rows: readonly Row[]): string {
    const near = this.near;
    if (this._step && near && !this._query) {
      const key = `p:${near}`;
      if (rows.some((r) => r.key === key)) return key;
    }
    return rows[0]?.key ?? "";
  }

  private _mainBody(rows: Row[]): unknown {
    const query = this._query;
    const named = entitiesIn(this.text, this.hass);
    const own = query
      ? matchEntities(
          named.map((id) => ({ id, name: this._name(id) })),
          query,
        ).map((o) => o.id)
      : named;
    const recipes = recipeMatches(this.kind, query);
    const matches = browserMatches(this.options, query, named);
    const shown = matches.slice(0, LISTED);
    const entityRows = (ids: readonly string[]): TemplateResult[] =>
      ids.map((id) => this._entity(id, rows));
    return html`${own.length ? this._section("own", t("sheet.in-template"), entityRows(own)) : nothing}${
      recipes.length
        ? this._section(
            "recipes",
            t("sheet.recipes"),
            recipes.map((r) => this._recipe(r, rows)),
          )
        : nothing
    }${
      shown.length
        ? this._section(
            "all",
            query ? t("sheet.matches") : t("sheet.all-entities"),
            entityRows(shown.map((o) => o.id)),
          )
        : nothing
    }${this._more(matches.length, shown.length)}`;
  }

  /** A recipe's entity step: the entities it fits (the template's
   * first), then the recipe without one. */
  private _stepBody(recipe: Recipe, rows: Row[]): unknown {
    const query = this._query;
    const fits = (id: string): boolean => {
      const entity = this.hass.states[id];
      return !!entity && recipe.fits(id, entity);
    };
    const named = entitiesIn(this.text, this.hass).filter(fits);
    const own = query
      ? matchEntities(
          named.map((id) => ({ id, name: this._name(id) })),
          query,
        ).map((o) => o.id)
      : named;
    const matches = browserMatches(this.options, query, named).filter((o) => fits(o.id));
    const shown = matches.slice(0, LISTED);
    const pickRows = (ids: readonly string[]): TemplateResult[] =>
      ids.map((id) => this._pickEntity(recipe, id, rows));
    // In the order they show: the rows list them so.
    const ownRows = own.length
      ? this._section("sown", t("sheet.in-template"), pickRows(own))
      : nothing;
    const fitRows = shown.length
      ? this._section(
          "sfit",
          query ? t("sheet.matches") : t("sheet.fits"),
          pickRows(shown.map((o) => o.id)),
        )
      : nothing;
    const without = this._option(
      { key: "p:", pick: { kind: "recipe", recipe, id: null } },
      rows,
      html`${icon("code-braces")}<span class="instext"><span class="insname">${t(
        "sheet.recipe-without",
      )}</span><code class="insid">${recipeCode(recipe, null)}</code></span>`,
      "snip",
    );
    return html`${ownRows}${fitRows}${this._more(matches.length, shown.length)}${this._section(
      "snone",
      t("sheet.or"),
      [without],
    )}`;
  }

  private _more(total: number, shown: number): unknown {
    return total > shown
      ? html`<p class="insmore">${t("combobox.more", { shown, total })}</p>`
      : nothing;
  }

  /** What the highlighted pick of a recipe's step writes, under the
   * list: the template, as it will go in. */
  private _preview(recipe: Recipe): TemplateResult {
    const id = this._active.startsWith("p:") ? this._active.slice(2) || null : null;
    const code = recipe.write(id, id ? this.hass.states[id] : undefined).text;
    return html`<div class="insprev"><span class="k">${t("sheet.writes")}</span><code>${code}</code></div>`;
  }

  /** The step's title over the search: back to the list, and what the
   * entity is picked for. */
  private _stepHead(recipe: Recipe): TemplateResult {
    return html`<div class="insstep"><button
        type="button" class="iconbtn" aria-label=${t("workspace.step-back")} title=${t("workspace.step-back")}
        @mousedown=${(e: Event) => e.preventDefault()}
        @click=${() => this._leave()}
      >${icon("chevron-left")}</button><div class="insstept"><span class="insname">${t(
        recipeTitle(recipe),
      )}</span><span class="insstepsub">${t("sheet.recipe-pick")}</span></div></div>`;
  }

  private _section(id: string, title: string, body: TemplateResult[]): TemplateResult {
    const head = `${this._id}-${id}`;
    return html`<div class="inssec" role="group" aria-labelledby=${head}><div class="inshead" id=${head} role="presentation">${title}</div>${body}</div>`;
  }

  /** A row: the mouse picks without taking the focus from the search
   * (or, on a phone, from the editor). */
  private _option(
    row: Row,
    rows: Row[],
    body: unknown,
    cls: string,
    extra: unknown = nothing,
  ): TemplateResult {
    rows.push(row);
    const active = row.key === this._active;
    return html`<div
      class=${`insopt ${cls}${active ? " active" : ""}`} id=${this._rowId(row.key)}
      role="option" aria-selected=${active ? "true" : "false"}
      @mousedown=${(e: Event) => e.preventDefault()}
      @click=${() => this._choose(row)}
    >${body}${extra}</div>`;
  }

  /** An entity's name, id and state. */
  private _entityText(id: string): TemplateResult {
    const state = stateText(this.hass, id);
    return html`<span class="instext"><span class="insname">${this._name(id)}</span><span class="insid">${id}${
      state ? html`<span class="insstate"> · ${state}</span>` : nothing
    }</span></span>`;
  }

  private _entity(id: string, rows: Row[]): TemplateResult {
    const entity = this.hass.states[id];
    const opens = this._opens(id);
    const open = this._open.has(id) && opens;
    const toggle = opens
      ? html`<span class=${`insmore-btn${open ? " open" : ""}`} aria-hidden="true" title=${t("sheet.more")}
          @mousedown=${(e: Event) => e.preventDefault()}
          @click=${(e: Event) => {
            e.stopPropagation();
            this._toggle(id, !open);
          }}>${icon("chevron-right")}</span>`
      : nothing;
    const main = this._option(
      { key: `e:${id}`, pick: { kind: "entity", id, attribute: null } },
      rows,
      html`${icon("entity")}${this._entityText(id)}`,
      "ent",
      toggle,
    );
    if (!open || !entity) return main;
    const recipes = this._recipes(id).map((recipe) =>
      this._option(
        { key: `x:${id}:${recipe.id}`, pick: { kind: "recipe", recipe, id } },
        rows,
        html`${icon("auto-fix")}<span class="instext"><span class="insname wraps" title=${recipeCode(
          recipe,
          id,
          entity,
        )}>${t(recipeTitle(recipe))}</span></span>`,
        "sub recipe",
      ),
    );
    const attributes = this._attributes(id).map((a) => {
      const value = entity.attributes[a];
      return this._option(
        { key: `a:${id}:${a}`, pick: { kind: "entity", id, attribute: a } },
        rows,
        html`${icon("attribute")}<span class="instext"><span class="insname mono">${a}</span>${
          value === undefined || value === null || typeof value === "object"
            ? nothing
            : html`<span class="insid">${String(value)}</span>`
        }</span>`,
        "sub attr",
      );
    });
    return html`${main}${recipes}${attributes}`;
  }

  /** A recipe in the whole list: chosen, it asks for its entity (or,
   * reading none, goes in). */
  private _recipe(recipe: Recipe, rows: Row[]): TemplateResult {
    const row: Row = recipe.entity
      ? { key: `r:${recipe.id}`, step: recipe }
      : { key: `r:${recipe.id}`, pick: { kind: "recipe", recipe, id: null } };
    return this._option(
      row,
      rows,
      html`${icon("auto-fix")}<span class="instext"><span class="insname wraps" title=${recipeCode(
        recipe,
        null,
      )}>${t(recipeTitle(recipe))}</span></span>`,
      "recipe",
      recipe.entity
        ? html`<span class="insmore-btn" aria-hidden="true">${icon("chevron-right")}</span>`
        : nothing,
    );
  }

  /** An entity in a recipe's step: chosen, the recipe goes in for it. */
  private _pickEntity(recipe: Recipe, id: string, rows: Row[]): TemplateResult {
    return this._option(
      { key: `p:${id}`, pick: { kind: "recipe", recipe, id } },
      rows,
      html`${icon("entity")}${this._entityText(id)}`,
      "ent",
    );
  }
}

define("aivi-insert-list", AiviInsertList);

declare global {
  interface HTMLElementTagNameMap {
    "aivi-insert-list": AiviInsertList;
  }
}
