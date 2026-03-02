import { enforceRunnerActionCooldown, getCurrentRunnerRunId } from "./preview-runner-guards";
import { isRunnerSessionGoneStatus, requestRunnerJson } from "./preview-runner-lifecycle-request";
import { clearPreviewSession } from "./preview-runner-session";
import { sanitizeProjectId } from "./preview-runner-validation";

const STOP_COOLDOWN_MS = 1500;
const STOP_PROJECT_COOLDOWN_MS = 2000;

export async function localPreviewStop(
  projectId: string,
  options?: { skipCooldown?: boolean },
): Promise<{ success: boolean; error?: string }> {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return { success: false, error: "Ungültige Projekt-ID." };

  if (!options?.skipCooldown) {
    const stopRateLimitError = enforceRunnerActionCooldown(
      validProjectId,
      "stop",
      STOP_COOLDOWN_MS,
      "Stop",
    );
    if (stopRateLimitError) return { success: false, error: stopRateLimitError };
  }

  const runId = getCurrentRunnerRunId(validProjectId);
  if (!runId) return { success: true };

  const result = await requestRunnerJson({
    projectId: validProjectId,
    path: `/stop/${encodeURIComponent(runId)}`,
    context: "Runner /stop",
    method: "POST",
  });
  if (!result.ok) {
    if (isRunnerSessionGoneStatus(result.status)) {
      clearPreviewSession(validProjectId);
      if (result.status === 404) return { success: true };
    }
    return { success: false, error: result.error };
  }

  clearPreviewSession(validProjectId);
  return { success: true };
}

export async function localPreviewStopProject(
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return { success: false, error: "Ungültige Projekt-ID." };

  const stopProjectRateLimitError = enforceRunnerActionCooldown(
    validProjectId,
    "stop-project",
    STOP_PROJECT_COOLDOWN_MS,
    "Stop-Project",
  );
  if (stopProjectRateLimitError) return { success: false, error: stopProjectRateLimitError };

  const runId = getCurrentRunnerRunId(validProjectId);
  const result = await requestRunnerJson({
    projectId: validProjectId,
    path: `/stop-project/${encodeURIComponent(validProjectId)}`,
    context: "Runner /stop-project",
    method: "POST",
  });
  if (!result.ok) {
    if (result.status == null || isRunnerSessionGoneStatus(result.status)) {
      if (runId) return localPreviewStop(validProjectId, { skipCooldown: true });
      clearPreviewSession(validProjectId);
      if (result.status === 404) return { success: true };
    }
    return { success: false, error: result.error };
  }

  clearPreviewSession(validProjectId);
  return { success: true };
}
