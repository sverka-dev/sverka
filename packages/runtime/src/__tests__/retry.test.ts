import { describe, it, expect, vi, afterEach } from "vitest";
import { Scheduler } from "../scheduler.js";
import type { SchedulerConfig } from "../scheduler.js";
import {
  MockExecutor,
  planFromOps,
  successResult,
  failureResult,
  validOperation,
} from "./helpers/fixtures.js";

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

describe("Scheduler — retry policy", () => {
  afterEach(() => vi.useRealTimers());

  it("maxAttempts: 3, fail twice then succeed => success", async () => {
    let calls = 0;
    const exec = new MockExecutor({
      result: (req) => {
        calls++;
        if (calls < 3)
          return failureResult(req.operation.id, { error: "fail" });
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({
      id: "op-a",
      name: "a",
      retry: { maxAttempts: 3, backoffSeconds: 0, retryOn: ["failure"] },
    });
    const plan = planFromOps([opA]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.status).toBe("success");
    expect(result.outcomes.get("op-a")?.status).toBe("success");
    expect(calls).toBe(3);
  });

  it("fail all attempts => failure", async () => {
    let calls = 0;
    const exec = new MockExecutor({
      result: (req) => {
        calls++;
        return failureResult(req.operation.id, { error: "fail" });
      },
    });
    const opA = validOperation({
      id: "op-a",
      name: "a",
      retry: { maxAttempts: 3, backoffSeconds: 0, retryOn: ["failure"] },
    });
    const plan = planFromOps([opA]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.outcomes.get("op-a")?.status).toBe("failure");
    expect(calls).toBe(3);
  });

  it("retryOn: [timeout] does not retry on a non-timeout failure", async () => {
    let calls = 0;
    const exec = new MockExecutor({
      result: (req) => {
        calls++;
        return failureResult(req.operation.id, { error: "exit code 1" });
      },
    });
    const opA = validOperation({
      id: "op-a",
      name: "a",
      retry: { maxAttempts: 3, backoffSeconds: 0, retryOn: ["timeout"] },
    });
    const plan = planFromOps([opA]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.outcomes.get("op-a")?.status).toBe("failure");
    expect(calls).toBe(1);
  });

  it("retryOn: [timeout] retries on a timeout failure", async () => {
    let calls = 0;
    const exec = new MockExecutor({
      result: (req) => {
        calls++;
        if (calls < 2)
          return failureResult(req.operation.id, {
            error: "operation timeout exceeded",
          });
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({
      id: "op-a",
      name: "a",
      retry: { maxAttempts: 3, backoffSeconds: 0, retryOn: ["timeout"] },
    });
    const plan = planFromOps([opA]);
    const result = await new Scheduler(baseConfig([exec])).execute(plan);
    expect(result.outcomes.get("op-a")?.status).toBe("success");
    expect(calls).toBe(2);
  });

  it("backoffSeconds delays retries (fake timers)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const exec = new MockExecutor({
      result: (req) => {
        calls++;
        if (calls < 2)
          return failureResult(req.operation.id, { error: "fail" });
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({
      id: "op-a",
      name: "a",
      retry: { maxAttempts: 2, backoffSeconds: 5, retryOn: ["failure"] },
    });
    const plan = planFromOps([opA]);
    const execPromise = new Scheduler(baseConfig([exec])).execute(plan);
    // First attempt fails immediately. Then 5s backoff.
    await vi.advanceTimersByTimeAsync(5000);
    const result = await execPromise;
    expect(result.outcomes.get("op-a")?.status).toBe("success");
    expect(calls).toBe(2);
  });
});
