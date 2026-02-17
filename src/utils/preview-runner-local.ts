import type { PreviewMode, PreviewRuntimeOptions } from "../lib/visudev/types";

// ==================== PREVIEW (Live App) ====================

/** When set (e.g. http://localhost:4000), frontend calls the Preview Runner directly; no Edge Function or Supabase secret needed. In dev we default to localhost:4000 so "npm run dev" works without .env. */
const localRunnerUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_PREVIEW_RUNNER_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.DEV ? "http://localhost:4000" : "") ||
  "";

/** Nach fehlgeschlagenem Request ggf. gefundene Runner-URL (z. B. wenn Runner auf 4100 läuft). */
let discoveredRunnerUrl: string | null = null;

const RUNNER_PORT_CANDIDATES = [4000, 4100, 4110, 4120, 4130, 4140];
const RUNNER_REQUEST_TIMEOUT_MS = 1500;

interface RunnerHealthPayload {
  ok?: boolean;
  service?: string;
  port?: number;
  startedAt?: string;
  uptimeSec?: number;
  activeRuns?: number;
}

export interface PreviewRunnerRunInfo {
  runId: string;
  projectId: string;
  repo: string;
  branchOrCommit: string;
  status: string;
  previewUrl: string | null;
  startedAt: string | null;
  readyAt: string | null;
  stoppedAt: string | null;
}

export interface PreviewRunnerRuntimeStatus {
  state: "active" | "inactive";
  baseUrl: string | null;
  checkedAt: string;
  startedAt: string | null;
  uptimeSec: number | null;
  activeRuns: number;
  projects: string[];
  runs: PreviewRunnerRunInfo[];
}

type RunnerPreviewStatus = NonNullable<PreviewStatusResponse["status"]>;

const RUNNER_PREVIEW_STATUS_SET = new Set<RunnerPreviewStatus>([
  "idle",
  "starting",
  "ready",
  "failed",
  "stopped",
]);
const runnerWarningCache = new Set<string>();

