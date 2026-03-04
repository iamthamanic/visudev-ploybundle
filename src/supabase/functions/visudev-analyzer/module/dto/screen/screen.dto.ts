export type ScreenType =
  | "page"
  | "screen"
  | "view"
  | "cli-command"
  | "modal"
  | "tab"
  | "dropdown";
export type ScreenScreenshotStatus = "none" | "pending" | "ok" | "error";

export interface EdgeTrigger {
  label?: string;
  selector?: string;
  testId?: string;
  file?: string;
  line?: number;
  confidence?: number;
}

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
  parentScreenId?: string;
  parentPath?: string;
  stateKey?: string;
  stateTargets?: StateTarget[];
}

export interface FileContent {
  path: string;
  content: string;
}
