import type { Hono } from "hono";
import type { LlmProvidersModuleConfig } from "./interfaces/module.interface.ts";
import { LlmProvidersController } from "./controllers/llm-providers.controller.ts";
import { LlmProvidersRepository } from "./internal/repositories/llm-providers.repository.ts";
import { registerLlmProvidersRoutes } from "./routes/llm-providers.routes.ts";
import { initModuleServices } from "./services/base.service.ts";
import { LlmProvidersService } from "./services/llm-providers.service.ts";

export function createLlmProvidersModule(config: LlmProvidersModuleConfig): {
  registerRoutes: (app: Hono) => void;
  controller: LlmProvidersController;
  service: LlmProvidersService;
  repository: LlmProvidersRepository;
} {
  initModuleServices(config);

  const repository = new LlmProvidersRepository();
  const service = new LlmProvidersService(repository);
  const controller = new LlmProvidersController(service);

  return {
    registerRoutes: (app: Hono): void =>
      registerLlmProvidersRoutes(app, controller),
    controller,
    service,
    repository,
  };
}

export type { LlmProvidersModuleConfig } from "./interfaces/module.interface.ts";
export * from "./dto/index.ts";
