/**
 * VisuDEV Preview Runner – Docker-basierter Build & Serve (fipso/runner-ähnlich)
 * Ein Container pro Preview: install → build → serve auf Port 3000 im Container.
 * Host-Port wird auf Container:3000 gemappt, kein "App ignoriert PORT"-Problem.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const DOCKER_IMAGE = process.env.VISUDEV_DOCKER_IMAGE || "node:20-alpine";
const CONTAINER_PORT = 3000;
/** Clean build artifacts and caches before build to avoid stale output (set to "0" to disable). */
const CLEAN_BEFORE_BUILD = process.env.PREVIEW_CLEAN_BEFORE_BUILD !== "0";
const MAX_LOG_TOKEN_LENGTH = 10_000;

function sanitizeContainerLogText(text) {
  const raw = String(text || "");
  let sanitized = raw
    .replace(/(authorization\s*:\s*bearer\s+)[a-z0-9._-]{12,}/gi, "$1[REDACTED]")
    .replace(/(x-access-token:)[^\s]+/gi, "$1[REDACTED]")
    .replace(
      /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[REDACTED_GITHUB_TOKEN]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(
      /((?:password|secret|token|api[_-]?key|service[_-]?role[_-]?key)\s*[:=]\s*)(["']?)[^\s,"']+\2/gi,
      "$1[REDACTED]",
    );

  if (sanitized.length > MAX_LOG_TOKEN_LENGTH) {
    sanitized = `${sanitized.slice(0, 4_800)}\n...[gekürzt]...\n${sanitized.slice(-4_800)}`;
  }
  return sanitized;
}

/** Container-Name aus runId (Docker: nur [a-zA-Z0-9][a-zA-Z0-9_.-]). */
function containerName(runId) {
  return (
    "visudev-preview-" +
    String(runId)
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, 50)
  );
}

/** Führt einen Befehl aus, gibt Promise mit stdout/stderr oder wirft. */
function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * Startet einen Docker-Container: Workspace gemountet, darin install → build → serve auf 3000.
 * Host appPort wird auf Container:3000 gemappt.
 * @param {string} workspaceDir - absoluter Pfad zum geklonten Repo
 * @param {number} appPort - Host-Port (wird auf Container 3000 gemappt)
 * @param {string} runId - z. B. run_123_abc (für Container-Namen)
 * @returns {Promise<string>} Container-ID
 */
export async function runContainer(workspaceDir, appPort, runId) {
  const name = containerName(runId);
  // Optional: clean build outputs and caches to avoid stale artifacts from previous runs
  const cleanStep = CLEAN_BEFORE_BUILD
    ? "rm -rf dist .next out .vite node_modules/.cache 2>/dev/null; "
    : "";
  // Install → build → serve: Ausgabeordner automatisch wählen (dist | build | out | .)
  const cmd =
    "(npm ci --include=dev --ignore-scripts 2>/dev/null || npm ci --ignore-scripts 2>/dev/null || npm install --include=dev --ignore-scripts 2>/dev/null || npm install --ignore-scripts) && " +
    cleanStep +
    "npm run build && " +
    '(D=dist; [ -d build ] && D=build; [ -d out ] && D=out; [ ! -d "$D" ] && D=.; exec npx serve "$D" -s -l ' +
    CONTAINER_PORT +
    ")";
  const absPath = resolve(workspaceDir);
  const isWin = process.platform === "win32";
  const mount = isWin ? absPath.replace(/\\/g, "/") : absPath;
  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    `${appPort}:${CONTAINER_PORT}`,
    "-v",
    `${mount}:/app`,
    "-w",
    "/app",
    DOCKER_IMAGE,
    "sh",
    "-c",
    cmd,
  ];
  await exec("docker", args).catch((e) => {
    console.error("  [docker] run failed:", e.message);
    throw e;
  });
  return name;
}

/**
 * Liefert kompakten Container-Status via docker inspect.
 * @param {string | null} containerName - exakter Docker-Containername
 * @returns {Promise<{state: string | null, exitCode: number | null, error: string | null} | null>}
 */
export async function getContainerStatus(containerName) {
  if (!containerName) return null;
  try {
    const { stdout } = await exec("docker", [
      "inspect",
      "-f",
      "{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}",
      containerName,
    ]);
    const raw = String(stdout || "").trim();
    if (!raw) return null;
    const [stateRaw = "", exitRaw = "", errorRaw = ""] = raw.split("|");
    const parsedExit = Number.parseInt(exitRaw, 10);
    return {
      state: stateRaw.trim() || null,
      exitCode: Number.isFinite(parsedExit) ? parsedExit : null,
      error: sanitizeContainerLogText(errorRaw.trim() || ""),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      state: null,
      exitCode: null,
      error: `[docker inspect fehlgeschlagen] ${sanitizeContainerLogText(msg)}`,
    };
  }
}

/**
 * Liefert die letzten Container-Logs (stdout+stderr).
 * @param {string | null} containerName - exakter Docker-Containername
 * @param {number} tail - Anzahl Zeilen vom Ende
 * @param {number} maxChars - maximale Zeichen (bei Überschreitung gekürzt)
 * @returns {Promise<string | null>}
 */
export async function getContainerLogs(containerName, tail = 120, maxChars = 12_000) {
  if (!containerName) return null;
  const safeTail = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : 120;
  const safeMaxChars = Number.isFinite(maxChars) && maxChars > 200 ? Math.floor(maxChars) : 12_000;
  try {
    const { stdout, stderr } = await exec("docker", [
      "logs",
      "--tail",
      String(safeTail),
      containerName,
    ]);
    const merged = sanitizeContainerLogText([stdout, stderr].filter(Boolean).join("\n").trim());
    if (!merged) return null;
    if (merged.length <= safeMaxChars) return merged;
    const half = Math.floor((safeMaxChars - 64) / 2);
    return `${merged.slice(0, half)}\n...[gekürzt]...\n${merged.slice(-half)}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return msg ? `[docker logs nicht verfügbar] ${sanitizeContainerLogText(msg)}` : null;
  }
}

/**
 * Stoppt und entfernt den Container (--rm entfernt automatisch, stop reicht).
 * Wirft nicht, wenn der Container nicht existiert (z. B. nach Runner-Neustart).
 * @param {string} runId - derselbe runId wie bei runContainer
 */
export async function stopContainer(runId) {
  const name = containerName(runId);
  try {
    await exec("docker", ["stop", "-t", "3", name]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isNoSuchContainer =
      /no such (container|object)/i.test(msg) || /No such container/i.test(msg);
    if (isNoSuchContainer) {
      return;
    }
    throw new Error(`[docker stop fehlgeschlagen] ${name}: ${sanitizeContainerLogText(msg)}`);
  }
}

/**
 * Prüft, ob Docker verfügbar ist.
 * @returns {Promise<boolean>}
 */
export async function isDockerAvailable() {
  try {
    await exec("docker", ["info"]);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[docker] info failed: ${msg}`);
    return false;
  }
}
