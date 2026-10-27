// Every widget template the panel knows, by template slug. Each module
// carries the template's renders, styles, slots and form layout.

import { battery } from "./battery";
import { budget } from "./budget";
import { countdown } from "./countdown";
import { energy } from "./energy";
import { gauge } from "./gauge";
import { list } from "./list";
import { prices } from "./prices";
import { progress } from "./progress";
import { remote } from "./remote";
import { showcase } from "./showcase";
import { status } from "./status";
import { switchboard } from "./switchboard";
import { trend } from "./trend";
import type { WidgetTemplate } from "./types";

export const TEMPLATES: Readonly<Record<string, WidgetTemplate>> = {
  status,
  progress,
  gauge,
  countdown,
  list,
  battery,
  budget,
  trend,
  prices,
  energy,
  switchboard,
  showcase,
  remote,
};

/** A widget template by slug, or undefined for one this build does not
 * know (an integration newer than this bundle). */
export function widgetTemplate(slug: string): WidgetTemplate | undefined {
  return Object.hasOwn(TEMPLATES, slug) ? TEMPLATES[slug] : undefined;
}
