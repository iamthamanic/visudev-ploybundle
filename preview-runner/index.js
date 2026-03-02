#!/usr/bin/env node
/**
 * VisuDEV Preview Runner
 *
 * API: POST /start, GET /status/:runId, POST /stop/:runId, POST /stop-project/:projectId, POST /refresh, POST /webhook/github
 * Real mode (USE_REAL_BUILD=1): clone repo, build, start app on assigned port.
 * Refresh: git pull + rebuild + restart so preview shows latest from repo (live).
 * GitHub Webhook: on push, auto-refresh matching preview (pull + rebuild + restart).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  getWorkspaceDir,
  getLocalWorkspaceOverride,
  listPreviewCandidates,
  resolveAppWorkspaceDir,
  cloneOrPull,
  checkoutCommit,
  getConfig,
  resolveBestEffortStartCommand,
  runBuild,
  runBuildNodeDirect,
  startApp,
  hasNewCommits,
  ensurePackageJsonScripts,
} from "./build.js";
import {
  runContainer,
  stopContainer,
  isDockerAvailable,
  getContainerLogs,
  getContainerStatus,
  streamContainerLogs,
} from "./docker.js";

const PORT = Number(process.env.PORT) || 4000;
/** Actual port the runner binds to (set after finding a free one). */
let runnerPort = PORT;
/** Ports to try for the runner API: preferred PORT, then above preview range (4001–4099). */
const RUNNER_PORT_CANDIDATES = [PORT, 4100, 4110, 4120, 4130, 4140];

const AUTO_REFRESH_INTERVAL_MS = Number(process.env.AUTO_REFRESH_INTERVAL_MS) || 60_000;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const PREVIEW_PORT_MIN = Number(process.env.PREVIEW_PORT_MIN) || 4001;
const PREVIEW_PORT_MAX = Number(process.env.PREVIEW_PORT_MAX) || 4099;
const PREVIEW_BASE_URL = process.env.PREVIEW_BASE_URL || "";
const PREVIEW_PUBLIC_ORIGIN = process.env.PREVIEW_PUBLIC_ORIGIN || "";
const PREVIEW_BIND_HOST = process.env.PREVIEW_BIND_HOST || "127.0.0.1";
const SIMULATE_DELAY_MS = Number(process.env.SIMULATE_DELAY_MS) || 3000;
const USE_REAL_BUILD =
  process.env.USE_REAL_BUILD === "1" ||
  process.env.USE_REAL_BUILD === "true" ||
  process.env.USE_REAL_BUILD === "yes";
const USE_DOCKER =
  process.env.USE_DOCKER === "1" ||
  process.env.USE_DOCKER === "true" ||
  process.env.USE_DOCKER === "yes";
const PREVIEW_BOOT_MODE_DEFAULT = (process.env.PREVIEW_BOOT_MODE || "best_effort").toLowerCase();
const PREVIEW_DOCKER_READY_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.PREVIEW_DOCKER_READY_TIMEOUT_MS) || 300_000,
);
const PREVIEW_DOCKER_LOG_TAIL = Math.max(20, Number(process.env.PREVIEW_DOCKER_LOG_TAIL) || 120);
/** Upstream timeout for frame proxy: if app does not respond within this time, return 504 so iframe gets onLoad. */
const PROXY_UPSTREAM_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.PROXY_UPSTREAM_TIMEOUT_MS) || 15_000,
);
const PROJECT_TOKEN_HEADER = "x-visudev-project-token";
const RUNNER_WRITE_RATE_LIMIT_WINDOW_MS = Math.max(
  1_000,
  Number(process.env.RUNNER_WRITE_RATE_LIMIT_WINDOW_MS) || 60_000,
);
const RUNNER_WRITE_RATE_LIMIT_MAX = Math.max(
  1,
  Number(process.env.RUNNER_WRITE_RATE_LIMIT_MAX) || 25,
);
const RUNNER_STARTED_AT = new Date().toISOString();
const STOPPED_RUN_MAX_AGE_MS = Math.max(
  60_000,
  Number(process.env.STOPPED_RUN_MAX_AGE_MS) || 12 * 60 * 60 * 1000,
);
const STOPPED_RUN_MAX_COUNT = Math.max(20, Number(process.env.STOPPED_RUN_MAX_COUNT) || 300);
/** Max time for npm install + build per candidate. After this the run fails with a clear message. */
const BUILD_TIMEOUT_MS = Math.max(60_000, Number(process.env.BUILD_TIMEOUT_MS) || 6 * 60 * 1000);

function resolveBootMode(value) {
  const raw = String(value || PREVIEW_BOOT_MODE_DEFAULT)
    .trim()
    .toLowerCase();
  return raw === "strict" ? "strict" : "best_effort";
}

function resolveInjectSupabasePlaceholders(value) {
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return null;
}

/** Returns the first port from candidates that is free to bind. */
function findFreeRunnerPort() {
  return new Promise((resolve) => {
    let i = 0;
    function tryNext() {
      if (i >= RUNNER_PORT_CANDIDATES.length) {
        resolve(null);
        return;
      }
      const p = RUNNER_PORT_CANDIDATES[i++];
      const s = net.createServer();
      s.once("error", () => {
        s.close(() => tryNext());
      });
      s.once("listening", () => {
        s.close(() => resolve(p));
      });
      s.listen(p, PREVIEW_BIND_HOST);
    }
    tryNext();
  });
}

const runs = new Map();
const usedPorts = new Set();
/** port -> http.Server (placeholder/error page only) */
const portServers = new Map();
/** projectId -> promise chain to serialize git/build per repo */
const workspaceLocks = new Map();
/** client+route -> { count, resetAt } for write endpoints */
const writeRateLimitBuckets = new Map();

function pruneStoppedRuns() {
  const now = Date.now();
  const stopped = [];
  for (const [runId, run] of runs) {
    if (run.status !== "stopped") continue;
    const stoppedAtMs = parseIsoMs(run.stoppedAt);
    if (stoppedAtMs > 0 && now - stoppedAtMs > STOPPED_RUN_MAX_AGE_MS) {
      runs.delete(runId);
      continue;
    }
    stopped.push({ runId, stoppedAtMs });
  }
  if (stopped.length <= STOPPED_RUN_MAX_COUNT) return;
  stopped.sort((a, b) => a.stoppedAtMs - b.stoppedAtMs);
  const removeCount = stopped.length - STOPPED_RUN_MAX_COUNT;
  for (let i = 0; i < removeCount; i++) {
    runs.delete(stopped[i].runId);
  }
}

/**
 * @param {number} port
 * @param {string} [host] - default PREVIEW_BIND_HOST. Use "0.0.0.0" to match Docker's bind (avoids "port already allocated" when an old container holds the port).
 */
function canBindPort(port, host = PREVIEW_BIND_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        server.close(() => resolve(ok));
      } catch {
        resolve(ok);
      }
    };
    server.once("error", () => finish(false));
    server.listen(port, host, () => finish(true));
  });
}

async function getNextFreePort() {
  for (let p = PREVIEW_PORT_MIN; p <= PREVIEW_PORT_MAX; p++) {
    if (!usedPorts.has(p)) {
      // eslint-disable-next-line no-await-in-loop
      const isFree = await canBindPort(p);
      if (!isFree) continue;
      usedPorts.add(p);
      return p;
    }
  }
  return null;
}

/** Reserve two consecutive ports: [proxyPort, appPort]. Proxy is the one returned as previewUrl; app runs on appPort. */
async function getTwoFreePorts() {
  const appHost = USE_DOCKER ? "0.0.0.0" : PREVIEW_BIND_HOST;
  for (let p = PREVIEW_PORT_MIN; p <= PREVIEW_PORT_MAX - 1; p++) {
    if (!usedPorts.has(p) && !usedPorts.has(p + 1)) {
      // eslint-disable-next-line no-await-in-loop
      const proxyFree = await canBindPort(p);
      if (!proxyFree) continue;
      // In Docker mode check app port on 0.0.0.0 so we don't pick a port an old container still holds.
      // eslint-disable-next-line no-await-in-loop
      const appFree = await canBindPort(p + 1, appHost);
      if (!appFree) continue;
      usedPorts.add(p);
      usedPorts.add(p + 1);
      return [p, p + 1];
    }
  }
  return null;
}

function releasePort(port) {
  const server = portServers.get(port);
  if (server) {
    server.close();
    portServers.delete(port);
  }
  usedPorts.delete(port);
}

/**
 * Release proxy port and start placeholder only after the server has closed (avoids EADDRINUSE).
 * Use this in setFailed so the placeholder binds after the port is actually free.
 */
function releasePortAndStartPlaceholder(proxyPort, errorMessage) {
  const server = portServers.get(proxyPort);
  portServers.delete(proxyPort);
  usedPorts.delete(proxyPort);
  if (server) {
    server.once("close", () => {
      startPlaceholderServer(proxyPort, errorMessage);
    });
    server.close();
  } else {
    startPlaceholderServer(proxyPort, errorMessage);
  }
}

/** CSP value so VisuDEV can embed the preview in iframes (any origin; restrict in production if needed). */
const FRAME_ANCESTORS = "frame-ancestors *";

function resolvePreviewUrl(proxyPort) {
  if (PREVIEW_PUBLIC_ORIGIN) {
    const origin = PREVIEW_PUBLIC_ORIGIN.replace(/\/$/, "");
    return `${origin}:${proxyPort}`;
  }
  if (PREVIEW_BASE_URL.trim() !== "") {
    return `${PREVIEW_BASE_URL.replace(/\/$/, "")}/${proxyPort}`;
  }
  return `http://localhost:${proxyPort}`;
}

function stripRunnerPrefix(pathname) {
  if (pathname === "/runner") return "/";
  if (pathname.startsWith("/runner/")) return pathname.slice("/runner".length) || "/";
  return pathname;
}

function buildProxyErrorPage(title, hint) {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:sans-serif;padding:1.5rem;background:#1a1a2e;color:#e2e8f0;max-width:28rem;">` +
    `<h2 style="color:#f87171;">${escapeHtml(title)}</h2>` +
    `<p style="color:#94a3b8;">${escapeHtml(hint)}</p>` +
    `<p style="font-size:0.875rem;">Port/App prüfen oder Preview in VisuDEV neu starten.</p>` +
    `<script>try{window.addEventListener("load",function(){window.parent.postMessage({type:"visudev-preview-error",reason:"Preview-App nicht erreichbar (502). Bitte Preview neu starten."},"*");});}catch(e){}</script>` +
    `</body></html>`
  );
}