function warnRunnerOnce(context: string, error?: unknown): void {
  const message =
    error instanceof Error ? error.message : error != null ? String(error) : "unknown error";
  const cacheKey = `${context}::${message}`;
  if (runnerWarningCache.has(cacheKey)) return;
  runnerWarningCache.add(cacheKey);
  console.warn(`[preview-runner-api] ${context}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRunnerStatus(value: unknown): RunnerPreviewStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim() as RunnerPreviewStatus;
  return RUNNER_PREVIEW_STATUS_SET.has(normalized) ? normalized : null;
}

function parseRunnerError(payload: unknown, fallbackStatus: number): string {
  if (isRecord(payload)) {
    const error = readString(payload.error);
    if (error) return error;
  }
  return String(fallbackStatus);
}

function parseRunnerJsonText(text: string, context: string): unknown | null {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    warnRunnerOnce(`${context}: invalid JSON`, error);
    return null;
  }
}

function parseRunnerStepLogs(value: unknown): PreviewStepLog[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const logs: PreviewStepLog[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const time = readString(entry.time);
    const message = readString(entry.message);
    if (!time || !message) continue;
    logs.push({ time, message });
  }
  return logs;
}

function parseRunnerRunInfo(value: unknown): PreviewRunnerRunInfo | null {
  if (!isRecord(value)) return null;
  const runId = readString(value.runId);
  if (!runId) return null;
  return {
    runId,
    projectId: readString(value.projectId) ?? "",
    repo: readString(value.repo) ?? "",
    branchOrCommit: readString(value.branchOrCommit) ?? "",
    status: readString(value.status) ?? "unknown",
    previewUrl: readNullableString(value.previewUrl),
    startedAt: readNullableString(value.startedAt),
    readyAt: readNullableString(value.readyAt),
    stoppedAt: readNullableString(value.stoppedAt),
  };
}

function parseRunnerHealthPayload(value: unknown): RunnerHealthPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return {
    ok: true,
    service: readString(value.service) ?? undefined,
    port: readFiniteNumber(value.port) ?? undefined,
    startedAt: readNullableString(value.startedAt) ?? undefined,
    uptimeSec: readFiniteNumber(value.uptimeSec) ?? undefined,
    activeRuns: readFiniteNumber(value.activeRuns) ?? undefined,
  };
}

function parseRunnerRuntimeSnapshot(value: unknown): {
  runs: PreviewRunnerRunInfo[];
  startedAt: string | null;
  uptimeSec: number | null;
  activeRuns: number | null;
} {
  if (!isRecord(value)) {
    return { runs: [], startedAt: null, uptimeSec: null, activeRuns: null };
  }

  const runsRaw = Array.isArray(value.runs) ? value.runs : [];
  const runs = runsRaw
    .map(parseRunnerRunInfo)
    .filter((entry): entry is PreviewRunnerRunInfo => entry != null);

  let startedAt: string | null = null;
  let uptimeSec: number | null = null;
  if (isRecord(value.runner)) {
    startedAt = readNullableString(value.runner.startedAt);
    uptimeSec = readFiniteNumber(value.runner.uptimeSec);
  }

  let activeRuns: number | null = null;
  if (isRecord(value.totals)) {
    activeRuns = readFiniteNumber(value.totals.active);
  }

  return { runs, startedAt, uptimeSec, activeRuns };
}

function parseRunnerStartPayload(value: unknown): {
  runId: string;
  status: RunnerPreviewStatus;
  projectToken: string | null;
} | null {
  if (!isRecord(value)) return null;
  const runId = readString(value.runId);
  if (!runId) return null;
  const status = parseRunnerStatus(value.status) ?? "starting";
  const projectToken = readString(value.projectToken);
  return { runId, status, projectToken };
}

function parseRunnerStatusPayload(value: unknown): {
  status: RunnerPreviewStatus;
  previewUrl?: string;
  error?: string;
  logs?: PreviewStepLog[];
} | null {
  if (!isRecord(value)) return null;
  const status = parseRunnerStatus(value.status);
  if (!status) return null;
  const previewUrl = readString(value.previewUrl) ?? undefined;
  const error = readString(value.error) ?? undefined;
  const logs = parseRunnerStepLogs(value.logs);
  return { status, previewUrl, error, logs };
}

async function requestRunnerJson(
  baseUrl: string,
  pathname: string,
): Promise<{ ok: boolean; status: number; data?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
      method: "GET",
      signal: controller.signal,
    });
    const text = await response.text();
    const data = parseRunnerJsonText(text, `Runner ${pathname} response`);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    warnRunnerOnce(`Runner request failed (${pathname})`, error);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Prüft, ob eine URL mit /health erreichbar ist (kurzer Timeout). */
async function checkRunnerHealth(baseUrl: string): Promise<RunnerHealthPayload | null> {
  const out = await requestRunnerJson(baseUrl, "/health");
  if (!out.ok || !out.data) return null;
  return parseRunnerHealthPayload(out.data);
}

/** Sucht unter Kandidaten-Ports (4000, 4100, …) nach einem laufenden Runner; setzt discoveredRunnerUrl. */
async function discoverRunnerUrl(): Promise<string | null> {
  const hosts = ["localhost", "127.0.0.1"];
  for (const port of RUNNER_PORT_CANDIDATES) {
    for (const host of hosts) {
      const url = `http://${host}:${port}`;
      if (await checkRunnerHealth(url)) {
        discoveredRunnerUrl = url;
        return url;
      }
    }
  }
  return null;
}

/** Runner runtime status for UI (sidebar badge / modal). */
export async function getPreviewRunnerRuntimeStatus(): Promise<PreviewRunnerRuntimeStatus> {
  const checkedAt = new Date().toISOString();
  const primaryBase = getEffectiveRunnerUrl();
  const healthPrimary = primaryBase ? await checkRunnerHealth(primaryBase) : null;
  const discoveredBase = healthPrimary ? null : await discoverRunnerUrl();
  const activeBase = healthPrimary ? primaryBase : discoveredBase;
  const health = activeBase ? await checkRunnerHealth(activeBase) : null;

  if (!activeBase || !health) {
    return {
      state: "inactive",
      baseUrl: activeBase ?? null,
      checkedAt,
      startedAt: null,
      uptimeSec: null,
      activeRuns: 0,
      projects: [],
      runs: [],
    };
  }

  const runsResp = await requestRunnerJson(activeBase, "/runs");
  const runtime = runsResp.ok
    ? parseRunnerRuntimeSnapshot(runsResp.data)
    : parseRunnerRuntimeSnapshot(null);
  const runs = runtime.runs;
  const projects = Array.from(
    new Set(runs.map((entry) => entry.projectId).filter((projectId) => projectId.length > 0)),
  );
  const activeRunsFromRuns = runtime.activeRuns;
  const activeRuns =
    typeof activeRunsFromRuns === "number" && Number.isFinite(activeRunsFromRuns)
      ? activeRunsFromRuns
      : typeof health.activeRuns === "number" && Number.isFinite(health.activeRuns)
        ? health.activeRuns
        : 0;

  return {
    state: "active",
    baseUrl: activeBase,
    checkedAt,
    startedAt: runtime.startedAt ?? health.startedAt ?? null,
    uptimeSec:
      runtime.uptimeSec ??
      (typeof health.uptimeSec === "number" && Number.isFinite(health.uptimeSec)
        ? health.uptimeSec
        : null),
    activeRuns,
    projects,
    runs,
  };
}

