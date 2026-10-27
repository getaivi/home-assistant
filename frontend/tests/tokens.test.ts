// Guards the design tokens by reading the stylesheet modules' source text
// (frontend/src/styles/*.ts) with regular expressions; nothing is rendered.
// It fails when a stylesheet of the panel's chrome sets a font size or a
// border radius in raw pixels instead of a token from the form kit's
// scales, and when a stylesheet uses a `--aivi-*` token that
// styles/base.ts does not define.
// In styles/preview.ts only the device mocks (from the `.pv-scale` rule on)
// are exempt: they mock iOS, in iOS's own point sizes; the pane's chrome
// above them uses the kit's scales. The per-template mocks in
// styles/preview/ are device mocks throughout, so they are exempt too.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "frontend/src/styles";
/** The stylesheets of the panel's own chrome. */
const chrome = (): string[] => readdirSync(DIR).filter((file) => file.endsWith(".ts"));
/** Every stylesheet, the per-template preview mocks included. */
const all = (): string[] => [
  ...chrome(),
  ...readdirSync(`${DIR}/preview`).map((file) => `preview/${file}`),
];

describe("design tokens", () => {
  it("font sizes and radii come from the scales", () => {
    const raw: string[] = [];
    for (const file of chrome()) {
      let css = readFileSync(`${DIR}/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (file === "preview.ts") css = css.slice(0, css.indexOf(".pv-scale"));
      for (const match of css.matchAll(/\b(font-size|border-radius):\s*[\d.]+px/g))
        raw.push(`${file}: ${match[0]}`);
    }
    expect(raw).toEqual([]);
  });

  it("defines every token the stylesheets use", () => {
    const base = readFileSync(`${DIR}/base.ts`, "utf8");
    const used = new Set<string>();
    for (const file of all())
      for (const match of readFileSync(`${DIR}/${file}`, "utf8").matchAll(
        /var\((--aivi-[a-z0-9-]+)/g,
      ))
        used.add(match[1] as string);
    const missing = [...used].filter((token) => !base.includes(`${token}:`));
    expect(missing).toEqual([]);
  });
});
