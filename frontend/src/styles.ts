// The panel stylesheet, applied once to <aivi-panel>'s shadow root. All
// internal components render into light DOM inside that shadow root, so
// one cascade styles everything (and HA theme variables cascade in). The
// modules are per component; their order is the cascade order.

import type { CSSResultGroup } from "lit";
import { activityStyles } from "./styles/activity";
import { baseStyles } from "./styles/base";
import { buttonStyles } from "./styles/buttons";
import { checklistStyles } from "./styles/checklist";
import { editorStyles } from "./styles/editor";
import { editorLayoutStyles } from "./styles/editor-layout";
import { eventsStyles } from "./styles/events";
import { formStyles } from "./styles/form";
import { hubStyles } from "./styles/hub";
import { hubFilterStyles } from "./styles/hub-filter";
import { kitStyles } from "./styles/kit";
import { previewStyles } from "./styles/preview";
import { templatePreviewStyles } from "./styles/preview/index";
import { rampStyles } from "./styles/ramp";
import { refreshStyles } from "./styles/refresh";
import { responsiveStyles } from "./styles/responsive";
import { rowsStyles } from "./styles/rows";
import { segmentsStyles } from "./styles/segments";
import { sourceStyles } from "./styles/source";
import { suggestStyles } from "./styles/suggest";
import { templateWorkspaceStyles } from "./styles/template-workspace";
import { toastStyles } from "./styles/toast";
import { topbarStyles } from "./styles/topbar";

export const panelStyles: CSSResultGroup = [
  baseStyles,
  topbarStyles,
  buttonStyles,
  hubFilterStyles,
  refreshStyles,
  eventsStyles,
  activityStyles,
  hubStyles,
  editorLayoutStyles,
  formStyles,
  kitStyles,
  checklistStyles,
  suggestStyles,
  previewStyles,
  ...templatePreviewStyles,
  sourceStyles,
  rampStyles,
  segmentsStyles,
  rowsStyles,
  editorStyles,
  templateWorkspaceStyles,
  toastStyles,
  responsiveStyles,
];
