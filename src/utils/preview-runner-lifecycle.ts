import type { PreviewRuntimeOptions } from "../lib/visudev/types";
import { getPreviewRunnerClientDeps } from "./preview-runner-deps";
import { enforceRunnerActionCooldown, getCurrentRunnerRunId } from "./preview-runner-guards";
import { getEffectiveRunnerUrl } from "./preview-runner-mode";
import {
  parseRunnerError,
  parseRunnerJsonText,
  parseRunnerStartPayload,
  parseRunnerStatusPayload,
  warnRunnerOnce,
} from "./preview-runner-parser";
import {
  clearPreviewSession,
  runnerHeaders,
  setStoredProjectToken,
  setStoredRunId,
} from "./preview-runner-session";
import { requestRunnerWithDiscovery } from "./preview-runner-transport";
import type { PreviewStepLog } from "./preview-runner-types";
import { sanitizeProjectId } from "./preview-runner-validation";

const START_COOLDOWN_MS = 3000;
const STOP_COOLDOWN_MS = 1500;
const REFRESH_COOLDOWN_MS = 3000;
const STOP_PROJECT_COOLDOWN_MS = 2000;

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

  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const body = JSON.stringify({
    projectId: validProjectId,
    repo: options?.repo,
    branchOrCommit: options?.branchOrCommit ?? "main",
    commitSha: options?.commitSha ?? undefined,
    bootMode: options?.bootMode ?? undefined,
    injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
  });

  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await deps.fetch(`${urlBase}/start`, {
      method: "POST",
      headers: runnerHeaders(validProjectId, true),
      body,
    });
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /start", doFetch);
  if (!request.ok) return { success: false, error: request.error };

  const payload = parseRunnerJsonText(request.text, "Runner /start response");
  if (payload == null) return { success: false, error: "Runner response not JSON" };
  if (!request.res.ok) {
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  const parsed = parseRunnerStartPayload(payload);
  if (!parsed) {
    warnRunnerOnce("Runner /start response missing required fields");
    return { success: false, error: "Runner response missing required start fields." };
  }

  setStoredRunId(validProjectId, parsed.runId);
  if (parsed.projectToken) setStoredProjectToken(validProjectId, parsed.projectToken);

  return { success: true, data: { runId: parsed.runId, status: parsed.status } };
}

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

  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await deps.fetch(`${urlBase}/status/${encodeURIComponent(runId)}`, {
      headers: runnerHeaders(validProjectId),
    });
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /status", doFetch);
  if (!request.ok) return { success: false, error: request.error };

  const payload = parseRunnerJsonText(request.text, "Runner /status response");
  if (payload == null) return { success: false, error: "Runner response not JSON" };
  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(validProjectId);
      return { success: true, status: "idle" };
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  const parsed = parseRunnerStatusPayload(payload);
  if (!parsed) {
    warnRunnerOnce("Runner /status response missing required fields");
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

  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await deps.fetch(`${urlBase}/stop/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: runnerHeaders(validProjectId),
    });
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /stop", doFetch);
  if (!request.ok) return { success: false, error: request.error };

  const payload = parseRunnerJsonText(request.text, "Runner /stop response");
  if (payload == null) return { success: false, error: "Runner response not JSON" };
  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(validProjectId);
      if (request.res.status === 404) return { success: true };
      return { success: false, error: parseRunnerError(payload, request.res.status) };
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
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
  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await deps.fetch(`${urlBase}/stop-project/${encodeURIComponent(validProjectId)}`, {
      method: "POST",
      headers: runnerHeaders(validProjectId),
    });
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /stop-project", doFetch);
  if (!request.ok) {
    if (runId) return localPreviewStop(validProjectId, { skipCooldown: true });
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /stop-project response");
  if (payload == null) return { success: false, error: "Runner response not JSON" };
  if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
    if (runId) return localPreviewStop(validProjectId, { skipCooldown: true });
    clearPreviewSession(validProjectId);
    if (request.res.status === 404) return { success: true };
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }
  if (!request.res.ok) {
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  clearPreviewSession(validProjectId);
  return { success: true };
}

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

  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await deps.fetch(`${urlBase}/refresh`, {
      method: "POST",
      headers: runnerHeaders(validProjectId, true),
      body: JSON.stringify({
        runId,
        bootMode: options?.bootMode ?? undefined,
        injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
      }),
    });
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /refresh", doFetch);
  if (!request.ok) return { success: false, error: request.error };

  const payload = parseRunnerJsonText(request.text, "Runner /refresh response");
  if (payload == null) return { success: false, error: "Runner response not JSON" };
  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(validProjectId);
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  return { success: true };
}
