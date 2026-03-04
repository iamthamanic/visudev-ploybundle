import type {
  ErdResponseDto,
  MigrationsResponseDto,
  SchemaResponseDto,
  UpdateErdDto,
  UpdateMigrationsDto,
  UpdateSchemaDto,
} from "../dto/index.ts";
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
  constructor(private readonly repository: DataRepository) {
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
   * Fetches PostgREST OpenAPI spec and builds nodes/tables. Saves to KV.
   * Returns the new ERD or throws if Supabase not connected / fetch failed.
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

    let res: Response;
    try {
      res = await fetch(openApiUrl, {
        method: "GET",
        headers: {
          Accept: "application/openapi+json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("Fetch OpenAPI failed", { projectId, error: msg });
      throw new Error(`Supabase schema fetch failed: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error("OpenAPI response not ok", {
        projectId,
        status: res.status,
        body: text.slice(0, 200),
      });
      throw new Error(
        `Supabase schema fetch failed: ${res.status} ${text.slice(0, 100)}`,
      );
    }

    let openApi: Record<string, unknown>;
    try {
      openApi = (await res.json()) as Record<string, unknown>;
    } catch {
      this.logger.error("OpenAPI parse failed", { projectId });
      throw new Error("Supabase schema response was not JSON");
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
