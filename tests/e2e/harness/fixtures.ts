import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { addRow, pickEntity } from "../panel";

const SNAPSHOTS = join(__dirname, "../../../snapshots");

/** The slice of a pushed payload the checks read from the editor's
 * "what will be pushed" disclosure. */
export interface Payload {
  accent?: string;
  color?: string;
  gradient?: string[];
  devices?: { name: string }[];
  progress?: {
    style?: string;
    segments?: { value: number; source?: unknown }[];
  };
}

/** A template box's text: the code editor's content element, which
 * Playwright fills and reads like a text field. */
export const TEMPLATE_BOX = "aivi-code-editor .cm-content";

/** The panel as the harness mounts it. Playwright's CSS selectors pierce
 * its open shadow root. */
export class Panel {
  constructor(private readonly page: Page) {}

  /** Open a harness page and wait for the hub. The unbound Grill activity
   * card is the readiness signal: it only renders once the remote activity
   * listing has merged into the hub. */
  async openHub(url = "index.html"): Promise<void> {
    await this.page.goto(url);
    await this.hubReady();
  }

  async hubReady(): Promise<void> {
    await expect(this.page.locator("aivi-activity-card", { hasText: "Grill" })).toBeVisible();
  }

  /** Open a deep link into an editor and wait for its title. */
  async openEditor(url: string, title: string): Promise<void> {
    await this.page.goto(url);
    await this.editorReady(title);
  }

  async editorReady(title: string): Promise<void> {
    await expect(this.page.locator(".topbar .title", { hasText: title })).toBeVisible();
  }

  /** The payload disclosure only renders once the live preview resolved. */
  async previewReady(): Promise<void> {
    await expect(this.page.locator("details.payload")).toBeAttached();
  }

  get payloadText(): Locator {
    return this.page.locator("details.payload pre");
  }

  async payload(): Promise<Payload> {
    return JSON.parse((await this.payloadText.textContent()) ?? "{}") as Payload;
  }

  get save(): Locator {
    return this.page.locator(".topbar .btn.primary");
  }

  field(key: string): Locator {
    return this.page.locator(`aivi-field-row[data-key="${key}"]`);
  }

  /** Type into an entity picker and choose the option naming `entityId`. */
  pickEntity(input: Locator, query: string, entityId: string): Promise<void> {
    return pickEntity(this.page, input, query, entityId);
  }

  /** Add a row to a rows field through its picker, by name or entity id;
   * a row that is already there is left alone. */
  addRow(text: string, scope = ""): Promise<void> {
    return addRow(this.page, text, scope);
  }

  /** Switch the widget preview to a size and wait for the canvas drawn
   * at it. */
  async previewSize(label: "Small" | "Medium"): Promise<void> {
    await this.page
      .locator("aivi-preview-pane .phead .seg")
      .getByRole("radio", { name: label })
      .click();
    await expect(this.page.locator(`.pv-stage .pv-canvas.is-${label.toLowerCase()}`)).toBeVisible();
  }

  /** The bar-style choice (Solid, Segmented, Layered). */
  barMode(label: string): Locator {
    return this.page.locator(".barmode .seg[role='radiogroup'] button", {
      hasText: label,
    });
  }
}

/** The center of an element, for raw mouse input. */
export async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${String(locator)} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** No CSS transition or animation runs on a harness page, from its first
 * paint: a capture or an audit never sees colors halfway through one (a
 * light page's text caught on its way from a dark gray). Every document
 * and shadow root adopts one stylesheet that turns them off, kept when a
 * root's sheets are replaced (Lit and CodeMirror assign them). */
async function stillFromTheStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const still = new CSSStyleSheet();
    still.replaceSync(
      "*, *::before, *::after { transition: none !important; animation: none !important; }",
    );
    const sheets = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "adoptedStyleSheets");
    if (sheets?.get && sheets.set) {
      const { get, set } = sheets;
      Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", {
        configurable: true,
        get() {
          return get.call(this);
        },
        set(next: CSSStyleSheet[]) {
          set.call(this, next.includes(still) ? next : [...next, still]);
        },
      });
    }
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
      const root = attach.call(this, init);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets];
      return root;
    };
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, still];
  });
}

