import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { warnNonFatal } from "./build-logging.js";

const gitDeps = {
  spawn,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  now: () => Date.now(),
  env: () => process.env,
  warn: (...args) => console.warn(...args),
};

export function configureBuildGitDeps(overrides = {}) {
  Object.assign(gitDeps, overrides || {});
}

const GIT_LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const KNOWN_GIT_CANDIDATES = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
const GIT_SUBCOMMANDS = new Set(["clone", "fetch", "checkout", "pull", "rev-parse", "rev-list"]);
const GITHUB_EXTRAHEADER_KEY = "http.https://github.com/.extraheader";

function resolveGitBinary() {
  const env = gitDeps.env();
  const explicit = env.SHIM_GIT_REAL_BIN;
  if (explicit && gitDeps.existsSync(explicit)) return explicit;

  const pathEntries = String(env.PATH || "")
    .split(":")
    .filter(Boolean);
  for (const dir of pathEntries) {
    if (dir.includes("/.local/bin")) continue;
    const candidate = join(dir, "git");
    if (gitDeps.existsSync(candidate)) return candidate;
  }

  for (const candidate of KNOWN_GIT_CANDIDATES) {
    if (gitDeps.existsSync(candidate)) return candidate;
  }
  return "git";
}

function getRepositoryUrl(repo) {
  return `https://github.com/${repo}.git`;
}

function getGitAuthEnv() {
  const env = { GIT_TERMINAL_PROMPT: "0" };
  const runtimeEnv = gitDeps.env();
  const token = String(runtimeEnv.GITHUB_TOKEN || "").trim();
  if (!token) return env;

  const existingCountParsed = Number.parseInt(String(runtimeEnv.GIT_CONFIG_COUNT || "0"), 10);
  const existingCount =
    Number.isFinite(existingCountParsed) && existingCountParsed >= 0 ? existingCountParsed : 0;

  return {
    ...env,
    GIT_CONFIG_COUNT: String(existingCount + 1),
    [`GIT_CONFIG_KEY_${existingCount}`]: GITHUB_EXTRAHEADER_KEY,
    [`GIT_CONFIG_VALUE_${existingCount}`]: `AUTHORIZATION: bearer ${token}`,
  };
}

function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const token = String(gitDeps.env().GITHUB_TOKEN || "").trim();
  if (!token) return text;
  return text.split(token).join("[REDACTED_GITHUB_TOKEN]");
}

function runGit(cwd, args, env = {}) {
  const list = Array.isArray(args) ? args.filter((a) => a != null && a !== "") : [];
  if (list.length === 0 || !GIT_SUBCOMMANDS.has(String(list[0]))) {
    throw new Error(
      "runGit: args must be a non-empty array with a valid subcommand (e.g. clone, fetch, pull)",
    );
  }
  const gitBinary = resolveGitBinary();
  return new Promise((resolve, reject) => {
    const child = gitDeps.spawn(gitBinary, list, {
      cwd,
      env: { ...gitDeps.env(), ...env },
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
      const stdoutSafe = redactSecrets(stdout);
      const stderrSafe = redactSecrets(stderr);
      if (code === 0) resolve({ stdout: stdoutSafe, stderr: stderrSafe });
      else reject(new Error(stderrSafe || stdoutSafe || `git exit ${code}`));
    });
    child.on("error", reject);
  });
}

function getGitLockPath(workspaceDir) {
  return join(workspaceDir, ".git", "index.lock");
}

function removeStaleGitLock(workspaceDir, maxAgeMs = GIT_LOCK_MAX_AGE_MS) {
  if (!workspaceDir) return false;
  const lockPath = getGitLockPath(workspaceDir);
  if (!gitDeps.existsSync(lockPath)) return false;
  try {
    const stats = gitDeps.statSync(lockPath);
    const ageMs = gitDeps.now() - stats.mtimeMs;
    if (ageMs < maxAgeMs) return false;
    gitDeps.unlinkSync(lockPath);
    gitDeps.warn(`  [git] Removed stale index.lock (${Math.round(ageMs / 1000)}s old).`);
    return true;
  } catch (error) {
    warnNonFatal(`removeStaleGitLock failed (${lockPath})`, error);
    return false;
  }
}

function isGitLockError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("index.lock");
}

export async function cloneOrPull(repo, branch, workspaceDir) {
  if (!repo || typeof repo !== "string" || !repo.includes("/")) {
    throw new Error("Ungültiges Repo-Format: erwartet 'owner/repo'");
  }
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("Workspace-Pfad fehlt oder ist ungültig");
  }
  const url = getRepositoryUrl(repo);
  const gitAuthEnv = getGitAuthEnv();
  let branchSafe = (branch || "main").replace(/[^a-zA-Z0-9/_.-]/g, "") || "main";
  branchSafe = branchSafe.replace(/^-+/, "") || "main";

  const attempt = async () => {
    if (!gitDeps.existsSync(workspaceDir)) {
      const parent = join(workspaceDir, "..");
      gitDeps.mkdirSync(parent, { recursive: true });
      await runGit(
        parent,
        ["clone", "--depth", "1", "-b", branchSafe, url, workspaceDir],
        gitAuthEnv,
      );
      return "cloned";
    }

    await runGit(workspaceDir, ["fetch", "origin", branchSafe], gitAuthEnv);
    await runGit(workspaceDir, ["checkout", branchSafe]);
    await runGit(workspaceDir, ["pull", "origin", branchSafe, "--rebase"], gitAuthEnv);
    return "pulled";
  };

  try {
    removeStaleGitLock(workspaceDir);
    return await attempt();
  } catch (err) {
    if (isGitLockError(err) && removeStaleGitLock(workspaceDir)) {
      return await attempt();
    }
    throw err;
  }
}

export async function checkoutCommit(workspaceDir, commitSha, branchForFetch) {
  if (!workspaceDir || !gitDeps.existsSync(workspaceDir)) {
    throw new Error("Workspace fehlt für checkoutCommit");
  }
  const sha = String(commitSha || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("commitSha muss ein 40-stelliger Hex-Hash sein");
  }
  const branchSafe = (branchForFetch || "main").replace(/[^a-zA-Z0-9/_.-]/g, "") || "main";
  const gitAuthEnv = getGitAuthEnv();
  removeStaleGitLock(workspaceDir);
  try {
    await runGit(workspaceDir, ["fetch", "origin", branchSafe, "--unshallow"], gitAuthEnv);
  } catch (error) {
    warnNonFatal(`checkoutCommit: --unshallow fallback for ${workspaceDir}`, error);
    await runGit(workspaceDir, ["fetch", "origin", branchSafe], gitAuthEnv);
  }
  await runGit(workspaceDir, ["checkout", sha]);
}

export async function hasNewCommits(workspaceDir, branch) {
  if (!workspaceDir || !gitDeps.existsSync(workspaceDir)) return false;
  const branchSafe =
    (branch || "main").replace(/[^a-zA-Z0-9/_.-]/g, "").replace(/^-+/, "") || "main";
  try {
    const gitAuthEnv = getGitAuthEnv();
    removeStaleGitLock(workspaceDir);
    await runGit(workspaceDir, ["fetch", "origin", branchSafe], gitAuthEnv);
    const { stdout } = await runGit(
      workspaceDir,
      ["rev-list", "--count", `HEAD..origin/${branchSafe}`],
      gitAuthEnv,
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch (error) {
    warnNonFatal(`hasNewCommits failed (${workspaceDir})`, error);
    return false;
  }
}
