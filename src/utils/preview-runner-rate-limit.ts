import { getPreviewRunnerClientDeps } from "./preview-runner-deps";
import { logPreviewRunnerClientError } from "./preview-runner-log";
import { sanitizeProjectId } from "./preview-runner-validation";

const RATE_LIMIT_PREFIX = "visudev_preview_rate_limit_";

export type PreviewRunnerAction = "start" | "stop" | "refresh" | "stop-project";

function readTimestamp(storage: Storage, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    logPreviewRunnerClientError(`read rate-limit timestamp failed (${key})`, error);
    return null;
  }
}

function writeTimestamp(storage: Storage, key: string, value: number): void {
  try {
    storage.setItem(key, String(value));
  } catch (error) {
    logPreviewRunnerClientError(`write rate-limit timestamp failed (${key})`, error);
  }
}

export function claimPreviewRunnerAction(
  projectId: string,
  action: PreviewRunnerAction,
  cooldownMs: number,
): { ok: true; retryAfterMs: 0 } | { ok: false; retryAfterMs: number } {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) {
    return { ok: false, retryAfterMs: cooldownMs };
  }

  const deps = getPreviewRunnerClientDeps();
  const storage = deps.getSessionStorage() ?? deps.getLocalStorage();
  if (!storage) return { ok: true, retryAfterMs: 0 };

  const key = `${RATE_LIMIT_PREFIX}${action}_${encodeURIComponent(validProjectId)}`;
  const now = deps.now();
  const last = readTimestamp(storage, key);

  if (last != null) {
    const elapsed = now - last;
    if (elapsed < cooldownMs) {
      return { ok: false, retryAfterMs: cooldownMs - elapsed };
    }
  }

  writeTimestamp(storage, key, now);
  return { ok: true, retryAfterMs: 0 };
}
