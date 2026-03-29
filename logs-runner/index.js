#!/usr/bin/env node
/**
 * VisuDEV Logs Runner
 *
 * Minimal HTTP server for the Logs tab: GET /health for status badge.
 * Later: OTLP ingest, log drain endpoints. Started via npm run dev (with Preview Runner).
 */

import http from "node:http";

const PORT = Number(process.env.PORT) || 5000;
const STARTED_AT = new Date().toISOString();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "visudev-logs-runner",
        port: PORT,
        startedAt: STARTED_AT,
        uptimeSec: Math.max(0, Math.floor((Date.now() - new Date(STARTED_AT).getTime()) / 1000)),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[visudev-logs-runner] Listening on http://127.0.0.1:${PORT}`);
});

server.on("error", (err) => {
  console.error("[visudev-logs-runner] Server error:", err.message);
  process.exit(1);
});
