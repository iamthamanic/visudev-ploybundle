import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStartEnv } from "./build-env.js";
import { warnNonFatal } from "./build-logging.js";

const runtimeDeps = {
  spawn,
  spawnSync,
  existsSync,
  readFileSync,
  resolveStartEnv,
  platform: () => process.platform,
  env: () => process.env,
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  stdoutWrite: (text) => process.stdout.write(text),
  stderrWrite: (text) => process.stderr.write(text),
};

export function configureBuildRuntimeDeps(overrides = {}) {
  Object.assign(runtimeDeps, overrides || {});
}

export function isSaneCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.trim()) return false;
  const c = cmd.trim();
  if (c === "npm" || c === "npm -h" || c === "npm --help") return false;
  if (/^npm\s+(-[a-zA-Z]|--[a-z-]+)\s*$/i.test(c)) return false;
  return true;
}

function runCommand(cwd, command, env = {}) {
  return new Promise((resolve, reject) => {
    const isWin = runtimeDeps.platform() === "win32";
    const child = runtimeDeps.spawn(isWin ? "cmd" : "sh", [isWin ? "/c" : "-c", command], {
      cwd,
      env: { ...runtimeDeps.env(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit ${code}`));
    });
    child.on("error", reject);
  });
}

function runPackageManager(cwd, cmd, args, env = {}) {
  const list = Array.isArray(args) ? args.filter((a) => a != null && a !== "") : [];
  return new Promise((resolve, reject) => {
    const child = runtimeDeps.spawn(cmd, list, {
      cwd,
      env: { ...runtimeDeps.env(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${cmd} exit ${code}`));
    });
    child.on("error", reject);
  });
}

function runNpm(cwd, args, env = {}) {
  if (!Array.isArray(args) || args.filter((a) => a != null && a !== "").length === 0) {
    return Promise.reject(new Error("runNpm: args must be a non-empty array"));
  }
  return runPackageManager(cwd, "npm", args, env);
}

function runPnpm(cwd, args, env = {}) {
  if (!Array.isArray(args) || args.filter((a) => a != null && a !== "").length === 0) {
    return Promise.reject(new Error("runPnpm: args must be a non-empty array"));
  }
  return runPackageManager(cwd, "pnpm", args, env);
}

function runYarn(cwd, args, env = {}) {
  if (!Array.isArray(args) || args.filter((a) => a != null && a !== "").length === 0) {
    return Promise.reject(new Error("runYarn: args must be a non-empty array"));
  }
  return runPackageManager(cwd, "yarn", args, env);
}

function isCommandAvailable(cmd) {
  try {
    const result = runtimeDeps.spawnSync(cmd, ["--version"], {
      stdio: "ignore",
      timeout: 1500,
      windowsHide: true,
    });
    return result.status === 0;
  } catch (error) {
    warnNonFatal(`isCommandAvailable failed (${cmd})`, error);
    return false;
  }
}

export function getPackageManager(workspaceDir) {
  if (runtimeDeps.existsSync(join(workspaceDir, "pnpm-lock.yaml")) && isCommandAvailable("pnpm")) {
    return "pnpm";
  }
  if (runtimeDeps.existsSync(join(workspaceDir, "yarn.lock")) && isCommandAvailable("yarn")) {
    return "yarn";
  }
  return "npm";
}

function isBadScriptValue(value) {
  if (typeof value !== "string") return true;
  const c = value.trim();
  if (!c) return true;
  const lower = c.toLowerCase();
  if (lower === "npm" || lower === "npm -h" || lower === "npm --help") return true;
  if (/^npm\s+(-[a-zA-Z]|--[a-z-]+)\s*$/i.test(c)) return true;
  if (/^\s*npm\s*$/i.test(c)) return true;
  return false;
}

export function ensurePackageJsonScripts(workspaceDir) {
  const pkgPath = join(workspaceDir, "package.json");
  if (!runtimeDeps.existsSync(pkgPath)) return;
  let pkg;
  try {
    pkg = JSON.parse(runtimeDeps.readFileSync(pkgPath, "utf8"));
  } catch (error) {
    warnNonFatal(`ensurePackageJsonScripts: invalid package.json (${pkgPath})`, error);
    return;
  }
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== "object") return;
  for (const [name, value] of Object.entries(scripts)) {
    if (isBadScriptValue(value)) {
      warnNonFatal(`ensurePackageJsonScripts: unsafe script "${name}" in ${pkgPath}`);
    }
  }
}

export function getBuildScript(workspaceDir) {
  const pkgPath = join(workspaceDir, "package.json");
  if (!runtimeDeps.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(runtimeDeps.readFileSync(pkgPath, "utf8"));
    const script = pkg?.scripts?.build;
    if (isBadScriptValue(script)) return null;
    return script.trim();
  } catch (error) {
    warnNonFatal(`getBuildScript: invalid package.json (${pkgPath})`, error);
    return null;
  }
}

