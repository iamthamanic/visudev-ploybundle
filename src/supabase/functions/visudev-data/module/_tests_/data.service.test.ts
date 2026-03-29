import { initModuleServices } from "../services/base.service.ts";
import { DataService } from "../services/data.service.ts";
import { DataRepository } from "../internal/repositories/data.repository.ts";
import type { SupabaseClientLike } from "../interfaces/module.interface.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ?? `Expected ${String(actual)} to equal ${String(expected)}`,
    );
  }
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const minimalConfig = {
  supabase: {} as SupabaseClientLike,
  logger,
  config: { kvTableName: "kv_store_test" },
};

function setupModule(): void {
  initModuleServices(minimalConfig);
}

class StubRepository extends DataRepository {
  public readonly calls: Record<string, unknown[]> = {
    getSchema: [],
    updateSchema: [],
    getMigrations: [],
    updateMigrations: [],
    getErd: [],
    updateErd: [],
  };

  constructor(
    private readonly data: {
      schema: Record<string, unknown>;
      migrations: unknown[];
      erd: Record<string, unknown>;
    },
  ) {
    super();
  }

  override getSchema(
    projectId: string,
  ): Promise<Record<string, unknown>> {
    this.calls.getSchema.push(projectId);
    return Promise.resolve(this.data.schema);
  }

  override updateSchema(
    projectId: string,
    dto: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.updateSchema.push({ projectId, dto });
    return Promise.resolve({ ...dto, projectId });
  }

  override getMigrations(projectId: string): Promise<unknown[]> {
    this.calls.getMigrations.push(projectId);
    return Promise.resolve(this.data.migrations);
  }

  override updateMigrations(
    projectId: string,
    dto: unknown[],
  ): Promise<unknown[]> {
    this.calls.updateMigrations.push({ projectId, dto });
    return Promise.resolve(dto);
  }

  override getErd(projectId: string): Promise<Record<string, unknown>> {
    this.calls.getErd.push(projectId);
    return Promise.resolve(this.data.erd);
  }

  override updateErd(
    projectId: string,
    dto: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.calls.updateErd.push({ projectId, dto });
    return Promise.resolve({ ...dto, projectId });
  }
}

Deno.test("DataService delegates schema methods to repository", async () => {
  setupModule();
  const repo = new StubRepository({
    schema: { tables: ["users"] },
    migrations: [],
    erd: {},
  });
  const service = new DataService(repo, minimalConfig);

  const schema = await service.getSchema("proj-1");
  const tables = schema.tables as string[] | undefined;
  assertEquals(tables?.[0], "users");
  assertEquals(repo.calls.getSchema.length, 1);

  const updated = await service.updateSchema("proj-1", { version: 2 });
  assertEquals(updated.projectId as string, "proj-1");
  assertEquals(repo.calls.updateSchema.length, 1);
});

Deno.test("DataService delegates migrations + erd methods", async () => {
  setupModule();
  const repo = new StubRepository({
    schema: {},
    migrations: [{ id: "001_init" }],
    erd: { nodes: [] },
  });
  const service = new DataService(repo, minimalConfig);

  const migrations = await service.getMigrations("proj-2");
  assert(Array.isArray(migrations), "Expected migrations array");
  assertEquals(repo.calls.getMigrations.length, 1);

  const updated = await service.updateMigrations("proj-2", [{ id: "002_add" }]);
  assertEquals(updated.length, 1);
  assertEquals(repo.calls.updateMigrations.length, 1);

  const erd = await service.getErd("proj-2");
  const nodes = erd.nodes as unknown[] | undefined;
  assertEquals(Array.isArray(nodes), true);
  assertEquals(repo.calls.getErd.length, 1);

  const updatedErd = await service.updateErd("proj-2", { nodes: ["a"] });
  assertEquals(updatedErd.projectId as string, "proj-2");
  assertEquals(repo.calls.updateErd.length, 1);
});
