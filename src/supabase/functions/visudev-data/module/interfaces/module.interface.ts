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

export interface SupabaseTableClient {
  select(column: string): SupabaseTableClient;
  eq(column: string, value: string): SupabaseTableClient;
  maybeSingle(): Promise<SupabaseQueryResult<{ value: unknown }>>;
  upsert(
    payload: { key: string; value: unknown },
  ): Promise<{ error: { message: string } | null }>;
}

export interface SupabaseClientLike {
  from(table: string): SupabaseTableClient;
}

export interface DataModuleSettings {
  kvTableName: string;
}

/** Optional: IDOR mitigation – assert current user can access project before any project-scoped operation. */
export type AssertProjectAccess = (
  projectId: string,
  c: import("hono").Context,
) => Promise<void>;

/** Abstraction for fetching OpenAPI spec (Dependency Inversion; testable without real fetch). */
export type OpenApiFetcher = (
  url: string,
  headers: Record<string, string>,
) => Promise<Record<string, unknown>>;

export interface DataModuleConfig {
  supabase: SupabaseClientLike;
  logger: LoggerLike;
  config: DataModuleSettings;
  /** When set, controller calls this before each project-scoped handler. */
  assertProjectAccess?: AssertProjectAccess;
  /** When set, used for ERD sync instead of global fetch (injection for tests / rate limiting). */
  openApiFetcher?: OpenApiFetcher;
}
