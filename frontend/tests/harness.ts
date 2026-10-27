// Shared test harness: mounts the real <aivi-panel> against the harness
// mock hass (frontend/harness/ is the single source of fixture data), plus small
// DOM helpers. No fixture data is defined here.
//
// The integration's answers to previews, saves and defaults are replayed
// from tests/fixtures/engine.json, which `make fixtures` records from the
// real Python (scripts/refresh_fixtures.py).

import "../src/aivi-panel";
import { appendFileSync, readFileSync } from "node:fs";
import { afterEach } from "vitest";
import { makeHass as mockHass } from "../harness/mock-hass.js";
import { AiviEditor } from "../src/aivi-editor";
import type { AiviPanel } from "../src/aivi-panel";
import type { Bindings, SegmentBinding } from "../src/types/bindings";
import type { WidgetContent } from "../src/types/content";
import type { HassLike } from "../src/types/hass";
import { canonical } from "../src/util";

export { META, STATES } from "../harness/mock-hass.js";

const ANSWERS = new Map(
  (
    JSON.parse(readFileSync("frontend/tests/fixtures/engine.json", "utf8")) as {
      request: unknown;
      answer: object;
    }[]
  ).map(({ request, answer }) => [canonical(request), answer]),
);

// The icon picker fetches the SF Symbols index the integration serves
// beside the bundle; here the committed file answers.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("sf-symbols.json"))
    return Promise.resolve(
      new Response(readFileSync("custom_components/aivi/frontend/sf-symbols.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  return realFetch(input, init);
}) as typeof fetch;

// Closing an editor opened from the hub goes back in history. happy-dom
// would really navigate (and load the previous URL); here the call is
// only counted, and a test that cares plays the host's answer itself by
// assigning `panel.route`.
let backs = 0;
history.back = (): void => {
  backs++;
};
history.go = (delta = 0): void => {
  backs -= Math.min(0, delta);
};

/** How many entries history.back() and history.go() went back since the
 * last call. */
export function takeBacks(): number {
  const n = backs;
  backs = 0;
  return n;
}

/** While `make fixtures` records, every request is logged and an unknown
 * one answered with an error. Otherwise an unknown request is rejected
 * and fails the test. */
const RECORD = process.env["AIVI_ENGINE_RECORD"];
const missing: string[] = [];

/** The requests that had no recorded answer since the last call. */
export function takeMissing(): string[] {
  return missing.splice(0);
}

afterEach(() => {
  const keys = takeMissing();
  if (keys.length)
    throw new Error(`no recorded engine answer, run \`make fixtures\`:\n${keys.join("\n")}`);
});

// A debounced preview fires or not depending on the machine's speed, so
// recording also logs the preview each scheduling would send.
if (RECORD) {
  const schedule = AiviEditor.prototype.schedulePreview;
  AiviEditor.prototype.schedulePreview = function (this: AiviEditor, delay?: number) {
    const editorState = this.panel.editorState;
    if (editorState)
      void replay({
        type: "aivi/preview",
        template: editorState.template,
        bindings: this.effectiveBindings(),
        kind: editorState.kind,
      });
    schedule.call(this, delay);
  };
}

function replay(msg: object): Promise<object> {
  const key = canonical(msg);
  if (RECORD) appendFileSync(RECORD, `${key}\n`);
  const answer = ANSWERS.get(key);
  if (answer) return Promise.resolve(structuredClone(answer));
  if (RECORD) return Promise.resolve({ error: { code: "not_recorded", message: key } });
  missing.push(key);
  return Promise.reject(new Error(`no recorded engine answer, run \`make fixtures\`: ${key}`));
}

export function makeHass(): HassLike {
  return mockHass(replay);
}

/** Poll until `cond` holds (real timers only). */
export async function until(cond: () => boolean, what = "condition"): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** One macrotask: lets pending Lit updates and 0 ms timers settle. */
export async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`expected an element matching "${sel}"`);
  return el;
}

export function $$(root: ParentNode, sel: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(sel)];
}

/** Open a color field (itself, or the first one under `scope`) and
 * return its popover, where the palette lives. A pick closes it again. */
export async function openColor(scope: ParentNode): Promise<HTMLElement> {
  const field =
    scope instanceof Element && scope.matches("aivi-color-field")
      ? (scope as HTMLElement)
      : $(scope, "aivi-color-field");
  if (!field.querySelector(".cfpop")) $(field, ".cfbtn").click();
  await tick();
  return $(field, ".cfpop");
}

export function text(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The element's inline style, whitespace-stripped (happy-dom reserializes
 * `style` with extra spaces). */