/** Cancel all CSS transitions and animations so captures do not depend on
 * timing. Removing `transition-property` cancels any in-flight transition
 * and snaps the property to its final value, so this doubles as "wait for
 * settled". A document <style> can't pierce the panel's shadow DOM, so a
 * constructed stylesheet is added to the document and to every open
 * shadow root, recursively. Idempotent per root; navigations reset it, so
 * it runs before every capture. */
async function freezeMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__motionFrozen ??= new WeakSet();
    const frozen = window.__motionFrozen;
    const freeze = (root: Document | ShadowRoot): void => {
      if (frozen.has(root)) return;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        "*, *::before, *::after { transition: none !important; " + "animation: none !important; }",
      );
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      frozen.add(root);
    };
    const walk = (root: Document | ShadowRoot): void => {
      freeze(root);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
  });
}

/** Run axe-core over the state currently on the page; serious and critical
 * violations fail the test. Excluded: .pv-canvas / .pv-banner /
 * .pv-island, the iOS widget / Live Activity / Dynamic Island previews:
 * faithful mocks of the always-dark iOS render (Apple's palette, tertiary
 * text below 4.5:1 by design), not panel UI. They live in the panel's
 * shadow root, so each exclusion must be a `fromShadowDom` path; a bare
 * selector only matches the light DOM.
 * No rules are disabled. The remaining moderate findings
 * (landmark-one-main, page-has-heading-one, region) are page-structure
 * rules owned by Home Assistant's app shell in production; adding our own
 * <main> or <h1> would collide with its. They are noted on the test as
 * annotations, not hidden. */
async function checkA11y(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  let audit = new AxeBuilder({ page }).options({ resultTypes: ["violations"] });
  for (const mock of [".pv-canvas", ".pv-banner", ".pv-island"]) {
    audit = audit.exclude({ fromShadowDom: ["aivi-panel", mock] });
  }
  const { violations } = await audit.analyze();
  const failing = (impact: unknown): boolean => impact === "serious" || impact === "critical";
  const noted = violations.filter((v) => !failing(v.impact)).map((v) => v.id);
  if (noted.length) {
    testInfo.annotations.push({
      type: "axe",
      description: `${name}: ${noted.length} minor/moderate (${noted.join(", ")})`,
    });
  }
  const bad = violations
    .filter((v) => failing(v.impact))
    .map((v) => ({
      rule: `${v.id} (${v.impact}): ${v.help}`,
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: n.target.join(" "),
        failure: n.failureSummary,
      })),
    }));
  expect(bad, `axe violations in state "${name}"`).toEqual([]);
}

export interface Snapshots {
  /** Capture the viewport into snapshots/<name>.png, then audit the state
   * with axe-core. */
  shot(name: string): Promise<void>;
  /** A viewport shot plus the widget mock on its own (<name>-widget.png),
   * the crop to hold against the app's renders. */
  shotWithPreview(name: string): Promise<void>;
  /** Capture one element into snapshots/<name>.png, without an audit. */
  crop(locator: Locator, name: string): Promise<void>;
}

export const test = base.extend<{ panel: Panel; snapshots: Snapshots }>({
  page: async ({ page }, use) => {
    await stillFromTheStart(page);
    await use(page);
  },
  panel: async ({ page }, use) => {
    await use(new Panel(page));
  },
  snapshots: async ({ page }, use, testInfo) => {
    const capture = async (target: Page | Locator, name: string): Promise<void> => {
      await freezeMotion(page);
      // The preview's icons load on demand (frontend/harness/ha-icon.js).
      await page.waitForFunction(() => !window.__iconsLoading);
      // A press on the preview scrolls its row into view smoothly, which
      // the motion freeze does not cover: wait for the page to come to rest.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let last = window.scrollY;
            let still = 0;
            const tick = (): void => {
              still = window.scrollY === last ? still + 1 : 0;
              last = window.scrollY;
              if (still >= 3) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );
      const path = join(SNAPSHOTS, `${name}.png`);
      await target.screenshot({ path });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    const shot = async (name: string): Promise<void> => {
      await capture(page, name);
      await checkA11y(page, testInfo, name);
    };
    await use({
      shot,
      shotWithPreview: async (name) => {
        await shot(name);
        await capture(page.locator(".pv-stage .pv-scale"), `${name}-widget`);
      },
      crop: capture,
    });
  },
});

export { expect };
