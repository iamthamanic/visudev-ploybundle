import { z } from "zod";
import { PROVIDER_IDS } from "../dto/index.ts";

export const providerIdSchema = z.enum(PROVIDER_IDS);

export const saveProviderKeySchema = z.object({
  apiKey: z.string().min(1, "apiKey is required").trim(),
  selectedModel: z.string().min(1).trim().optional(),
});

export const saveProviderSelectionSchema = z.object({
  selectedModel: z.string().min(1, "selectedModel is required").trim(),
});

export const testProviderSchema = z.object({
  apiKey: z.string().min(1).trim().optional(),
});

export const updateSettingsSchema = z.object({
  defaultProvider: providerIdSchema.optional(),
  defaultModel: z.string().min(1).trim().optional(),
  allowLlmForEscalations: z.boolean().optional(),
});
