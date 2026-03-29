import type {
  LlmProviderId,
  LlmProviderModelDto,
  LlmProviderTestResultDto,
} from "../dto/index.ts";
import {
  ExternalApiException,
  ValidationException,
} from "../internal/exceptions/index.ts";
import { ProviderCatalogService } from "./provider-catalog.service.ts";

interface OpenAiCompatibleResponse {
  data?: Array<{ id?: string }>;
}

interface GeminiModelsResponse {
  models?: Array<{ name?: string }>;
}

const ANTHROPIC_MODELS: LlmProviderModelDto[] = [
  {
    id: "claude-3-5-haiku-latest",
    label: "claude-3-5-haiku-latest",
    source: "live",
  },
  {
    id: "claude-3-7-sonnet-latest",
    label: "claude-3-7-sonnet-latest",
    source: "live",
  },
];

export class ProviderClientService {
  constructor(private readonly catalog: ProviderCatalogService) {}

  public async testProvider(
    providerId: LlmProviderId,
    apiKey: string,
  ): Promise<LlmProviderTestResultDto> {
    const entry = this.catalog.get(providerId);

    if (entry.adapter === "anthropic-native") {
      return await this.testAnthropic(entry.baseUrl, apiKey);
    }

    if (entry.adapter === "google-gemini-native") {
      return await this.testGemini(entry.baseUrl, apiKey);
    }

    return await this.testOpenAiCompatible(entry.baseUrl, apiKey);
  }

  private async testOpenAiCompatible(
    baseUrl: string,
    apiKey: string,
  ): Promise<LlmProviderTestResultDto> {
    const response = await fetch(`${this.trimBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const payload = await this.parseResponse<OpenAiCompatibleResponse>(
      response,
    );
    const models = Array.isArray(payload.data)
      ? payload.data
        .map((model) => model.id?.trim())
        .filter((modelId): modelId is string => Boolean(modelId))
        .sort()
        .map((modelId) => ({
          id: modelId,
          label: modelId,
          source: "live" as const,
        }))
      : [];

    return {
      valid: true,
      models,
      status: "valid",
      lastTestedAt: new Date().toISOString(),
    };
  }

  private async testAnthropic(
    baseUrl: string,
    apiKey: string,
  ): Promise<LlmProviderTestResultDto> {
    const response = await fetch(`${this.trimBaseUrl(baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({}),
    });

    if (response.status === 401 || response.status === 403) {
      throw new ValidationException("Ungültiger API-Key.");
    }
    if (!response.ok && response.status !== 400) {
      throw new ExternalApiException(
        `Anthropic API error: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return {
      valid: true,
      models: ANTHROPIC_MODELS,
      status: "valid",
      lastTestedAt: new Date().toISOString(),
    };
  }

  private async testGemini(
    baseUrl: string,
    apiKey: string,
  ): Promise<LlmProviderTestResultDto> {
    const response = await fetch(
      `${this.trimBaseUrl(baseUrl)}/models?key=${encodeURIComponent(apiKey)}`,
    );

    const payload = await this.parseResponse<GeminiModelsResponse>(response);
    const models = Array.isArray(payload.models)
      ? payload.models
        .map((model) => model.name?.replace("models/", "").trim())
        .filter((modelId): modelId is string =>
          Boolean(modelId) && modelId.includes("gemini")
        )
        .sort()
        .map((modelId) => ({
          id: modelId,
          label: modelId,
          source: "live" as const,
        }))
      : [];

    return {
      valid: true,
      models,
      status: "valid",
      lastTestedAt: new Date().toISOString(),
    };
  }

  private trimBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 401 || response.status === 403) {
      throw new ValidationException("Ungültiger API-Key.");
    }

    if (!response.ok) {
      throw new ExternalApiException(
        `Provider API error: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    return await response.json() as T;
  }
}
