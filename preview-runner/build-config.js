import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeRelativeDir } from "./build-candidates.js";
import { sanitizePreviewEnv } from "./build-env.js";
import { warnNonFatal } from "./build-logging.js";
import { getPackageManager, isSaneCommand } from "./build-runtime.js";

const DEFAULT_BUILD = "npm ci --ignore-scripts && npm run build";
const DEFAULT_START = "npx serve dist";
const MIN_PREVIEW_PORT = 1024;
const MAX_PREVIEW_PORT = 65535;
const FORBIDDEN_COMMAND_CHARS = /[|;<>`$\n\r]/;
const ALLOWED_COMMAND_PREFIXES = [
  /^npm\s+(run|ci|install|exec)\b/i,
  /^pnpm\s+(run|install|exec)\b/i,
  /^yarn\s+(run|install)\b/i,
  /^npx\s+[a-z0-9@/_-]+/i,
  /^node\s+[\w./@-]+/i,
  /^vite(\s|$)/i,
  /^next\s+(dev|start|build)\b/i,
  /^react-scripts\s+(start|build)\b/i,
  /^serve(\s|$)/i,
];

function ensureIgnoreScripts(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return cmd;
  const c = cmd.trim();
  if (c.includes("--ignore-scripts")) return c;
  if (c.startsWith("npm ci ") && c.includes("&&")) {
    return "npm ci --ignore-scripts " + c.slice("npm ci ".length);
  }
  if (c.startsWith("npm ci&&")) {
    return "npm ci --ignore-scripts &&" + c.slice("npm ci&&".length);
  }
  return c;
}

function isAllowedCommandSegment(segment) {
  const s = segment.trim();
  if (!s) return false;
  if (FORBIDDEN_COMMAND_CHARS.test(s)) return false;
  return ALLOWED_COMMAND_PREFIXES.some((pattern) => pattern.test(s));
}

function isSafeConfigCommand(cmd) {
  if (!isSaneCommand(cmd)) return false;
  const normalized = String(cmd).trim();
  const segments = normalized
    .split("&&")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every(isAllowedCommandSegment);
}

function readConfigCommand(raw, fallback, configPath, keyName) {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const normalized = raw.trim();
  if (!isSafeConfigCommand(normalized)) {
    warnNonFatal(`${configPath}: invalid ${keyName} rejected`, normalized);
    return fallback;
  }
  return normalized;
}

function readConfigPort(raw, fallback, configPath) {
  if (raw == null) return fallback;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (Number.isInteger(parsed) && parsed >= MIN_PREVIEW_PORT && parsed <= MAX_PREVIEW_PORT) {
    return parsed;
  }
  warnNonFatal(
    `${configPath}: invalid port rejected (expected ${MIN_PREVIEW_PORT}-${MAX_PREVIEW_PORT})`,
    raw,
  );
  return fallback;
}

export function getConfig(workspaceDir, workspaceRoot = workspaceDir) {
  const rootConfigPath = join(workspaceRoot, "visudev.config.json");
  const localConfigPath =
    workspaceDir === workspaceRoot ? null : join(workspaceDir, "visudev.config.json");
  let buildCommand = DEFAULT_BUILD;
  let startCommand = DEFAULT_START;
  let fallbackStartCommand = null;
  let previewEnv = {};
  let injectSupabasePlaceholders = null;
  let appDirectory = null;
  let port = 3000;

  const applyConfig = (configPath) => {
    if (!configPath || !existsSync(configPath)) return;
    try {
      const raw = readFileSync(configPath, "utf8");
      const config = JSON.parse(raw);
      buildCommand = readConfigCommand(
        config.buildCommand,
        buildCommand,
        configPath,
        "buildCommand",
      );
      startCommand = readConfigCommand(
        config.startCommand,
        startCommand,
        configPath,
        "startCommand",
      );
      fallbackStartCommand = readConfigCommand(
        config.fallbackStartCommand,
        fallbackStartCommand,
        configPath,
        "fallbackStartCommand",
      );
      previewEnv = { ...previewEnv, ...sanitizePreviewEnv(config.previewEnv) };
      if (typeof config.injectSupabasePlaceholders === "boolean") {
        injectSupabasePlaceholders = config.injectSupabasePlaceholders;
      }
      const normalizedAppDirectory = normalizeRelativeDir(config.appDirectory);
      if (normalizedAppDirectory) {
        appDirectory = normalizedAppDirectory;
      }
      port = readConfigPort(config.port, port, configPath);
    } catch (error) {
      warnNonFatal(`getConfig: invalid JSON in ${configPath}`, error);
    }
  };

  applyConfig(rootConfigPath);
  applyConfig(localConfigPath);

  buildCommand = ensureIgnoreScripts(buildCommand);
  return {
    buildCommand,
    startCommand,
    fallbackStartCommand,
    previewEnv,
    injectSupabasePlaceholders,
    appDirectory,
    workspaceRoot,
    port,
  };
}

export function resolveBestEffortStartCommand(workspaceDir, config = null) {
  if (config && isSaneCommand(config.fallbackStartCommand)) {
    return config.fallbackStartCommand.trim();
  }

  const pkgPath = join(workspaceDir, "package.json");
  let scripts = null;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg?.scripts && typeof pkg.scripts === "object") {
        scripts = pkg.scripts;
      }
    } catch (error) {
      warnNonFatal(`resolveBestEffortStartCommand: invalid package.json in ${workspaceDir}`, error);
      scripts = null;
    }
  }

  const pm = getPackageManager(workspaceDir);
  const runPrefix = pm === "pnpm" ? "pnpm run" : pm === "yarn" ? "yarn run" : "npm run";

  if (scripts && typeof scripts.dev === "string" && isSaneCommand(scripts.dev)) {
    return `${runPrefix} dev`;
  }
  if (scripts && typeof scripts.start === "string" && isSaneCommand(scripts.start)) {
    return `${runPrefix} start`;
  }

  if (existsSync(join(workspaceDir, "node_modules", "vite", "bin", "vite.js"))) {
    return "npx vite";
  }
  return null;
}
