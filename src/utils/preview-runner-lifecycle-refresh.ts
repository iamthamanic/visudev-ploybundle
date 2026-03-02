import type { PreviewRuntimeOptions } from "../lib/visudev/types";
import { enforceRunnerActionCooldown, getCurrentRunnerRunId } from "./preview-runner-guards";
import { isRunnerSessionGoneStatus, requestRunnerJson } from "./preview-runner-lifecycle-request";
import { clearPreviewSession } from "./preview-runner-session";
import { sanitizeProjectId } from "./preview-runner-validation";

const REFRESH_COOLDOWN_MS = 3000;

export async function localPreviewRefresh(
  projectId: string,
  options?: PreviewRuntimeOptions,
): Promise<{ success: boolean; error?: string }> {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return { success: false, error: "Ungültige Projekt-ID." };

  const runId = getCurrentRunnerRunId(validProjectId);
  if (!runId) {
    return {
      success: false,
      error: "Kein aktiver Preview für dieses Projekt (Seite neu laden und Preview neu starten).",
    };
  }

  const refreshRateLimitError = enforceRunnerActionCooldown(
    validProjectId,
    "refresh",
    REFRESH_COOLDOWN_MS,
    "Refresh",
  );
  if (refreshRateLimitError) return { success: false, error: refreshRateLimitError };

  const result = await requestRunnerJson({
    projectId: validProjectId,
    path: "/refresh",
    context: "Runner /refresh",
    method: "POST",
    withJsonBody: true,
    body: JSON.stringify({
      runId,
      bootMode: options?.bootMode ?? undefined,
      injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
    }),
  });
  if (!result.ok) {
    if (isRunnerSessionGoneStatus(result.status)) {
      clearPreviewSession(validProjectId);
    }
    return { success: false, error: result.error };
  }

  return { success: true };
}
