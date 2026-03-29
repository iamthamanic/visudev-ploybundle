#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * dev-auto: Single dev entrypoint (Vite + optional Preview Runner).
 * Responsibilities split into: parseHost/parsePort (input validation), tryListen/findFreePort (ports),
 * findExistingRunner/waitForRunner/getOrStartRunner (runner), runViteWithShutdown (vite + signals), main (orchestration).
 */
const net = require("net");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Parse env port with validation; fallback on NaN or out-of-range, log warning. */
function parsePort(envValue, defaultPort, name) {
  const raw = envValue ?? String(defaultPort);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_PORT || n > MAX_PORT) {
    console.warn(
      `[dev-auto] Ungültiger Port ${name}=${raw} (erwartet ${MIN_PORT}-${MAX_PORT}), nutze ${defaultPort}.`,
    );
    return defaultPort;
  }
  return n;
}

/** Allowed hostnames for dev (no command injection). Fallback on invalid. */
function parseHost(envValue, defaultHost) {
  const raw = (envValue ?? defaultHost).trim();
  if (!raw) return defaultHost;
  if (/^127\.\d+\.\d+\.\d+$/.test(raw) || raw === "localhost" || raw === "::1") return raw;
  if (/^[a-zA-Z0-9.-]{1,253}$/.test(raw)) return raw;
  console.warn(`[dev-auto] Ungültiger VITE_HOST=${raw}, nutze ${defaultHost}.`);
  return defaultHost;
}

const host = parseHost(process.env.VITE_HOST, "127.0.0.1");
/** Host for URL building: IPv6 (e.g. ::1) must be in brackets. */
const hostForUrl = host.includes(":") ? `[${host}]` : host;
const requestedVitePort = parsePort(process.env.VITE_PORT, 3005, "VITE_PORT");
const requestedRunnerPort = parsePort(process.env.PREVIEW_RUNNER_PORT, 4000, "PREVIEW_RUNNER_PORT");
const requestedLogsRunnerPort = parsePort(process.env.LOGS_RUNNER_PORT, 5000, "LOGS_RUNNER_PORT");
const reuseExistingRunner = process.env.REUSE_PREVIEW_RUNNER === "1";
const reuseExistingLogsRunner = process.env.REUSE_LOGS_RUNNER === "1";

function tryListen(port, hostToCheck) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    const opts = hostToCheck ? { port, host: hostToCheck } : { port };
    server.listen(opts, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isPortFree(port) {
  // Check both IPv6/any and IPv4 loopback to avoid false-free on macOS dual-stack.
  const freeAny = await tryListen(port, undefined);
  if (!freeAny) return false;
  const freeV4 = await tryListen(port, "127.0.0.1");
  return freeV4;
}

async function findFreePort(startPort) {
  const portStart =
    Number.isFinite(startPort) && startPort >= MIN_PORT && startPort <= MAX_PORT ? startPort : 3005;
  let port = portStart;
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i += 1) {
    if (port > MAX_PORT) {
      throw new Error(`No free port in range ${portStart}..${MAX_PORT}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(port);
    if (free) return port;
    port += 1;
  }
  throw new Error(`No free port found starting at ${portStart}`);
}

/** Gleiche Port-Kandidaten wie der Runner (preview-runner/index.js RUNNER_PORT_CANDIDATES). */
const RUNNER_PORT_CANDIDATES = [requestedRunnerPort, 4100, 4110, 4120, 4130].filter(
  (p, i, a) => a.indexOf(p) === i,
);

async function findFreeRunnerPort() {
  for (const candidate of RUNNER_PORT_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) return candidate;
  }
  return findFreePort(4100);
}

const LOGS_RUNNER_PORT_CANDIDATES = [requestedLogsRunnerPort, 5010, 5020, 5030].filter(
  (p, i, a) => a.indexOf(p) === i,
);

async function findFreeLogsRunnerPort() {
  for (const candidate of LOGS_RUNNER_PORT_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) return candidate;
  }
  return findFreePort(5000);
}

function findExistingLogsRunner() {
  return new Promise((resolve) => {
    let i = 0;
    function tryNext() {
      if (i >= LOGS_RUNNER_PORT_CANDIDATES.length) {
        resolve(null);
        return;
      }
      const port = LOGS_RUNNER_PORT_CANDIDATES[i++];
      const url = `http://${hostForUrl}:${port}`;
      const opts = { hostname: host, port, path: "/health", method: "GET" };
      const req = http.request(opts, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(url);
        else tryNext();
      });
      req.on("error", () => tryNext());
      req.setTimeout(2000, () => {
        req.destroy();
        tryNext();
      });
      req.end();
    }
    tryNext();
  });
}

