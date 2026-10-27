// The per-template preview styles, after the shared preview stylesheet
// in the cascade, in registry order.

import type { CSSResult } from "lit";
import { TEMPLATES } from "../../preview/templates";

export const templatePreviewStyles: CSSResult[] = Object.values(TEMPLATES).map((t) => t.styles);
