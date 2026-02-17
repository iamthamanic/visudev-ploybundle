/** projectId -> runId when using local runner */
const localRunIds = new Map<string, string>();
const localProjectTokens = new Map<string, string>();

const PREVIEW_RUNID_KEY = "visudev_preview_runId_";
const PREVIEW_PROJECT_TOKEN_KEY = "visudev_preview_project_token_";

export function getStoredRunId(projectId: string): string | null {
  let runId = localRunIds.get(projectId) ?? null;
  if (!runId && typeof localStorage !== "undefined") {
    runId = localStorage.getItem(PREVIEW_RUNID_KEY + projectId);
    if (runId) localRunIds.set(projectId, runId);
  }
  return runId;
}

export function setStoredRunId(projectId: string, runId: string): void {
  localRunIds.set(projectId, runId);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PREVIEW_RUNID_KEY + projectId, runId);
  }
}

export function clearStoredRunId(projectId: string): void {
  localRunIds.delete(projectId);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(PREVIEW_RUNID_KEY + projectId);
  }
}

export function getStoredProjectToken(projectId: string): string | null {
  const cached = localProjectTokens.get(projectId);
  if (cached) return cached;
  if (typeof sessionStorage === "undefined") return null;
  const token = sessionStorage.getItem(PREVIEW_PROJECT_TOKEN_KEY + projectId);
  if (!token || token.trim() === "") return null;
  localProjectTokens.set(projectId, token);
  return token;
}

export function setStoredProjectToken(projectId: string, token: string): void {
  localProjectTokens.set(projectId, token);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(PREVIEW_PROJECT_TOKEN_KEY + projectId, token);
  }
}

export function clearStoredProjectToken(projectId: string): void {
  localProjectTokens.delete(projectId);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(PREVIEW_PROJECT_TOKEN_KEY + projectId);
  }
}

export function clearPreviewSession(projectId: string): void {
  clearStoredRunId(projectId);
  clearStoredProjectToken(projectId);
}

export function runnerHeaders(projectId: string, withJson = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (withJson) headers["Content-Type"] = "application/json";
  const token = getStoredProjectToken(projectId);
  if (token) headers["X-VisuDev-Project-Token"] = token;
  return headers;
}
