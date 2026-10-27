// The build stamp Vite injects via `define` (frontend/vite.config.ts):
// "<short-sha>[-dirty] <commit-iso-time>", logged on boot so a stale bundle
// is diagnosable. Outside Vite (vitest) the global is absent -> "dev".
declare const __AIVI_BUILD__: string;

export const BUILD_STAMP: string = typeof __AIVI_BUILD__ === "string" ? __AIVI_BUILD__ : "dev";

// The template editor's content-hashed file name, which the panel build
// reads from the editor build's output (frontend/vite.config.ts). Outside
// Vite (vitest) there is no build: a placeholder.
declare const __AIVI_EDITOR__: string;

export const EDITOR_FILE: string =
  typeof __AIVI_EDITOR__ === "string" ? __AIVI_EDITOR__ : "aivi-code-editor-dev.js";
