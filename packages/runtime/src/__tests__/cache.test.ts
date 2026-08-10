import { describe, it, expect } from "vitest";
import { Scheduler } from "../scheduler.js";
import type {
  SchedulerConfig,
  CacheBackend,
  CacheKey,
  CacheEntry,
} from "../index.js";
import {
  MockExecutor,
  op,
  planFromOps,
  successResult,
  validOperation,
} from "./helpers/fixtures.js";

/** In-memory CacheBackend mock for testing. */
class MemoryCache implements CacheBackend {
  entries = new Map<string, CacheEntry>();
  restored: string[] = [];
  stored: string[] = [];

  async get(key: CacheKey): Promise<CacheEntry | undefined> {
    return this.entries.get(key.key);
  }
  async put(entry: CacheEntry): Promise<void> {
    this.entries.set(entry.key, entry);
  }
  async restore(_key: CacheKey, _targetDir: string): Promise<void> {
    this.restored.push(_key.key);
  }
  async store(_key: CacheKey, _sourceDir: string): Promise<void> {
    this.stored.push(_key.key);
  }
}

function baseConfig(
  executors: readonly MockExecutor[],
  overrides: Partial<SchedulerConfig> = {},
): SchedulerConfig {
  return {
    executors,
    maxConcurrent: 4,
    workspace: "/ws",
    artifactDir: "/art",
    cacheDir: "/cache",
    credentials: {},
    resume: false,
    ...overrides,
  };
}

function cachedOp(
  id: string,
  dependsOn: readonly string[] = [],
): ReturnType<typeof validOperation> {
  return validOperation({
    id,
    name: id,
    dependsOn,
    cache: { key: `cache-${id}`, inputs: ["in.txt"], outputs: ["out.txt"] },
  });
}

describe("Scheduler — cache reuse", () => {
  it("a cache hit is not executed; outcome has fromCache: true and status: success", async () => {
    const exec = new MockExecutor();
    const cache = new MemoryCache();
    // Pre-populate cache for op-a.
    await cache.put({
      key: "cache-a",
      outputs: ["out.txt"],
      createdAt: new Date().toISOString(),
    });
    const plan = planFromOps([cachedOp("a")]);
    const result = await new Scheduler(baseConfig([exec], { cache })).execute(
      plan,
    );
    expect(result.status).toBe("success");
    expect(result.outcomes.get("a")?.fromCache).toBe(true);
    expect(result.outcomes.get("a")?.status).toBe("success");
    expect(exec.calls.length).toBe(0);
  });

  it("a cache miss executes the operation and stores outputs", async () => {
    const exec = new MockExecutor({
      result: (req) => successResult(req.operation.id),
    });
    const cache = new MemoryCache();
    const plan = planFromOps([cachedOp("a")]);
    const result = await new Scheduler(baseConfig([exec], { cache })).execute(
      plan,
    );
    expect(result.status).toBe("success");
    expect(result.outcomes.get("a")?.fromCache).toBe(false);
    expect(exec.calls.length).toBe(1);
    expect(cache.stored).toContain("cache-a");
    expect(cache.entries.has("cache-a")).toBe(true);
  });

  it("when no cache backend is configured, all fromCache are false", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([cachedOp("a")]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    expect(result.outcomes.get("a")?.fromCache).toBe(false);
    expect(exec.calls.length).toBe(1);
  });
});
