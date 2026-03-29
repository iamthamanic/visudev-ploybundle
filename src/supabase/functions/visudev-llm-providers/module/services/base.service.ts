import type {
  LlmProvidersModuleConfig,
  LoggerLike,
} from "../interfaces/module.interface.ts";

let moduleDeps: LlmProvidersModuleConfig | null = null;

export function initModuleServices(deps: LlmProvidersModuleConfig): void {
  moduleDeps = deps;
}

export function getModuleDeps(): LlmProvidersModuleConfig {
  if (!moduleDeps) {
    throw new Error(
      "[visudev-llm-providers] Services not initialized. Call initModuleServices() first.",
    );
  }
  return moduleDeps;
}

export abstract class BaseService {
  protected readonly supabase = getModuleDeps().supabase;
  protected readonly logger: LoggerLike = getModuleDeps().logger;
  protected readonly config = getModuleDeps().config;
}
