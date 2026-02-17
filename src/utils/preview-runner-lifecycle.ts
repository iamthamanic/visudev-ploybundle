import type { PreviewRuntimeOptions } from "../lib/visudev/types";
import {
  discoverRunnerUrl,
  getEffectiveRunnerUrl,
  parseRunnerError,
  parseRunnerJsonText,
  parseRunnerStartPayload,
  parseRunnerStatusPayload,
  warnRunnerOnce,
} from "./preview-runner-core";
import {
  clearStoredProjectToken,
  clearStoredRunId,
  getStoredRunId,
  runnerHeaders,
  setStoredProjectToken,
  setStoredRunId,
} from "./preview-runner-session";
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
  let base = getEffectiveRunnerUrl().replace(/\/$/, "");
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

  let res: Response;
  let text = "";
  try {
    const out = await doFetch(base);
    res = out.res;
    text = out.text;
  } catch (error) {
    warnRunnerOnce(`Runner /start request failed (${base})`, error);
    const found = await discoverRunnerUrl();
    if (found) {
      base = found.replace(/\/$/, "");
      try {
        const out = await doFetch(base);
        res = out.res;
        text = out.text;
      } catch (retryError) {
        warnRunnerOnce(`Runner /start retry failed (${base})`, retryError);
        return {
          success: false,
          error: `Preview Runner nicht erreichbar. Läuft der Runner? (lokal: ${base})`,
        };
      }
    } else {
      return {
        success: false,
        error: `Preview Runner nicht erreichbar. Läuft der Runner? (lokal: http://localhost:4000)`,
      };
    }
  }

  const payload = parseRunnerJsonText(text, "Runner /start response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }

  if (!res.ok) {
    return { success: false, error: parseRunnerError(payload, res.status) };
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
  let base = getEffectiveRunnerUrl().replace(/\/$/, "");
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}/status/${encodeURIComponent(runId)}`, {
      headers: runnerHeaders(projectId),
    });
    text = await res.text();
  } catch (error) {
    warnRunnerOnce(`Runner /status request failed (${base})`, error);
    const found = await discoverRunnerUrl();
    if (found) {
      base = found.replace(/\/$/, "");
      try {
        res = await fetch(`${base}/status/${encodeURIComponent(runId)}`, {
          headers: runnerHeaders(projectId),
        });
        text = await res.text();
      } catch (retryError) {
        warnRunnerOnce(`Runner /status retry failed (${base})`, retryError);
        return {
          success: false,
          error: `Preview Runner nicht erreichbar. Läuft der Runner? (lokal: ${base})`,
        };
      }
    } else {
      return {
        success: false,
        error: "Preview Runner nicht erreichbar. Läuft der Runner? (lokal: http://localhost:4000)",
      };
    }
  }

  const payload = parseRunnerJsonText(text, "Runner /status response");
  if (payload == null) {
    return { success: false, error: "Runner response not JSON" };
  }

  if (!res.ok) {
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      clearStoredRunId(projectId);
      clearStoredProjectToken(projectId);
      return { success: true, status: "idle" };
    }
    return { success: false, error: parseRunnerError(payload, res.status) };
  }

  const parsed = parseRunnerStatusPayload(payload);
  if (!parsed) {
    warnRunnerOnce("Runner /status response missing required fields");
    return { success: false, error: "Runner response missing required status fields." };
  }

  if (parsed.status === "idle") {
    clearStoredRunId(projectId);
    clearStoredProjectToken(projectId);
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
  try {
    const res = await fetch(`${base}/stop/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: runnerHeaders(projectId),
    });
    const text = await res.text();
    const payload = parseRunnerJsonText(text, "Runner /stop response");
    if (payload == null) {
      return { success: false, error: "Runner response not JSON" };
    }

    if (!res.ok) {
      if (res.status === 404) {
        clearStoredRunId(projectId);
        clearStoredProjectToken(projectId);
        return { success: true };
      }
      return { success: false, error: parseRunnerError(payload, res.status) };
    }

    clearStoredRunId(projectId);
    clearStoredProjectToken(projectId);
    return { success: true };
  } catch (error) {
    warnRunnerOnce(`Runner /stop request failed (${base})`, error);
    return { success: false, error: "Runner request failed" };
  }
}

export async function localPreviewStopProject(
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  const runId = getStoredRunId(projectId);
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/stop-project/${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: runnerHeaders(projectId),
    });
    const text = await res.text();
    const payload = parseRunnerJsonText(text, "Runner /stop-project response");
    if (payload == null) {
      return { success: false, error: "Runner response not JSON" };
    }
    if (res.status === 404) {
      if (runId) return localPreviewStop(projectId);
      clearStoredRunId(projectId);
      clearStoredProjectToken(projectId);
      return { success: true };
    }
    if (!res.ok) {
      return { success: false, error: parseRunnerError(payload, res.status) };
    }
    clearStoredRunId(projectId);
    clearStoredProjectToken(projectId);
    return { success: true };
  } catch (error) {
    warnRunnerOnce(`Runner /stop-project request failed (${base})`, error);
    if (runId) return localPreviewStop(projectId);
    clearStoredRunId(projectId);
    clearStoredProjectToken(projectId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Runner request failed",
    };
  }
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
  try {
    const res = await fetch(`${base}/refresh`, {
      method: "POST",
      headers: runnerHeaders(projectId, true),
      body: JSON.stringify({
        runId,
        bootMode: options?.bootMode ?? undefined,
        injectSupabasePlaceholders: options?.injectSupabasePlaceholders ?? undefined,
      }),
    });
    const text = await res.text();
    const payload = parseRunnerJsonText(text, "Runner /refresh response");
    if (payload == null) {
      return { success: false, error: "Runner response not JSON" };
    }
    if (!res.ok) {
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        clearStoredRunId(projectId);
        clearStoredProjectToken(projectId);
      }
      return { success: false, error: parseRunnerError(payload, res.status) };
    }
    return { success: true };
  } catch (error) {
    warnRunnerOnce(`Runner /refresh request failed (${base})`, error);
    return { success: false, error: "Runner request failed" };
  }
}
