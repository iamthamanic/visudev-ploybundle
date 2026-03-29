import type { Context } from "hono";
import type {
  LlmProviderId,
  LlmProviderSettingsDto,
  LlmProviderStateDto,
  LlmProviderTestResultDto,
} from "../dto/index.ts";
import {
  NotFoundException,
  UnauthorizedException,
  ValidationException,
} from "../internal/exceptions/index.ts";
import {
  LlmProvidersRepository,
  type StoredLlmProviderRecord,
} from "../internal/repositories/llm-providers.repository.ts";
import { BaseService } from "./base.service.ts";
import { ProviderCatalogService } from "./provider-catalog.service.ts";
import { ProviderClientService } from "./provider-client.service.ts";

const DEFAULT_SETTINGS: LlmProviderSettingsDto = {
  allowLlmForEscalations: true,
};

function maskApiKey(apiKey: string): string {
  const suffix = apiKey.slice(-4);
  return suffix ? `••••${suffix}` : "••••";
}

export class LlmProvidersService extends BaseService {
  private readonly catalog = new ProviderCatalogService();
  private readonly client = new ProviderClientService(this.catalog);

  constructor(private readonly repository: LlmProvidersRepository) {
    super();
  }

  public async listProviders(userId: string): Promise<LlmProviderStateDto[]> {
    const catalogEntries = this.catalog.list();
    const records = await Promise.all(
      catalogEntries.map((entry) =>
        this.repository.getProvider(userId, entry.id)
      ),
    );

    return catalogEntries.map((entry, index) =>
      this.toState(entry.id, records[index])
    );
  }

  public async getSettings(userId: string): Promise<LlmProviderSettingsDto> {
    return (await this.repository.getSettings(userId)) ?? DEFAULT_SETTINGS;
  }

  public async updateSettings(
    userId: string,
    patch: Partial<LlmProviderSettingsDto>,
  ): Promise<LlmProviderSettingsDto> {
    const current = await this.getSettings(userId);
    const next: LlmProviderSettingsDto = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    if (!next.defaultProvider) {
      delete next.defaultModel;
    }

    if (next.defaultProvider) {
      const provider = await this.repository.getProvider(
        userId,
        next.defaultProvider,
      );
      if (!provider?.apiKey) {
        throw new ValidationException(
          "Der gewählte Standard-Provider ist nicht konfiguriert.",
        );
      }
      if (
        next.defaultModel &&
        !provider.models.some((model) => model.id === next.defaultModel)
      ) {
        throw new ValidationException(
          "Das Standard-Modell ist für diesen Provider nicht verfügbar.",
        );
      }
    }

    return await this.repository.saveSettings(userId, next);
  }

  public async testProvider(
    userId: string,
    providerId: LlmProviderId,
    apiKey?: string,
  ): Promise<LlmProviderTestResultDto> {
    const stored = await this.repository.getProvider(userId, providerId);
    const resolvedApiKey = apiKey?.trim() || stored?.apiKey;
    if (!resolvedApiKey) {
      throw new ValidationException(
        "Bitte zuerst einen API-Key eingeben oder speichern.",
      );
    }
    return await this.client.testProvider(providerId, resolvedApiKey);
  }

  public async saveProviderKey(
    userId: string,
    providerId: LlmProviderId,
    apiKey: string,
    selectedModel?: string,
  ): Promise<LlmProviderStateDto> {
    const tested = await this.client.testProvider(providerId, apiKey);
    const chosenModel = this.resolveSelectedModel(selectedModel, tested.models);
    const now = new Date().toISOString();

    await this.repository.saveProvider(userId, providerId, {
      providerId,
      apiKey,
      maskedKey: maskApiKey(apiKey),
      selectedModel: chosenModel,
      models: tested.models,
      lastTestedAt: tested.lastTestedAt,
      status: tested.status,
      updatedAt: now,
    });

    return this.toState(
      providerId,
      await this.repository.getProvider(userId, providerId),
    );
  }

  public async saveProviderSelection(
    userId: string,
    providerId: LlmProviderId,
    selectedModel: string,
  ): Promise<LlmProviderStateDto> {
    const stored = await this.repository.getProvider(userId, providerId);
    if (!stored?.apiKey) {
      throw new NotFoundException("LLM provider");
    }
    if (!stored.models.some((model) => model.id === selectedModel)) {
      throw new ValidationException(
        "Das gewählte Modell ist für diesen Provider nicht verfügbar.",
      );
    }

    const updated: StoredLlmProviderRecord = {
      ...stored,
      selectedModel,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.saveProvider(userId, providerId, updated);
    return this.toState(providerId, updated);
  }

  public async listProviderModels(
    userId: string,
    providerId: LlmProviderId,
  ) {
    const stored = await this.repository.getProvider(userId, providerId);
    return stored?.models ?? [];
  }

  public async deleteProviderKey(
    userId: string,
    providerId: LlmProviderId,
  ): Promise<void> {
    await this.repository.deleteProvider(userId, providerId);
    const settings = await this.getSettings(userId);
    if (settings.defaultProvider === providerId) {
      await this.repository.saveSettings(userId, {
        ...settings,
        defaultProvider: undefined,
        defaultModel: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  public getAuthUserIdFromContext(c: Context): string {
    const userId = c.get("userId");
    if (typeof userId !== "string" || userId.length === 0) {
      throw new UnauthorizedException();
    }
    return userId;
  }

  private toState(
    providerId: LlmProviderId,
    stored: StoredLlmProviderRecord | null,
  ): LlmProviderStateDto {
    const catalogEntry = this.catalog.get(providerId);
    return {
      providerId,
      displayName: catalogEntry.displayName,
      adapter: catalogEntry.adapter,
      docsUrl: catalogEntry.docsUrl,
      baseUrl: catalogEntry.baseUrl,
      hasKey: Boolean(stored?.apiKey),
      maskedKey: stored?.maskedKey,
      selectedModel: stored?.selectedModel,
      models: stored?.models ?? [],
      lastTestedAt: stored?.lastTestedAt,
      status: stored?.status ?? "missing",
      updatedAt: stored?.updatedAt,
    };
  }

  private resolveSelectedModel(
    selectedModel: string | undefined,
    models: { id: string }[],
  ): string | undefined {
    if (!selectedModel) {
      return models[0]?.id;
    }
    if (!models.some((model) => model.id === selectedModel)) {
      throw new ValidationException(
        "Das gewählte Modell wurde vom Provider nicht geliefert.",
      );
    }
    return selectedModel;
  }
}
