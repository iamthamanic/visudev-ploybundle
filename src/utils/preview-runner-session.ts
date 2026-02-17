import { getPreviewRunnerClientDeps } from "./preview-runner-deps";
import { logPreviewRunnerClientError } from "./preview-runner-log";
import {
  sanitizeProjectId,
  sanitizeProjectToken,
  sanitizeRunId,
} from "./preview-runner-validation";

const PREVIEW_RUNID_KEY = "visudev_preview_runId_";
const PREVIEW_PROJECT_TOKEN_KEY = "visudev_preview_project_token_";

function getStorageKeys(projectId: string): { runIdKey: string; tokenKey: string } | null {
  const validProjectId = sanitizeProjectId(projectId);
  if (!validProjectId) return null;
  const projectKey = encodeURIComponent(validProjectId);
  return {
    runIdKey: PREVIEW_RUNID_KEY + projectKey,
    tokenKey: PREVIEW_PROJECT_TOKEN_KEY + projectKey,
  };
}

function readStorage(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    logPreviewRunnerClientError(`read storage failed (${key})`, error);
    return null;
  }
}

function writeStorage(storage: Storage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch (error) {
    logPreviewRunnerClientError(`write storage failed (${key})`, error);
  }
}

function removeStorage(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    logPreviewRunnerClientError(`remove storage failed (${key})`, error);
  }
}

export function getStoredRunId(projectId: string): string | null {
  const keys = getStorageKeys(projectId);
  if (!keys) return null;

  const deps = getPreviewRunnerClientDeps();
  const storage = deps.getLocalStorage();
  const raw = readStorage(storage, keys.runIdKey);
  if (!raw) return null;

  const runId = sanitizeRunId(raw);
  if (!runId) {
    removeStorage(storage, keys.runIdKey);
    return null;
  }
  return runId;
}

export function setStoredRunId(projectId: string, runId: string): void {
  const keys = getStorageKeys(projectId);
  const validRunId = sanitizeRunId(runId);
  if (!keys || !validRunId) return;

  const deps = getPreviewRunnerClientDeps();
  writeStorage(deps.getLocalStorage(), keys.runIdKey, validRunId);
}

export function clearStoredRunId(projectId: string): void {
  const keys = getStorageKeys(projectId);
  if (!keys) return;

  const deps = getPreviewRunnerClientDeps();
  removeStorage(deps.getLocalStorage(), keys.runIdKey);
}

export function getStoredProjectToken(projectId: string): string | null {
  const keys = getStorageKeys(projectId);
  if (!keys) return null;

  const deps = getPreviewRunnerClientDeps();
  const storage = deps.getSessionStorage();
  const raw = readStorage(storage, keys.tokenKey);
  if (!raw) return null;

  const token = sanitizeProjectToken(raw);
  if (!token) {
    removeStorage(storage, keys.tokenKey);
    return null;
  }
  return token;
}

export function setStoredProjectToken(projectId: string, token: string): void {
  const keys = getStorageKeys(projectId);
  const validToken = sanitizeProjectToken(token);
  if (!keys || !validToken) return;

  const deps = getPreviewRunnerClientDeps();
  writeStorage(deps.getSessionStorage(), keys.tokenKey, validToken);
}

export function clearStoredProjectToken(projectId: string): void {
  const keys = getStorageKeys(projectId);
  if (!keys) return;

  const deps = getPreviewRunnerClientDeps();
  removeStorage(deps.getSessionStorage(), keys.tokenKey);
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
