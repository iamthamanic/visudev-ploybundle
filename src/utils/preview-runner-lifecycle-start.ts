import type { PreviewRuntimeOptions } from "../lib/visudev/types";
import { enforceRunnerActionCooldown } from "./preview-runner-guards";
import { requestRunnerJson } from "./preview-runner-lifecycle-request";
import { parseRunnerStartPayload, warnRunner } from "./preview-runner-parser";
import { setStoredProjectToken, setStoredRunId } from "./preview-runner-session";
import { sanitizeProjectId } from "./preview-runner-validation";

const START_COOLDOWN_MS = 3000;

export async function localPreviewStart(
  projectId: string,
  options?: {
    repo?: string;
    branchOrCommit?: string;
    commitSha?: string;
    bootMode?: PreviewRuntimeOptions["bootMode"];
    injectSupabasePlaceholders?: PreviewRuntimeOptions["injectSupabasePlaceholders"];
  },
): Promise<{ success: boolean; data?: { runId: string; status: string }; error?: string }> {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return { success: false, error: "Ungültige Projekt-ID." };

  const startRateLimitError = enforceRunnerActionCooldown(
    validProjectId,
    "start",
    START_COOLDOWN_MS,
    "Start",
  );
  if (startRateLimitError) return { success: false, error: startRateLimitError };

  const result = await requestRunnerJson({
    projectId: validProjectId,
    path: "/start",
    context: "Runner /start",
    method: "POST",
    withJsonBody: true,
    body: JSON.stringify({
      projectId: validProjectId,
      repo: options?.repo,
      branchOrCommit: options?.branchOrCommit ?? "main",
      commitSha: options?.commitSha ?? undefined,
      bootMode: options?.bootMode ?? undefined,
      injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
    }),
  });
  if (!result.ok) return { success: false, error: result.error };

  const parsed = parseRunnerStartPayload(result.payload);
  if (!parsed) {
    warnRunner("Runner /start response missing required fields");
    return { success: false, error: "Runner response missing required start fields." };
  }

  setStoredRunId(validProjectId, parsed.runId);
  if (parsed.projectToken) setStoredProjectToken(validProjectId, parsed.projectToken);

  return { success: true, data: { runId: parsed.runId, status: parsed.status } };
}
