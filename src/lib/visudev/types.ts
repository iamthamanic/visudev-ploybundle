// VisuDEV Core Types
export type ScanStatus = "idle" | "running" | "completed" | "failed";
export type ScreenshotStatus = "none" | "pending" | "ok" | "failed";
export type StepLogType = "info" | "success" | "error";

export interface StepLogEntry {
  time: string;
  message: string;
  type?: StepLogType;
}

export interface Screen {
  id: string;
  name: string;
  path: string;
  screenshotUrl?: string;
  screenshotStatus?: ScreenshotStatus;
  filePath?: string;
  type?: "page" | "screen" | "view";
  flows?: string[];
  navigatesTo?: string[];
  framework?: string;
  componentCode?: string;
  lastScreenshotCommit?: string;
  depth?: number;
}

export interface Flow {
  id: string;
  type: "ui-event" | "function-call" | "api-call" | "db-query";
  name: string;
  file: string;
  line: number;
  code: string;
  calls: string[];
  color: string;
}

/** Preview (Live App) status from Preview Runner */
export type PreviewStatus = "idle" | "starting" | "ready" | "failed" | "stopped";
/** Preview mode selection per project */
export type PreviewMode = "auto" | "local" | "central" | "deployed";
/** Runtime boot behavior for local preview runner (per start/refresh). */
export type PreviewBootMode = "best_effort" | "strict";
/** Optional per-run preview settings (not persisted to project config by default). */
export interface PreviewRuntimeOptions {
  bootMode?: PreviewBootMode;
  injectSupabasePlaceholders?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  github_repo?: string;
  github_branch?: string;
  github_access_token?: string;
  deployed_url?: string;
  /** Preview mode: local runner (Docker), central runner (server), or auto */
  preview_mode?: PreviewMode;
  /** Data view (ERD): used by ProjectsPage, ProjectCard, visudev-server for Supabase vs local DB */
  database_type?: "supabase" | "local";
  supabase_project_id?: string;
  supabase_anon_key?: string;
  supabase_management_token?: string;
  screens: Screen[];
  flows: Flow[];
  createdAt: string;
  updatedAt?: string;
  /** Live App preview URL (from Preview Runner) */
  previewUrl?: string;
  /** Live App preview status */
  previewStatus?: PreviewStatus;
  /** When the preview expires (ISO) */
  previewExpiresAt?: string;
  /** Commit SHA of last analysis (for Preview-Runner: start at this exact SHA) */
  lastAnalyzedCommitSha?: string;
}

export interface AnalysisResult {
  screens: Screen[];
  flows: Flow[];
  stats: {
    totalScreens: number;
    totalFlows: number;
    maxDepth: number;
  };
}

export interface ScanResult {
  id: string;
  projectId: string;
  scanType: "appflow" | "blueprint" | "data";
  status: ScanStatus;
  progress: number;
  logs?: StepLogEntry[];
  result?: AnalysisResult;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ScanStatuses {
  appflow: { status: ScanStatus; progress: number; message?: string; error?: string };
  blueprint: { status: ScanStatus; progress: number; message?: string; error?: string };
  data: { status: ScanStatus; progress: number; message?: string; error?: string };
}
