// Every shipped translation against en.json: no key English lacks, the
// same placeholders, plural keys in the language's own CLDR categories,
// and nothing Home Assistant's ICU parser would misread. A key a
// translation leaves out falls back to English, so gaps are allowed.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "custom_components/aivi/translations";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

function load(file: string): Record<string, string> {
  return flatten(JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")) as Tree);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

const PLURAL = /^(.*)-(zero|one|two|few|many|other)$/;

const en = load("en.json");
const languages = readdirSync(DIR)
  .filter((file) => file.endsWith(".json") && file !== "en.json")
  .map((file) => file.replace(/\.json$/, ""));

describe.each(languages)("%s", (lang) => {
  const translated = load(`${lang}.json`);
  const categories = new Set(new Intl.PluralRules(lang).resolvedOptions().pluralCategories);

  it("has only keys English has, plural forms aside", () => {
    const unknown = Object.keys(translated).filter((key) => {
      if (key in en) {
        const plural = PLURAL.exec(key);
        return plural !== null && !categories.has(plural[2] as Intl.LDMLPluralRule);
      }
      const plural = PLURAL.exec(key);
      return plural === null || !(`${plural[1]}-other` in en);
    });
    expect(unknown).toEqual([]);
  });

  it("keeps each string's placeholders", () => {
    const wrong = Object.entries(translated).flatMap(([key, text]) => {
      const plural = PLURAL.exec(key);
      if (plural !== null && `${plural[1]}-other` in en) {
        // A form may drop {count} ("one item"), never add a placeholder.
        const allowed = new Set(
          [`${plural[1]}-one`, `${plural[1]}-other`].flatMap((k) => placeholders(en[k] ?? "")),
        );
        return placeholders(text).every((p) => allowed.has(p)) ? [] : [key];
      }
      return placeholders(text).join() === placeholders(en[key] ?? "").join() ? [] : [key];
    });
    expect(wrong).toEqual([]);
  });

  it("gives every plural its other form", () => {
    const bases = new Set(
      Object.keys(translated).flatMap((key) => {
        const plural = PLURAL.exec(key);
        return plural !== null && `${plural[1]}-other` in en ? [plural[1]] : [];
      }),
    );
    const missing = [...bases].filter((base) => !(`${base}-other` in translated));
    expect(missing).toEqual([]);
  });

  it("has no empty strings and no apostrophe against a placeholder", () => {
    // In an ICU message, '{ starts quoted text and swallows the placeholder.
    const bad = Object.entries(translated).filter(
      ([, text]) => text.trim() === "" || /'\{|\}'/.test(text),
    );
    expect(bad).toEqual([]);
  });
});
