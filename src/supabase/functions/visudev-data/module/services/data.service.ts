import type {
  ErdResponseDto,
  MigrationsResponseDto,
  SchemaResponseDto,
  UpdateErdDto,
  UpdateMigrationsDto,
  UpdateSchemaDto,
} from "../dto/index.ts";
import type { DataModuleConfig } from "../interfaces/module.interface.ts";
import { DataRepository } from "../internal/repositories/data.repository.ts";
import { BaseService } from "./base.service.ts";

/** ERD node shape for sync from Supabase OpenAPI (matches frontend ERDTableNode). */
interface ErdNode {
  id: string;
  name?: string;
  label?: string;
  columns?: {
    name: string;
    type?: string;
    nullable?: boolean;
    default?: string;
  }[];
}

export class DataService extends BaseService {
  constructor(
    private readonly repository: DataRepository,
    private readonly moduleConfig: DataModuleConfig,
  ) {
    super();
  }

  public getSchema(projectId: string): Promise<SchemaResponseDto> {
    this.logger.info("Fetching schema", { projectId });
    return this.repository.getSchema(projectId);
  }

  public updateSchema(
    projectId: string,
    dto: UpdateSchemaDto,
  ): Promise<SchemaResponseDto> {
    this.logger.info("Updating schema", { projectId });
    return this.repository.updateSchema(projectId, dto);
  }

  public getMigrations(
    projectId: string,
  ): Promise<MigrationsResponseDto> {
    this.logger.info("Fetching migrations", { projectId });
    return this.repository.getMigrations(projectId);
  }

  public updateMigrations(
    projectId: string,
    dto: UpdateMigrationsDto,
  ): Promise<MigrationsResponseDto> {
    this.logger.info("Updating migrations", { projectId });
    return this.repository.updateMigrations(projectId, dto);
  }

  public getErd(projectId: string): Promise<ErdResponseDto> {
    this.logger.info("Fetching ERD", { projectId });
    return this.repository.getErd(projectId);
  }

  public updateErd(
    projectId: string,
    dto: UpdateErdDto,
  ): Promise<ErdResponseDto> {
    this.logger.info("Updating ERD", { projectId });
    return this.repository.updateErd(projectId, dto);
  }

  /**
   * Sync ERD from the project's connected Supabase DB (integrations.supabase).
   * Uses injected openApiFetcher when provided (Dependency Inversion). No response bodies in logs/errors (Data Leakage).
   * OpenAPI structure validated before mapping (Input Validation).
   */
  public async syncErdFromSupabase(projectId: string): Promise<ErdResponseDto> {
    this.logger.info("Syncing ERD from project Supabase", { projectId });

    const integrations = await this.repository.getIntegrations(projectId);
    const url = integrations?.supabase?.url?.trim();
    const serviceKey = integrations?.supabase?.serviceKey?.trim();

    if (!url || !serviceKey) {
      this.logger.warn("Supabase not connected for project", { projectId });
      const existing = await this.repository.getErd(projectId);
      return existing;
    }

    const restBase = url.replace(/\/$/, "") + "/rest/v1";
    const openApiUrl = `${restBase}/`;
    const headers: Record<string, string> = {
      Accept: "application/openapi+json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };

    const fetcher = this.moduleConfig.openApiFetcher ??
      this.defaultOpenApiFetcher.bind(this);
    let openApi: Record<string, unknown>;
    try {
      openApi = await fetcher(openApiUrl, headers);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("OpenAPI fetch failed", { projectId, error: msg });
      throw new Error("Supabase schema fetch failed");
    }

    if (!this.isValidOpenApiShape(openApi)) {
      this.logger.error("OpenAPI structure invalid", { projectId });
      throw new Error("Supabase schema response had invalid structure");
    }

    const nodes = this.buildErdNodesFromOpenApi(openApi);
    const erd: ErdResponseDto = {
      projectId,
      updatedAt: new Date().toISOString(),
      nodes,
      tables: nodes,
    };

    await this.repository.updateErd(projectId, erd);
    this.logger.info("ERD synced from Supabase", {
      projectId,
      tableCount: nodes.length,
    });
    return erd;
  }

  /** Default fetcher: fetch + JSON; no response body in logs or thrown messages (Data Leakage). */
  private async defaultOpenApiFetcher(
    openApiUrl: string,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(openApiUrl, { method: "GET", headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
    if (!res.ok) {
      this.logger.error("OpenAPI response not ok", {
        status: res.status,
      });
      throw new Error("Supabase schema fetch failed");
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      this.logger.error("OpenAPI parse failed");
      throw new Error("Supabase schema response was not JSON");
    }
  }

  /** Input Validation: ensure OpenAPI has paths and components.schemas (or at least paths). */
  private isValidOpenApiShape(obj: Record<string, unknown>): boolean {
    if (!obj || typeof obj !== "object") return false;
    const paths = obj.paths;
    if (paths === null || typeof paths !== "object") return false;
    return true;
  }

  private buildErdNodesFromOpenApi(
    openApi: Record<string, unknown>,
  ): ErdNode[] {
    const paths = (openApi.paths as Record<string, unknown>) ?? {};
    const schemas = (openApi.components as Record<string, unknown>)?.schemas as
      | Record<string, Record<string, unknown>>
      | undefined;

    const nodes: ErdNode[] = [];
    for (const pathKey of Object.keys(paths)) {
      const tableName = pathKey.replace(/^\//, "").trim();
      if (!tableName || tableName === "rpc" || tableName.startsWith("rpc/")) {
        continue;
      }
      const schemaDef = schemas?.[tableName] as
        | Record<string, unknown>
        | undefined;
      const properties =
        (schemaDef?.properties as Record<string, Record<string, unknown>>) ??
          {};
      const columns = Object.entries(properties).map(([name, prop]) => ({
        name,
        type: typeof prop?.type === "string"
          ? (prop.type as string)
          : undefined,
        nullable: prop?.nullable === true,
        default: typeof prop?.default === "string"
          ? (prop.default as string)
          : undefined,
      }));

      nodes.push({
        id: tableName,
        name: tableName,
        label: tableName,
        columns: columns.length > 0 ? columns : undefined,
      });
    }

    return nodes.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  }
}
