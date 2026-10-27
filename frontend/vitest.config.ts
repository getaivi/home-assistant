// Vitest runs the panel test suite (frontend/tests) in happy-dom: real
// custom elements + shadow DOM without a browser. Coverage is v8 over
// frontend/src with an enforced floor so a coverage drop fails the build.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // Slightly under what the suite achieves; raise it as coverage grows,
      // never lower it to make a change pass.
      thresholds: {
        statements: 93,
        branches: 80,
        functions: 92,
        lines: 94,
      },
    },
  },
});
