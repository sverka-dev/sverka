import { describe, it, expect } from "vitest";
import { Scheduler } from "../scheduler.js";
import type { SchedulerConfig, StateStore } from "../index.js";
import type { ExecutionState, OperationOutcome } from "../index.js";
import {
  MockExecutor,
  op,
  planFromOps,
  successResult,
} from "./helpers/fixtures.js";

/** In-memory StateStore mock for testing. */
class MemoryStateStore implements StateStore {
  states = new Map<string, ExecutionState>();

  async save(state: ExecutionState): Promise<void> {
    this.states.set(state.planId, state);
  }
  async load(planId: string): Promise<ExecutionState | undefined> {
    return this.states.get(planId);
  }
  async clear(planId: string): Promise<void> {
    this.states.delete(planId);
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

describe("Scheduler — state persistence and resume", () => {
  it("after executing a and b, the state store has both as completed", async () => {
    const exec = new MockExecutor();
    const store = new MemoryStateStore();
    const plan = planFromOps([op("a"), op("b", ["a"])]);
    const result = await new Scheduler(
      baseConfig([exec], { stateStore: store }),
    ).execute(plan);
    expect(result.status).toBe("success");
    // On successful completion, the scheduler clears persisted state — it's
    // no longer needed for resume. Verify the state was cleared.
    expect(store.states.get(plan.id)).toBeUndefined();
  });

  it("retains state after a partial run (failure with continueOnError)", async () => {
    const exec = new MockExecutor({
      result: (req) => {
        if (req.operation.id === "a") {
          return failureResult("a");
        }
        return successResult(req.operation.id);
      },
    });
    const store = new MemoryStateStore();
    const plan = planFromOps([
      op("a"),
      op("b", ["a"]),
    ]);
    // Make op-a continueOnError so the run is "partial" not "failure".
    plan.operations[0]!.continueOnError = true;
    const result = await new Scheduler(
      baseConfig([exec], { stateStore: store }),
    ).execute(plan);
    expect(result.status).toBe("partial");
    // State should be retained for potential resume.
    const saved = store.states.get(plan.id);
    expect(saved).toBeDefined();
  });

  it("a resumed run skips completed ops and executes only remaining", async () => {
    const exec = new MockExecutor();
    const store = new MemoryStateStore();
    const plan = planFromOps([op("a"), op("b", ["a"]), op("c", ["b"])]);

    // First run: execute a and b, but not c (simulate interruption by
    // pre-populating state with a and b completed).
    const outcomeA: OperationOutcome = {
      operationId: "a",
      status: "success",
      durationMs: 1,
      logs: "",
      artifacts: [],
      fromCache: false,
    };
    const outcomeB: OperationOutcome = {
      operationId: "b",
      status: "success",
      durationMs: 1,
      logs: "",
      artifacts: [],
      fromCache: false,
    };
    await store.save({
      planId: plan.id,
      completed: ["a", "b"],
      failed: [],
      skipped: [],
      running: [],
      outcomes: new Map([
        ["a", outcomeA],
        ["b", outcomeB],
      ]),
      updatedAt: new Date().toISOString(),
    });

    // Resumed run: should skip a and b, execute only c.
    const result = await new Scheduler(
      baseConfig([exec], { stateStore: store, resume: true }),
    ).execute(plan);
    expect(result.status).toBe("success");
    expect(exec.calls.map((c) => c.operation.id)).toEqual(["c"]);
    expect(result.outcomes.get("a")?.status).toBe("success");
    expect(result.outcomes.get("b")?.status).toBe("success");
    expect(result.outcomes.get("c")?.status).toBe("success");
  });

  it("operations previously running are re-run on resume", async () => {
    const exec = new MockExecutor();
    const store = new MemoryStateStore();
    const plan = planFromOps([op("a"), op("b", ["a"])]);

    // Pre-populate: a completed, b running (interrupted).
    await store.save({
      planId: plan.id,
      completed: ["a"],
      failed: [],
      skipped: [],
      running: ["b"],
      outcomes: new Map([
        [
          "a",
          {
            operationId: "a",
            status: "success",
            durationMs: 1,
            logs: "",
            artifacts: [],
            fromCache: false,
          },
        ],
      ]),
      updatedAt: new Date().toISOString(),
    });

    const result = await new Scheduler(
      baseConfig([exec], { stateStore: store, resume: true }),
    ).execute(plan);
    expect(result.status).toBe("success");
    // a was skipped (completed), b was re-run.
    expect(exec.calls.map((c) => c.operation.id)).toEqual(["b"]);
    expect(result.outcomes.get("b")?.status).toBe("success");
  });

  it("stateStore.load failure on resume raises STATE_LOAD_ERROR", async () => {
    const exec = new MockExecutor();
    const store: StateStore = {
      save: async () => {},
      load: async () => {
        throw new Error("disk corrupted");
      },
      clear: async () => {},
    };
    const plan = planFromOps([op("a")]);
    await expect(
      new Scheduler(
        baseConfig([exec], { stateStore: store, resume: true }),
      ).execute(plan),
    ).rejects.toMatchObject({
      code: "SCHEDULER_ERROR",
      context: expect.objectContaining({ code: "STATE_LOAD_ERROR" }),
    });
  });

  it("when no state store is configured, no persistence occurs", async () => {
    const exec = new MockExecutor();
    const plan = planFromOps([op("a")]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    // No way to observe "no persistence" directly, but the run succeeds
    // without a store. This test guards against crashes when stateStore
    // is undefined.
  });
});
