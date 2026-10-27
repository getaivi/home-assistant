// Builds the template code editor (CodeMirror, frontend/src/code-editor/
// editor.ts) to its own ES module beside the panel bundle,
// custom_components/aivi/frontend/aivi-code-editor-<hash>.js. The panel
// imports it by URL the first time a template box shows
// (code-editor/loader.ts), so users who never write a template never
// download it, and the panel bundle carries none of it. Like the panel
// build, deterministic.
//
// The hash is the content's, so the integration serves the file as
// cacheable forever (panel.py). This build runs before the panel's, which
// reads the name back from the directory (vite.config.ts); files an
// earlier build left are removed here, so exactly one is there.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const outDir = fileURLToPath(new URL("../custom_components/aivi/frontend", import.meta.url));

/** Removes every editor file in the output directory but the one just written. */
function dropStaleEditors(): Plugin {
  return {
    name: "aivi-drop-stale-editors",
    writeBundle(_options, bundle) {
      const keep = new Set(Object.keys(bundle));
      for (const name of readdirSync(outDir)) {
        if (/^aivi-code-editor.*\.js$/.test(name) && !keep.has(name)) {
          rmSync(join(outDir, name));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [dropStaleEditors()],
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/code-editor/editor.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "aivi-code-editor-[hash].js",
    },
    outDir,
    emptyOutDir: false,
    target: "es2022",
    minify: true,
    sourcemap: false,
    rollupOptions: {
      output: { codeSplitting: false },
    },
  },
});
