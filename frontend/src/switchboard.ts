// Switchboard tile options: client-side mirror of the rules Aivi and
// custom_components/aivi/switchboard/ (marks.py, ids.py) apply to a
// tile's marks and presses, so the editor flags problems instead of the
// push silently dropping them. tests/fixtures.test.ts holds them to the
// integration's answers.

import type { TranslationKey } from "./i18n";
import { type RowOptions, STATE_TEXT_OPTION } from "./types/bindings";
import type { StateTextMeta } from "./types/meta";

/** Aivi's `Image.url` rule: https, a non-empty host, no
 * whitespace anywhere, at most 2048 characters. */
const HTTPS_URL = /^https:\/\/[^\s/?#]+[^\s]*$/;
export const IMAGE_URL_MAX = 2048;
export const IMAGE_ALT_MAX = 64;

/** `#RRGGBB`: no alpha, no three-digit shorthand. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Turns a light's automatic gradient off. */
export const GRADIENT_NONE = "none";

/** The `image_source` value that opts in to the entity's picture. */
export const IMAGE_FROM_ENTITY = "entity_picture";

/** Why a picture URL would be refused, or null when Aivi accepts it. */
export function imageUrlProblem(url: string): TranslationKey | null {
  if (!url.startsWith("https://")) return "switchboard.image-https";
  if (url.length > IMAGE_URL_MAX) return "switchboard.image-long";
  if (/\s/.test(url)) return "switchboard.image-space";
  if (!HTTPS_URL.test(url)) return "switchboard.image-host";
  return null;
}

/** A named color from `names` (lowercased) or `#RRGGBB` (uppercased,
 * the form Aivi stores), else null. */
export function actionColor(value: string, names: string[]): string | null {
  const text = value.trim();
  if (HEX_COLOR.test(text)) return text.toUpperCase();
  const name = text.toLowerCase();
  return names.includes(name) ? name : null;
}

interface GradientParse {
  stops: string[];
  /** Why the text is not a usable gradient; null when it is (or empty). */
  problem: TranslationKey | null;
}

/** A picked gradient as typed: 2 to 3 comma-separated stops, named or
 * hex. Empty means "automatic" and `none` means "off"; neither is a
 * problem. */
export function parseGradient(raw: string, names: string[]): GradientParse {
  const text = raw.trim();
  if (!text || text.toLowerCase() === GRADIENT_NONE) return { stops: [], problem: null };
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const stops = parts
    .map((part) => actionColor(part, names))
    .filter((stop): stop is string => stop !== null);
  if (stops.length !== parts.length) return { stops, problem: "switchboard.gradient-color" };
  if (stops.length < 2 || stops.length > 3) return { stops, problem: "switchboard.gradient-count" };
  return { stops, problem: null };
}

/** The entity picture, when it is one Aivi could hand the phone: an
 * absolute https URL. Home Assistant's own `/api/...` paths are
 * authenticated and often token-rotating, so they never qualify. */
export function forwardablePicture(picture: unknown): string | null {
  return typeof picture === "string" && imageUrlProblem(picture) === null ? picture : null;
}

/** An amount the integration reads as money (`wire_money` in
 * custom_components/aivi/values.py parses it as a Python `Decimal`):
 * optional sign, digits with at most one point, an optional exponent,
 * with underscores ignored. It sends the amount written out in full. */
const MONEY = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A typed budget as it is stored: trimmed, a lone decimal comma read as
 * the decimal point ("1,5" is 1.5). Anything else is kept as typed, for
 * `budgetProblem` to refuse. */
export function budgetText(raw: string): string {
  const text = raw.trim();
  return /^[+-]?\d*,\d+$/.test(text) ? text.replace(",", ".") : text;
}

/** Why a row's budget would be dropped from the push (the row's budget
 * slot is money, above 0), or null when Aivi takes it or none is set. */
export function budgetProblem(value: string | undefined): TranslationKey | null {
  if (!value?.trim()) return null;
  const text = value.trim().replaceAll("_", "");
  return MONEY.test(text) && Number(text) > 0 ? null : "checklist.budget-invalid";
}

/** Why a stat's gauge ceiling would be dropped from the push (a number
 * above 0), or null when Aivi takes it or none is set. */
export function maxProblem(value: string | undefined): TranslationKey | null {
  if (!value?.trim()) return null;
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? null : "checklist.max-invalid";
}

/** Whether a reading fills a gauge: a plain number (Aivi's rule for a
 * stat's `max`), not a word or a formatted time. */
export function plainNumber(value: string | undefined): boolean {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(value?.trim() ?? "");
}

/** The options of one row the push would drop, by option key, so the
 * editor can mark each control and hold Save until they are fixed. A
 * tile's marks (picture, gradient, hex color) are checked only for a
 * `tile`; a budget wherever one is stored. */
export function rowProblems(
  options: RowOptions,
  names: string[],
  tile = true,
): Record<string, TranslationKey> {
  const problems: Record<string, TranslationKey> = {};
  const budget = budgetProblem(options["budget"]);
  if (budget) problems["budget"] = budget;
  const max = maxProblem(options["max"]);
  if (max) problems["max"] = max;
  if (!tile) return problems;
  const image = options["image"]?.trim();
  if (image) {
    const problem = imageUrlProblem(image);
    if (problem) problems["image"] = problem;
  }
  const gradient = options["gradient"];
  if (gradient) {
    const { problem } = parseGradient(gradient, names);
    if (problem) problems["gradient"] = problem;
  }
  const color = options["color"];
  if (color && actionColor(color, names) === null) problems["color"] = "switchboard.color-invalid";
  return problems;
}

/** What a press on the tile does, as the catalog key of a sentence
 * taking `{name}`. Mirrors `press_service` in
 * custom_components/aivi/switchboard/ids.py. */
export function pressKey(entityId: string, meta: StateTextMeta | undefined): TranslationKey {
  const domain = entityId.split(".")[0] ?? "";
  if (domain === "cover" || domain === "valve") return "switchboard.press-open";
  if (domain === "lock") return "switchboard.press-lock";
  if (domain === "scene") return "switchboard.press-scene";
  if (domain === "script") return "switchboard.press-script";
  if (domain === "button" || domain === "input_button") return "switchboard.press-button";
  return !meta || meta.toggle_domains.includes(domain)
    ? "switchboard.press-toggle"
    : "switchboard.press-on";
}

export function tileKind(entityId: string, meta: StateTextMeta): "toggle" | "button" {
  return meta.toggle_domains.includes(entityId.split(".")[0] ?? "") ? "toggle" : "button";
}

/** The word a key falls back to when the tile sets none: the domain's
 * automatic word, else null (the app's own). */
export function autoWord(entityId: string, key: string, meta: StateTextMeta): string | null {
  return meta.auto[entityId.split(".")[0] ?? ""]?.[key] ?? null;
}

export function wordOption(key: string): string {
  return `${STATE_TEXT_OPTION}${key}`;
}
