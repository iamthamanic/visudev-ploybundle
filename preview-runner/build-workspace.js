import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WORKSPACE_ROOT = join(__dirname, "workspace");
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** When set to an absolute path, the runner uses this dir instead of cloning (for local dev: same code as your editor). */
export function getLocalWorkspaceOverride() {
  const raw = typeof process.env.USE_LOCAL_WORKSPACE === "string" ? process.env.USE_LOCAL_WORKSPACE.trim() : "";
  if (!raw) return null;
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

export function sanitizeProjectId(projectId) {
  const normalized = String(projectId || "").trim();
  if (!PROJECT_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid projectId. Expected [A-Za-z0-9_-]{1,64}.");
  }
  return normalized;
}

export function getWorkspaceDir(projectId) {
  const local = getLocalWorkspaceOverride();
  if (local) return local;
  return join(WORKSPACE_ROOT, sanitizeProjectId(projectId));
}
