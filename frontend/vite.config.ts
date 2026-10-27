// Builds the panel to a single self-contained ES module at
// custom_components/aivi/frontend/aivi-panel.js, the file panel.py serves
// and frontend/harness/ loads. Its name stays fixed: Home Assistant reads the
// panel's URL once, at startup. The build must be deterministic (no hashes in
// its name, no wall-clock timestamps, lockfile-pinned deps).
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = fileURLToPath(new URL("../custom_components/aivi/frontend", import.meta.url));

// The template editor's content-hashed file name, the URL the panel imports
// it from (code-editor/loader.ts). The editor build runs first and leaves exactly one
// (vite.editor.config.ts).
function editorFile(): string {
  const found = readdirSync(outDir).filter((name) => /^aivi-code-editor-[\w-]+\.js$/.test(name));
  if (found.length !== 1) {
    throw new Error(
      `expected one built template editor in ${outDir}, found ${found.length}: ` +
        "build it first (vite build --config frontend/vite.editor.config.ts)",
    );
  }
  return found[0] as string;
}

// Staleness beacon: stamp the bundle with the commit it was built from,
// logged by the panel on boot. Uses the commit time (`%cI`), never
// wall-clock, so two builds of the same tree are byte-identical; uncommitted
// tracked changes append "-dirty"; outside a git checkout it is "unknown".
function buildStamp(): string {
  const git = (args: string): string =>
    execSync(`git ${args}`, { cwd: here, encoding: "utf8" }).trim();
  try {
    const dirty = git("status --porcelain -uno") === "" ? "" : "-dirty";
    return `${git("rev-parse --short HEAD")}${dirty} ${git("log -1 --format=%cI")}`;
  } catch {
    return "unknown";
  }
}

/** The text of a css`…` stylesheet without its comments and with its
 * whitespace collapsed; the `${…}` parts are left as they are. */
function packCss(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
}

// The stylesheets are Lit css`…` templates, which the minifier keeps as
// written, comments and indentation included: this packs their text.
function packStylesheets(): Plugin {
  return {
    name: "aivi-pack-stylesheets",
    transform(code, id) {
      if (!id.includes("/frontend/src/") || !code.includes("css`")) return null;
      let out = "";
      let at = 0;
      for (let start = code.indexOf("css`", at); start >= 0; start = code.indexOf("css`", at)) {
        out += code.slice(at, start + 4);
        let i = start + 4;
        let literal = "";
        // The template's literal text runs to its closing backtick; an
        // interpolation is copied as is, braces counted.
        while (i < code.length && code[i] !== "`") {
          if (code[i] === "$" && code[i + 1] === "{") {
            out += packCss(literal);
            literal = "";
            let depth = 0;
            const from = i;
            do {
              if (code[i] === "{") depth++;
              else if (code[i] === "}") depth--;
              i++;
            } while (depth > 0 && i < code.length);
            out += code.slice(from, i);
          } else literal += code[i++];
        }
        out += `${packCss(literal)}\``;
        at = i + 1;
      }
      return { code: out + code.slice(at), map: null };
    },
  };
}

export default defineConfig({
  plugins: [packStylesheets()],
  define: {
    __AIVI_BUILD__: JSON.stringify(buildStamp()),
    __AIVI_EDITOR__: JSON.stringify(editorFile()),
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/aivi-panel.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "aivi-panel.js",
    },
    outDir,
    emptyOutDir: false,
    target: "es2022",
    minify: true,
    sourcemap: false,
    // Everything in one chunk: the integration serves exactly one file.
    // A library build keeps its whitespace and its pure annotations for a
    // bundler downstream; this file is served as it is, so both go.
    rollupOptions: {
      output: {
        codeSplitting: false,
        minify: { codegen: { removeWhitespace: true } },
        comments: { annotation: false },
      },
    },
  },
});
