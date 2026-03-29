import type { Context } from "hono";
import { ZodError } from "zod";
import type {
  ErdResponseDto,
  MigrationsResponseDto,
  SchemaResponseDto,
  UpdateErdDto,
  UpdateMigrationsDto,
  UpdateSchemaDto,
} from "../dto/index.ts";
import { ValidationException } from "../internal/exceptions/index.ts";
import { DataService } from "../services/data.service.ts";
import type { DataModuleConfig } from "../interfaces/module.interface.ts";
import {
  erdBodySchema,
  migrationsBodySchema,
  projectIdSchema,
  schemaBodySchema,
} from "../validators/data.validator.ts";

interface SuccessResponse<T> {
  success: true;
  data: T;
}

export class DataController {
  constructor(
    private readonly service: DataService,
    private readonly moduleConfig: DataModuleConfig,
  ) {}

  /** IDOR: assert project access when handler is project-scoped (optional, set by entrypoint). */
  private async guardProject(c: Context, projectId: string): Promise<void> {
    const assert = this.moduleConfig.assertProjectAccess;
    if (assert) await assert(projectId, c);
  }

  public async getSchema(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const data = await this.service.getSchema(projectId);
    return this.ok<SchemaResponseDto>(c, data);
  }

  public async updateSchema(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const body = await this.parseBody<UpdateSchemaDto>(c, schemaBodySchema);
    const data = await this.service.updateSchema(projectId, body);
    return this.ok<SchemaResponseDto>(c, data);
  }

  public async getMigrations(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const data = await this.service.getMigrations(projectId);
    return this.ok<MigrationsResponseDto>(c, data);
  }

  public async updateMigrations(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const body = await this.parseBody<UpdateMigrationsDto>(
      c,
      migrationsBodySchema,
    );
    const data = await this.service.updateMigrations(projectId, body);
    return this.ok<MigrationsResponseDto>(c, data);
  }

  public async getErd(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const data = await this.service.getErd(projectId);
    return this.ok<ErdResponseDto>(c, data);
  }

  public async updateErd(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const body = await this.parseBody<UpdateErdDto>(c, erdBodySchema);
    const data = await this.service.updateErd(projectId, body);
    return this.ok<ErdResponseDto>(c, data);
  }

  /** Sync ERD from project's connected Supabase DB (integrations). No body. IDOR: guardProject enforces access. */
  public async syncErd(c: Context): Promise<Response> {
    const projectId = this.parseProjectId(c);
    await this.guardProject(c, projectId);
    const data = await this.service.syncErdFromSupabase(projectId);
    return this.ok<ErdResponseDto>(c, data);
  }

  private parseProjectId(c: Context): string {
    try {
      return projectIdSchema.parse(c.req.param("projectId"));
    } catch (error) {
      throw this.asValidationError("Invalid projectId", error);
    }
  }

  private async parseBody<T>(
    c: Context,
    schema: { parse: (data: unknown) => T },
  ): Promise<T> {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch (error) {
      throw this.asValidationError("Invalid JSON body", error);
    }

    try {
      return schema.parse(payload);
    } catch (error) {
      throw this.asValidationError("Validation failed", error);
    }
  }

  private ok<T>(c: Context, data: T): Response {
    const payload: SuccessResponse<T> = { success: true, data };
    return c.json(payload, 200);
  }

  private asValidationError(
    message: string,
    error: unknown,
  ): ValidationException {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      return new ValidationException(message, details);
    }

    return new ValidationException(message);
  }
}
