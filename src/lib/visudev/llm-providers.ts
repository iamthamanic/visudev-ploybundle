export const LLM_PROVIDER_CATALOG = [
  {
    id: "openai",
    displayName: "OpenAI",
    adapter: "openai-compatible",
    docsUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    adapter: "anthropic-native",
    docsUrl: "https://console.anthropic.com/settings/keys",
    baseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "gemini",
    displayName: "Gemini",
    adapter: "google-gemini-native",
    docsUrl: "https://aistudio.google.com/app/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    id: "ollama-cloud",
    displayName: "Ollama Cloud",
    adapter: "openai-compatible",
    docsUrl: "",
    baseUrl: "https://ollama.com/api/openai/v1",
  },
  {
    id: "moonshot",
    displayName: "Moonshot AI",
    adapter: "openai-compatible",
    docsUrl: "https://platform.moonshot.ai/console/api-keys",
    baseUrl: "https://api.moonshot.ai/v1",
  },
  {
    id: "z-ai",
    displayName: "z.ai",
    adapter: "openai-compatible",
    docsUrl: "",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    adapter: "openai-compatible",
    docsUrl: "https://platform.deepseek.com/api_keys",
    baseUrl: "https://api.deepseek.com/v1",
  },
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_CATALOG)[number]["id"];
export type LlmProviderAdapter = (typeof LLM_PROVIDER_CATALOG)[number]["adapter"];

export interface LlmProviderCatalogEntry {
  id: LlmProviderId;
  displayName: string;
  adapter: LlmProviderAdapter;
  docsUrl: string;
  baseUrl: string;
}

export interface LlmProviderModel {
  id: string;
  label: string;
  source: "live" | "cached";
}

export interface LlmProviderState {
  providerId: LlmProviderId;
  displayName: string;
  adapter: LlmProviderAdapter;
  docsUrl: string;
  baseUrl: string;
  hasKey: boolean;
  maskedKey?: string;
  selectedModel?: string;
  models: LlmProviderModel[];
  lastTestedAt?: string;
  status: "missing" | "untested" | "valid" | "invalid";
  updatedAt?: string;
}

export interface LlmProviderTestResult {
  valid: boolean;
  models: LlmProviderModel[];
  status: LlmProviderState["status"];
  lastTestedAt: string;
}

export interface LlmProviderSettings {
  defaultProvider?: LlmProviderId;
  defaultModel?: string;
  allowLlmForEscalations: boolean;
  updatedAt?: string;
}

export function buildEmptyLlmProviderState(entry: LlmProviderCatalogEntry): LlmProviderState {
  return {
    providerId: entry.id,
    displayName: entry.displayName,
    adapter: entry.adapter,
    docsUrl: entry.docsUrl,
    baseUrl: entry.baseUrl,
    hasKey: false,
    models: [],
    status: "missing",
  };
}
