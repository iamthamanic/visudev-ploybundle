import { BaseService } from "../../services/base.service.ts";
import type {
  ErdResponseDto,
  MigrationsResponseDto,
  SchemaResponseDto,
  UpdateErdDto,
  UpdateMigrationsDto,
  UpdateSchemaDto,
} from "../../dto/index.ts";
import { RepositoryException } from "../exceptions/index.ts";

/** Minimal type for KV integrations payload (Supabase connection for schema sync). */
export interface IntegrationsKV {
  supabase?: {
    url?: string;
    serviceKey?: string;
    projectRef?: string;
  };
}

export class DataRepository extends BaseService {
  public async getSchema(projectId: string): Promise<SchemaResponseDto> {
    const key = this.getKey(projectId, "schema");
    const stored = await this.getValue<SchemaResponseDto>(key);
    return stored ?? {};
  }

  public async updateSchema(
    projectId: string,
    dto: UpdateSchemaDto,
  ): Promise<SchemaResponseDto> {
    const key = this.getKey(projectId, "schema");
    const schema: SchemaResponseDto = {
      ...dto,
      projectId,
      updatedAt: new Date().toISOString(),
    };
    await this.setValue(key, schema);
    return schema;
  }

  public async getMigrations(
    projectId: string,
  ): Promise<MigrationsResponseDto> {
    const key = this.getKey(projectId, "migrations");
    const stored = await this.getValue<MigrationsResponseDto>(key);
    return stored ?? [];
  }

  public async updateMigrations(
    projectId: string,
    dto: UpdateMigrationsDto,
  ): Promise<MigrationsResponseDto> {
    const key = this.getKey(projectId, "migrations");
    await this.setValue(key, dto);
    return dto;
  }

  public async getErd(projectId: string): Promise<ErdResponseDto> {
    const key = this.getKey(projectId, "erd");
    const stored = await this.getValue<ErdResponseDto>(key);
    return stored ?? {};
  }

  /** Read integrations for project (key integrations:{projectId}) to get project's Supabase connection. */
  public async getIntegrations(
    projectId: string,
  ): Promise<IntegrationsKV | null> {
    const key = `integrations:${projectId}`;
    return await this.getValue<IntegrationsKV>(key);
  }

  public async updateErd(
    projectId: string,
    dto: UpdateErdDto,
  ): Promise<ErdResponseDto> {
    const key = this.getKey(projectId, "erd");
    const erd: ErdResponseDto = {
      ...dto,
      projectId,
      updatedAt: new Date().toISOString(),
    };
    await this.setValue(key, erd);
    return erd;
  }

  private getKey(projectId: string, suffix: string): string {
    return `data:${projectId}:${suffix}`;
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
}
