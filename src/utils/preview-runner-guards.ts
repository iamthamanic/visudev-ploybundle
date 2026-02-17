import { claimPreviewRunnerAction, type PreviewRunnerAction } from "./preview-runner-rate-limit";
import { clearPreviewSession, getStoredRunId } from "./preview-runner-session";
import { sanitizeRunId } from "./preview-runner-validation";

function rateLimitError(action: string, retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `${action} derzeit gedrosselt. Bitte in ${seconds}s erneut versuchen.`;
}

export function enforceRunnerActionCooldown(
  projectId: string,
  action: PreviewRunnerAction,
  cooldownMs: number,
  label: string,
): string | null {
  const cooldown = claimPreviewRunnerAction(projectId, action, cooldownMs);
  return cooldown.ok ? null : rateLimitError(label, cooldown.retryAfterMs);
}

export function getCurrentRunnerRunId(projectId: string): string | null {
  const runId = getStoredRunId(projectId);
  if (!runId) return null;
  const validRunId = sanitizeRunId(runId);
  if (!validRunId) {
    clearPreviewSession(projectId);
    return null;
  }
  return validRunId;
}
