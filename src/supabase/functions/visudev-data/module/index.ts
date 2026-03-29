import type { Hono } from "hono";
import type { DataModuleConfig } from "./interfaces/module.interface.ts";
import { initModuleServices } from "./services/base.service.ts";
import { DataRepository } from "./internal/repositories/data.repository.ts";
import { DataService } from "./services/data.service.ts";
import { DataController } from "./controllers/data.controller.ts";
import { registerDataRoutes } from "./routes/data.routes.ts";

export function createDataModule(config: DataModuleConfig): {
  registerRoutes: (app: Hono) => void;
  controller: DataController;
  service: DataService;
  repository: DataRepository;
} {
  initModuleServices(config);

  const repository = new DataRepository();
  const service = new DataService(repository, config);
  const controller = new DataController(service, config);

  return {
    registerRoutes: (app: Hono): void => registerDataRoutes(app, controller),
    controller,
    service,
    repository,
  };
}

export type { DataModuleConfig } from "./interfaces/module.interface.ts";
export * from "./dto/index.ts";
