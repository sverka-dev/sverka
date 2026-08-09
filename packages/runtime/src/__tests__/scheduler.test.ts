import { describe, it, expect } from "vitest";
import { Scheduler } from "../scheduler.js";
import type { SchedulerConfig } from "../scheduler.js";
import { SchedulerError } from "../errors.js";
import {
  MockExecutor,
  op,
  planFromOps,
  successResult,
  failureResult,
  validOperation,
} from "./helpers/fixtures.js";
import type { PlanOperation } from "@sverka/ir";

function baseConfig(executors: readonly MockExecutor[], overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
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

describe("Scheduler — topological scheduling", () => {
  it("executes a linear plan a -> b -> c in order", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([
      op("a"),
      op("b", ["a"]),
      op("c", ["b"]),
    ]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    expect([...result.outcomes.keys()]).toEqual(["a", "b", "c"]);
    // Calls happened in topological order.
    expect(exec.calls.map((c) => c.operation.id)).toEqual(["a", "b", "c"]);
  });

  it("executes a diamond a -> {b, c} -> d with b and c concurrent", async () => {
    let bStart = 0;
    let cStart = 0;
    const exec = new MockExecutor({
      result: (req) => {
        if (req.operation.id === "b") bStart = Date.now();
        if (req.operation.id === "c") cStart = Date.now();
        return successResult(req.operation.id);
      },
    });
    const plan = planFromOps([
      op("a"),
      op("b", ["a"]),
      op("c", ["a"]),
      op("d", ["b", "c"]),
    ]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    expect([...result.outcomes.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    // d ran last.
    expect(exec.calls.map((c) => c.operation.id)[3]).toBe("d");
    // b and c both ran after a, before d.
    expect(bStart).toBeGreaterThan(0);
    expect(cStart).toBeGreaterThan(0);
  });
});

describe("Scheduler — concurrency limits", () => {
  it("maxConcurrent: 1 forces sequential execution", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running--;
        return successResult(req.operation.id);
      },
    });
    const plan = planFromOps([op("a"), op("b"), op("c"), op("d")]);
    await new Scheduler(baseConfig([exec], { maxConcurrent: 1 })).execute(plan);
    expect(maxRunning).toBe(1);
  });

  it("maxConcurrent: 2 allows two independent ops at once", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return successResult(req.operation.id);
      },
    });
    const plan = planFromOps([op("a"), op("b"), op("c"), op("d")]);
    await new Scheduler(baseConfig([exec], { maxConcurrent: 2 })).execute(plan);
    expect(maxRunning).toBe(2);
  });
});

