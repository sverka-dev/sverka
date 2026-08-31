import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createFileCacheStore, type CacheStore } from "../cache-store.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";

function makeCacheablePlan(cacheSpec: StepDefinition["cache"], command = "echo build"): RunPlan {
  const step: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [{ kind: "shell", command }],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...(cacheSpec ? { cache: cacheSpec } : {}),
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-cache",
    graphId: "graph-cache",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [step],
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

async function collectEvents(engine: ReturnType<typeof createEngine>, request: Parameters<ReturnType<typeof createEngine>["run"]>[0]) {
  const events: { type: string; stepId?: string; key?: string; attempt?: number; nextAttemptMs?: number; message?: string; severity?: string }[] = [];
  for await (const event of engine.run(request)) {
    events.push(event as never);
  }
  return events;
}

describe("Engine — cache integration", () => {
  let testDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-eng-cache-"));
    cacheDir = join(testDir, "cache");
    await mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("cache hit skips execution, emits step-cache-hit, ends succeeded", async () => {
    const cache = createFileCacheStore({ cacheDir });
    // Pre-seed the cache: store a "dist" path under the build key.
    const seedDir = join(testDir, "seed");
    await mkdir(join(seedDir, "dist"), { recursive: true });
    await writeFile(join(seedDir, "dist", "out.txt"), "cached");
    await cache.store({ key: "build-key", paths: ["dist"], sourceDir: seedDir });

    let executed = false;
    const driver = createMockDriver({
      executeFn: async () => {
        executed = true;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const engine = createEngine({ drivers: [driver], cache });

    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "build-key" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(executed).toBe(false);
    const types = events.map((e) => e.type);
    expect(types).toContain("step-cache-hit");
    expect(types).not.toContain("step-started");
    expect(types).not.toContain("step-ready");
    expect(types).toContain("step-succeeded");
    const completed = events.find((e) => e.type === "run-completed") as never as { status: string };
    expect(completed.status).toBe("success");
  });

  it("cache miss runs the step, then stores the paths", async () => {
    const storeCalls: { key: string; paths: readonly string[] }[] = [];
    const cache: CacheStore = {
      restore: async () => undefined,
      store: async (req) => {
        storeCalls.push({ key: req.key, paths: req.paths });
      },
    };
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver], cache });

    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "build-key" }, "echo build"),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(storeCalls).toHaveLength(1);
    expect(storeCalls[0]?.key).toBe("build-key");
    expect(storeCalls[0]?.paths).toEqual(["dist"]);
    const types = events.map((e) => e.type);
    expect(types).not.toContain("step-cache-hit");
    expect(types).toContain("step-succeeded");
  });

  it("policy pull never calls store", async () => {
    let storeCalled = false;
    let restoreCalled = false;
    const cache: CacheStore = {
      restore: async () => {
        restoreCalled = true;
        return undefined;
      },
      store: async () => {
        storeCalled = true;
      },
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "k", policy: "pull" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalled).toBe(true);
    expect(storeCalled).toBe(false);
  });

  it("policy push never calls restore (runs the step, stores on success)", async () => {
    let restoreCalled = false;
    let storeCalled = false;
    const cache: CacheStore = {
      restore: async () => {
        restoreCalled = true;
        return undefined;
      },
      store: async () => {
        storeCalled = true;
      },
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "k", policy: "push" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalled).toBe(false);
    expect(storeCalled).toBe(true);
  });

  it("context-ref key resolution: ${{ env.NODE_VERSION }} resolves to env value", async () => {
    process.env.NODE_VERSION = "20";
    try {
      const restoreCalls: { key: string }[] = [];
      const cache: CacheStore = {
        restore: async (req) => {
          restoreCalls.push({ key: req.key });
          return undefined;
        },
        store: async () => undefined,
      };
      const engine = createEngine({ drivers: [createMockDriver()], cache });
      await collectEvents(engine, {
        plan: makeCacheablePlan({ paths: ["dist"], key: "build-${{ env.NODE_VERSION }}" }),
        workspace: join(testDir, "ws"),
        artifactDir: join(testDir, "art"),
      });
      expect(restoreCalls[0]?.key).toBe("build-20");
    } finally {
      delete process.env.NODE_VERSION;
    }
  });

  it("restore throw → step runs normally (miss), a warn diagnostic emitted", async () => {
    const cache: CacheStore = {
      restore: async () => {
        throw new Error("disk gone");
      },
      store: async () => undefined,
    };
    let executed = false;
    const driver = createMockDriver({
      executeFn: async () => {
        executed = true;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const engine = createEngine({ drivers: [driver], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "k" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    expect(executed).toBe(true);
    const diag = events.find((e) => e.type === "diagnostic" && e.severity === "warn");
    expect(diag).toBeDefined();
    expect(diag?.message).toContain("cache restore failed");
  });

  it("store throw → step result unchanged, a warn diagnostic emitted", async () => {
    const cache: CacheStore = {
      restore: async () => undefined,
      store: async () => {
        throw new Error("disk full");
      },
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "k" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    const diag = events.find((e) => e.type === "diagnostic" && e.severity === "warn");
    expect(diag).toBeDefined();
    expect(diag?.message).toContain("cache store failed");
    const completed = events.find((e) => e.type === "run-completed") as never as { status: string };
    expect(completed.status).toBe("success");
  });
});