const NODE_BUILD_BINARIES = [
  { pattern: /^vite\s+build/i, bin: "node_modules/vite/bin/vite.js", args: "build" },
  {
    pattern: /^react-scripts\s+build/i,
    bin: "node_modules/react-scripts/bin/react-scripts.js",
    args: "build",
  },
  {
    pattern: /^vue-cli-service\s+build/i,
    bin: "node_modules/@vue/cli-service/bin/vue-cli-service.js",
    args: "build",
  },
];

async function installDeps(workspaceDir, pm) {
  if (pm === "pnpm") {
    await runPnpm(workspaceDir, ["install", "--ignore-scripts"]);
    return;
  }
  if (pm === "yarn") {
    await runYarn(workspaceDir, ["install", "--ignore-scripts"]);
    return;
  }
  const hasLock = runtimeDeps.existsSync(join(workspaceDir, "package-lock.json"));
  if (hasLock) {
    await runNpm(workspaceDir, ["ci", "--ignore-scripts"]);
  } else {
    await runNpm(workspaceDir, ["install", "--ignore-scripts"]);
  }
}

async function runBuildStep(workspaceDir, pm, script) {
  if (!script || script.includes("&&") || /^\s*npm\s*$/i.test(script) || /^npm\s+/i.test(script)) {
    if (pm === "pnpm") await runPnpm(workspaceDir, ["run", "build"]);
    else if (pm === "yarn") await runYarn(workspaceDir, ["run", "build"]);
    else await runNpm(workspaceDir, ["run", "build"]);
    return;
  }
  if (script.startsWith("echo ") || script === "echo ok") {
    if (pm === "pnpm") await runPnpm(workspaceDir, ["run", "build"]);
    else if (pm === "yarn") await runYarn(workspaceDir, ["run", "build"]);
    else await runNpm(workspaceDir, ["run", "build"]);
    return;
  }
  for (const { pattern, bin, args } of NODE_BUILD_BINARIES) {
    if (pattern.test(script)) {
      const binPath = join(workspaceDir, bin);
      if (runtimeDeps.existsSync(binPath)) {
        runtimeDeps.log("  [build] node direct:", bin, args);
        await runCommand(workspaceDir, `node ${bin} ${args}`);
        return;
      }
      break;
    }
  }
  if (pm === "pnpm") {
    runtimeDeps.log("  [build] pnpm run build");
    await runPnpm(workspaceDir, ["run", "build"]);
    return;
  }
  if (pm === "yarn") {
    runtimeDeps.log("  [build] yarn run build");
    await runYarn(workspaceDir, ["run", "build"]);
    return;
  }
  runtimeDeps.log("  [build] npx fallback:", script);
  await runCommand(workspaceDir, "npx " + script);
}

export async function runBuildNodeDirect(workspaceDir) {
  const pm = getPackageManager(workspaceDir);
  runtimeDeps.log("  [build] package manager:", pm);
  await installDeps(workspaceDir, pm);
  const script = getBuildScript(workspaceDir);
  await runBuildStep(workspaceDir, pm, script);
}

export async function runBuild(workspaceDir, config) {
  runtimeDeps.log("  [build] ", config.buildCommand);
  await runCommand(workspaceDir, config.buildCommand);
}

function effectiveStartCommand(startCommand, port) {
  const cmd = (startCommand || "").trim();
  if (cmd.includes("--port")) return cmd;
  if (/^(npm|pnpm|yarn)\s+run\s+dev(\s|$)/.test(cmd)) {
    return `${cmd} -- --host 127.0.0.1 --port ${port}`;
  }
  if (/^(npm|pnpm|yarn)\s+run\s+start(\s|$)/.test(cmd)) {
    return `${cmd} -- --port ${port}`;
  }
  if (/^\s*npx\s+vite\s/.test(cmd)) {
    return `${cmd} --host 127.0.0.1 --port ${port}`;
  }
  return cmd;
}

export function startApp(workspaceDir, port, config) {
  const {
    env: previewEnv,
    injectedKeys,
    placeholderMode,
    supabaseDetected,
  } = runtimeDeps.resolveStartEnv(workspaceDir, config);
  const env = { ...runtimeDeps.env(), ...previewEnv, PORT: String(port) };
  const command = effectiveStartCommand(config.startCommand, port);
  const isWin = runtimeDeps.platform() === "win32";
  const child = runtimeDeps.spawn(isWin ? "cmd" : "sh", [isWin ? "/c" : "-c", command], {
    cwd: workspaceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.__visudevInjectedEnvKeys = injectedKeys;
  child.__visudevSupabasePlaceholderMode = placeholderMode;
  child.__visudevSupabaseDetected = supabaseDetected;
  child.stdout?.on("data", (d) => runtimeDeps.stdoutWrite(`[preview ${port}] ${d}`));
  child.stderr?.on("data", (d) => runtimeDeps.stderrWrite(`[preview ${port}] ${d}`));
  child.on("error", (err) => runtimeDeps.error(`[preview ${port}] error:`, err));
  return child;
}
