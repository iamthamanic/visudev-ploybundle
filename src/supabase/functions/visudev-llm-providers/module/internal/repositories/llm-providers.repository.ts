import type {
  LlmProviderId,
  LlmProviderModelDto,
  LlmProviderSettingsDto,
  LlmProviderStatus,
} from "../../dto/index.ts";
import { RepositoryException } from "../exceptions/index.ts";
import { BaseService } from "../../services/base.service.ts";

export interface StoredLlmProviderRecord {
  providerId: LlmProviderId;
  apiKey?: string;
  maskedKey?: string;
  selectedModel?: string;
  models: LlmProviderModelDto[];
  lastTestedAt?: string;
  status: LlmProviderStatus;
  updatedAt: string;
}

export class LlmProvidersRepository extends BaseService {
  public async getProvider(
    userId: string,
    providerId: LlmProviderId,
  ): Promise<StoredLlmProviderRecord | null> {
    return await this.getValue<StoredLlmProviderRecord>(
      this.getProviderKey(userId, providerId),
    );
  }

  public async saveProvider(
    userId: string,
    providerId: LlmProviderId,
    value: StoredLlmProviderRecord,
  ): Promise<void> {
    await this.setValue(this.getProviderKey(userId, providerId), value);
  }

  public async deleteProvider(
    userId: string,
    providerId: LlmProviderId,
  ): Promise<void> {
    await this.deleteValue(this.getProviderKey(userId, providerId));
  }

  public async getSettings(
    userId: string,
  ): Promise<LlmProviderSettingsDto | null> {
    return await this.getValue<LlmProviderSettingsDto>(
      this.getSettingsKey(userId),
    );
  }

  public async saveSettings(
    userId: string,
    settings: LlmProviderSettingsDto,
  ): Promise<LlmProviderSettingsDto> {
    await this.setValue(this.getSettingsKey(userId), settings);
    return settings;
  }

  private getProviderKey(userId: string, providerId: LlmProviderId): string {
    return `llm-provider:${userId}:${providerId}`;
  }

  private getSettingsKey(userId: string): string {
    return `llm-settings:${userId}`;
  }

  private async getValue<T>(key: string): Promise<T | null> {
    const { data, error } = await this.supabase
      .from(this.config.kvTableName)
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) {
      this.logger.error("KV fetch failed", { key, error: error.message });
      throw new RepositoryException(error.message);
    }

    return (data?.value as T | null) ?? null;
  }

  private async setValue<T>(key: string, value: T): Promise<void> {
    const { error } = await this.supabase.from(this.config.kvTableName).upsert({
      key,
      value,
    });

    if (error) {
      this.logger.error("KV upsert failed", { key, error: error.message });
      throw new RepositoryException(error.message);
    }
  }

  private async deleteValue(key: string): Promise<void> {
    const { error } = await this.supabase.from(this.config.kvTableName).delete()
      .eq(
        "key",
        key,
      );

    if (error) {
      this.logger.error("KV delete failed", { key, error: error.message });
      throw new RepositoryException(error.message);
    }
  }
}
