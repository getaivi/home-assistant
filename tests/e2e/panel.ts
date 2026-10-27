// Panel interactions both suites drive: the harness checks and the
// journeys over the QA stack.
import type { Locator, Page } from "@playwright/test";

/** Type into an entity picker and choose the option naming `entityId`. */
export async function pickEntity(
  page: Page,
  input: Locator,
  query: string,
  entityId: string,
): Promise<void> {
  await input.click();
  await input.fill(query);
  await page.locator(".cbx-pop .opt", { hasText: entityId }).click();
}

/** Add a row to a rows field through its picker, by name or entity id;
 * a row that is already there is left alone. */
export async function addRow(page: Page, text: string, scope = ""): Promise<void> {
  const within = (selector: string): Locator => page.locator(`${scope} ${selector}`.trim());
  if (await within(".ordrow").filter({ hasText: text }).count()) return;
  const input = within("aivi-entity-combobox.rowadd input");
  await input.fill(text);
  await within("aivi-entity-combobox.rowadd .cbx-pop .opt")
    .filter({ hasText: text })
    .first()
    .click();
  // The picker stays open for the next one; close it.
  await input.press("Escape");
}