function waitForLogsRunner(url, maxAttempts = 20, intervalMs = 300) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port, path: "/health", method: "GET" };
    let attempts = 0;
    let destroyedByTimeout = false;
    const tryOnce = () => {
      attempts += 1;
      destroyedByTimeout = false;
      const req = http.request(opts, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        if (attempts >= maxAttempts) {
          reject(new Error(`Logs Runner ${url} nicht bereit nach ${maxAttempts} Versuchen`));
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
      req.on("error", () => {
        if (destroyedByTimeout) return;
        if (attempts >= maxAttempts) {
          reject(new Error("Logs Runner nicht erreichbar."));
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
      req.setTimeout(intervalMs, () => {
        destroyedByTimeout = true;
        req.destroy();
        if (attempts >= maxAttempts) reject(new Error("Logs Runner Timeout"));
        else setTimeout(tryOnce, intervalMs);
      });
      req.end();
    };
    tryOnce();
  });
}

async function getOrStartLogsRunner() {
  const existing = await findExistingLogsRunner();
  if (existing && reuseExistingLogsRunner) {
    console.log(`[dev-auto] Vorhandenen Logs Runner gefunden: ${existing}`);
    return { logsRunnerUrl: existing, logsRunner: null };
  }
  if (existing && !reuseExistingLogsRunner) {
    console.log(
      `[dev-auto] Logs Runner gefunden (${existing}), wird ignoriert (REUSE_LOGS_RUNNER=1 zum Wiederverwenden).`,
    );
  }
  const logsRunnerPort = await findFreeLogsRunnerPort();
  const logsRunnerUrl = `http://${hostForUrl}:${logsRunnerPort}`;
  const envForLogsRunner = { ...process.env, PORT: String(logsRunnerPort) };
  console.log(`[dev-auto] Logs Runner: ${logsRunnerUrl}`);
  const logsRunnerScript = path.join(__dirname, "run-logs-runner.js");
  const logsRunner = spawn(process.execPath, [logsRunnerScript], {
    env: envForLogsRunner,
    stdio: "inherit",
  });
  logsRunner.on("error", (err) => {
    console.error("[dev-auto] Logs Runner spawn failed:", err.message);
    process.exit(1);
  });
  await waitForLogsRunner(logsRunnerUrl).catch((err) => {
    console.error("[dev-auto] Logs Runner nicht bereit:", err.message);
    logsRunner.kill("SIGTERM");
    process.exit(1);
  });
  console.log("[dev-auto] Logs Runner bereit.");
  return { logsRunnerUrl, logsRunner };
}

/** Prüft, ob auf einem der Kandidaten-Ports bereits ein Runner /health antwortet (z. B. npx visudev-runner). */
function findExistingRunner() {
  return new Promise((resolve) => {
    let i = 0;
    function tryNext() {
      if (i >= RUNNER_PORT_CANDIDATES.length) {
        resolve(null);
        return;
      }
      const port = RUNNER_PORT_CANDIDATES[i++];
      const url = `http://${hostForUrl}:${port}`;
      const opts = { hostname: host, port, path: "/health", method: "GET" };
      const req = http.request(opts, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(url);
        else tryNext();
      });
      req.on("error", () => tryNext());
      req.setTimeout(2000, () => {
        req.destroy();
        tryNext();
      });
      req.end();
    }
    tryNext();
  });
}

/** Wartet, bis der Preview Runner auf /health antwortet (dann ist er bereit und Vite bekommt die richtige URL). */
function waitForRunner(url, maxAttempts = 30, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, port: u.port, path: "/health", method: "GET" };
    let attempts = 0;
    let destroyedByTimeout = false;
    const tryOnce = () => {
      attempts += 1;
      destroyedByTimeout = false;
      const req = http.request(opts, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        if (attempts >= maxAttempts) {
          reject(
            new Error(
              `Runner ${url} nicht bereit nach ${maxAttempts} Versuchen (Status ${res.statusCode})`,
            ),
          );
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
      req.on("error", () => {
        if (destroyedByTimeout) return;
        if (attempts >= maxAttempts) {
          reject(
            new Error(
              `Runner ${url} nicht erreichbar nach ${maxAttempts} Versuchen. Läuft der Runner?`,
            ),
          );
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
      req.setTimeout(intervalMs, () => {
        destroyedByTimeout = true;
        req.destroy();
        if (attempts >= maxAttempts) reject(new Error(`Runner ${url} Timeout`));
        else setTimeout(tryOnce, intervalMs);
      });
      req.end();
    };
    tryOnce();
  });
}

/** Resolve preview URL: use existing runner if one responds on /health, otherwise start one. Returns { previewUrl, runner } (runner null if existing). */
async function getOrStartRunner() {
  const existing = await findExistingRunner();
  if (existing && reuseExistingRunner) {
    console.log(
      `[dev-auto] Vorhandenen Runner gefunden: ${existing} (kein zweiter wird gestartet)`,
    );
    return { previewUrl: existing, runner: null };
  }
  if (existing && !reuseExistingRunner) {
    console.log(
      `[dev-auto] Runner gefunden (${existing}), wird ignoriert. Starte lokalen Runner (setze REUSE_PREVIEW_RUNNER=1 zum Wiederverwenden).`,
    );
  }
  const runnerPort = await findFreeRunnerPort();
  const previewUrl = `http://${hostForUrl}:${runnerPort}`;
  const envForRunner = {
    ...process.env,
    VITE_PREVIEW_RUNNER_URL: previewUrl,
    PORT: String(runnerPort),
    USE_REAL_BUILD: "1",
  };
  const dockerOverrideRaw = process.env.USE_DOCKER;
  const hasDockerOverride = typeof dockerOverrideRaw === "string";
  const dockerOverride =
    hasDockerOverride && ["1", "true", "yes"].includes(dockerOverrideRaw.trim().toLowerCase());
  if (hasDockerOverride) {
    envForRunner.USE_DOCKER = dockerOverride ? "1" : "0";
  } else if (spawnSync("docker", ["info"], { stdio: "ignore", timeout: 5000 }).status === 0) {
    envForRunner.USE_DOCKER = "1";
  }
  console.log(
    `[dev-auto] Runner: ${previewUrl} (local preview-runner/index.js)${runnerPort !== requestedRunnerPort ? ` — port ${requestedRunnerPort} war belegt` : ""}`,
  );
  const runnerScript = path.join(__dirname, "run-preview-runner.js");
  const runner = spawn(process.execPath, [runnerScript], {
    env: envForRunner,
    stdio: "inherit",
  });
  runner.on("error", (err) => {
    console.error("[dev-auto] Runner spawn failed:", err.message);
    process.exit(1);
  });
  await waitForRunner(previewUrl).catch((err) => {
    console.error("[dev-auto] Runner nicht bereit:", err.message);
    runner.kill("SIGTERM");
    process.exit(1);
  });
  console.log("[dev-auto] Runner bereit.");
  return { previewUrl, runner };
}

/** Start Vite with runner URLs and wire shutdown on signals/child exit. */
function runViteWithShutdown(previewUrl, runner, logsRunnerUrl, logsRunner, vitePort) {
  const envForVite = {
    ...process.env,
    VITE_PREVIEW_RUNNER_URL: previewUrl,
    VITE_LOGS_RUNNER_URL: logsRunnerUrl || "",
  };
  console.log(`[dev-auto] Vite: http://${hostForUrl}:${vitePort}`);
  console.log(`[dev-auto] VITE_PREVIEW_RUNNER_URL=${previewUrl}`);
  if (logsRunnerUrl) console.log(`[dev-auto] VITE_LOGS_RUNNER_URL=${logsRunnerUrl}`);

  const vite = spawn(
    "npx",
    ["vite", "--host", host, "--port", String(vitePort), "--strictPort", "--open"],
    { env: envForVite, stdio: "inherit" },
  );

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (runner && !runner.killed) runner.kill(signal);
    if (logsRunner && !logsRunner.killed) logsRunner.kill(signal);
    if (!vite.killed) vite.kill(signal);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (runner) {
    runner.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`[dev-auto] Runner exited (code ${code ?? "unknown"}). Stopping Vite.`);
        shutdown("SIGTERM");
        process.exit(code ?? 1);
      }
    });
  }
  if (logsRunner) {
    logsRunner.on("exit", (code) => {
      if (!shuttingDown) {
        console.error(`[dev-auto] Logs Runner exited (code ${code ?? "unknown"}). Stopping Vite.`);
        shutdown("SIGTERM");
        process.exit(code ?? 1);
      }
    });
  }

  vite.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[dev-auto] Vite exited (code ${code ?? "unknown"}). Stopping Runner.`);
      shutdown("SIGTERM");
      process.exit(code ?? 1);
    }
  });
}

async function main() {
  const vitePort = await findFreePort(requestedVitePort);
  const { previewUrl, runner } = await getOrStartRunner();
  const { logsRunnerUrl, logsRunner } = await getOrStartLogsRunner();
  console.log("[dev-auto] Starte Vite …");
  runViteWithShutdown(previewUrl, runner, logsRunnerUrl, logsRunner, vitePort);
}

main().catch((err) => {
  console.error("[dev-auto] Failed to start dev environment", err);
  process.exit(1);
});
