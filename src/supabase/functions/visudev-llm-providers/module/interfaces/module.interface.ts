export interface LoggerLike {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface SupabaseQueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface SupabaseDeleteClient {
  eq(
    column: string,
    value: string,
  ): Promise<{ error: { message: string } | null }>;
}

export interface SupabaseTableClient {
  select(column: string): SupabaseTableClient;
  eq(column: string, value: string): SupabaseTableClient;
  maybeSingle(): Promise<SupabaseQueryResult<{ value: unknown }>>;
  upsert(
    payload: { key: string; value: unknown },
  ): Promise<{ error: { message: string } | null }>;
  delete(): SupabaseDeleteClient;
}

export interface SupabaseClientLike {
  from(table: string): SupabaseTableClient;
}

export interface LlmProvidersModuleSettings {
  kvTableName: string;
}

export interface LlmProvidersModuleConfig {
  supabase: SupabaseClientLike;
  logger: LoggerLike;
  config: LlmProvidersModuleSettings;
}
