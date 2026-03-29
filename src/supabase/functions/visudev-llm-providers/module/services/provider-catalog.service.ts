import type { LlmProviderAdapter, LlmProviderId } from "../dto/index.ts";

export interface ProviderCatalogEntry {
  id: LlmProviderId;
  displayName: string;
  adapter: LlmProviderAdapter;
  docsUrl: string;
  baseUrl: string;
}

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
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
];

export class ProviderCatalogService {
  public list(): ProviderCatalogEntry[] {
    return [...PROVIDER_CATALOG];
  }

  public get(providerId: LlmProviderId): ProviderCatalogEntry {
    const entry = PROVIDER_CATALOG.find((provider) =>
      provider.id === providerId
    );
    if (!entry) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return entry;
  }
}
