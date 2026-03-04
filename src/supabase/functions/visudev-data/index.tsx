/**
 * VisuDEV Edge Function: Data (DDD/DI Refactor)
 *
 * @version 2.0.0
 * @description Database schema, ERD, and migrations management API.
 * IDOR: All routes are project-scoped; middleware enforces project ownership (JWT must match project.ownerId).
 */

import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@jsr/supabase__supabase-js";
import { createDataModule } from "./module/index.ts";
import type { LoggerLike } from "./module/interfaces/module.interface.ts";
import { ModuleException } from "./module/internal/exceptions/index.ts";
import type { ErrorResponse } from "./module/types/index.ts";

interface EnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  kvTableName: string;
}

const app = new Hono().basePath("/visudev-data");

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

const logger: LoggerLike = createLogger();
const env = loadEnvConfig(logger);

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

async function getUserIdOptional(c: Context): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch (e) {
    logger.warn("auth.getUser failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function getProjectOwnerId(projectId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(env.kvTableName)
    .select("value")
    .eq("key", `project:${projectId}`)
    .maybeSingle();
  if (error) return null;
  const value = data?.value as { ownerId?: string } | null;
  return value?.ownerId ?? null;
}

app.use("*", async (c, next) => {
  const projectId = c.req.param("projectId");
  if (!projectId) return next();
  const ownerId = await getProjectOwnerId(projectId);
  const userId = await getUserIdOptional(c);
  if (userId === null) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }
  if (ownerId != null && userId !== ownerId) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }
  return next();
});

const dataModule = createDataModule({
  supabase,
  logger,
  config: { kvTableName: env.kvTableName },
});

dataModule.registerRoutes(app);

app.onError((err, c) => {
  if (err instanceof ModuleException) {
    logger.warn("Request failed", { code: err.code, message: err.message });
    const payload: ErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    return c.json(payload, err.statusCode);
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error("Unhandled error", { message });
  const payload: ErrorResponse = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
    },
  };
  return c.json(payload, 500);
});

Deno.serve(app.fetch);

function createLogger(): LoggerLike {
  const encoder = new TextEncoder();
  const write = (
    stream: "stdout" | "stderr",
    payload: Record<string, unknown>,
  ): void => {
    const line = JSON.stringify(payload);
    const data = encoder.encode(`${line}\n`);
    if (stream === "stderr") {
      Deno.stderr.writeSync(data);
      return;
    }
    Deno.stdout.writeSync(data);
  };

  return {
    info: (message: string, meta?: Record<string, unknown>): void => {
      write("stdout", {
        level: "info",
        message,
        meta,
        ts: new Date().toISOString(),
      });
    },
    warn: (message: string, meta?: Record<string, unknown>): void => {
      write("stderr", {
        level: "warn",
        message,
        meta,
        ts: new Date().toISOString(),
      });
    },
    error: (message: string, meta?: Record<string, unknown>): void => {
      write("stderr", {
        level: "error",
        message,
        meta,
        ts: new Date().toISOString(),
      });
    },
    debug: (message: string, meta?: Record<string, unknown>): void => {
      write("stdout", {
        level: "debug",
        message,
        meta,
        ts: new Date().toISOString(),
      });
    },
  };
}

function loadEnvConfig(loggerInstance: LoggerLike): EnvConfig {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const kvTableName = Deno.env.get("VISUDEV_KV_TABLE") ??
    Deno.env.get("KV_TABLE_NAME") ?? "kv_store_edf036ef";

  if (!Deno.env.get("VISUDEV_KV_TABLE") && !Deno.env.get("KV_TABLE_NAME")) {
    loggerInstance.warn("KV table env not set. Falling back to default.", {
      defaultValue: kvTableName,
    });
  }

  return { supabaseUrl, supabaseServiceRoleKey, kvTableName };
}

function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`${key} environment variable is required`);
  }
  return value;
}