describe("Scheduler — failure and cancellation", () => {
  it("a fatal failure on a cancels its dependents (b, c) as cancelled", async () => {
    const exec = new MockExecutor({
      result: (req) =>
        req.operation.id === "a"
          ? failureResult(req.operation.id, { error: "boom" })
          : successResult(req.operation.id),
    });
    const plan = planFromOps([
      op("a"),
      op("b", ["a"]),
      op("c", ["a"]),
    ]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("failure");
    expect(result.outcomes.get("a")?.status).toBe("failure");
    expect(result.outcomes.get("b")?.status).toBe("cancelled");
    expect(result.outcomes.get("c")?.status).toBe("cancelled");
    expect(result.cancelledOperations).toEqual(["b", "c"]);
    // b and c were never executed.
    expect(exec.calls.map((c) => c.operation.id)).toEqual(["a"]);
  });

  it("continueOnError: true on a lets an independent branch (z) proceed; dependents of a still cancelled", async () => {
    const exec = new MockExecutor({
      result: (req) =>
        req.operation.id === "a"
          ? failureResult(req.operation.id)
          : successResult(req.operation.id),
    });
    const a = validOperation({ id: "a", name: "a", dependsOn: [], continueOnError: true });
    const z = op("z");
    const b = op("b", ["a"]);
    const plan = planFromOps([a, z, b]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    // Some failures under continueOnError => partial.
    expect(result.status).toBe("partial");
    expect(result.outcomes.get("a")?.status).toBe("failure");
    expect(result.outcomes.get("z")?.status).toBe("success");
    expect(result.outcomes.get("b")?.status).toBe("cancelled");
    expect(result.cancelledOperations).toEqual(["b"]);
  });

  it("cancel() during execution produces a partial result with running ops cancelled", async () => {
    let releaseA: () => void = () => {};
    const aPromise = new Promise<void>((r) => (releaseA = r));
    const exec = new MockExecutor({
      result: async (req) => {
        if (req.operation.id === "a") await aPromise;
        return successResult(req.operation.id);
      },
    });
    const plan = planFromOps([op("a"), op("b", ["a"])]);
    const scheduler = new Scheduler(baseConfig([exec]));
    const execPromise = scheduler.execute(plan);
    // Give 'a' a moment to start.
    await new Promise((r) => setTimeout(r, 20));
    await scheduler.cancel();
    releaseA();
    const result = await execPromise;
    expect(result.status).toBe("partial");
    expect(result.cancelledOperations).toContain("a");
    // b never ran (a was cancelled before completing).
    expect(result.outcomes.get("b")?.status).toBe("cancelled");
  });
});

describe("Scheduler — executor routing", () => {
  it("routes operations to the executor whose canExecute returns true", async () => {
    const docker = new MockExecutor({
      name: "docker",
      canExecute: (o) => o.executor.type === "docker",
    });
    const host = new MockExecutor({
      name: "host",
      canExecute: (o) => o.executor.type === "host",
    });
    const dockerOp: PlanOperation = validOperation({
      id: "d",
      name: "d",
      dependsOn: [],
      executor: { type: "docker", image: "img", imageDigest: "sha256:" + "a".repeat(64) },
    });
    const hostOp = op("h");
    const plan = planFromOps([dockerOp, hostOp]);
    const result = await new Scheduler(baseConfig([docker, host])).execute(plan);
    expect(result.status).toBe("success");
    expect(docker.calls.map((c) => c.operation.id)).toEqual(["d"]);
    expect(host.calls.map((c) => c.operation.id)).toEqual(["h"]);
  });

  it("raises NO_EXECUTOR when no executor matches an operation", async () => {
    const host = new MockExecutor({
      canExecute: (o) => o.executor.type === "host",
    });
    const dockerOp: PlanOperation = validOperation({
      id: "d",
      name: "d",
      dependsOn: [],
      executor: { type: "docker", image: "img", imageDigest: "sha256:" + "a".repeat(64) },
    });
    const plan = planFromOps([dockerOp]);
    await expect(new Scheduler(baseConfig([host])).execute(plan)).rejects.toMatchObject({
      code: "SCHEDULER_ERROR",
      context: expect.objectContaining({ code: "NO_EXECUTOR" }),
    });
  });

  it("raises CYCLE_DETECTED when the plan DAG has a cycle", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([
      op("a", ["c"]),
      op("b", ["a"]),
      op("c", ["b"]),
    ]);
    await expect(new Scheduler(baseConfig([exec])).execute(plan)).rejects.toMatchObject({
      code: "SCHEDULER_ERROR",
      context: expect.objectContaining({ code: "CYCLE_DETECTED" }),
    });
  });
});

describe("Scheduler — logs and artifacts", () => {
  it("collects logs and artifacts from every executed operation", async () => {
    const exec = new MockExecutor({
      result: (req) =>
        successResult(req.operation.id, {
          logs: `log-${req.operation.id}`,
          artifacts: [`art-${req.operation.id}`],
        }),
    });
    const plan = planFromOps([op("a"), op("b", ["a"])]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.outcomes.get("a")?.logs).toBe("log-a");
    expect(result.outcomes.get("a")?.artifacts).toEqual(["art-a"]);
    expect(result.outcomes.get("b")?.logs).toBe("log-b");
    expect(result.outcomes.get("b")?.artifacts).toEqual(["art-b"]);
  });
});

describe("Scheduler — result status semantics", () => {
  it("all ops succeed => status: success", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([op("a"), op("b")]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
  });

  it("a fatal failure => status: failure", async () => {
    const exec = new MockExecutor({
      result: (req) =>
        req.operation.id === "a" ? failureResult(req.operation.id) : successResult(req.operation.id),
    });
    const plan = planFromOps([op("a"), op("b", ["a"])]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("failure");
  });
});

describe("Scheduler — empty plan", () => {
  it("returns a success result with no outcomes for an empty plan", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    expect(result.outcomes.size).toBe(0);
  });
});

describe("Scheduler — dispose", () => {
  it("disposes executors that implement dispose()", async () => {
    const exec = new MockExecutor();
    const scheduler = new Scheduler(baseConfig([exec]));
    await scheduler.dispose();
    expect(exec.disposed).toBe(true);
  });
});