export function css(el: Element): string {
  return (el.getAttribute("style") ?? "").replace(/\s+/g, "");
}

/** A keydown on `el`; false when a handler prevented its default. */
export function key(el: Element, name: string, init: KeyboardEventInit = {}): boolean {
  return el.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
  );
}

/** Re-render a Lit element after a change to state it does not observe. */
export function rerender(el: Element): void {
  (el as Element & { requestUpdate(): void }).requestUpdate();
}

export function setInput(el: HTMLElement, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function setSelect(el: HTMLElement, value: string): void {
  (el as HTMLSelectElement).value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Mounts a booted panel; `hass` defaults to the harness mock. */
export async function mountPanel(hass: HassLike = makeHass()): Promise<AiviPanel> {
  const el = document.createElement("aivi-panel") as AiviPanel;
  document.body.append(el);
  el.hass = hass;
  await until(() => !!el.shadowRoot?.querySelector(".wrap"), "panel boot");
  return el;
}

export function sr(panel: AiviPanel): ShadowRoot {
  const root = panel.shadowRoot;
  if (!root) throw new Error("panel has no shadow root");
  return root;
}

/** Opens the bind/edit editor for a widget slug from the mock account,
 * once its first preview has landed (so later edits never race it). */
export async function openWidgetEditor(panel: AiviPanel, slug: string): Promise<AiviEditor> {
  const acc = panel.accounts[0];
  if (!acc) throw new Error("no mock account");
  const remote = (panel.aiviWidgets[acc.entry_id] ?? []).find((w) => w.slug === slug) ?? null;
  const bound = acc.widgets.find((w) => w.slug === slug) ?? null;
  panel.openEditor(acc, remote, bound);
  await until(() => !!sr(panel).querySelector("aivi-editor .form"), `editor for ${slug}`);
  const editor = $(sr(panel), "aivi-editor") as AiviEditor;
  await previewSettled(editor);
  return editor;
}

/** Opens the bind/edit editor for a Live Activity slug from the mock
 * account, mirroring openWidgetEditor. */
export async function openActivityEditor(panel: AiviPanel, slug: string): Promise<AiviEditor> {
  const acc = panel.accounts[0];
  if (!acc) throw new Error("no mock account");
  const remote = (panel.aiviActivities[acc.entry_id] ?? []).find((a) => a.slug === slug) ?? null;
  const bound = (acc.activities ?? []).find((a) => a.slug === slug) ?? null;
  panel.openActivityEditor(acc, remote, bound);
  await until(() => !!sr(panel).querySelector("aivi-editor .form"), `activity editor for ${slug}`);
  const editor = $(sr(panel), "aivi-editor") as AiviEditor;
  await previewSettled(editor);
  return editor;
}

/** Waits until the editor's live preview has resolved (or failed). */
export async function previewSettled(editor: AiviEditor): Promise<void> {
  await until(() => editor.editorState.preview !== undefined, "preview");
  await tick();
}

/** The element holding the focus inside the panel. */
export function focused(panel: AiviPanel): Element | null {
  return sr(panel).activeElement;
}

/** Mounts a booted panel the way <ha-panel-custom> does: route (and the
 * other host properties) assigned before the first hass. */
export async function mountRouted(path: string, hass: HassLike = makeHass()): Promise<AiviPanel> {
  const el = document.createElement("aivi-panel") as AiviPanel;
  document.body.append(el);
  el.narrow = false;
  el.panel = { url_path: "aivi" };
  el.route = { prefix: "/aivi", path };
  el.hass = hass;
  await until(() => !!el.shadowRoot?.querySelector(".wrap"), "panel boot");
  return el;
}

/** An account whose fixture bindings (the widget and the demo Live
 * Activity) are hidden, so nothing is bound yet; saves still flow through
 * the mock's own state. */
export function unboundHass(): HassLike {
  const hass = makeHass();
  const orig = hass.callWS.bind(hass);
  hass.callWS = async (msg: object): Promise<unknown> => {
    const res = await orig(msg);
    if ((msg as { type: string }).type === "aivi/config") {
      const cfg = res as {
        accounts: Array<{
          widgets: Array<{ subentry_id: string }>;
          activities: Array<{ subentry_id: string }>;
        }>;
      };
      for (const acc of cfg.accounts) {
        acc.widgets = acc.widgets.filter((w) => w.subentry_id !== "w1");
        acc.activities = acc.activities.filter((a) => a.subentry_id !== "a1");
      }
    }
    return res;
  };
  return hass;
}

/** The hub card of the widget or Live Activity called `name`. */
export function hubCard(panel: AiviPanel, name: string): HTMLElement {
  const found = $$(sr(panel), "aivi-widget-card, aivi-activity-card").find(
    (c) => text($(c, ".nm")) === name,
  );
  if (!found) throw new Error(`no card named ${name}`);
  return found;
}

/** A stylesheet module's CSS, comments stripped. happy-dom computes no
 * layout, so a test about layout reads the stylesheet's source text. */
export function sheet(file: string): string {
  return readFileSync(`frontend/src/styles/${file}.ts`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declarations of the first rule whose selector is exactly
 * `selector`: renaming a selector fails the test that reads it. */
export function rule(file: string, selector: string): string {
  const source = sheet(file);
  const at = source.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule "${selector}" in styles/${file}.ts`);
  return source.slice(at + selector.length + 2, source.indexOf("}", at)).replace(/\s+/g, " ");
}

const SAMPLES = (await import("../harness/sample-data.json", { with: { type: "json" } })).default
  .samples as { id: string; bindings: Bindings }[];

/** The widget content the integration resolves one of the harness's
 * samples to. */
export async function resolvedSample(template: string, id: string): Promise<WidgetContent> {
  const found = SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`no sample ${id}`);
  const res = (await makeHass().callWS({
    type: "aivi/preview",
    template,
    bindings: structuredClone(found.bindings),
    kind: "widget",
  })) as { content: WidgetContent | null };
  if (!res.content) throw new Error(`unresolvable preview for ${template}`);
  return res.content;
}

export function fieldRow(root: ParentNode, key: string): HTMLElement {
  return $(root, `aivi-field-row[data-key="${key}"]`);
}

/** A field's own source menu: at the trailing edge of its row. */
export function sourceMenu(row: HTMLElement): HTMLSelectElement {
  return $(row, ":scope > .fsrc > select.srcsel") as HTMLSelectElement;
}

/** The phases stored for the progress template's bar. */
export function segs(editor: AiviEditor): SegmentBinding[] {
  return editor.editorState.bindings["segments"] as SegmentBinding[];
}

/** The bar-style switch of a segments editor. */
export function modeSwitch(seged: HTMLElement): HTMLElement {
  return $(seged, ".barmode .seg[role=radiogroup]");
}

export async function pickMode(seged: HTMLElement, label: string): Promise<void> {
  const btn = $$(modeSwitch(seged), "button").find((b) => b.textContent === label);
  if (!btn) throw new Error(`no bar mode labeled "${label}"`);
  btn.click();
  await tick();
}

/** The unbound progress widget's editor with its bar switched to
 * Segmented, which seeds two phases. */
export async function openSeeded(): Promise<{
  editor: AiviEditor;
  seged: HTMLElement;
}> {
  const panel = await mountPanel();
  const editor = await openWidgetEditor(panel, "laundry");
  const seged = $(sr(panel), "aivi-segments-editor");
  await pickMode(seged, "Segmented");
  return { editor, seged };
}

/** happy-dom rects are all zero; give the editor bar real geometry: 212px
 * wide: 206px of capsules around one 6px gap (2 segments, seam 0 at
 * x=106), or 200px around two (3 segments, seams at x=103 and x=159). */
export function sizeBar(seged: HTMLElement): void {
  Object.defineProperty($(seged, ".segbar"), "getBoundingClientRect", {
    value: () => ({
      left: 0,
      right: 212,
      top: 0,
      bottom: 28,
      width: 212,
      height: 28,
      x: 0,
      y: 0,
    }),
  });
}

/** A pointer event on the bar's hit overlay. */
export function pressBar(
  seged: HTMLElement,
  type: string,
  clientX: number,
  pointerType?: string,
): void {
  const e = new MouseEvent(type, { clientX, bubbles: true });
  if (pointerType) Object.defineProperty(e, "pointerType", { value: pointerType });
  $(seged, ".seghit").dispatchEvent(e);
}

/** Each capsule's aria-pressed, in bar order. */
export function pressedCapsules(seged: HTMLElement): string[] {
  return $$(seged, ".segcap").map((c) => c.getAttribute("aria-pressed") ?? "");
}

/** Each capsule's accessible name, in bar order. */
export function capsuleNames(seged: HTMLElement): string[] {
  return $$(seged, ".segcap").map((c) => c.getAttribute("aria-label") ?? "");
}

/** A button of the selected phase's inline editor, by its text. */
export function inlineButton(seged: HTMLElement, label: string): HTMLElement {
  const btn = $$(seged, ".seginline .segrow button").find((b) => b.textContent === label);
  if (!btn) throw new Error(`no inline button labeled "${label}"`);
  return btn;
}
