import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "../types.js";

function makeRetryPlan(retry: StepDefinition["retry"], command = "exit 1"): RunPlan {
  const step: StepDefinition = {
    id: "ci/flaky",
    runtime: {},
    operations: [{ kind: "shell", command }],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...(retry ? { retry } : {}),
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-retry",
    graphId: "graph-retry",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [step],
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

async function collectEvents(
  engine: ReturnType<typeof createEngine>,
  request: Parameters<ReturnType<typeof createEngine>["run"]>[0],
): Promise<{ type: string; stepId?: string; attempt?: number; nextAttemptMs?: number; error?: string; status?: string }[]> {
  const events: { type: string; stepId?: string; attempt?: number; nextAttemptMs?: number; error?: string; status?: string }[] = [];
  for await (const event of engine.run(request)) {
    events.push(event as never);
  }
  return events;
}

describe("Engine — retry integration", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-retry-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("retries a failing step up to max+1 attempts, then fails", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "flaky",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 2 }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    // max=2 → 3 total attempts (1 initial + 2 retries)
    expect(calls).toBe(3);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(2);
    expect(retries[0]?.attempt).toBe(1);
    expect(retries[1]?.attempt).toBe(2);
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed).toBeDefined();
    const completed = events.find((e) => e.type === "run-completed") as never as { status: string };
    expect(completed.status).toBe("failure");
  });

  it("succeeds on retry when an earlier attempt fails", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "recover",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        if (calls < 2) {
          return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
        }
        return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 3 }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(calls).toBe(2);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.attempt).toBe(1);
    const succeeded = events.find((e) => e.type === "step-succeeded");
    expect(succeeded).toBeDefined();
    const completed = events.find((e) => e.type === "run-completed") as never as { status: string };
    expect(completed.status).toBe("success");
  });

  it("emits step-started once, step-retry before each rerun", async () => {
    const driver: RuntimeDriver = {
      name: "always-fail",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 1 }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    const started = events.filter((e) => e.type === "step-started");
    expect(started).toHaveLength(1);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(1);
    // step-started comes before step-retry
    const startedIdx = events.findIndex((e) => e.type === "step-started");
    const retryIdx = events.findIndex((e) => e.type === "step-retry");
    expect(startedIdx).toBeLessThan(retryIdx);
    // step-retry comes before step-failed
    const failedIdx = events.findIndex((e) => e.type === "step-failed");
    expect(retryIdx).toBeLessThan(failedIdx);
  });

  it("without backoff, retries are immediate (nextAttemptMs=0)", async () => {
    const driver: RuntimeDriver = {
      name: "fail",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 1 }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    const retry = events.find((e) => e.type === "step-retry");
    expect(retry?.nextAttemptMs).toBe(0);
  });

  it("with backoff, waits min(baseMs * factor^(attempt-1), maxMs) before retry", async () => {
    const driver: RuntimeDriver = {
      name: "fail",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 2, backoff: { baseMs: 50, maxMs: 200, factor: 2 } }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(2);
    // attempt 1: 50 * 2^0 = 50
    expect(retries[0]?.nextAttemptMs).toBe(50);
    // attempt 2: 50 * 2^1 = 100
    expect(retries[1]?.nextAttemptMs).toBe(100);
  });

  it("backoff respects maxMs cap", async () => {
    const driver: RuntimeDriver = {
      name: "fail",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 3, backoff: { baseMs: 100, maxMs: 150, factor: 2 } }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(3);
    // attempt 1: 100 * 2^0 = 100
    expect(retries[0]?.nextAttemptMs).toBe(100);
    // attempt 2: 100 * 2^1 = 200, capped to 150
    expect(retries[1]?.nextAttemptMs).toBe(150);
    // attempt 3: 100 * 2^2 = 400, capped to 150
    expect(retries[2]?.nextAttemptMs).toBe(150);
  });

  it("exitCodes filter: only retries on specified exit codes", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "exit-codes",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        // Exit code 42 (not in exitCodes list)
        return { exitCode: 42, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 3, exitCodes: [1, 2] }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    // exit code 42 is not in [1,2], so no retry
    expect(calls).toBe(1);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(0);
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed).toBeDefined();
  });

  it("exitCodes filter: retries on matching exit code", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "exit-codes-match",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 2, exitCodes: [1] }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(calls).toBe(3);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(2);
  });

  it("no retry when max=0", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "no-retry",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan({ max: 0 }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(calls).toBe(1);
    const retries = events.filter((e) => e.type === "step-retry");
    expect(retries).toHaveLength(0);
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed).toBeDefined();
  });

  it("step without retry policy: no retries", async () => {
    let calls = 0;
    const driver: RuntimeDriver = {
      name: "no-policy",
      canExecute: () => true,
      executeShell: async (): Promise<ShellResult> => {
        calls++;
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });

    const events = await collectEvents(engine, {
      plan: makeRetryPlan(undefined),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });

    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === "step-retry")).toHaveLength(0);
  });
});
