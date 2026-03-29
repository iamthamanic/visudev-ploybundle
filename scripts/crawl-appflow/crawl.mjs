#!/usr/bin/env node

import fs from "node:fs";
import { runRuntimeCrawl } from "../../preview-runner/runtime-crawl.js";

function readArg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function printUsage() {
  process.stdout.write(
    "Usage: node scripts/crawl-appflow/crawl.mjs --baseUrl <url> --screens '<json>' [--out result.json]\n",
  );
}

const baseUrl = readArg("baseUrl");
const screensArg = readArg("screens");
const outPath = readArg("out");

if (process.argv.includes("--help") || !baseUrl || !screensArg) {
  printUsage();
  process.exit(baseUrl && screensArg ? 0 : 1);
}

let screens;
try {
  screens = JSON.parse(screensArg);
} catch (error) {
  process.stderr.write(
    `Invalid --screens JSON: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

const result = await runRuntimeCrawl({ baseUrl, screens });
const payload = JSON.stringify(result, null, 2);

if (outPath) {
  fs.writeFileSync(outPath, payload);
  process.stdout.write(`${outPath}\n`);
} else {
  process.stdout.write(`${payload}\n`);
}
