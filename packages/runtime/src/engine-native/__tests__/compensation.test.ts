// Spec 30 — Saga compensations: engine compensation phase.
// Test plan items 4–13.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";
import type { RuntimeDriver, ShellExecuteRequest, ShellResult } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────

/** Build a step definition with optional compensation and dependency. */
function mkStep(id: string, cmd: string, comp?: string, dep?: string): StepDefinition {
  return {
    id,
    runtime: {},
    operations: [{ kind: "shell", command: cmd }],
    inputs: [],
    outputs: [],
    dependencies: dep ? [{ kind: "control", producer: dep }] : [],
    ...(comp ? { compensation: { kind: "shell", command: comp } } : {}),
  };
}

/** Build a RunPlan wrapping the given steps. */
function wrapPlan(id: string, graphId: string, steps: StepDefinition[]): RunPlan {
  return {
    apiVersion: "sverka.dev/v1run",
    id,
    graphId,
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps,
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

/** A 3-step linear plan A→B→C where C fails. A and B have compensations. */
function makeLinearFailPlan(
  compensations: { a?: string; b?: string; c?: string } = {},
): RunPlan {
  return wrapPlan("rp-saga", "graph-saga", [
    mkStep("ci/a", "echo a", compensations.a),
    mkStep("ci/b", "echo b", compensations.b, "ci/a"),
    mkStep("ci/c", "exit 1", compensations.c, "ci/b"),
  ]);
}

/** A 3-step linear plan A→B→C where all succeed. */
function makeLinearSuccessPlan(
  compensations: { a?: string; b?: string; c?: string } = {},
): RunPlan {
  return wrapPlan("rp-saga-ok", "graph-saga-ok", [
    mkStep("ci/a", "echo a", compensations.a),
    mkStep("ci/b", "echo b", compensations.b, "ci/a"),
    mkStep("ci/c", "echo c", compensations.c, "ci/b"),
  ]);
}

/** A single-step plan where the step has a compensation but fails. */
function makeSingleFailPlan(compensation?: string): RunPlan {
  return wrapPlan("rp-saga-single", "graph-saga-single", [
    mkStep("ci/only", "exit 1", compensation),
  ]);
}

/** A plan where a step is skipped (condition: never) and has a compensation. */
function makeSkippedPlan(compensation?: string): RunPlan {
  return wrapPlan("rp-saga-skip", "graph-saga-skip", [
    mkStep("ci/build", "echo build"),
    { ...mkStep("ci/skip", "echo skip", compensation, "ci/build"), condition: { kind: "status", status: "never" } },
  ]);
}

async function collectEvents(
  engine: ReturnType<typeof createEngine>,
  request: Parameters<ReturnType<typeof createEngine>["run"]>[0],
): Promise<{ type: string; stepId?: string; command?: string; status?: string; durationMs?: number; severity?: string; message?: string }[]> {
  const events: { type: string; stepId?: string; command?: string; status?: string; durationMs?: number; severity?: string; message?: string }[] = [];
  for await (const event of engine.run(request)) {
    events.push(event as never);
  }
  return events;
}

/** Run a plan with standard workspace/artifactDir under the given testDir. */
async function runPlan(
  engine: ReturnType<typeof createEngine>,
  plan: RunPlan,
  testDir: string,
  extra?: Parameters<ReturnType<typeof createEngine>["run"]>[0],
): Promise<ReturnType<typeof collectEvents>> {
  return collectEvents(engine, {
    plan,
    workspace: join(testDir, "ws"),
    artifactDir: join(testDir, "art"),
    ...extra,
  });
}

/** Create a tracking driver that records commands and fails on "exit 1". */
function makeTrackingDriver(
  onCommand?: (req: ShellExecuteRequest) => void,
): RuntimeDriver {
  return {
    name: "tracking",
    canExecute: () => true,
    executeShell: async (req: ShellExecuteRequest): Promise<ShellResult> => {
      onCommand?.(req);
      if (req.command.trim().startsWith("exit 1")) {
        return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
      }
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    },
  };
}

/** Extract stepIds from events of a given type. */
function stepIdsByType(events: { type: string; stepId?: string }[], type: string): string[] {
  return events.filter((e) => e.type === type).map((e) => e.stepId!);
}

/** Find the run-completed event and return its status. */
function runStatus(events: { type: string; status?: string }[]): string {
  return (events.find((e) => e.type === "run-completed") as never as { status: string }).status;
}

// ── Tests ─────────────────────────────────────────────────────────

describe("Engine — saga compensations (Spec 30)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-saga-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("item 4: succeeded upstream steps with compensation run in reverse completion order", async () => {
    const calls: string[] = [];
    const driver = makeTrackingDriver((req) => calls.push(req.command));
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearFailPlan({ a: "rollback-a.sh", b: "rollback-b.sh" }), testDir);

    // A and B succeeded, C failed. Compensations should run B then A (reverse).
    expect(stepIdsByType(events, "step-compensating")).toEqual(["ci/b", "ci/a"]);

    // The driver should have been called with rollback-b.sh then rollback-a.sh
    const rollbackCalls = calls.filter((c) => c.startsWith("rollback"));
    expect(rollbackCalls).toEqual(["rollback-b.sh", "rollback-a.sh"]);

    expect(runStatus(events)).toBe("failure");
  });

  it("item 5: step with no compensation is skipped during compensation phase", async () => {
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearFailPlan({ a: "rollback-a.sh" }), testDir);

    // Only ci/a should be compensated; ci/b has no compensation.
    expect(stepIdsByType(events, "step-compensating")).toEqual(["ci/a"]);
  });

  it("item 6: a failed step with compensation does NOT have its compensation run", async () => {
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearFailPlan({ a: "rollback-a.sh", c: "rollback-c.sh" }), testDir);

    const compensating = stepIdsByType(events, "step-compensating");
    expect(compensating).not.toContain("ci/c");
    expect(compensating).toContain("ci/a");
  });

  it("item 7: a skipped step with compensation does NOT have its compensation run", async () => {
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeSkippedPlan("rollback-skip.sh"), testDir);

    // build succeeded but has no compensation → no compensating events at all
    expect(stepIdsByType(events, "step-compensating")).toEqual([]);
    expect(runStatus(events)).toBe("success");
  });

  it("item 8: run that ends success — no compensation events emitted", async () => {
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearSuccessPlan({ a: "rollback-a.sh", b: "rollback-b.sh", c: "rollback-c.sh" }), testDir);

    expect(events.filter((e) => e.type === "step-compensating")).toHaveLength(0);
    expect(events.filter((e) => e.type === "step-compensated")).toHaveLength(0);
    expect(runStatus(events)).toBe("success");
  });

  it("item 9: run that ends cancelled — no compensation events emitted", async () => {
    // Cancel mid-run using a slow driver + engine.cancel().
    const { createCancellableMockDriver } = await import("./helpers/mock-driver.js");
    const slowDriver = createCancellableMockDriver(500);
    const engine = createEngine({ drivers: [slowDriver] });
    const iter = engine.run({
      plan: makeSingleFailPlan("rollback.sh"),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    const events: { type: string; stepId?: string }[] = [];
    const collectPromise = (async () => {
      for await (const event of iter) {
        events.push(event as { type: string; stepId?: string });
      }
    })();
    setTimeout(() => engine.cancel(), 50);
    await collectPromise;

    const compensating = events.filter((e) => e.type === "step-compensating");
    const compensated = events.filter((e) => e.type === "step-compensated");
    expect(compensating).toHaveLength(0);
    expect(compensated).toHaveLength(0);

    const completed = events.find((e) => e.type === "run-completed") as never as { status: string };
    expect(completed.status).toBe("cancelled");
  });

  it("item 10: compensation command that fails (exit 1) → warn diagnostic + step-compensated failed; subsequent compensations still run", async () => {
    // A's compensation fails (exit 1), B's compensation should still run.
    const driver: RuntimeDriver = {
      name: "mixed",
      canExecute: () => true,
      executeShell: async (req: ShellExecuteRequest): Promise<ShellResult> => {
        if (req.command.trim().startsWith("exit 1")) {
          return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
        }
        if (req.command === "rollback-a-fail.sh") {
          return { exitCode: 1, stdout: "", stderr: "rollback failed", durationMs: 1, timedOut: false };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearFailPlan({ a: "rollback-a-fail.sh", b: "rollback-b.sh" }), testDir);

    const compensated = events.filter((e) => e.type === "step-compensated");
    expect(compensated.find((e) => e.stepId === "ci/b")?.status).toBe("succeeded");
    expect(compensated.find((e) => e.stepId === "ci/a")?.status).toBe("failed");

    const warnings = events.filter((e) => e.type === "diagnostic" && e.severity === "warn" && e.stepId === "ci/a");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(compensated).toHaveLength(2);
  });

  it("item 11: step-compensating carries command; step-compensated carries status and durationMs", async () => {
    const driver = createMockDriver();
    const engine = createEngine({ drivers: [driver] });
    const events = await runPlan(engine, makeLinearFailPlan({ a: "rollback-a.sh" }), testDir);

    const compensating = events.find((e) => e.type === "step-compensating" && e.stepId === "ci/a");
    expect(compensating?.command).toBe("rollback-a.sh");

    const compensated = events.find((e) => e.type === "step-compensated" && e.stepId === "ci/a");
    expect(compensated?.status).toBe("succeeded");
    expect(typeof compensated?.durationMs).toBe("number");
  });

  it("item 12: compensation runs in the step's workspace with the step's runtime env", async () => {
    const seenRequests: ShellExecuteRequest[] = [];
    const driver = makeTrackingDriver((req) => seenRequests.push(req));
    const engine = createEngine({ drivers: [driver] });

    const a: StepDefinition = {
      ...mkStep("ci/a", "echo a", "rollback.sh"),
      runtime: { env: { DEPLOY_ENV: "staging" } },
    };
    const plan = wrapPlan("rp-saga-env", "graph-saga-env", [a, mkStep("ci/b", "exit 1", undefined, "ci/a")]);

    await runPlan(engine, plan, testDir);

    const compReq = seenRequests.find((r) => r.command === "rollback.sh");
    expect(compReq).toBeDefined();
    expect(compReq!.workspace).toContain("ci/a");
    expect(compReq!.env.DEPLOY_ENV).toBe("staging");
  });

  it("cache-restored steps are excluded from compensation phase", async () => {
    const { createFileCacheStore } = await import("../cache-store.js");
    const cache = createFileCacheStore({ cacheDir: join(testDir, "cache") });

    const calls: string[] = [];
    const driver = makeTrackingDriver((req) => calls.push(req.command));

    const a: StepDefinition = {
      ...mkStep("ci/a", "echo a", "rollback-a.sh"),
      cache: { key: "a-key", paths: ["."] },
    };
    const plan = wrapPlan("rp-saga-cache", "graph-saga-cache", [a, mkStep("ci/b", "exit 1", undefined, "ci/a")]);

    // First run: A executes (caches), B fails → compensation runs for A.
    const engine1 = createEngine({ drivers: [driver], cache });
    const events1 = await collectEvents(engine1, { plan, workspace: join(testDir, "ws1"), artifactDir: join(testDir, "art1") });
    expect(stepIdsByType(events1, "step-compensating")).toContain("ci/a");

    // Second run: A should be a cache hit, B fails → compensation should NOT run.
    calls.length = 0;
    const engine2 = createEngine({ drivers: [driver], cache });
    const events2 = await collectEvents(engine2, { plan, workspace: join(testDir, "ws2"), artifactDir: join(testDir, "art2") });
    const cacheHit = events2.find((e) => e.type === "step-cache-hit");
    expect(cacheHit).toBeDefined();
    expect(cacheHit!.stepId).toBe("ci/a");
    expect(stepIdsByType(events2, "step-compensating")).not.toContain("ci/a");
  });

  it("compensation command is interpolated — ${...} references resolved", async () => {
    const seenCommands: string[] = [];
    const driver = makeTrackingDriver((req) => seenCommands.push(req.command));
    const plan: RunPlan = {
      ...wrapPlan("rp-interp", "graph-interp", [
        mkStep("ci/a", "echo a", "rollback --env=${env}"),
        mkStep("ci/b", "exit 1", undefined, "ci/a"),
      ]),
      inputs: { env: "production" },
    };
    const engine = createEngine({ drivers: [driver] });
    await runPlan(engine, plan, testDir);
    const compCmd = seenCommands.find((c) => c.startsWith("rollback"));
    expect(compCmd).toBeDefined();
    expect(compCmd).toContain("production");
  });

  it("compensation respects safe-outputs — read-only steps get no secrets", async () => {
    const seenRequests: { command: string; env: Record<string, string> }[] = [];
    const driver: RuntimeDriver = {
      name: "tracking",
      canExecute: () => true,
      executeShell: async (req: ShellExecuteRequest): Promise<ShellResult> => {
        seenRequests.push({ command: req.command, env: req.env });
        if (req.command.trim().startsWith("exit 1")) {
          return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    };
    const plan = wrapPlan("rp-safe", "graph-safe", [
      { ...mkStep("ci/a", "echo a", "rollback.sh"), runtime: { secrets: ["MY_SECRET"] } },
      mkStep("ci/b", "exit 1", undefined, "ci/a"),
    ]);
    const engine = createEngine({ drivers: [driver] });
    await runPlan(engine, plan, testDir, { secrets: { resolve: async (name: string) => (name === "MY_SECRET" ? "secret-value" : undefined) } });
    const compReq = seenRequests.find((r) => r.command.includes("rollback.sh"));
    expect(compReq).toBeDefined();
    expect(compReq!.env["MY_SECRET"]).toBeUndefined();
  });

  it("item 12: cancel during compensation stops subsequent compensations", async () => {
    // Two succeeded steps (A, B) with compensations, C fails.
    // The first compensation (B) is slow and gets cancelled mid-flight.
    // The second compensation (A) must NOT be scheduled because the abort
    // signal is already aborted.
    const { createCancellableMockDriver } = await import("./helpers/mock-driver.js");
    const slowDriver = createCancellableMockDriver(500);
    // Override: only compensation commands use the slow path; step execution
    // is instant so the run reaches the compensation phase quickly.
    const driver: RuntimeDriver = {
      name: "mixed-cancel",
      canExecute: () => true,
      executeShell: async (req: ShellExecuteRequest): Promise<ShellResult> => {
        if (req.command.trim().startsWith("exit 1")) {
          return { exitCode: 1, stdout: "", stderr: "fail", durationMs: 1, timedOut: false };
        }
        if (req.command.startsWith("rollback")) {
          // Use the slow, cancellable path for compensations.
          return slowDriver.executeShell(req);
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    };
    const engine = createEngine({ drivers: [driver] });
    const iter = engine.run({
      plan: makeLinearFailPlan({ a: "rollback-a.sh", b: "rollback-b.sh" }),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    const events: { type: string; stepId?: string; status?: string }[] = [];
    const collectPromise = (async () => {
      for await (const event of iter) {
        events.push(event as { type: string; stepId?: string; status?: string });
      }
    })();
    // Cancel shortly after the run starts — the compensation phase begins
    // after C fails, and the first compensation (B) is slow (500ms).
    // The 50ms cancel fires while B's compensation awaits executeShell.
    setTimeout(() => engine.cancel(), 50);
    await collectPromise;

    const compensating = events.filter((e) => e.type === "step-compensating");
    const compensated = events.filter((e) => e.type === "step-compensated");

    // B's compensation started (step-compensating emitted) but was cancelled.
    expect(compensating.map((e) => e.stepId)).toContain("ci/b");
    // A's compensation must NOT have been scheduled — the abort signal fired
    // while B's compensation was in-flight, so the loop exits before reaching A.
    expect(compensating.map((e) => e.stepId)).not.toContain("ci/a");
    expect(compensated.map((e) => e.stepId)).not.toContain("ci/a");
  });
});
