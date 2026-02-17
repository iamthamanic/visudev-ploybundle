import type { PreviewRuntimeOptions } from "../lib/visudev/types";
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
  getStoredRunId,
  runnerHeaders,
  setStoredProjectToken,
  setStoredRunId,
} from "./preview-runner-session";
import { requestRunnerWithDiscovery } from "./preview-runner-transport";
import type { PreviewStepLog } from "./preview-runner-types";

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
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const body = JSON.stringify({
    projectId,
    repo: options?.repo,
    branchOrCommit: options?.branchOrCommit ?? "main",
    commitSha: options?.commitSha ?? undefined,
    bootMode: options?.bootMode ?? undefined,
    injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
  });

  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await fetch(`${urlBase}/start`, {
      method: "POST",
      headers: runnerHeaders(projectId, true),
      body,
    });
    const text = await res.text();
    return { res, text };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /start", doFetch);
  if (!request.ok) {
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /start response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }

  if (!request.res.ok) {
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  const parsed = parseRunnerStartPayload(payload);
  if (!parsed) {
    warnRunnerOnce("Runner /start response missing required fields");
    return { success: false, error: "Runner response missing required start fields." };
  }

  setStoredRunId(projectId, parsed.runId);
  if (parsed.projectToken) {
    setStoredProjectToken(projectId, parsed.projectToken);
  }
  return { success: true, data: { runId: parsed.runId, status: parsed.status } };
}

export async function localPreviewStatus(projectId: string): Promise<{
  success: boolean;
  status?: "idle" | "starting" | "ready" | "failed" | "stopped";
  previewUrl?: string;
  error?: string;
  logs?: PreviewStepLog[];
}> {
  const runId = getStoredRunId(projectId);
  if (!runId) return { success: true, status: "idle" };
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await fetch(`${urlBase}/status/${encodeURIComponent(runId)}`, {
      headers: runnerHeaders(projectId),
    });
    const text = await res.text();
    return { res, text };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /status", doFetch);
  if (!request.ok) {
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /status response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }

  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(projectId);
      return { success: true, status: "idle" };
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  const parsed = parseRunnerStatusPayload(payload);
  if (!parsed) {
    warnRunnerOnce("Runner /status response missing required fields");
    return { success: false, error: "Runner response missing required status fields." };
  }

  if (parsed.status === "idle") {
    clearPreviewSession(projectId);
  }

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
): Promise<{ success: boolean; error?: string }> {
  const runId = getStoredRunId(projectId);
  if (!runId) return { success: true };
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await fetch(`${urlBase}/stop/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: runnerHeaders(projectId),
    });
    const text = await res.text();
    return { res, text };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /stop", doFetch);
  if (!request.ok) {
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /stop response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }

  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(projectId);
      if (request.res.status === 404) {
        return { success: true };
      }
      return { success: false, error: parseRunnerError(payload, request.res.status) };
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }

  clearPreviewSession(projectId);
  return { success: true };
}

export async function localPreviewStopProject(
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  const runId = getStoredRunId(projectId);
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await fetch(`${urlBase}/stop-project/${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: runnerHeaders(projectId),
    });
    const text = await res.text();
    return { res, text };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /stop-project", doFetch);
  if (!request.ok) {
    if (runId) return localPreviewStop(projectId);
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /stop-project response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }
  if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
    if (runId) return localPreviewStop(projectId);
    clearPreviewSession(projectId);
    if (request.res.status === 404) {
      return { success: true };
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }
  if (!request.res.ok) {
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }
  clearPreviewSession(projectId);
  return { success: true };
}

/** Refresh preview: pull latest from repo, rebuild, restart (live update). Only with local runner. */
export async function localPreviewRefresh(
  projectId: string,
  options?: PreviewRuntimeOptions,
): Promise<{ success: boolean; error?: string }> {
  const runId = getStoredRunId(projectId);
  if (!runId)
    return {
      success: false,
      error: "Kein aktiver Preview für dieses Projekt (Seite neu laden und Preview neu starten).",
    };
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const res = await fetch(`${urlBase}/refresh`, {
      method: "POST",
      headers: runnerHeaders(projectId, true),
      body: JSON.stringify({
        runId,
        bootMode: options?.bootMode ?? undefined,
        injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
      }),
    });
    const text = await res.text();
    return { res, text };
  };

  const request = await requestRunnerWithDiscovery(base, "Runner /refresh", doFetch);
  if (!request.ok) {
    return { success: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, "Runner /refresh response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }
  if (!request.res.ok) {
    if (request.res.status === 404 || request.res.status === 401 || request.res.status === 403) {
      clearPreviewSession(projectId);
    }
    return { success: false, error: parseRunnerError(payload, request.res.status) };
  }
  return { success: true };
}
