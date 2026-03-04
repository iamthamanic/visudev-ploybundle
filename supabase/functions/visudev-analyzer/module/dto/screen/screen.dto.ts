export type ScreenType =
  | "page"
  | "screen"
  | "view"
  | "modal"
  | "tab"
  | "dropdown";
export type ScreenScreenshotStatus = "none" | "pending" | "ok" | "error";

/** Trigger metadata for state edges (open-modal, switch-tab). */
export interface EdgeTrigger {
  label?: string;
  selector?: string;
  testId?: string;
  file?: string;
  line?: number;
  confidence?: number;
}

/** State-based edge from a host screen to a modal/tab/dropdown. */
export interface StateTarget {
  targetScreenId: string;
  edgeType: "open-modal" | "switch-tab" | "dropdown-action";
  trigger?: EdgeTrigger;
}

export interface Screen {
  id: string;
  name: string;
  path: string;
  filePath: string;
  type: ScreenType;
  flows: string[];
  navigatesTo: string[];
  framework: string;
  componentCode?: string;
  lastAnalyzedCommit?: string;
  screenshotStatus?: ScreenScreenshotStatus;
  screenshotUrl?: string;
  lastScreenshotCommit?: string;
  tableName?: string;
  description?: string;
  /** State-based screens: parent route screen id. */
  parentScreenId?: string;
  /** State-based screens: parent route path (when parent id not yet known). */
  parentPath?: string;
  /** State-based screens: unique key e.g. "modal:create-project", "tab:settings". */
  stateKey?: string;
  /** Host screen only: edges to modals/tabs opened from this screen, with trigger. */
  stateTargets?: StateTarget[];
}

export interface FileContent {
  path: string;
  content: string;
}
