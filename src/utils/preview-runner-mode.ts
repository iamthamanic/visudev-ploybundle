import type { PreviewMode } from "../lib/visudev/types";
import { getPreviewRunnerClientDeps } from "./preview-runner-deps";
import { logPreviewRunnerClientError } from "./preview-runner-log";

/** When set (e.g. http://localhost:4000), frontend calls the Preview Runner directly; no Edge Function or Supabase secret needed. In dev we default to localhost:4000 so "npm run dev" works without .env. */
const localRunnerUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_PREVIEW_RUNNER_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.DEV ? "http://localhost:4000" : "") ||
  "";

const DISCOVERED_RUNNER_KEY = "visudev_preview_runner_discovered_url";

function normalizeRunnerUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    logPreviewRunnerClientError("invalid runner URL", error);
    return null;
  }
}

function getDiscoveryStorage(): Storage | null {
  const deps = getPreviewRunnerClientDeps();
  return deps.getSessionStorage() ?? deps.getLocalStorage();
}

function getDiscoveredRunnerUrl(): string | null {
  const storage = getDiscoveryStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(DISCOVERED_RUNNER_KEY);
    if (!raw) return null;
    const normalized = normalizeRunnerUrl(raw);
    if (!normalized) {
      storage.removeItem(DISCOVERED_RUNNER_KEY);
      return null;
    }
    return normalized;
  } catch (error) {
    logPreviewRunnerClientError("read discovered runner URL failed", error);
    return null;
  }
}

export function getEffectiveRunnerUrl(): string {
  return getDiscoveredRunnerUrl() ?? localRunnerUrl;
}

export function setDiscoveredRunnerUrl(url: string): void {
  const storage = getDiscoveryStorage();
  if (!storage) return;
  const normalized = normalizeRunnerUrl(url);
  try {
    if (!normalized) {
      storage.removeItem(DISCOVERED_RUNNER_KEY);
      return;
    }
    storage.setItem(DISCOVERED_RUNNER_KEY, normalized);
  } catch (error) {
    logPreviewRunnerClientError("write discovered runner URL failed", error);
  }
}

export function shouldDiscoverRunner(): boolean {
  return Boolean(localRunnerUrl || (typeof import.meta !== "undefined" && import.meta.env?.DEV));
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