const VISUDEV_BRIDGE_SCRIPT = String.raw`<script data-visudev-preview-bridge="1">(function(){try{if(window.__visudevPreviewBridgeInstalled)return;window.__visudevPreviewBridgeInstalled=true;var lastRoute=null;var reportTimer=null;function normalizePath(path){var raw=String(path||"/");raw=raw.split("?")[0].split("#")[0]||"/";if(!raw.startsWith("/"))raw="/"+raw;raw=raw.replace(/\/{2,}/g,"/");if(raw.length>1&&raw.endsWith("/"))raw=raw.slice(0,-1);return raw||"/";}function post(payload){try{if(window.parent&&window.parent!==window){window.parent.postMessage(payload,"*");}}catch(_e){}}function collectButtons(){var nodes=document.querySelectorAll('button,[role="button"],a[href]');var out=[];for(var i=0;i<nodes.length&&i<60;i++){var el=nodes[i];var label=((el.getAttribute("aria-label")||el.textContent||"").trim());out.push({tagName:String(el.tagName||"").toLowerCase(),role:el.getAttribute("role")||undefined,label:label?label.slice(0,80):undefined});}return out;}function collectLinks(){var links=document.querySelectorAll("a[href]");var out=[];for(var i=0;i<links.length&&i<60;i++){var el=links[i];var href=el.getAttribute("href")||"";if(!href)continue;var text=(el.textContent||"").trim();out.push({href:href,text:text?text.slice(0,80):undefined});}return out;}function emitReport(){var route=normalizePath(window.location.pathname||"/");post({type:"visudev-dom-report",route:route,buttons:collectButtons(),links:collectLinks()});if(lastRoute!==null&&lastRoute!==route){post({type:"visudev-navigate",path:route});}lastRoute=route;}function queueReport(){if(reportTimer)window.clearTimeout(reportTimer);reportTimer=window.setTimeout(function(){reportTimer=null;emitReport();},120);}function wrapHistory(method){var original=history[method];if(typeof original!=="function")return;history[method]=function(){var result=original.apply(this,arguments);queueReport();return result;};}wrapHistory("pushState");wrapHistory("replaceState");window.addEventListener("popstate",queueReport);window.addEventListener("hashchange",queueReport);window.addEventListener("load",function(){queueReport();window.setTimeout(queueReport,600);window.setTimeout(queueReport,1800);});document.addEventListener("click",function(event){var target=event.target;if(!target||!target.closest)return;var anchor=target.closest("a[href]");if(!anchor)return;var href=anchor.getAttribute("href")||"";if(!href||href[0]==="#"||/^mailto:|^tel:|^javascript:/i.test(href))return;try{var url=new URL(href,window.location.href);if(url.origin!==window.location.origin)return;post({type:"visudev-navigate",path:normalizePath(url.pathname||"/")});}catch(_e){}},true);if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",queueReport,{once:true});}else{queueReport();}}catch(_err){}})();</script>`;

function injectVisudevBridge(html) {
  if (!html || html.includes("data-visudev-preview-bridge")) return html;
  // Inject as early as possible so bridge runs before other scripts (works with every repo)
  if (/<head(\s[^>]*)?>/i.test(html))
    return html.replace(/(<head(\s[^>]*)?>)/i, `$1${VISUDEV_BRIDGE_SCRIPT}`);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${VISUDEV_BRIDGE_SCRIPT}</head>`);
  if (/<body[^>]*>/i.test(html))
    return html.replace(/<body([^>]*)>/i, `<body$1>${VISUDEV_BRIDGE_SCRIPT}`);
  return `${VISUDEV_BRIDGE_SCRIPT}${html}`;
}

function buildProxyRequestHeaders(headers, targetPort) {
  const next = {
    ...headers,
    host: `127.0.0.1:${targetPort}`,
    "accept-encoding": "identity",
  };
  delete next["if-none-match"];
  delete next["if-modified-since"];
  delete next["referer"];
  delete next["referrer"];
  return next;
}

function forwardProxyResponse(upstreamRes, downstreamRes, requestMethod) {
  const headers = { ...upstreamRes.headers };
  delete headers["x-frame-options"];
  delete headers["content-security-policy"];
  delete headers["content-security-policy-report-only"];
  delete headers["cross-origin-embedder-policy"];
  delete headers["cross-origin-opener-policy"];
  headers["content-security-policy"] = FRAME_ANCESTORS;
  const statusCode = upstreamRes.statusCode || 502;
  const contentType = String(headers["content-type"] || "");
  const contentEncoding = String(headers["content-encoding"] || "").toLowerCase();
  const canInjectHtml =
    /\btext\/html\b/i.test(contentType) &&
    (contentEncoding === "" || contentEncoding === "identity") &&
    String(requestMethod || "").toUpperCase() !== "HEAD" &&
    statusCode !== 204 &&
    statusCode !== 304;

  let finished = false;
  /** When HTML: if upstream never sends "end" within timeout, send 504 so iframe gets onLoad. */
  let bodyTimeoutId = null;
  if (canInjectHtml) {
    bodyTimeoutId = setTimeout(() => {
      if (finished || downstreamRes.headersSent) return;
      finished = true;
      console.warn(
        `  [proxy] Response-Body-Timeout (${PROXY_UPSTREAM_TIMEOUT_MS / 1000}s): Upstream hat nicht abgeschlossen → sende 504 an Client.`,
      );
      upstreamRes.destroy();
      downstreamRes.writeHead(504, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": FRAME_ANCESTORS,
      });
      downstreamRes.end(
        buildProxyErrorPage(
          "Preview-App antwortet zu langsam",
          `Response-Body wurde nicht innerhalb von ${PROXY_UPSTREAM_TIMEOUT_MS / 1000} s geliefert. Preview neu starten oder Build prüfen.`,
        ),
      );
    }, PROXY_UPSTREAM_TIMEOUT_MS);
  }

  if (!canInjectHtml) {
    downstreamRes.writeHead(statusCode, headers);
    upstreamRes.pipe(downstreamRes, { end: true });
    return;
  }

  const chunks = [];
  upstreamRes.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  upstreamRes.on("error", (err) => {
    if (finished) return;
    finished = true;
    if (bodyTimeoutId) clearTimeout(bodyTimeoutId);
    if (!downstreamRes.headersSent) {
      downstreamRes.writeHead(502, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": FRAME_ANCESTORS,
      });
    }
    downstreamRes.end(
      buildProxyErrorPage("Proxy-Fehler", `Upstream-Fehler beim Lesen der Antwort: ${err.message}`),
    );
  });
  upstreamRes.on("end", () => {
    if (finished) return;
    finished = true;
    if (bodyTimeoutId) clearTimeout(bodyTimeoutId);
    const html = Buffer.concat(chunks).toString("utf8");
    const injected = injectVisudevBridge(html);
    delete headers["content-encoding"];
    delete headers["transfer-encoding"];
    delete headers.etag;
    delete headers["last-modified"];
    headers["content-length"] = Buffer.byteLength(injected, "utf8");
    headers["cache-control"] = "no-store";
    downstreamRes.writeHead(statusCode, headers);
    downstreamRes.end(injected);
  });
}

function proxyToApp(clientReq, clientRes, targetPort, targetPath) {
  const opts = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: targetPath || clientReq.url || "/",
    method: clientReq.method,
    headers: buildProxyRequestHeaders(clientReq.headers, targetPort),
  };
  let responded = false;
  const sendError = (statusCode, title, hint) => {
    if (responded || clientRes.headersSent) return;
    responded = true;
    clientRes.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": FRAME_ANCESTORS,
    });
    clientRes.end(buildProxyErrorPage(title, hint));
  };

  const proxy = http.request(opts, (upstreamRes) => {
    if (responded) return;
    forwardProxyResponse(upstreamRes, clientRes, clientReq.method);
  });
  proxy.setTimeout(PROXY_UPSTREAM_TIMEOUT_MS, () => {
    if (responded) return;
    console.warn(
      `  [proxy] Request-Timeout (${PROXY_UPSTREAM_TIMEOUT_MS / 1000}s): Keine Antwort vom Upstream → sende 504 an Client.`,
    );
    proxy.destroy();
    sendError(
      504,
      "Preview-App antwortet zu langsam",
      `Die gebaute App hat innerhalb von ${PROXY_UPSTREAM_TIMEOUT_MS / 1000} s nicht geantwortet. Bitte „Preview neu starten“ oder Build/Container prüfen.`,
    );
  });
  proxy.on("error", (err) => {
    if (responded) return;
    const isRefused = /ECONNREFUSED|connect/i.test(err.message);
    const isTimeout = /timeout|ETIMEDOUT/i.test(err.message);
    const title = isTimeout
      ? "Preview-App antwortet zu langsam"
      : isRefused
        ? "Preview-App nicht erreichbar"
        : "Proxy-Fehler";
    const hint = isTimeout
      ? `Keine Antwort innerhalb von ${PROXY_UPSTREAM_TIMEOUT_MS / 1000} s. Preview neu starten oder Build/Container prüfen.`
      : isRefused
        ? "Die gebaute App antwortet nicht auf dem erwarteten Port. Bitte „Preview neu starten“ in VisuDEV oder npm run dev + Docker prüfen."
        : err.message;
    sendError(502, title, hint);
  });
  clientReq.pipe(proxy, { end: true });
}

function proxyPreviewRequest(req, res, targetPort, targetPath) {
  proxyToApp(req, res, targetPort, targetPath);
}

/** Wait until app on port responds. 2xx/3xx and client 4xx are considered "reachable".
 * Some SPAs/APIs intentionally return 404/401 on "/" while still being fully up.
 * Reject only when there is no reachable HTTP response within maxMs or only 5xx responses.
 */
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestAppStatusOnce(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        timeout: 5000,
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        res.resume();
        resolve(status);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      const timeoutError = new Error("HTTP request timeout");
      timeoutError.code = "REQUEST_TIMEOUT";
      req.destroy(timeoutError);
    });
    req.end();
  });
}

async function waitForAppReady(port, maxMs = 60_000, shouldAbort = null, onPendingCheck = null) {
  const interval = 500;
  const deadline = Date.now() + maxMs;
  let lastStatus = null;
  let lastNetworkError = null;

  while (true) {
    if (typeof shouldAbort === "function" && shouldAbort()) {
      throw createRunAbortError();
    }
    if (typeof onPendingCheck === "function") {
      const pendingResult = await onPendingCheck();
      if (pendingResult instanceof Error) throw pendingResult;
      if (typeof pendingResult === "string" && pendingResult.trim() !== "") {
        throw new Error(pendingResult);
      }
    }

    try {
      const status = await requestAppStatusOnce(port);
      lastStatus = status;
      if (status >= 200 && status < 500) return;
    } catch (err) {
      if (isRunAbortError(err)) throw err;
      lastNetworkError = err?.code
        ? `${String(err.code)}${err.message ? ` (${err.message})` : ""}`
        : err?.message || "unbekannt";
    }

    if (Date.now() >= deadline) {
      const statusHint = lastStatus != null ? ` Letzter HTTP-Status: ${lastStatus}.` : "";
      const networkHint =
        lastNetworkError != null ? ` Letzter Netzwerkfehler: ${lastNetworkError}.` : "";
      if (lastStatus != null) {
        throw new Error(
          `Preview-App antwortet nicht auf Port ${port} innerhalb von ${maxMs / 1000}s (Status ${lastStatus || "unknown"}).${statusHint}${networkHint}`,
        );
      }
      throw new Error(
        `Preview-App nicht erreichbar (Port ${port}) nach ${maxMs / 1000}s.${networkHint}${statusHint} Build/Container prüfen.`,
      );
    }

    await sleepMs(interval);
  }
}

function formatDockerStatusLine(statusInfo) {
  if (!statusInfo) return null;
  const parts = [];
  if (statusInfo.state) parts.push(`state=${statusInfo.state}`);
  if (statusInfo.exitCode != null) parts.push(`exitCode=${statusInfo.exitCode}`);
  if (statusInfo.error) parts.push(`error=${statusInfo.error}`);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

async function collectDockerDiagnostics(run, containerName) {
  if (!containerName) return null;
  const [statusInfo, logs] = await Promise.all([
    getContainerStatus(containerName),
    getContainerLogs(containerName, PREVIEW_DOCKER_LOG_TAIL),
  ]);
  const statusLine = formatDockerStatusLine(statusInfo);
  if (statusLine) {
    pushLog(run, `Docker-Status: ${statusLine}`);
  }
  if (logs) {
    pushLog(run, `Docker-Logs (tail ${PREVIEW_DOCKER_LOG_TAIL}):\n${logs}`);
  }
  if (statusLine || logs) {
    return {
      statusLine,
      logs,
      summary: [statusLine ? `Docker-Status: ${statusLine}` : null].filter(Boolean).join(" | "),
    };
  }
  return null;
}

function createDockerStartupMonitor(run, containerName) {
  let lastCheckAt = 0;
  let alreadyFailed = false;
  return async () => {
    if (alreadyFailed || !containerName) return null;
    const now = Date.now();
    if (now - lastCheckAt < 1200) return null;
    lastCheckAt = now;

    const statusInfo = await getContainerStatus(containerName);
    const state = String(statusInfo?.state || "").toLowerCase();
    const isRunningState = state === "running" || state === "created" || state === "restarting";
    const missingContainer =
      !state &&
      typeof statusInfo?.error === "string" &&
      /no such object|not found|cannot find/i.test(statusInfo.error);

    if (isRunningState || (!missingContainer && !state)) {
      return null;
    }

    const statusLine = formatDockerStatusLine(statusInfo);
    if (statusLine) {
      pushLog(run, `Docker-Status: ${statusLine}`);
    }
    const logs = await getContainerLogs(containerName, PREVIEW_DOCKER_LOG_TAIL);
    if (logs) {
      pushLog(run, `Docker-Logs (tail ${PREVIEW_DOCKER_LOG_TAIL}):\n${logs}`);
    }
    alreadyFailed = true;
    if (statusLine) {
      return `Docker-Container wurde vorzeitig beendet (${statusLine}).`;
    }
    return "Docker-Container wurde vorzeitig beendet.";
  };
}

/** Create HTTP proxy on proxyPort that forwards to appPort and adds frame-ancestors so iframes work. */
function createFrameProxy(proxyPort, appPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      proxyToApp(clientReq, clientRes, appPort, clientReq.url || "/");
    });
    server.once("error", (err) => {
      reject(err);
    });
    server.listen(proxyPort, PREVIEW_BIND_HOST, () => {
      console.log(
        `  Frame proxy http://${PREVIEW_BIND_HOST}:${proxyPort} -> http://127.0.0.1:${appPort}`,
      );
      resolve(server);
    });
  });
}