/** URL für den lokalen Runner (env oder zuvor per Discovery gefunden). */
function getEffectiveRunnerUrl(): string {
  return discoveredRunnerUrl ?? localRunnerUrl;
}

export function resolvePreviewMode(previewMode?: PreviewMode): "local" | "central" | "deployed" {
  if (previewMode === "local") return "local";
  if (previewMode === "central") return "central";
  if (previewMode === "deployed") return "deployed";
  return localRunnerUrl ? "local" : "central";
}

export function localRunnerGuard(): { ok: boolean; error?: string } {
  const url = getEffectiveRunnerUrl();
  if (!url) {
    return {
      ok: false,
      error: "VisuDEV starten (im Projektordner: npm run dev), dann erneut versuchen.",
    };
  }
  return { ok: true };
}

/** projectId -> runId when using local runner */
const localRunIds = new Map<string, string>();
const localProjectTokens = new Map<string, string>();

const PREVIEW_RUNID_KEY = "visudev_preview_runId_";
const PREVIEW_PROJECT_TOKEN_KEY = "visudev_preview_project_token_";

function getStoredRunId(projectId: string): string | null {
  let runId = localRunIds.get(projectId) ?? null;
  if (!runId && typeof localStorage !== "undefined") {
    runId = localStorage.getItem(PREVIEW_RUNID_KEY + projectId);
    if (runId) localRunIds.set(projectId, runId);
  }
  return runId;
}

function setStoredRunId(projectId: string, runId: string): void {
  localRunIds.set(projectId, runId);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PREVIEW_RUNID_KEY + projectId, runId);
  }
}

function clearStoredRunId(projectId: string): void {
  localRunIds.delete(projectId);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(PREVIEW_RUNID_KEY + projectId);
  }
}

function getStoredProjectToken(projectId: string): string | null {
  const cached = localProjectTokens.get(projectId);
  if (cached) return cached;
  if (typeof sessionStorage === "undefined") return null;
  const token = sessionStorage.getItem(PREVIEW_PROJECT_TOKEN_KEY + projectId);
  if (!token || token.trim() === "") return null;
  localProjectTokens.set(projectId, token);
  return token;
}

function setStoredProjectToken(projectId: string, token: string): void {
  localProjectTokens.set(projectId, token);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(PREVIEW_PROJECT_TOKEN_KEY + projectId, token);
  }
}

function clearStoredProjectToken(projectId: string): void {
  localProjectTokens.delete(projectId);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(PREVIEW_PROJECT_TOKEN_KEY + projectId);
  }
}

function runnerHeaders(projectId: string, withJson = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (withJson) headers["Content-Type"] = "application/json";
  const token = getStoredProjectToken(projectId);
  if (token) headers["X-VisuDev-Project-Token"] = token;
  return headers;
}

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

/** Single log line from preview start/refresh (Runner or Edge). */
export interface PreviewStepLog {
  time: string;
  message: string;
}

export interface PreviewStatusResponse {
  success: boolean;
  status?: "idle" | "starting" | "ready" | "failed" | "stopped";
  previewUrl?: string;
  error?: string;
  startedAt?: string;
  expiresAt?: string;
  logs?: PreviewStepLog[];
}

/** Läuft einmal im Hintergrund, um den Runner zu finden (z. B. auf Port 4100), wenn 4000 nicht erreichbar ist. Beim ersten Start/Status wird die gefundene URL gecacht. */
export async function discoverPreviewRunner(): Promise<void> {
  if (localRunnerUrl || (typeof import.meta !== "undefined" && import.meta.env?.DEV)) {
    await discoverRunnerUrl();
  }
}
