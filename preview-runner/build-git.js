import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { warnNonFatal } from "./build-logging.js";

const defaultGitDeps = Object.freeze({
  spawn,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  now: () => Date.now(),
  env: () => process.env,
  warn: (...args) => console.warn(...args),
});
let gitDeps = defaultGitDeps;

const GIT_LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const KNOWN_GIT_CANDIDATES = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
const GIT_SUBCOMMANDS = new Set(["clone", "fetch", "checkout", "pull", "rev-parse", "rev-list"]);
const GITHUB_EXTRAHEADER_KEY = "http.https://github.com/.extraheader";

export function configureBuildGitDeps(overrides = null) {
  if (!overrides || typeof overrides !== "object") {
    gitDeps = defaultGitDeps;
    return;
  }
  gitDeps = Object.freeze({
    ...defaultGitDeps,
    ...overrides,
  });
}

export function resetBuildGitDeps() {
  gitDeps = defaultGitDeps;
}

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

function normalizeRepoSlug(repoValue) {
  const trimmed = String(repoValue || "").trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\/github\.com\//i, "");
  const withoutSuffix = withoutProtocol.replace(/\.git$/i, "");
  const clean = withoutSuffix.replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) {
    return null;
  }
  return `${owner}/${name}`;
}

function normalizeBranchRef(branchValue, fallback = "main") {
  const candidate =
    typeof branchValue === "string" && branchValue.trim() !== ""
      ? branchValue.trim()
      : String(fallback || "main").trim();
  if (!candidate || candidate.length > 128) return null;
  if (
    candidate.includes("..") ||
    candidate.startsWith("/") ||
    candidate.endsWith("/") ||
    candidate.startsWith("-") ||
    /[\s~^:?*[\]\\]/.test(candidate)
  ) {
    return null;
  }
  return candidate;
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

function isGitDirtyWorkspaceError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("cannot pull with rebase: You have unstaged changes") ||
    msg.includes("Please commit or stash") ||
    msg.includes("would be overwritten by merge")
  );
}

export async function cloneOrPull(repo, branch, workspaceDir) {
  const normalizedRepo = normalizeRepoSlug(repo);
  if (!normalizedRepo) {
    throw new Error("Ungültiges Repo-Format: erwartet 'owner/repo'");
  }
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("Workspace-Pfad fehlt oder ist ungültig");
  }
  const branchSafe = normalizeBranchRef(branch, "main");
  if (!branchSafe) {
    throw new Error(
      "Ungültiger Branch/Ref. Bitte einen sicheren Git-Ref ohne Sonderzeichen nutzen.",
    );
  }
  const url = getRepositoryUrl(normalizedRepo);
  const gitAuthEnv = getGitAuthEnv();

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
    if (isGitDirtyWorkspaceError(err) && gitDeps.existsSync(workspaceDir)) {
      const parent = join(workspaceDir, "..");
      gitDeps.warn(
        `  [git] Workspace dirty (${workspaceDir}), entferne lokalen Clone und klone neu.`,
      );
      gitDeps.rmSync(workspaceDir, { recursive: true, force: true });
      gitDeps.mkdirSync(parent, { recursive: true });
      await runGit(
        parent,
        ["clone", "--depth", "1", "-b", branchSafe, url, workspaceDir],
        gitAuthEnv,
      );
      return "recloned";
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
  const branchSafe = normalizeBranchRef(branchForFetch, "main");
  if (!branchSafe) {
    throw new Error("Ungültiger Branch/Ref für checkoutCommit");
  }
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
  const branchSafe = normalizeBranchRef(branch, "main");
  if (!branchSafe) return false;
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