/** Start a minimal HTTP server on the given port (stub or error page). Sends CSP so iframe embedding works. */
function startPlaceholderServer(port, errorMessage = null) {
  const html = errorMessage
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview Fehler</title></head><body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#eee;"><h1>Preview Fehler</h1><pre style="white-space:pre-wrap;color:#f88;">${escapeHtml(errorMessage)}</pre></body></html>`
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview Stub</title></head><body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#eee;max-width:36rem;"><h1>Preview (Stub)</h1><p>Port ${port} – hier würde die gebaute App laufen.</p><p>Der Runner startet aktuell <strong>keine</strong> echte App. Für echte Previews:</p><ol style="margin:0.5rem 0;padding-left:1.5rem;"><li>Runner stoppen (Ctrl+C)</li><li>Starten mit echtem Build:<br><code style="background:#333;padding:0.25rem 0.5rem;border-radius:4px;">USE_REAL_BUILD=1 npm start</code></li><li>Optional: <code style="background:#333;padding:0.1rem 0.3rem;">GITHUB_TOKEN</code> setzen (für private Repos)</li></ol><p style="color:#9ca3af;font-size:0.9rem;">Siehe <code>docs/PREVIEW_RUNNER.md</code>.</p></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": FRAME_ANCESTORS,
    });
    res.end(html);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      usedPorts.delete(port);
    }
    console.warn(
      `  Placeholder konnte nicht auf http://${PREVIEW_BIND_HOST}:${port} starten: ${err.message}`,
    );
  });
  server.listen(port, PREVIEW_BIND_HOST, () => {
    console.log(`  Placeholder listening on http://${PREVIEW_BIND_HOST}:${port}`);
    portServers.set(port, server);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prüft, ob die Fehlermeldung wie npm/git-Hilfe aussieht (für Retry mit --ignore-scripts). */
function isNpmOrGitHelpError(msg) {
  const t = String(msg || "");
  if (
    t.includes("Verwendung: git") ||
    t.includes("Usage: git") ||
    (t.includes("git [-v | --version]") && t.includes("<command>"))
  )
    return true;
  if (
    t.includes("npm <command>") ||
    (t.includes("Usage:") && t.includes("npm install") && t.includes("npm run")) ||
    (t.includes("Specify configs") && t.includes("npm help config"))
  )
    return true;
  return false;
}

/** If error is Git/npm help output, return a short actionable message instead. */
function normalizeBuildError(msg) {
  const t = String(msg || "");
  if (
    t.includes("Verwendung: git") ||
    t.includes("Usage: git") ||
    (t.includes("git [-v | --version]") && t.includes("<command>"))
  ) {
    return (
      "Build/Start fehlgeschlagen: Im Build oder in einer Abhängigkeit wird vermutlich 'git' ohne Unterbefehl aufgerufen (z. B. in einem postinstall-Skript). " +
      "Bitte package.json-Skripte und Abhängigkeiten prüfen. Ursprüngliche Ausgabe wurde gekürzt."
    );
  }
  if (
    t.includes("npm <command>") ||
    (t.includes("Usage:") && t.includes("npm install") && t.includes("npm run")) ||
    (t.includes("Specify configs") && t.includes("npm help config"))
  ) {
    return (
      "Build/Start fehlgeschlagen: Es wird 'npm' ohne Unterbefehl aufgerufen (z. B. in einem Skript oder einer Abhängigkeit). " +
      "Bitte package.json-Skripte (build, postinstall, start, …) und Abhängigkeiten prüfen – dort darf nicht nur „npm“ oder „npm -h“ stehen. Ursprüngliche Ausgabe wurde gekürzt."
    );
  }
  return msg;
}

function getErrorMessage(err) {
  return err instanceof Error ? err.message : String(err ?? "Unknown error");
}

function sanitizeDiagnosticText(input) {
  const raw = String(input || "");
  let sanitized = raw
    .replace(/(authorization\s*:\s*bearer\s+)[a-z0-9._-]{12,}/gi, "$1[REDACTED]")
    .replace(
      /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[REDACTED_GITHUB_TOKEN]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
    .replace(
      /((?:password|secret|token|api[_-]?key|service[_-]?role[_-]?key)\s*[:=]\s*)(["']?)[^\s,"']+\2/gi,
      "$1[REDACTED]",
    );
  if (sanitized.length > 12_000) {
    sanitized = `${sanitized.slice(0, 5_800)}\n...[gekürzt]...\n${sanitized.slice(-5_800)}`;
  }
  return sanitized;
}

function normalizeProjectIdValue(value) {
  const projectId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) return null;
  return projectId;
}

function normalizeRunIdValue(value) {
  const runId = String(value || "").trim();
  if (!/^run_[0-9]{10,}_[a-z0-9]{4,20}$/i.test(runId)) return null;
  return runId;
}

function normalizeRepoInput(repo) {
  const trimmed = String(repo || "").trim();
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

function normalizeBranchOrCommitInput(branchOrCommit) {
  const value = String(branchOrCommit || "").trim();
  if (value.length === 0 || value.length > 128) return null;
  if (
    value.includes("..") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.startsWith("-") ||
    /[\s~^:?*[\]\\]/.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizeProjectToken(tokenValue) {
  const token = String(tokenValue || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  return token;
}

function readProjectTokenFromRequest(req) {
  const raw =
    req.headers[PROJECT_TOKEN_HEADER] ?? req.headers[PROJECT_TOKEN_HEADER.toLowerCase()] ?? "";
  if (Array.isArray(raw)) {
    return normalizeProjectToken(raw[0]);
  }
  return normalizeProjectToken(raw);
}

function generateProjectToken() {
  return crypto.randomBytes(24).toString("hex");
}

function collectActiveProjectTokens(projectId) {
  const tokens = new Set();
  for (const [, run] of runs) {
    if (run.status === "stopped") continue;
    if (String(run.projectId) !== String(projectId)) continue;
    const token = normalizeProjectToken(run.projectToken);
    if (token) tokens.add(token);
  }
  return Array.from(tokens);
}

function hasActiveProjectRuns(projectId) {
  for (const [, run] of runs) {
    if (run.status === "stopped") continue;
    if (String(run.projectId) !== String(projectId)) continue;
    return true;
  }
  return false;
}

function resolveProjectTokenForStart(projectId, requestToken) {
  const activeTokens = collectActiveProjectTokens(projectId);
  if (activeTokens.length === 0) {
    return {
      ok: true,
      token: requestToken || generateProjectToken(),
    };
  }
  if (activeTokens.length > 1) {
    return {
      ok: false,
      statusCode: 409,
      error: "Multiple active project tokens detected. Stop all project runs and start again.",
    };
  }
  const projectToken = activeTokens[0];
  if (requestToken && requestToken === projectToken) {
    return { ok: true, token: projectToken };
  }
  if (requestToken && requestToken !== projectToken) {
    return {
      ok: false,
      statusCode: 403,
      error: "Project token mismatch.",
    };
  }
  // UX recovery: if browser storage lost the token (e.g. origin switch localhost<->127.0.0.1),
  // allow start to re-attach to the single active project token.
  return { ok: true, token: projectToken };
}

function ensureRunAccess(run, requestToken) {
  const runToken = normalizeProjectToken(run?.projectToken);
  if (!runToken) {
    return {
      ok: false,
      statusCode: 401,
      error: "Missing project token for this run. Restart preview to regenerate access token.",
    };
  }
  if (!requestToken) {
    return { ok: false, statusCode: 401, error: "Missing project token." };
  }
  if (requestToken !== runToken) {
    return { ok: false, statusCode: 403, error: "Forbidden for this project." };
  }
  return { ok: true };
}

function ensureProjectAccess(projectId, requestToken) {
  const activeTokens = collectActiveProjectTokens(projectId);
  if (activeTokens.length === 0) {
    if (hasActiveProjectRuns(projectId)) {
      return {
        ok: false,
        statusCode: 401,
        error: "Missing project token for existing project preview.",
      };
    }
    return { ok: true };
  }
  if (!requestToken) {
    return { ok: false, statusCode: 401, error: "Missing project token." };
  }
  if (!activeTokens.includes(requestToken)) {
    return { ok: false, statusCode: 403, error: "Forbidden for this project." };
  }
  return { ok: true };
}

function parseIsoMs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function listActiveProjectRuns(projectId, projectToken = null) {
  const out = [];
  for (const [runId, run] of runs) {
    if (run.status === "stopped") continue;
    if (String(run.projectId) !== String(projectId)) continue;
    if (projectToken) {
      const token = normalizeProjectToken(run.projectToken);
      if (token !== projectToken) continue;
    }
    out.push({ runId, run });
  }
  out.sort((a, b) => parseIsoMs(b.run.startedAt) - parseIsoMs(a.run.startedAt));
  return out;
}

function selectReusableProjectRun(projectId, projectToken) {
  const entries = listActiveProjectRuns(projectId, projectToken);
  const active = entries.filter(
    (entry) => entry.run.status === "starting" || entry.run.status === "ready",
  );
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const aReady = a.run.status === "ready" ? 1 : 0;
    const bReady = b.run.status === "ready" ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    return parseIsoMs(b.run.startedAt) - parseIsoMs(a.run.startedAt);
  });
  return {
    selected: active[0],
    duplicates: active.slice(1),
  };
}

function getClientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  if (typeof forwarded === "string" && forwarded.trim() !== "") {
    return forwarded.split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "unknown").trim();
}

function enforceWriteRateLimit(req, routeKey) {
  const now = Date.now();
  const clientKey = getClientAddress(req);
  const key = `${clientKey}:${routeKey}`;
  let bucket = writeRateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + RUNNER_WRITE_RATE_LIMIT_WINDOW_MS,
    };
  }
  bucket.count += 1;
  writeRateLimitBuckets.set(key, bucket);

  // Opportunistic cleanup to keep memory bounded.
  if (writeRateLimitBuckets.size > 2000) {
    for (const [bucketKey, item] of writeRateLimitBuckets) {
      if (now >= item.resetAt + RUNNER_WRITE_RATE_LIMIT_WINDOW_MS) {
        writeRateLimitBuckets.delete(bucketKey);
      }
    }
  }

  if (bucket.count > RUNNER_WRITE_RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true };
}

function createRunAbortError() {
  const error = new Error("Run wurde gestoppt.");
  error.code = "RUN_ABORTED";
  return error;
}

function isRunAbortError(error) {
  return error != null && typeof error === "object" && error.code === "RUN_ABORTED";
}

function isRunOperationActive(runId, run, operationId) {
  const current = runs.get(runId);
  if (!current || current !== run) return false;
  if (current.status === "stopped") return false;
  if (current.cancelRequested === true) return false;
  if (operationId && current.activeOperationId !== operationId) return false;
  return true;
}

function assertRunOperationActive(runId, run, operationId) {
  if (!isRunOperationActive(runId, run, operationId)) {
    throw createRunAbortError();
  }
}

/** Append a step message to run.logs (for UI). */
function pushLog(run, message) {
  if (!run.logs) run.logs = [];
  run.logs.push({ time: new Date().toISOString(), message: sanitizeDiagnosticText(message) });
}

/** Beendet den Docker-Log-Stream für diesen Run, falls aktiv. */
function stopDockerLogStream(run) {
  if (run.dockerLogStreamProcess) {
    try {
      run.dockerLogStreamProcess.kill();
    } catch (_) {
      /* ignore */
    }
    run.dockerLogStreamProcess = undefined;
  }
}

function bindChildExit(run, runId, child) {
  child.on("exit", (code, signal) => {
    if (run.childProcess === child) {
      run.childProcess = null;
      if (run.status === "ready") {
        run.status = "failed";
        run.error = `Preview-App beendet (exit ${code ?? "?"}${signal ? `, Signal ${signal}` : ""}). Bitte „Preview neu starten“.`;
        console.log(`  Preview app exited [${runId}]: code=${code} signal=${signal}`);
      }
    }
  });
}

function pushInjectedEnvHint(run, child) {
  const injected = Array.isArray(child?.__visudevInjectedEnvKeys)
    ? child.__visudevInjectedEnvKeys
    : [];
  const mode = String(child?.__visudevSupabasePlaceholderMode || "");
  if (injected.length === 0) return;
  let modeHint = "";
  if (mode === "auto_detected") {
    modeHint = " (Supabase automatisch erkannt)";
  } else if (mode === "forced_on") {
    modeHint = " (erzwungen)";
  }
  pushLog(
    run,
    `Hinweis: Fehlende Env-Variablen wurden als Preview-Platzhalter gesetzt${modeHint}: ${injected.join(", ")}`,
  );
}

async function withWorkspaceLock(projectId, fn) {
  const key = String(projectId || "default");
  const prev = workspaceLocks.get(key) || Promise.resolve();
  let release = null;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chain = prev.then(() => current).catch(() => current);
  workspaceLocks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    if (release) release();
    if (workspaceLocks.get(key) === chain) {
      workspaceLocks.delete(key);
    }
  }
}

function describeCandidate(candidate) {
  const scripts = [];
  if (candidate?.scripts?.build) scripts.push("build");
  if (candidate?.scripts?.dev) scripts.push("dev");
  if (candidate?.scripts?.start) scripts.push("start");
  const scriptLabel = scripts.length > 0 ? scripts.join("/") : "keine scripts";
  const score =
    typeof candidate?.score === "number" && Number.isFinite(candidate.score)
      ? candidate.score
      : "?";
  const source = candidate?.source || "scan";
  const rel = candidate?.appDirRelative || ".";
  return `${rel} (${source}, score ${score}, scripts: ${scriptLabel})`;
}

async function stopChildProcess(child) {
  if (!child) return;
  try {
    if (!child.killed) child.kill("SIGTERM");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`  stopChildProcess SIGTERM fehlgeschlagen: ${msg}`);
    return;
  }
  await new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    child.once("exit", done);
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`  stopChildProcess SIGKILL fehlgeschlagen: ${msg}`);
      }
      done();
    }, 1500);
  });
}

