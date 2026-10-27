// Panel localization via HA's backend translation pipeline: strings live
// under the hassfest-sanctioned `config_panel` section of strings.json /
// translations/<lang>.json, fetched at boot with frontend/get_translations.
// The server overlays the language on English per key; the bundled en
// catalog is the fallback when the fetch fails entirely.

import { en } from "./translations/en";
import type { HassLike } from "./types/hass";

export type TranslationKey = keyof typeof en;

/** The wire prefix HA puts on flattened backend translations. */
const PREFIX = "component.aivi.config_panel.";

let catalog: Record<string, string> = en;
let locale = "en";

/** The active BCP 47 locale for Intl formatting (dates, numbers). */
export function i18nLocale(): string {
  return locale;
}

/** Install a fetched catalog; missing keys fall back to en per key. */
export function setCatalog(resources: Record<string, string>, lang: string): void {
  catalog = { ...en, ...resources };
  locale = lang;
}

export function resetCatalog(): void {
  catalog = en;
  locale = "en";
}

/**
 * Resolve the catalog for the user's HA language. Called once at panel
 * boot, before the first render, so no string ever flashes English.
 * Never throws: an unreachable backend leaves the bundled en catalog
 * (but keeps the locale, so Intl formatting still follows the user).
 */
export async function loadCatalog(hass: HassLike): Promise<void> {
  const lang = hass.locale?.language ?? hass.language ?? "en";
  if (lang === "en") {
    resetCatalog();
    return;
  }
  try {
    const res = (await hass.callWS({
      type: "frontend/get_translations",
      language: lang,
      category: "config_panel",
      integration: "aivi",
    })) as { resources?: Record<string, string> };
    const stripped: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.resources ?? {})) {
      if (key.startsWith(PREFIX)) stripped[key.slice(PREFIX.length)] = value;
    }
    setCatalog(stripped, lang);
  } catch {
    setCatalog({}, lang);
  }
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return interpolate(catalog[key] ?? en[key], params);
}

/** Dynamic (data-keyed) lookup: template and field copy addressed by
 * slug; undefined when the key isn't in the catalog. */
export function tOpt(key: string): string | undefined {
  return catalog[key];
}

/** A template's own copy under `<prefix>-<template>.<key>`. A Live
 * Activity's comes first (`<prefix>-activity-<template>`): a widget and a
 * Live Activity can share a slug (remote), and not their wording. */
export function tTemplate(
  prefix: string,
  template: string | undefined,
  key: string,
  kind?: string,
): string | undefined {
  if (!template) return undefined;
  return (
    (kind === "activity" ? catalog[`${prefix}-activity-${template}.${key}`] : undefined) ??
    catalog[`${prefix}-${template}.${key}`]
  );
}

/** Plural-aware lookup: picks `<base>-<category>` with Intl.PluralRules
 * in the active locale, falling back per key to `<base>-other`. The en
 * catalog ships `-one`/`-other`; languages with more categories add
 * `-few`/`-many`/… keys without any code change. */
export function tPlural(
  base: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const dict = en as Record<string, string>;
  const text =
    catalog[`${base}-${category}`] ??
    dict[`${base}-${category}`] ??
    catalog[`${base}-other`] ??
    dict[`${base}-other`] ??
    "";
  return interpolate(text, { count, ...params });
}

/** For strings whose placeholder renders as markup: the text before and
 * after `{placeholder}`, so the caller can wrap the value itself. */
export function tSplit(
  key: TranslationKey,
  placeholder: string,
  params?: Record<string, string | number>,
): [string, string] {
  const raw = catalog[key] ?? en[key];
  const token = `{${placeholder}}`;
  const at = raw.indexOf(token);
  if (at < 0) return [interpolate(raw, params), ""];
  return [interpolate(raw.slice(0, at), params), interpolate(raw.slice(at + token.length), params)];
}
