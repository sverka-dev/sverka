import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createFileCacheStore, type CacheStore } from "../cache-store.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";

function makeCacheablePlan(
  cacheSpec: StepDefinition["cache"],
  command = "echo build",
): RunPlan {
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

async function collectEvents(
  engine: ReturnType<typeof createEngine>,
  request: Parameters<ReturnType<typeof createEngine>["run"]>[0],
) {
  const events: {
    type: string;
    stepId?: string;
    key?: string;
    attempt?: number;
    nextAttemptMs?: number;
    message?: string;
    severity?: string;
  }[] = [];
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
    await cache.store({
      key: "build-key",
      paths: ["dist"],
      sourceDir: seedDir,
    });

    let executed = false;
    const driver = createMockDriver({
      executeFn: async () => {
        executed = true;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
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
    const completed = events.find(
      (e) => e.type === "run-completed",
    ) as never as { status: string };
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
      plan: makeCacheablePlan(
        { paths: ["dist"], key: "build-key" },
        "echo build",
      ),
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
        plan: makeCacheablePlan({
          paths: ["dist"],
          key: "build-${{ env.NODE_VERSION }}",
        }),
        workspace: join(testDir, "ws"),
        artifactDir: join(testDir, "art"),
      });
      expect(restoreCalls[0]?.key).toBe("build-20");
    } finally {
      delete process.env.NODE_VERSION;
    }
  });

  it("secrets.* refs land in the key as a sha256 — never the raw value", async () => {
    const step: StepDefinition = {
      id: "ci/build",
      runtime: { secrets: ["TOKEN"] },
      operations: [{ kind: "shell", command: "echo build" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      cache: { paths: ["dist"], key: "ci-${{ secrets.TOKEN }}" },
    };
    const plan: RunPlan = {
      apiVersion: "sverka.dev/v1run",
      id: "rp-cache",
      graphId: "graph-cache",
      entry: { id: "ci/on-push", trigger: { kind: "push" } },
      inputs: {},
      steps: [step],
      createdAt: "2026-08-31T00:00:00.000Z",
    };
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
      plan,
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
      secrets: {
        resolve: async (name) => (name === "TOKEN" ? "s3cr3t" : undefined),
      },
    });
    expect(restoreCalls[0]?.key).toMatch(/^ci-[0-9a-f]{64}$/);
    expect(restoreCalls[0]?.key).not.toContain("s3cr3t");
  });

  it("hashFiles: key segment is the content hash, changes with file content", async () => {
    const ws = join(testDir, "ws");
    await mkdir(join(ws, "locks"), { recursive: true });
    await writeFile(join(ws, "locks", "a.lock"), "v1");
    const restoreCalls: { key: string }[] = [];
    const cache: CacheStore = {
      restore: async (req) => {
        restoreCalls.push({ key: req.key });
        return undefined;
      },
      store: async () => undefined,
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    const plan = makeCacheablePlan({
      paths: ["dist"],
      key: "deps-${{ hashFiles('locks/*.lock') }}",
    });
    await collectEvents(engine, {
      plan,
      workspace: ws,
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalls[0]?.key).toMatch(/^deps-[0-9a-f]{64}$/);

    // Same layout, different content → different key.
    await writeFile(join(ws, "locks", "a.lock"), "v2");
    await collectEvents(engine, {
      plan,
      workspace: ws,
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalls).toHaveLength(2);
    expect(restoreCalls[1]?.key).not.toBe(restoreCalls[0]?.key);
  });

  it("hashFiles with no matches resolves to empty segment + warn diagnostic", async () => {
    const ws = join(testDir, "ws");
    await mkdir(ws, { recursive: true });
    const restoreCalls: { key: string }[] = [];
    const cache: CacheStore = {
      restore: async (req) => {
        restoreCalls.push({ key: req.key });
        return undefined;
      },
      store: async () => undefined,
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({
        paths: ["dist"],
        key: "deps-${{ hashFiles('missing/*.lock') }}",
      }),
      workspace: ws,
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalls[0]?.key).toBe("deps-");
    const diag = events.find(
      (e) => e.type === "diagnostic" && e.severity === "warn",
    );
    expect(diag?.message).toContain("hashFiles");
  });

  it("hashFiles: absolute and '..' patterns are refused with a warn", async () => {
    const ws = join(testDir, "ws");
    await mkdir(ws, { recursive: true });
    const restoreCalls: { key: string }[] = [];
    const cache: CacheStore = {
      restore: async (req) => {
        restoreCalls.push({ key: req.key });
        // Hit — keeps the key resolved once (store never runs).
        return { key: req.key };
      },
      store: async () => undefined,
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({
        paths: ["dist"],
        key: "deps-${{ hashFiles('/etc/*', '../x', '..\\x') }}",
      }),
      workspace: ws,
      artifactDir: join(testDir, "art"),
    });
    expect(restoreCalls[0]?.key).toBe("deps-");
    const warns = events.filter(
      (e) =>
        e.type === "diagnostic" &&
        e.severity === "warn" &&
        (e.message ?? "").includes("escapes the workspace"),
    );
    expect(warns).toHaveLength(3);
  });

  it("hashFiles: match cap emits the warning once across patterns", async () => {
    const ws = join(testDir, "ws");
    // 300+ files across two dirs so both patterns overflow the cap.
    for (const dir of ["a", "b"]) {
      await mkdir(join(ws, dir), { recursive: true });
      for (let i = 0; i < 160; i++) {
        await writeFile(join(ws, dir, `f${i}.txt`), `${dir}${i}`);
      }
    }
    const cache: CacheStore = {
      // Hit — the key resolves once (store never runs).
      restore: async (req) => ({ key: req.key }),
      store: async () => undefined,
    };
    const engine = createEngine({ drivers: [createMockDriver()], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({
        paths: ["dist"],
        key: "deps-${{ hashFiles('a/*.txt', 'b/*.txt') }}",
      }),
      workspace: ws,
      artifactDir: join(testDir, "art"),
    });
    const capWarns = events.filter(
      (e) => e.type === "diagnostic" && (e.message ?? "").includes("cap"),
    );
    expect(capWarns).toHaveLength(1);
  });

  it("hashFiles: NUL bytes in content cannot collide two file sets", async () => {
    // Old framing hashed path\0content\0 — a file 'a' containing
    // "x\0b\0" collided with files 'a'="x" + 'b'="". Per-file digests
    // must keep these sets distinct.
    const keyFor = async (files: Record<string, string>) => {
      const ws = join(
        testDir,
        `ws-${Object.keys(files).join("")}-${files["a"]!.length}`,
      );
      await mkdir(ws, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        await writeFile(join(ws, name), content);
      }
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
        plan: makeCacheablePlan({
          paths: ["dist"],
          key: "deps-${{ hashFiles('*') }}",
        }),
        workspace: ws,
        artifactDir: join(testDir, "art"),
      });
      return restoreCalls[0]?.key;
    };
    const keyA = await keyFor({ a: "x\0b\0" });
    const keyB = await keyFor({ a: "x", b: "" });
    expect(keyA).toBeDefined();
    expect(keyA).not.toBe(keyB);
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
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 1,
          timedOut: false,
        };
      },
    });
    const engine = createEngine({ drivers: [driver], cache });
    const events = await collectEvents(engine, {
      plan: makeCacheablePlan({ paths: ["dist"], key: "k" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    expect(executed).toBe(true);
    const diag = events.find(
      (e) => e.type === "diagnostic" && e.severity === "warn",
    );
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
    const diag = events.find(
      (e) => e.type === "diagnostic" && e.severity === "warn",
    );
    expect(diag).toBeDefined();
    expect(diag?.message).toContain("cache store failed");
    const completed = events.find(
      (e) => e.type === "run-completed",
    ) as never as { status: string };
    expect(completed.status).toBe("success");
  });
});
