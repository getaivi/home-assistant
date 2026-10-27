import { i18nLocale, t, tOpt, tPlural, tTemplate } from "./i18n";

/** A field's label: the template's own when it has one (a remote's
 * actions are buttons, a switchboard's tiles), else the key's. */
export function labelFor(key: string, template?: string, kind?: string): string {
  return (
    tTemplate("field-label", template, key, kind) ??
    tOpt(`field-label.${key}`) ??
    key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Whether an entity's state reads as on, by the integration's own rule
 * (`Meta.on_states`): what keeps a Live Activity running. */
export function readsOn(state: string, onStates: readonly string[]): boolean {
  return onStates.includes(state.trim().toLowerCase());
}

/** A source's reading worth quoting (`Waiting.reading`,
 * `FieldFeedback.reading`): the entity's own state, not the stand-in for
 * nothing there ("missing", "empty"). */
export function quotable(reading: string | null): reading is string {
  return reading !== null && reading !== "missing" && reading !== "empty";
}

/** Display name for a backend enum value from `enum.<group>.<value>`; the
 * value itself stays raw on the wire. Unknown values (an integration
 * newer than this bundle) fall back to a humanized raw value, never
 * blank. */
export function enumLabel(group: string, value: string): string {
  return (
    tOpt(`enum.${group}.${value}`) ??
    value.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/** A failure's message. Home Assistant rejects a WebSocket command with a
 * plain `{code, message}` object, not an Error. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String(err.message);
  return String(err);
}

/** True when `el` renders inside an <aivi-panel> in narrow (phone) mode.
 * The panel reflects HA's `narrow` assignment as an attribute on itself,
 * and its internal elements have no shadow roots of their own, so the
 * root node of any of them is the panel's shadow root. */
export function inNarrowPanel(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot && (root.host as HTMLElement).hasAttribute("narrow");
}

/** An iOS timer reading (`Text(timerInterval:)` / `Text(style: .timer)`)
 * for a duration: `M:SS`, `H:MM:SS` from an hour up, floored at "0:00".
 * The preview is a still: computed once at render (on-device it ticks). */
function timerReading(ms: number): string {
  if (Number.isNaN(ms) || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

/** The `time_since` / `time_until` formatters: on-device both render as a
 * ticking timer (`Text(timerInterval:)`; the relative phrasing is only
 * what VoiceOver reads), clamped at "0:00". Null unless the
 * value looks like an ISO timestamp: the device also falls back to the
 * raw string, and bare numbers like "62" would otherwise parse as years. */
export function formatterTimer(value: string, formatter: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const ms = formatter === "time_since" ? Date.now() - at : at - Date.now();
  return timerReading(ms);
}

/** iOS `Text(_, style: .timer)` counting down to `iso`. */
export function timerText(iso: string): string {
  return timerReading(Date.parse(iso) - Date.now());
}

/** The countdown hero, matching the device: expired text once past,
 * a ticking timer under 24 h, `Text(style: .relative)` ("2 days, 2 hr")
 * beyond that. Unit words come from Intl in the user's locale. */
export function countdownHero(iso: string, expiredText?: string): string {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return iso;
  const d = target - Date.now();
  if (d <= 0) return expiredText || t("common.done");
  if (d < 86400e3) return timerText(iso);
  const days = Math.floor(d / 86400e3);
  const hr = Math.round((d % 86400e3) / 3600e3);
  const locale = i18nLocale();
  const dayPart = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "day",
    unitDisplay: "long",
  }).format(days);
  if (!hr) return dayPart;
  const hrPart = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
  }).format(hr);
  return `${dayPart}, ${hrPart}`;
}

/** A duration in the largest whole unit: "90 seconds", "2 hours". */
export function durationLabel(seconds: number): string {
  for (const [unit, size] of [
    ["days", 86400],
    ["hours", 3600],
    ["minutes", 60],
  ] as const)
    if (seconds >= size && seconds % size === 0) return tPlural(`duration.${unit}`, seconds / size);
  return tPlural("duration.seconds", seconds);
}

/** How often, as a sentence says it: "every minute", "every 15
 * seconds" (`every.<unit>` plural forms). */
export function everyLabel(seconds: number): string {
  for (const [unit, size] of [
    ["days", 86400],
    ["hours", 3600],
    ["minutes", 60],
  ] as const)
    if (seconds >= size && seconds % size === 0) return tPlural(`every.${unit}`, seconds / size);
  return tPlural("every.seconds", seconds);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** JSON with recursively sorted object keys: value equality that is
 * indifferent to key order (the server rebuilds objects). */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}
