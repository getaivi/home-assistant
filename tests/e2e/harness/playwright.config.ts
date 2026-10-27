// The panel harness (frontend/harness/) in a headless browser: screenshots
// into snapshots/ for review, plus interaction and accessibility checks.
//
//   make snapshots
//   npm run test:harness -- --grep "hub"   (or --ui)
//
// Requires: npm ci && npx playwright install chromium
import { defineConfig, devices } from "@playwright/test";

// Not the port `make harness` serves on, so a harness left open in a
// browser (possibly from another checkout) is never the one under test.
const port = Number(process.env["HARNESS_PORT"] ?? 8778);
const baseURL = `http://127.0.0.1:${port}/frontend/harness/`;

// Device profiles only lend their viewport, touch, pixel ratio and user
// agent: every project runs in Chromium, the one browser the setup installs.
const chromium = { browserName: "chromium" } as const;

export default defineConfig({
  testDir: ".",
  outputDir: "../../../test-results/harness",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../../playwright-report/harness", open: "never" }],
  ],
  use: {
    baseURL,
    // Covers `@media (prefers-reduced-motion)` only; captures also freeze
    // transitions themselves (see fixtures.ts).
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: ["phone.spec.ts", "devices.spec.ts"],
      use: { ...chromium, viewport: { width: 1280, height: 800 } },
    },
    {
      name: "phone",
      testMatch: "phone.spec.ts",
      use: { ...chromium, viewport: { width: 390, height: 844 } },
    },
    // Stand-ins for the companion app's WebView: touch, pixel ratio and a
    // mobile user agent, which also turn on the pointer-coarse CSS.
    {
      name: "iphone14",
      testMatch: "devices.spec.ts",
      use: { ...devices["iPhone 14"], ...chromium },
    },
    {
      name: "pixel7",
      testMatch: "devices.spec.ts",
      use: { ...devices["Pixel 7"], ...chromium },
    },
  ],
  // The dev server: the harness pages, with previews and saves answered by
  // the integration.
  webServer: {
    command: `uv run python scripts/harness_server.py --port ${port}`,
    cwd: "../../..",
    url: `${baseURL}index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
