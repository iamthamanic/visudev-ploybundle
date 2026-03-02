import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolveStartEnv } from "./build-env.js";

const defaultRuntimeDeps = Object.freeze({
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
});

let runtimeDepsOverride = null;

export function configureBuildRuntimeDeps(overrides = null) {
  if (!overrides || typeof overrides !== "object") {
    runtimeDepsOverride = null;
    return;
  }
  runtimeDepsOverride = Object.freeze({
    ...defaultRuntimeDeps,
    ...overrides,
  });
}

export function resetBuildRuntimeDeps() {
  runtimeDepsOverride = null;
}

export function getBuildRuntimeDeps() {
  return runtimeDepsOverride || defaultRuntimeDeps;
}