function forceServeSpaConfig(appDir, config) {
  if (!config || typeof config !== "object") return config;
  if (fs.existsSync(path.join(appDir, "dist"))) {
    return { ...config, startCommand: "npx serve dist -s" };
  }
  if (fs.existsSync(path.join(appDir, "build"))) {
    return { ...config, startCommand: "npx serve build -s" };
  }
  if (fs.existsSync(path.join(appDir, "out"))) {
    return { ...config, startCommand: "npx serve out -s" };
  }
  return config;
}

async function startCandidateProcess(
  run,
  runId,
  candidate,
  appPort,
  config,
  timeoutMs,
  shouldAbort = null,
) {
  const effectiveConfig = forceServeSpaConfig(candidate.appDir, config);
  const child = startApp(candidate.appDir, appPort, effectiveConfig);
  pushInjectedEnvHint(run, child);
  try {
    await waitForAppReady(appPort, timeoutMs, shouldAbort);
    if (typeof shouldAbort === "function" && shouldAbort()) {
      await stopChildProcess(child);
      return { success: false, aborted: true, error: "Run wurde gestoppt." };
    }
    run.childProcess = child;
    bindChildExit(run, runId, child);
    return { success: true, child };
  } catch (err) {
    await stopChildProcess(child);
    if (isRunAbortError(err)) {
      return { success: false, aborted: true, error: "Run wurde gestoppt." };
    }
    return {
      success: false,
      error: getErrorMessage(err),
    };
  }
}

function buildCandidateFailureSummary(failures, totalCandidates) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return "Kein startbarer Kandidat gefunden.";
  }
  const lines = failures.slice(0, 4).map((failure, idx) => {
    const label = failure?.label || "unbekannt";
    const reason = failure?.reason || "Unbekannter Fehler";
    return `${idx + 1}. ${label}: ${reason}`;
  });
  if (failures.length > 4) {
    lines.push(`… plus ${failures.length - 4} weitere fehlgeschlagene Kandidaten.`);
  }
  lines.push(`Geprüfte Kandidaten: ${totalCandidates}`);
  return lines.join("\n");
}

