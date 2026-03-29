import type { Hono } from "hono";
import type { LlmProvidersController } from "../controllers/llm-providers.controller.ts";
import { asyncHandler } from "../internal/middleware/async-handler.ts";

export function registerLlmProvidersRoutes(
  app: Hono,
  controller: LlmProvidersController,
): void {
  app.get(
    "/providers",
    asyncHandler(controller.listProviders.bind(controller)),
  );
  app.get("/settings", asyncHandler(controller.getSettings.bind(controller)));
  app.put(
    "/settings",
    asyncHandler(controller.updateSettings.bind(controller)),
  );
  app.post(
    "/providers/:providerId/test",
    asyncHandler(controller.testProvider.bind(controller)),
  );
  app.put(
    "/providers/:providerId/key",
    asyncHandler(controller.saveProviderKey.bind(controller)),
  );
  app.delete(
    "/providers/:providerId/key",
    asyncHandler(controller.deleteProviderKey.bind(controller)),
  );
  app.get(
    "/providers/:providerId/models",
    asyncHandler(controller.getProviderModels.bind(controller)),
  );
  app.put(
    "/providers/:providerId/selection",
    asyncHandler(controller.saveProviderSelection.bind(controller)),
  );
}
