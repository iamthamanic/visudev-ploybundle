export const PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "ollama-cloud",
  "moonshot",
  "z-ai",
  "deepseek",
] as const;

export type LlmProviderId = (typeof PROVIDER_IDS)[number];
export type LlmProviderAdapter =
  | "openai-compatible"
  | "anthropic-native"
  | "google-gemini-native";
export type LlmProviderStatus = "missing" | "untested" | "valid" | "invalid";

export interface LlmProviderModelDto {
  id: string;
  label: string;
  source: "live" | "cached";
}

export interface LlmProviderStateDto {
  providerId: LlmProviderId;
  displayName: string;
  adapter: LlmProviderAdapter;
  docsUrl: string;
  baseUrl: string;
  hasKey: boolean;
  maskedKey?: string;
  selectedModel?: string;
  models: LlmProviderModelDto[];
  lastTestedAt?: string;
  status: LlmProviderStatus;
  updatedAt?: string;
}

export interface LlmProviderSettingsDto {
  defaultProvider?: LlmProviderId;
  defaultModel?: string;
  allowLlmForEscalations: boolean;
  updatedAt?: string;
}

export interface SaveProviderKeyDto {
  apiKey: string;
  selectedModel?: string;
}

export interface SaveProviderSelectionDto {
  selectedModel: string;
}

export interface TestProviderDto {
  apiKey?: string;
}

export interface LlmProviderTestResultDto {
  valid: boolean;
  models: LlmProviderModelDto[];
  status: LlmProviderStatus;
  lastTestedAt: string;
}