async function bootPreviewByCandidates({
  run,
  runId,
  workspaceDir,
  appPort,
  bestEffortEnabled,
  candidates,
  shouldAbort = null,
}) {
  const candidateList = Array.isArray(candidates) && candidates.length > 0 ? candidates : [];
  const failures = [];
  if (candidateList.length > 1) {
    pushLog(run, `Scanner: ${candidateList.length} Kandidaten erkannt. Starte Probe-Reihenfolge.`);
  }

  for (let idx = 0; idx < candidateList.length; idx++) {
    if (typeof shouldAbort === "function" && shouldAbort()) {
      return { success: false, aborted: true, error: "Run wurde gestoppt." };
    }
    const candidate = candidateList[idx];
    const label = describeCandidate(candidate);
    const prefix = `[${candidate.appDirRelative || "."}]`;
    pushLog(run, `Scanner: Kandidat ${idx + 1}/${candidateList.length}: ${label}`);
    ensurePackageJsonScripts(candidate.appDir);
    const config = {
      ...getConfig(candidate.appDir, workspaceDir),
      injectSupabasePlaceholders: run.injectSupabasePlaceholders,
    };

    let buildErr = null;
    pushLog(
      run,
      `Build: npm install / build … ${prefix} (Timeout: ${Math.floor(BUILD_TIMEOUT_MS / 1000)}s)`,
    );
    const buildPromise = runBuildNodeDirect(candidate.appDir);
    const buildTimeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Build hat zu lange gedauert (Timeout ${Math.floor(BUILD_TIMEOUT_MS / 1000)}s). Bitte lokal prüfen: npm install && npm run build im App-Verzeichnis.`,
            ),
          ),
        BUILD_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([buildPromise, buildTimeoutPromise]);
      pushLog(run, `Build fertig ${prefix}`);
    } catch (e) {
      buildPromise.catch(() => {}); // avoid unhandled rejection when build finishes later
      buildErr = e;
      if (isNpmOrGitHelpError(e.message)) {
        const retryPromise = runBuild(candidate.appDir, config);
        const retryTimeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  `Build (Retry) hat zu lange gedauert (Timeout ${Math.floor(BUILD_TIMEOUT_MS / 1000)}s).`,
                ),
              ),
            BUILD_TIMEOUT_MS,
          );
        });
        try {
          await Promise.race([retryPromise, retryTimeoutPromise]);
          retryPromise.catch(() => {});
          buildErr = null;
          pushLog(run, `Build fertig ${prefix}`);
        } catch (retryErr) {
          retryPromise.catch(() => {});
          buildErr = retryErr;
        }
      }
    }

    if (buildErr) {
      const buildMsg = getErrorMessage(buildErr);
      pushLog(run, `Build fehlgeschlagen ${prefix} (exakte Meldung):\n${buildMsg}`);
      if (!bestEffortEnabled) {
        failures.push({
          label,
          reason: normalizeBuildError(buildMsg),
        });
        continue;
      }
      const fallbackStartCommand = resolveBestEffortStartCommand(candidate.appDir, config);
      if (!fallbackStartCommand) {
        failures.push({
          label,
          reason:
            "Best-Effort-Fallback nicht möglich: kein geeigneter Startbefehl gefunden (dev/start).",
        });
        continue;
      }
      pushLog(run, `Best-Effort: Starte Fallback mit "${fallbackStartCommand}" … ${prefix}`);
      const fallbackConfig = { ...config, startCommand: fallbackStartCommand };
      const fallbackResult = await startCandidateProcess(
        run,
        runId,
        candidate,
        appPort,
        fallbackConfig,
        90_000,
        shouldAbort,
      );
      if (fallbackResult.aborted) {
        return { success: false, aborted: true, error: "Run wurde gestoppt." };
      }
      if (fallbackResult.success) {
        run.degraded = true;
        pushLog(run, `Best-Effort aktiv: App läuft trotz Build-Fehler. ${prefix}\n${buildMsg}`);
        return {
          success: true,
          degraded: true,
          candidate,
          buildMessage: buildMsg,
        };
      }
      failures.push({
        label,
        reason: `Fallback-Start fehlgeschlagen: ${fallbackResult.error}`,
      });
      continue;
    }

    pushLog(run, `Start: App wird gestartet … ${prefix}`);
    const startResult = await startCandidateProcess(
      run,
      runId,
      candidate,
      appPort,
      config,
      60_000,
      shouldAbort,
    );
    if (startResult.aborted) {
      return { success: false, aborted: true, error: "Run wurde gestoppt." };
    }
    if (startResult.success) {
      run.degraded = false;
      pushLog(run, `Bereit ${prefix}`);
      return { success: true, degraded: false, candidate };
    }
    pushLog(run, `Start fehlgeschlagen ${prefix}: ${startResult.error}`);

    if (!bestEffortEnabled) {
      failures.push({
        label,
        reason: `Start fehlgeschlagen: ${startResult.error}`,
      });
      continue;
    }

    const fallbackStartCommand = resolveBestEffortStartCommand(candidate.appDir, config);
    if (
      !fallbackStartCommand ||
      fallbackStartCommand.trim() === (config.startCommand || "").trim()
    ) {
      failures.push({
        label,
        reason: `Start fehlgeschlagen: ${startResult.error}`,
      });
      continue;
    }

    pushLog(
      run,
      `Best-Effort: Start-Fallback "${fallbackStartCommand}" nach Start-Fehler … ${prefix}`,
    );
    const fallbackConfig = { ...config, startCommand: fallbackStartCommand };
    const fallbackResult = await startCandidateProcess(
      run,
      runId,
      candidate,
      appPort,
      fallbackConfig,
      90_000,
      shouldAbort,
    );
    if (fallbackResult.aborted) {
      return { success: false, aborted: true, error: "Run wurde gestoppt." };
    }
    if (fallbackResult.success) {
      run.degraded = true;
      pushLog(run, `Best-Effort aktiv: App läuft mit Start-Fallback. ${prefix}`);
      return {
        success: true,
        degraded: true,
        candidate,
      };
    }
    failures.push({
      label,
      reason: `Start + Fallback fehlgeschlagen: ${fallbackResult.error}`,
    });
  }

  return {
    success: false,
    error: buildCandidateFailureSummary(failures, candidateList.length),
  };
}

/** Background: clone, build, start app on appPort, then start frame proxy on proxyPort. On failure show error placeholder on proxyPort. */
async function buildAndStartAsync(runId) {
  const run = runs.get(runId);
  if (!run || run.status !== "starting") return;
  if (!Array.isArray(run.logs)) run.logs = [];
  const operationId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  run.activeOperationId = operationId;
  run.cancelRequested = false;
  pushLog(run, "Build-Workflow gestartet.");
  const { repo, branchOrCommit, projectId, proxyPort, appPort, previewUrl } = run;
  const bootMode = resolveBootMode(run.bootMode);
  const bestEffortEnabled = bootMode !== "strict";
  const workspaceDir = getWorkspaceDir(projectId);
  const isActive = () => isRunOperationActive(runId, run, operationId);
  const assertActive = () => assertRunOperationActive(runId, run, operationId);

  const setFailed = (displayMsg, hint = "", exactMsg = null) => {
    if (!isActive()) return;
    run.status = "failed";
    run.error = sanitizeDiagnosticText(exactMsg ?? displayMsg);
    run.readyAt = null;
    run.containerId = null;
    run.degraded = false;
    run.proxyServer = null;
    if (appPort !== proxyPort) {
      releasePort(appPort);
    }
    releasePortAndStartPlaceholder(proxyPort, `Build/Start fehlgeschlagen:\n${displayMsg}${hint}`);
  };

  const useLocalWorkspace = !!getLocalWorkspaceOverride();

  return withWorkspaceLock(projectId, async () => {
    try {
      assertActive();
      if (useLocalWorkspace) {
        pushLog(run, "Lokales Workspace (USE_LOCAL_WORKSPACE): Git-Schritt übersprungen.");
      } else {
        pushLog(run, "Git: Clone/Pull …");
        await cloneOrPull(repo, branchOrCommit, workspaceDir);
        assertActive();
        pushLog(run, "Git: Clone/Pull fertig");
        if (run.commitSha) {
          pushLog(run, `Git: Checkout Commit ${run.commitSha.slice(0, 8)} …`);
          await checkoutCommit(workspaceDir, run.commitSha, branchOrCommit);
          assertActive();
          pushLog(run, `Git: Checkout Commit ${run.commitSha.slice(0, 8)} fertig`);
        }
      }
      const rootConfig = getConfig(workspaceDir, workspaceDir);
      const appCandidates = listPreviewCandidates(workspaceDir, rootConfig, 8);
      const appWorkspace = appCandidates[0] ?? resolveAppWorkspaceDir(workspaceDir, rootConfig);
      if (appWorkspace.appDirRelative !== ".") {
        pushLog(
          run,
          `Monorepo erkannt: nutze App-Verzeichnis "${appWorkspace.appDirRelative}" (${appWorkspace.source}).`,
        );
      }

      if (USE_DOCKER) {
        assertActive();
        const dockerOk = await isDockerAvailable();
        assertActive();
        if (!dockerOk) {
          setFailed(
            "Docker ist nicht verfügbar. USE_DOCKER=1 erfordert laufenden Docker (docker info).",
          );
          return;
        }
        pushLog(run, "Docker: Starte Container …");
        ensurePackageJsonScripts(appWorkspace.appDir);
        let containerName;
        try {
          containerName = await runContainer(appWorkspace.appDir, appPort, runId);
        } catch (dockerErr) {
          const errMsg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
          const isPortAllocated = /port is already allocated|Bind for .* failed/i.test(errMsg);
          if (isPortAllocated) {
            releasePort(proxyPort);
            if (appPort !== proxyPort) releasePort(appPort);
            const retryPorts = await getTwoFreePorts();
            if (retryPorts) {
              const [newProxyPort, newAppPort] = retryPorts;
              run.proxyPort = newProxyPort;
              run.appPort = newAppPort;
              run.port = newProxyPort;
              run.previewUrl = resolvePreviewUrl(newProxyPort);
              pushLog(
                run,
                `Port war belegt, neues Paar: Proxy ${newProxyPort}, App ${newAppPort}. Starte Container erneut …`,
              );
              containerName = await runContainer(appWorkspace.appDir, newAppPort, runId);
            } else {
              throw dockerErr;
            }
          } else {
            throw dockerErr;
          }
        }
        run.containerId = containerName;
        run.dockerLogStreamProcess =
          streamContainerLogs(containerName, (msg) => pushLog(run, msg)) ?? undefined;
        const startupMonitor = createDockerStartupMonitor(run, containerName);
        assertActive();
        const proxyServer = await createFrameProxy(run.proxyPort, run.appPort);
        run.proxyServer = proxyServer;
        portServers.set(run.proxyPort, proxyServer);
        assertActive();
        pushLog(
          run,
          `Warte auf App (Timeout ${Math.floor(PREVIEW_DOCKER_READY_TIMEOUT_MS / 1000)}s) …`,
        );
        await waitForAppReady(
          run.appPort,
          PREVIEW_DOCKER_READY_TIMEOUT_MS,
          () => !isActive(),
          startupMonitor,
        );
        assertActive();
        run.status = "ready";
        run.readyAt = new Date().toISOString();
        run.error = null;
        run.degraded = false;
        pushLog(run, "Bereit");
        console.log(`  Preview ready (Docker): ${run.previewUrl}`);
        return;
      }

      const bootResult = await bootPreviewByCandidates({
        run,
        runId,
        workspaceDir,
        appPort,
        bestEffortEnabled,
        candidates: appCandidates,
        shouldAbort: () => !isActive(),
      });
      if (!bootResult.success) {
        if (bootResult.aborted) return;
        throw new Error(bootResult.error);
      }
      assertActive();
      const proxyServer = await createFrameProxy(proxyPort, appPort);
      run.proxyServer = proxyServer;
      portServers.set(proxyPort, proxyServer);
      assertActive();
      run.status = "ready";
      run.readyAt = new Date().toISOString();
      run.error = null;
      run.degraded = bootResult.degraded === true;
      if (bootResult.candidate) {
        pushLog(run, `Aktiver Kandidat: ${describeCandidate(bootResult.candidate)}`);
      }
      if (!run.degraded) {
        pushLog(run, "Bereit");
      }
      console.log(`  Preview ready${run.degraded ? " (best-effort)" : ""}: ${previewUrl}`);
    } catch (err) {
      if (isRunAbortError(err) || !isActive()) {
        if (USE_DOCKER && run.containerId) {
          stopDockerLogStream(run);
          try {
            await stopContainer(runId);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
            console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
          }
          run.containerId = null;
        }
        return;
      }
      let dockerSummary = "";
      if (USE_DOCKER && run.containerId) {
        const diag = await collectDockerDiagnostics(run, run.containerId);
        if (diag?.summary) dockerSummary = diag.summary;
      }
      if (USE_DOCKER && run.containerId) {
        stopDockerLogStream(run);
        try {
          await stopContainer(runId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
          console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
        }
        run.containerId = null;
      }
      const baseMsg = getErrorMessage(err);
      const msg = dockerSummary ? `${baseMsg}\n${dockerSummary}` : baseMsg;
      const displayMsg = normalizeBuildError(baseMsg);
      const displayMsgWithDocker = dockerSummary ? `${displayMsg}\n${dockerSummary}` : displayMsg;
      pushLog(run, `Fehlgeschlagen (exakte Meldung):\n${msg}`);
      if (displayMsg !== msg) {
        pushLog(run, `Hinweis:\n${displayMsgWithDocker}`);
      }
      setFailed(
        displayMsgWithDocker,
        "\n\nWichtig: Dev-Server neu starten (npm run dev mit Ctrl+C beenden, dann erneut starten). Oder USE_DOCKER=1 versuchen (Docker muss laufen).",
        msg,
      );
      console.error(`  Preview failed [${runId}]:`, msg);
    } finally {
      if (run.activeOperationId === operationId) {
        run.activeOperationId = null;
      }
    }
  });
}

/** Refresh: pull, rebuild, restart app on appPort (proxy stays). */
async function refreshAsync(runId) {
  const run = runs.get(runId);
  if (!run || !run.port) return;
  const { repo, branchOrCommit, projectId, proxyPort, appPort } = run;
  const bootMode = resolveBootMode(run.bootMode);
  const bestEffortEnabled = bootMode !== "strict";
  const workspaceDir = getWorkspaceDir(projectId);
  const operationId = `refresh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  run.cancelRequested = false;
  run.activeOperationId = operationId;
  const isActive = () => isRunOperationActive(runId, run, operationId);
  const assertActive = () => assertRunOperationActive(runId, run, operationId);
  run.status = "starting";
  run.logs = [];
  run.readyAt = null;
  pushLog(run, "Refresh gestartet.");

  if (run.containerId) {
    stopDockerLogStream(run);
    try {
      await stopContainer(runId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
      console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
    }
    run.containerId = null;
  }
  if (run.childProcess) {
    await stopChildProcess(run.childProcess);
    run.childProcess = null;
  }

  const useLocalWorkspace = !!getLocalWorkspaceOverride();

  return withWorkspaceLock(projectId, async () => {
    try {
      assertActive();
      if (useLocalWorkspace) {
        pushLog(run, "Lokales Workspace (USE_LOCAL_WORKSPACE): Git-Pull übersprungen.");
      } else {
        pushLog(run, "Git: Pull …");
        await cloneOrPull(repo, branchOrCommit, workspaceDir);
        assertActive();
        pushLog(run, "Git: Pull fertig");
      }
      const rootConfig = getConfig(workspaceDir, workspaceDir);
      const appCandidates = listPreviewCandidates(workspaceDir, rootConfig, 8);
      const appWorkspace = appCandidates[0] ?? resolveAppWorkspaceDir(workspaceDir, rootConfig);
      if (appWorkspace.appDirRelative !== ".") {
        pushLog(
          run,
          `Monorepo erkannt: nutze App-Verzeichnis "${appWorkspace.appDirRelative}" (${appWorkspace.source}).`,
        );
      }

      if (USE_DOCKER) {
        assertActive();
        const dockerOk = await isDockerAvailable();
        assertActive();
        if (!dockerOk) {
          run.status = "failed";
          run.error = "Docker nicht verfügbar (Refresh).";
          pushLog(run, "Fehlgeschlagen: Docker nicht verfügbar");
          return;
        }
        pushLog(run, "Docker: Starte Container …");
        ensurePackageJsonScripts(appWorkspace.appDir);
        let containerName;
        try {
          containerName = await runContainer(appWorkspace.appDir, appPort, runId);
        } catch (dockerErr) {
          const errMsg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
          const isPortAllocated = /port is already allocated|Bind for .* failed/i.test(errMsg);
          if (isPortAllocated) {
            releasePort(proxyPort);
            if (appPort !== proxyPort) releasePort(appPort);
            const retryPorts = await getTwoFreePorts();
            if (retryPorts) {
              const [newProxyPort, newAppPort] = retryPorts;
              if (run.proxyServer) {
                run.proxyServer.close();
                portServers.delete(run.proxyPort);
                run.proxyServer = null;
              }
              run.proxyPort = newProxyPort;
              run.appPort = newAppPort;
              run.port = newProxyPort;
              run.previewUrl = resolvePreviewUrl(newProxyPort);
              pushLog(
                run,
                `Port war belegt, neues Paar: Proxy ${newProxyPort}, App ${newAppPort}. Starte Container erneut …`,
              );
              containerName = await runContainer(appWorkspace.appDir, newAppPort, runId);
              const proxyServer = await createFrameProxy(run.proxyPort, run.appPort);
              run.proxyServer = proxyServer;
              portServers.set(run.proxyPort, proxyServer);
            } else {
              throw dockerErr;
            }
          } else {
            throw dockerErr;
          }
        }
        run.containerId = containerName;
        run.dockerLogStreamProcess =
          streamContainerLogs(containerName, (msg) => pushLog(run, msg)) ?? undefined;
        const startupMonitor = createDockerStartupMonitor(run, containerName);
        assertActive();
        pushLog(
          run,
          `Warte auf App (Timeout ${Math.floor(PREVIEW_DOCKER_READY_TIMEOUT_MS / 1000)}s) …`,
        );
        await waitForAppReady(
          run.appPort,
          PREVIEW_DOCKER_READY_TIMEOUT_MS,
          () => !isActive(),
          startupMonitor,
        );
        assertActive();
        pushLog(run, "Bereit");
        run.status = "ready";
        run.readyAt = new Date().toISOString();
        run.error = null;
        run.degraded = false;
        console.log(`  Preview refreshed (Docker): http://localhost:${proxyPort}`);
        return;
      }

      const bootResult = await bootPreviewByCandidates({
        run,
        runId,
        workspaceDir,
        appPort,
        bestEffortEnabled,
        candidates: appCandidates,
        shouldAbort: () => !isActive(),
      });
      if (!bootResult.success) {
        if (bootResult.aborted) return;
        throw new Error(bootResult.error);
      }
      assertActive();
      if (bootResult.candidate) {
        pushLog(run, `Aktiver Kandidat: ${describeCandidate(bootResult.candidate)}`);
      }
      if (!bootResult.degraded) {
        pushLog(run, "Bereit");
      }
      run.status = "ready";
      run.readyAt = new Date().toISOString();
      run.error = null;
      run.degraded = bootResult.degraded === true;
      console.log(
        `  Preview refreshed${run.degraded ? " (best-effort)" : ""}: http://localhost:${proxyPort}`,
      );
    } catch (err) {
      if (isRunAbortError(err) || !isActive()) {
        if (USE_DOCKER && run.containerId) {
          stopDockerLogStream(run);
          try {
            await stopContainer(runId);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
            console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
          }
          run.containerId = null;
        }
        return;
      }
      let dockerSummary = "";
      if (USE_DOCKER && run.containerId) {
        const diag = await collectDockerDiagnostics(run, run.containerId);
        if (diag?.summary) dockerSummary = diag.summary;
      }
      if (USE_DOCKER && run.containerId) {
        stopDockerLogStream(run);
        try {
          await stopContainer(runId);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
          console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
        }
        run.containerId = null;
      }
      const baseMsg = getErrorMessage(err);
      const msg = dockerSummary ? `${baseMsg}\n${dockerSummary}` : baseMsg;
      run.status = "failed";
      run.error = sanitizeDiagnosticText(msg);
      run.degraded = false;
      pushLog(run, `Fehlgeschlagen (exakte Meldung):\n${msg}`);
      console.error(`  Refresh failed [${runId}]:`, msg);
    } finally {
      if (run.activeOperationId === operationId) {
        run.activeOperationId = null;
      }
    }
  });
}

/** Auto-Refresh: alle N Sekunden prüfen, ob Repo neue Commits hat; bei Bedarf pull + rebuild + restart. */
let autoRefreshTimer = null;
function startAutoRefresh() {
  if (autoRefreshTimer != null || (!USE_REAL_BUILD && !USE_DOCKER) || AUTO_REFRESH_INTERVAL_MS <= 0)
    return;
  autoRefreshTimer = setInterval(async () => {
    for (const [runId, run] of runs) {
      if (run.status !== "ready" || !run.port) continue;
      try {
        const workspaceDir = getWorkspaceDir(run.projectId);
        if (await hasNewCommits(workspaceDir, run.branchOrCommit)) {
          console.log(`  Auto-Refresh [${runId}]: neue Commits, starte Refresh …`);
          await refreshAsync(runId);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`  Auto-Refresh [${runId}] fehlgeschlagen: ${msg}`);
      }
    }
  }, AUTO_REFRESH_INTERVAL_MS);
  console.log(`  Auto-Refresh: alle ${AUTO_REFRESH_INTERVAL_MS / 1000}s auf neue Commits prüfen`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    const maxBytes = 1024 * 1024;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        const err = new Error("Request body too large");
        err.statusCode = 413;
        reject(err);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        const err = new Error("Invalid JSON body");
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function corsPreflight(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VisuDev-Project-Token",
    "Access-Control-Max-Age": "600",
  });
  res.end();
}

async function handleStart(req, res, _url) {
  pruneStoppedRuns();
  const body = await parseBody(req);
  const {
    repo,
    branchOrCommit = "main",
    projectId,
    commitSha,
    bootMode: requestedBootMode,
    injectSupabasePlaceholders: requestedInjectSupabasePlaceholders,
  } = body;
  const normalizedRepo = normalizeRepoInput(repo);
  const normalizedProjectId = normalizeProjectIdValue(projectId);
  const normalizedBranchOrCommit = normalizeBranchOrCommitInput(branchOrCommit);
  const requestProjectToken = readProjectTokenFromRequest(req);
  if (!normalizedRepo || !normalizedProjectId || !normalizedBranchOrCommit) {
    send(res, 400, {
      success: false,
      error:
        "Invalid start request. Expected repo=owner/repo, projectId=[A-Za-z0-9_-]{1,64}, branchOrCommit with safe git ref chars.",
    });
    return;
  }
  const tokenResult = resolveProjectTokenForStart(normalizedProjectId, requestProjectToken);
  if (!tokenResult.ok) {
    send(res, tokenResult.statusCode, { success: false, error: tokenResult.error });
    return;
  }

  const reusable = selectReusableProjectRun(normalizedProjectId, tokenResult.token);
  if (reusable) {
    const selectedRun = reusable.selected.run;
    const selectedRunId = reusable.selected.runId;
    if (reusable.duplicates.length > 0) {
      for (const duplicate of reusable.duplicates) {
        // Keep exactly one active run per project to avoid indefinite "starting" queues.
        // eslint-disable-next-line no-await-in-loop
        await stopRun(duplicate.runId, duplicate.run);
      }
      pushLog(
        selectedRun,
        `Hinweis: ${reusable.duplicates.length} duplizierte Preview-Run(s) wurden automatisch gestoppt.`,
      );
    }
    pushLog(
      selectedRun,
      `Start erneut angefordert – aktiven Run wiederverwendet (${selectedRunId}, Status: ${selectedRun.status}).`,
    );
    send(res, 200, {
      success: true,
      runId: selectedRunId,
      projectToken: tokenResult.token,
      status: selectedRun.status,
      reusedExistingRun: true,
      previewUrl: selectedRun.previewUrl ?? undefined,
    });
    return;
  }

  const staleFailed = listActiveProjectRuns(normalizedProjectId, tokenResult.token).filter(
    (entry) => entry.run.status === "failed",
  );
  for (const entry of staleFailed) {
    // Remove failed leftovers so a fresh start gets clean ports/workspace context.
    // eslint-disable-next-line no-await-in-loop
    await stopRun(entry.runId, entry.run);
  }

  let proxyPort, appPort;
  if (USE_REAL_BUILD || USE_DOCKER) {
    const ports = await getTwoFreePorts();
    if (ports === null) {
      send(res, 503, {
        success: false,
        error: "No free port pair in pool (PREVIEW_PORT_MIN–PREVIEW_PORT_MAX)",
      });
      return;
    }
    [proxyPort, appPort] = ports;
  } else {
    const single = await getNextFreePort();
    if (single === null) {
      send(res, 503, {
        success: false,
        error: "No free port in pool (PREVIEW_PORT_MIN–PREVIEW_PORT_MAX)",
      });
      return;
    }
    proxyPort = single;
    appPort = single;
  }

  const previewUrl = resolvePreviewUrl(proxyPort);

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const commitShaTrimmed =
    commitSha && /^[a-f0-9]{40}$/i.test(String(commitSha).trim()) ? String(commitSha).trim() : null;
  runs.set(runId, {
    status: "starting",
    port: proxyPort,
    proxyPort,
    appPort,
    previewUrl,
    error: null,
    startedAt: new Date().toISOString(),
    repo: normalizedRepo,
    branchOrCommit: normalizedBranchOrCommit,
    projectId: normalizedProjectId,
    commitSha: commitShaTrimmed,
    projectToken: tokenResult.token,
    childProcess: null,
    proxyServer: null,
    logs: [],
    activeOperationId: null,
    cancelRequested: false,
    degraded: false,
    bootMode: resolveBootMode(requestedBootMode),
    injectSupabasePlaceholders: resolveInjectSupabasePlaceholders(
      requestedInjectSupabasePlaceholders,
    ),
  });
  const newRun = runs.get(runId);
  if (newRun) {
    pushLog(
      newRun,
      `Start angefordert (${normalizedRepo} @ ${normalizedBranchOrCommit}). Run: ${runId}`,
    );
    if (USE_REAL_BUILD || USE_DOCKER) {
      pushLog(newRun, "Run ist in der Build/Start-Warteschlange …");
    }
  }

  if (USE_REAL_BUILD || USE_DOCKER) {
    buildAndStartAsync(runId);
  } else {
    startPlaceholderServer(proxyPort);
    setTimeout(() => {
      const run = runs.get(runId);
      if (run && run.status === "starting") {
        run.status = "ready";
        run.readyAt = new Date().toISOString();
      }
    }, SIMULATE_DELAY_MS);
  }

  send(res, 200, {
    success: true,
    runId,
    projectToken: tokenResult.token,
    status: "starting",
    reusedExistingRun: false,
  });
}

function handleStatus(req, res, url) {
  const match = url.pathname.match(/^\/status\/([^/]+)$/);
  const runId = match ? normalizeRunIdValue(decodeURIComponent(match[1])) : null;
  if (!runId) {
    send(res, 400, { success: false, error: "Invalid runId" });
    return;
  }

  const run = runs.get(runId);
  if (!run) {
    // Run not found (e.g. runner restarted): return 200 idle so frontend gets no 404 and can clear runId
    send(res, 200, { success: true, status: "idle" });
    return;
  }
  const access = ensureRunAccess(run, readProjectTokenFromRequest(req));
  if (!access.ok) {
    send(res, access.statusCode, { success: false, error: access.error });
    return;
  }

  send(res, 200, {
    success: true,
    runId,
    status: run.status,
    previewUrl: run.previewUrl ?? undefined,
    error: run.error ?? undefined,
    degraded: run.degraded === true,
    bootMode: run.bootMode ?? PREVIEW_BOOT_MODE_DEFAULT,
    startedAt: run.startedAt,
    readyAt: run.readyAt,
    logs: run.logs || [],
  });
}

async function handleStop(req, res, url) {
  const match = url.pathname.match(/^\/stop\/([^/]+)$/);
  const runId = match ? normalizeRunIdValue(decodeURIComponent(match[1])) : null;
  if (!runId) {
    send(res, 400, { success: false, error: "Invalid runId" });
    return;
  }

  const run = runs.get(runId);
  if (!run) {
    send(res, 404, { success: false, error: "Run not found" });
    return;
  }
  const access = ensureRunAccess(run, readProjectTokenFromRequest(req));
  if (!access.ok) {
    send(res, access.statusCode, { success: false, error: access.error });
    return;
  }

  await stopRun(runId, run);
  send(res, 200, {
    success: true,
    runId,
    status: "stopped",
  });
}

async function stopRun(runId, run) {
  if (!run || run.status === "stopped") {
    pruneStoppedRuns();
    return;
  }
  run.cancelRequested = true;
  run.activeOperationId = null;
  pushLog(run, "Run wurde gestoppt.");

  if (run.containerId) {
    stopDockerLogStream(run);
    try {
      await stopContainer(runId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      pushLog(run, `Docker-Stop fehlgeschlagen: ${msg}`);
      console.warn(`  stopContainer fehlgeschlagen [${runId}]: ${msg}`);
    }
    run.containerId = null;
  }
  if (run.childProcess) {
    await stopChildProcess(run.childProcess);
    run.childProcess = null;
  }
  if (run.proxyPort != null) {
    releasePort(run.proxyPort);
    run.proxyServer = null;
  } else if (run.port != null) {
    releasePort(run.port);
  }
  if (run.appPort != null && run.appPort !== run.proxyPort) {
    releasePort(run.appPort);
  }
  if (run.port != null && run.port !== run.proxyPort && run.port !== run.appPort) {
    releasePort(run.port);
  }
  run.status = "stopped";
  run.stoppedAt = new Date().toISOString();
  pruneStoppedRuns();
}

async function handleStopProject(req, res, url) {
  const match = url.pathname.match(/^\/stop-project\/([^/]+)$/);
  const projectId = match ? normalizeProjectIdValue(decodeURIComponent(match[1])) : null;
  if (!projectId) {
    send(res, 400, { success: false, error: "Invalid projectId" });
    return;
  }
  const access = ensureProjectAccess(projectId, readProjectTokenFromRequest(req));
  if (!access.ok) {
    send(res, access.statusCode, { success: false, error: access.error });
    return;
  }

  const stoppedRunIds = [];
  for (const [runId, run] of runs) {
    if (String(run.projectId) !== projectId) continue;
    if (run.status === "stopped") continue;
    await stopRun(runId, run);
    stoppedRunIds.push(runId);
  }

  send(res, 200, {
    success: true,
    projectId,
    stopped: stoppedRunIds.length,
    runIds: stoppedRunIds,
  });
}

async function handleHealth(_req, res) {
  pruneStoppedRuns();
  let activeRuns = 0;
  let readyRuns = 0;
  let startingRuns = 0;
  let failedRuns = 0;
  let stoppedRuns = 0;
  let totalRuns = 0;
  for (const [, run] of runs) {
    totalRuns += 1;
    if (run.status === "ready") {
      readyRuns += 1;
      activeRuns += 1;
    } else if (run.status === "starting") {
      startingRuns += 1;
      activeRuns += 1;
    } else if (run.status === "failed") {
      failedRuns += 1;
    } else if (run.status === "stopped") {
      stoppedRuns += 1;
    }
  }
  let dockerAvailable = null;
  if (USE_DOCKER) {
    try {
      dockerAvailable = await isDockerAvailable();
    } catch {
      dockerAvailable = false;
    }
  }
  const mode = USE_DOCKER ? "docker" : USE_REAL_BUILD ? "real" : "stub";
  send(res, 200, {
    ok: true,
    service: "visudev",
    port: runnerPort,
    mode,
    useDocker: USE_DOCKER,
    useRealBuild: USE_REAL_BUILD,
    dockerAvailable,
    startedAt: RUNNER_STARTED_AT,
    uptimeSec: Math.max(0, Math.floor((Date.now() - new Date(RUNNER_STARTED_AT).getTime()) / 1000)),
    activeRuns,
    totalRuns,
    readyRuns,
    startingRuns,
    failedRuns,
    stoppedRuns,
  });
}

function handleRuns(req, res, url) {
  pruneStoppedRuns();
  const includeStopped =
    url.searchParams.get("includeStopped") === "1" ||
    url.searchParams.get("includeStopped") === "true";
  const requestedProjectIdRaw = url.searchParams.get("projectId");
  const requestedProjectId =
    requestedProjectIdRaw == null ? null : normalizeProjectIdValue(requestedProjectIdRaw);
  if (requestedProjectIdRaw != null && !requestedProjectId) {
    send(res, 400, { success: false, error: "Invalid projectId" });
    return;
  }
  const requestToken = readProjectTokenFromRequest(req);
  if (requestedProjectId) {
    const projectAccess = ensureProjectAccess(requestedProjectId, requestToken);
    if (!projectAccess.ok) {
      send(res, projectAccess.statusCode, { success: false, error: projectAccess.error });
      return;
    }
  }

  const runEntries = [];
  for (const [runId, run] of runs) {
    if (requestedProjectId && String(run.projectId) !== requestedProjectId) continue;
    const runAccess = ensureRunAccess(run, requestToken);
    if (!runAccess.ok) continue;
    if (!includeStopped && run.status === "stopped") continue;
    runEntries.push({
      runId,
      projectId: run.projectId,
      repo: run.repo,
      branchOrCommit: run.branchOrCommit,
      status: run.status,
      bootMode: run.bootMode ?? PREVIEW_BOOT_MODE_DEFAULT,
      degraded: run.degraded === true,
      previewUrl: run.previewUrl ?? null,
      startedAt: run.startedAt ?? null,
      readyAt: run.readyAt ?? null,
      stoppedAt: run.stoppedAt ?? null,
    });
  }

  const totals = {
    total: runEntries.length,
    active: runEntries.filter((entry) => entry.status === "starting" || entry.status === "ready")
      .length,
    ready: runEntries.filter((entry) => entry.status === "ready").length,
    starting: runEntries.filter((entry) => entry.status === "starting").length,
    failed: runEntries.filter((entry) => entry.status === "failed").length,
    stopped: runEntries.filter((entry) => entry.status === "stopped").length,
  };

  send(res, 200, {
    success: true,
    runner: {
      port: runnerPort,
      startedAt: RUNNER_STARTED_AT,
      uptimeSec: Math.max(
        0,
        Math.floor((Date.now() - new Date(RUNNER_STARTED_AT).getTime()) / 1000),
      ),
    },
    totals,
    runs: runEntries,
  });
}

async function handleRefresh(req, res) {
  const body = await parseBody(req);
  const runId = normalizeRunIdValue(body.runId);
  const requestedBootMode = body.bootMode;
  const requestedInjectSupabasePlaceholders = body.injectSupabasePlaceholders;
  if (!runId) {
    send(res, 400, { success: false, error: "Invalid runId" });
    return;
  }
  const run = runs.get(runId);
  if (!run) {
    send(res, 404, { success: false, error: "Run not found" });
    return;
  }
  const access = ensureRunAccess(run, readProjectTokenFromRequest(req));
  if (!access.ok) {
    send(res, access.statusCode, { success: false, error: access.error });
    return;
  }
  if (requestedBootMode != null) {
    run.bootMode = resolveBootMode(requestedBootMode);
  }
  if (requestedInjectSupabasePlaceholders != null) {
    run.injectSupabasePlaceholders = resolveInjectSupabasePlaceholders(
      requestedInjectSupabasePlaceholders,
    );
  }
  refreshAsync(runId);
  send(res, 200, { success: true, status: "starting" });
}

/** GitHub Webhook: on push, find runs for repo+branch and auto-refresh (pull + rebuild + restart). */
function handleWebhookGitHub(req, res, rawBody) {
  const sig = req.headers["x-hub-signature-256"];
  if (GITHUB_WEBHOOK_SECRET && sig) {
    const hmac = crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET);
    hmac.update(rawBody);
    const expected = "sha256=" + hmac.digest("hex");
    if (
      expected.length !== sig.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    ) {
      send(res, 401, { error: "Invalid signature" });
      return;
    }
  } else if (GITHUB_WEBHOOK_SECRET && !sig) {
    send(res, 401, { error: "Missing X-Hub-Signature-256" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    send(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (req.headers["x-github-event"] === "ping") {
    send(res, 200, { ok: true, message: "pong" });
    return;
  }

  if (req.headers["x-github-event"] !== "push") {
    send(res, 200, { ok: true, ignored: true });
    return;
  }

  if (payload.repository?.full_name == null) {
    send(res, 400, { error: "Missing repository.full_name" });
    return;
  }

  const repo = payload.repository.full_name;
  let branch = null;
  if (payload.ref && typeof payload.ref === "string" && payload.ref.startsWith("refs/heads/")) {
    branch = payload.ref.slice("refs/heads/".length);
  }

  const refreshed = [];
  for (const [runId, run] of runs) {
    if (run.repo !== repo || run.status !== "ready") continue;
    if (branch != null && run.branchOrCommit !== branch) continue;
    refreshAsync(runId);
    refreshed.push(runId);
  }

  if (refreshed.length > 0) {
    console.log(
      `  Webhook: push to ${repo} ${branch ?? "*"} → refreshed ${refreshed.length} preview(s)`,
    );
  }
  send(res, 200, { ok: true, refreshed: refreshed.length });
}

/** Read raw body from req (for webhook signature verification). */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    corsPreflight(res);
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${runnerPort}`);
  const strippedPath = stripRunnerPrefix(url.pathname);
  url.pathname = strippedPath;
  const pathname = url.pathname;

  const previewMatch = pathname.match(/^\/p\/(\d+)(\/.*)?$/);
  if (previewMatch) {
    const port = Number(previewMatch[1]);
    const rest = previewMatch[2] || "/";
    if (Number.isNaN(port) || port < PREVIEW_PORT_MIN || port > PREVIEW_PORT_MAX) {
      send(res, 400, { error: "Invalid preview port" });
      return;
    }
    proxyPreviewRequest(req, res, port, rest);
    return;
  }

  if (req.method === "POST" && pathname === "/webhook/github") {
    const webhookRateLimit = enforceWriteRateLimit(req, "/webhook/github");
    if (!webhookRateLimit.ok) {
      send(
        res,
        429,
        {
          success: false,
          error: "Rate limit exceeded for write operations. Please retry shortly.",
        },
        { "Retry-After": String(webhookRateLimit.retryAfterSec) },
      );
      return;
    }
    try {
      const rawBody = await readRawBody(req);
      handleWebhookGitHub(req, res, rawBody);
    } catch (e) {
      console.error(e);
      send(res, 500, { success: false, error: e instanceof Error ? e.message : "Internal error" });
    }
    return;
  }

  // Access control: GET /status/:runId, POST /stop/:runId, POST /stop-project/:projectId require
  // header x-visudev-project-token and are validated server-side (ensureRunAccess/ensureProjectAccess).
  // Unauthorized requests receive 401/403. Rate limiting: write endpoints below are rate-limited
  // server-side per client IP (enforceWriteRateLimit); client-side cooldown is UX-only.
  const writeRouteKey =
    req.method === "POST" && pathname === "/start"
      ? "/start"
      : req.method === "POST" && pathname === "/refresh"
        ? "/refresh"
        : req.method === "POST" && pathname.startsWith("/stop-project/")
          ? "/stop-project"
          : req.method === "POST" && pathname.startsWith("/stop/")
            ? "/stop"
            : null;
  if (writeRouteKey) {
    const rateLimit = enforceWriteRateLimit(req, writeRouteKey);
    if (!rateLimit.ok) {
      send(
        res,
        429,
        {
          success: false,
          error: "Rate limit exceeded for write operations. Please retry shortly.",
        },
        { "Retry-After": String(rateLimit.retryAfterSec) },
      );
      return;
    }
  }

  try {
    if (req.method === "GET" && pathname === "/health") {
      await handleHealth(req, res);
      return;
    }
    if (req.method === "GET" && pathname === "/runs") {
      handleRuns(req, res, url);
      return;
    }
    if (req.method === "POST" && pathname === "/start") {
      await handleStart(req, res, url);
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/status/")) {
      handleStatus(req, res, url);
      return;
    }
    if (req.method === "POST" && pathname.startsWith("/stop/")) {
      await handleStop(req, res, url);
      return;
    }
    if (req.method === "POST" && pathname.startsWith("/stop-project/")) {
      await handleStopProject(req, res, url);
      return;
    }
    if (req.method === "POST" && pathname === "/refresh") {
      await handleRefresh(req, res);
      return;
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    const statusCode = Number.isFinite(Number(e?.statusCode)) ? Number(e.statusCode) : 500;
    send(res, statusCode, {
      success: false,
      error: e instanceof Error ? e.message : "Internal error",
    });
  }
});

findFreeRunnerPort().then((actualPort) => {
  if (actualPort == null) {
    console.error(
      `No free port for Runner. Tried: ${RUNNER_PORT_CANDIDATES.join(", ")}. Set PORT=… to try another.`,
    );
    process.exit(1);
  }
  runnerPort = actualPort;
  if (actualPort !== PORT) {
    console.warn(
      `Port ${PORT} in use, using ${actualPort}. Set VITE_PREVIEW_RUNNER_URL=http://localhost:${actualPort} if the app does not find the runner.`,
    );
  }
  server.listen(actualPort, PREVIEW_BIND_HOST, () => {
    console.log(`Preview Runner listening on http://${PREVIEW_BIND_HOST}:${actualPort}`);
    console.log(`  Port pool: ${PREVIEW_PORT_MIN}-${PREVIEW_PORT_MAX} (auto-assigned per run)`);
    console.log(
      `  Mode: ${USE_DOCKER ? "DOCKER (clone, build, serve in container)" : USE_REAL_BUILD ? "REAL (clone, build, start)" : "STUB (placeholder)"}`,
    );
    if (USE_REAL_BUILD && !USE_DOCKER) {
      const defaultBestEffort = resolveBootMode(PREVIEW_BOOT_MODE_DEFAULT) !== "strict";
      console.log(
        `  Default boot mode: ${resolveBootMode(PREVIEW_BOOT_MODE_DEFAULT)} (${defaultBestEffort ? "fallback erlaubt" : "strict"})`,
      );
      console.log(
        `  BUILD_TIMEOUT_MS=${BUILD_TIMEOUT_MS} (${Math.floor(BUILD_TIMEOUT_MS / 1000)}s pro Kandidat)`,
      );
    }
    if (PREVIEW_BASE_URL) {
      console.log(`  PREVIEW_BASE_URL=${PREVIEW_BASE_URL}`);
    }
    if (PREVIEW_PUBLIC_ORIGIN) {
      console.log(`  PREVIEW_PUBLIC_ORIGIN=${PREVIEW_PUBLIC_ORIGIN}`);
    }
    if (PREVIEW_BIND_HOST) {
      console.log(`  PREVIEW_BIND_HOST=${PREVIEW_BIND_HOST}`);
    }
    if (USE_DOCKER) {
      console.log(
        `  PREVIEW_DOCKER_READY_TIMEOUT_MS=${PREVIEW_DOCKER_READY_TIMEOUT_MS} (${Math.floor(PREVIEW_DOCKER_READY_TIMEOUT_MS / 1000)}s)`,
      );
      console.log(`  PREVIEW_DOCKER_LOG_TAIL=${PREVIEW_DOCKER_LOG_TAIL}`);
    }
    if (!USE_REAL_BUILD && !USE_DOCKER) {
      console.log(`  SIMULATE_DELAY_MS=${SIMULATE_DELAY_MS}`);
    }
    if (GITHUB_WEBHOOK_SECRET) {
      console.log(`  GitHub Webhook: POST /webhook/github (Signature verified)`);
    } else {
      console.log(`  GitHub Webhook: POST /webhook/github (set GITHUB_WEBHOOK_SECRET to verify)`);
    }
    startAutoRefresh();
  });
});
