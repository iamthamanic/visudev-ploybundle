export interface PreviewRunnerRunInfo {
  runId: string;
  projectId: string;
  repo: string;
  branchOrCommit: string;
  status: string;
  previewUrl: string | null;
  startedAt: string | null;
  readyAt: string | null;
  stoppedAt: string | null;
}

export interface PreviewRunnerRuntimeStatus {
  state: "active" | "inactive";
  baseUrl: string | null;
  checkedAt: string;
  startedAt: string | null;
  uptimeSec: number | null;
  activeRuns: number;
  projects: string[];
  runs: PreviewRunnerRunInfo[];
}

/** Single log line from preview start/refresh (Runner or Edge). */
export interface PreviewStepLog {
  time: string;
  message: string;
}

export interface PreviewStatusResponse {
  success: boolean;
  status?: "idle" | "starting" | "ready" | "failed" | "stopped";
  previewUrl?: string;
  error?: string;
  startedAt?: string;
  expiresAt?: string;
  logs?: PreviewStepLog[];
}

export type RunnerPreviewStatus = NonNullable<PreviewStatusResponse["status"]>;
