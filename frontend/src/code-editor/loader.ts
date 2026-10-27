// Loads the code editor chunk, aivi-code-editor-<hash>.js, the first time
// a template box shows. It sits beside the panel bundle: the integration
// serves both at /aivi_panel/ (panel.py) and the harness serves the
// directory they are built into. Where there is no such file (vitest
// runs the sources from disk) or it fails to load (offline, an install
// missing it), the box stays a plain textarea.

import { EDITOR_FILE } from "../build-info";
import type { MountCodeEditor } from "./contract";

export type EditorLoader = () => Promise<MountCodeEditor>;

/** Where the chunk lives: next to this bundle, under the content-hashed
 * name the build gave it (a new build, a new name, so no query busts a
 * cache). Null when the bundle is not served over HTTP. */
export function editorUrl(
  base: string = import.meta.url,
  file: string = EDITOR_FILE,
): string | null {
  let url: URL;
  try {
    url = new URL(file, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

function isMount(value: unknown): value is MountCodeEditor {
  return typeof value === "function";
}

const importChunk: EditorLoader = async () => {
  const url = editorUrl();
  if (!url) throw new Error("template editor: not served here");
  const mod = (await import(/* @vite-ignore */ url)) as { mountCodeEditor?: unknown };
  if (!isMount(mod.mountCodeEditor)) throw new Error(`${EDITOR_FILE}: no mountCodeEditor`);
  return mod.mountCodeEditor;
};

let loader: EditorLoader = importChunk;
let loading: Promise<MountCodeEditor> | null = null;

/** The editor, loaded once; a failed load is tried again next time. */
export function loadCodeEditor(): Promise<MountCodeEditor> {
  loading ??= loader().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Tests: load the editor with `next` instead (the default when null). */
export function setEditorLoader(next: EditorLoader | null): void {
  loader = next ?? importChunk;
  loading = null;
}
