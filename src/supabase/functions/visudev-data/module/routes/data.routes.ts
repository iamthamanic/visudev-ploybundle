import type { Hono } from "hono";
import type { DataController } from "../controllers/data.controller.ts";
import { asyncHandler } from "../internal/middleware/async-handler.ts";

export function registerDataRoutes(
  app: Hono,
  controller: DataController,
): void {
  app.get(
    "/:projectId/schema",
    asyncHandler(controller.getSchema.bind(controller)),
  );
  app.put(
    "/:projectId/schema",
    asyncHandler(controller.updateSchema.bind(controller)),
  );

  app.get(
    "/:projectId/migrations",
    asyncHandler(controller.getMigrations.bind(controller)),
  );
  app.put(
    "/:projectId/migrations",
    asyncHandler(controller.updateMigrations.bind(controller)),
  );

  app.get("/:projectId/erd", asyncHandler(controller.getErd.bind(controller)));
  app.put(
    "/:projectId/erd",
    asyncHandler(controller.updateErd.bind(controller)),
  );
  app.post(
    "/:projectId/erd/sync",
    asyncHandler(controller.syncErd.bind(controller)),
  );
}
