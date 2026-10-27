// Shared constants. All user-facing strings resolve through i18n.ts.

import { t, tOpt, tTemplate } from "./i18n";

// The Aivi palette, at the iOS dark-appearance system-color values the
// widgets actually render with (each name maps 1:1 to a system color).
export const COLOR_HEX = {
  red: "#ff4245",
  orange: "#ff9230",
  yellow: "#ffd600",
  green: "#30d158",
  mint: "#00dac3",
  teal: "#00d2e0",
  cyan: "#3cd3fe",
  blue: "#0091ff",
  indigo: "#6d7cff",
  purple: "#db34f2",
  pink: "#ff375f",
  brown: "#b78a66",
  gray: "#8e8e93",
  gray2: "#636366",
  gray3: "#48484a",
  gray4: "#3a3a3c",
  gray5: "#2c2c2e",
  gray6: "#1c1c1e",
} as const;

/** Palette name -> hex, tolerating unknown/absent names. */
export function colorHex(name: string | null | undefined): string | undefined {
  return name && Object.hasOwn(COLOR_HEX, name)
    ? (COLOR_HEX as Record<string, string>)[name]
    : undefined;
}

// Themeless fallback only: the chrome follows --primary-color and uses this
// when no theme variable is set (styles.ts derives the AA-safe button fill
// from whichever accent is active).
export const ACCENT = "#0a93d6";
export const SYSTEM_BLUE = "#0091ff"; // widget fallback accent (no accent set)

// iOS dark-mode text hierarchy, as rendered on the widget canvas.
export const WP = {
  primary: "#fff",
  secondary: "rgba(235,235,245,.6)",
  tertiary: "rgba(235,235,245,.3)",
  quaternary: "rgba(235,235,245,.18)",
} as const;

interface TemplateInfo {
  label: string;
  hint?: string;
  /** Set for a template Aivi no longer supports: what to do instead. */
  retired?: string;
}

/** Template display copy from the catalog; unknown slugs (a newer Aivi
 * than this build) fall back to the raw slug so nothing renders blank. */
export function templateInfo(slug: string): TemplateInfo {
  const label = tOpt(`template.${slug}.label`);
  if (label === undefined) return { label: slug };
  const hint = tOpt(`template.${slug}.hint`);
  const retired = tOpt(`template.${slug}.retired`);
  return {
    label,
    ...(hint === undefined ? {} : { hint }),
    ...(retired === undefined ? {} : { retired }),
  };
}

/** A field's hint: the template's own wording when it has one (a
 * trend's chart bounds are not a gauge's dial bounds), else the key's. */
export function fieldHint(
  key: string,
  template?: string,
  templateMode = false,
  kind?: string,
): string | undefined {
  // A hint that speaks of an entity has a template's own wording.
  return (
    (templateMode ? tOpt(`field-hint-template.${key}`) : undefined) ??
    tTemplate("field-hint", template, key, kind) ??
    tOpt(`field-hint.${key}`)
  );
}

export function sources(): { id: string; label: string }[] {
  return [
    { id: "entity", label: t("source.entity") },
    { id: "attribute", label: t("source.attribute") },
    { id: "template", label: t("source.template") },
  ];
}

const ENTITY_ID = /\b[a-z_]+\.[a-z0-9_]+\b/;

/** Whether `text` contains anything shaped like an entity id. */
export function mentionsEntity(text: string): boolean {
  return ENTITY_ID.test(text);
}

/** Every entity-id-shaped token in `text`, in order. */
export function entityIdsIn(text: string): string[] {
  return text.match(new RegExp(ENTITY_ID.source, "g")) ?? [];
}
