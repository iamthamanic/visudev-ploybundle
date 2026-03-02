import { getCurrentRunnerRunId } from "./preview-runner-guards";
import { isRunnerSessionGoneStatus, requestRunnerJson } from "./preview-runner-lifecycle-request";
import { parseRunnerStatusPayload, warnRunner } from "./preview-runner-parser";
import { clearPreviewSession } from "./preview-runner-session";
import type { PreviewStepLog } from "./preview-runner-types";
import { sanitizeProjectId } from "./preview-runner-validation";

export async function localPreviewStatus(projectId: string): Promise<{
  success: boolean;
  status?: "idle" | "starting" | "ready" | "failed" | "stopped";
  previewUrl?: string;
  error?: string;
  logs?: PreviewStepLog[];
}> {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return { success: false, error: "Ungültige Projekt-ID." };

  const runId = getCurrentRunnerRunId(validProjectId);
  if (!runId) return { success: true, status: "idle" };

  const result = await requestRunnerJson({
    projectId: validProjectId,
    path: `/status/${encodeURIComponent(runId)}`,
    context: "Runner /status",
  });

  if (!result.ok) {
    if (isRunnerSessionGoneStatus(result.status)) {
      clearPreviewSession(validProjectId);
      return { success: true, status: "idle" };
    }
    return { success: false, error: result.error };
  }

  const parsed = parseRunnerStatusPayload(result.payload);
  if (!parsed) {
    warnRunner("Runner /status response missing required fields");
    return { success: false, error: "Runner response missing required status fields." };
  }
  if (parsed.status === "idle") clearPreviewSession(validProjectId);

  return {
    success: true,
    status: parsed.status,
    previewUrl: parsed.previewUrl,
    error: parsed.error,
    logs: parsed.logs,
  };
}
