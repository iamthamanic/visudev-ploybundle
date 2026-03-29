import type { Context } from "hono";
import { ZodError } from "zod";
import type {
  LlmProviderSettingsDto,
  LlmProviderStateDto,
  LlmProviderTestResultDto,
  SaveProviderKeyDto,
  SaveProviderSelectionDto,
  TestProviderDto,
} from "../dto/index.ts";
import { ValidationException } from "../internal/exceptions/index.ts";
import { LlmProvidersService } from "../services/llm-providers.service.ts";
import {
  providerIdSchema,
  saveProviderKeySchema,
  saveProviderSelectionSchema,
  testProviderSchema,
  updateSettingsSchema,
} from "../validators/llm-providers.validator.ts";

interface SuccessResponse<T> {
  success: true;
  data: T;
}

export class LlmProvidersController {
  constructor(private readonly service: LlmProvidersService) {}

  public async listProviders(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const data = await this.service.listProviders(userId);
    return this.ok<LlmProviderStateDto[]>(c, data);
  }

  public async getSettings(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const data = await this.service.getSettings(userId);
    return this.ok<LlmProviderSettingsDto>(c, data);
  }

  public async updateSettings(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const body = await this.parseBody<Partial<LlmProviderSettingsDto>>(
      c,
      updateSettingsSchema,
    );
    const data = await this.service.updateSettings(userId, body);
    return this.ok<LlmProviderSettingsDto>(c, data);
  }

  public async testProvider(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const providerId = this.parseProviderId(c);
    const body = await this.parseBody<TestProviderDto>(c, testProviderSchema);
    const data = await this.service.testProvider(
      userId,
      providerId,
      body.apiKey,
    );
    return this.ok<LlmProviderTestResultDto>(c, data);
  }

  public async saveProviderKey(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const providerId = this.parseProviderId(c);
    const body = await this.parseBody<SaveProviderKeyDto>(
      c,
      saveProviderKeySchema,
    );
    const data = await this.service.saveProviderKey(
      userId,
      providerId,
      body.apiKey,
      body.selectedModel,
    );
    return this.ok<LlmProviderStateDto>(c, data);
  }

  public async saveProviderSelection(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const providerId = this.parseProviderId(c);
    const body = await this.parseBody<SaveProviderSelectionDto>(
      c,
      saveProviderSelectionSchema,
    );
    const data = await this.service.saveProviderSelection(
      userId,
      providerId,
      body.selectedModel,
    );
    return this.ok<LlmProviderStateDto>(c, data);
  }

  public async getProviderModels(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const providerId = this.parseProviderId(c);
    const data = await this.service.listProviderModels(userId, providerId);
    return this.ok(c, data);
  }

  public async deleteProviderKey(c: Context): Promise<Response> {
    const userId = this.service.getAuthUserIdFromContext(c);
    const providerId = this.parseProviderId(c);
    await this.service.deleteProviderKey(userId, providerId);
    return c.json({ success: true }, 200);
  }

  private parseProviderId(c: Context) {
    try {
      return providerIdSchema.parse(c.req.param("providerId"));
    } catch (error) {
      throw this.asValidationError("Invalid provider id", error);
    }
  }

  private async parseBody<T>(
    c: Context,
    schema: { parse: (data: unknown) => T },
  ): Promise<T> {
    let payload: unknown = {};
    try {
      if (c.req.header("content-type")?.includes("application/json")) {
        payload = await c.req.json();
      }
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
      return new ValidationException(
        message,
        error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    return new ValidationException(message);
  }
}
