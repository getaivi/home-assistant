// Journeys over the QA stack (qa/docker-compose.yml): Home Assistant, the
// mounted Aivi integration and the mock Aivi API. Breadth, not depth:
// depth belongs to the unit tests.
//
//   make e2e                               (compose up, the journeys, compose down)
//   npm run test:qa -- --grep "Laundry"    (against a stack that is already up)
//
// Requires: the stack running, npm ci && npx playwright install chromium
import { defineConfig } from "@playwright/test";
import { AUTH_STATE, HA_URL } from "./env";

export default defineConfig({
  testDir: ".",
  outputDir: "../../../test-results/qa",
  globalSetup: "./global-setup.ts",
  // One Home Assistant, one account: the journeys share its state and run
  // in file order, one at a time. Each is idempotent, so a failed one is
  // retried once by itself; a pass on retry is reported as flaky.
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: !!process.env["CI"],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "../../../playwright-report/qa", open: "never" }]],
  use: {
    baseURL: HA_URL,
    storageState: AUTH_STATE,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
