#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Startet den Logs Runner (Health + später OTLP/Log-Ingest).
 * Wird von dev-auto.js mit gesetztem PORT aufgerufen.
 */
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const runnerDir = path.join(projectRoot, "logs-runner");
const runnerPath = path.join(runnerDir, "index.js");

const child = spawn(process.execPath, [runnerPath], {
  cwd: runnerDir,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
