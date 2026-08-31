// Tests for Engine.query() — Spec 32 (Run Queries).
import { describe, it, expect } from "vitest";
import { createEngine } from "../engine.js";
import type { RunState, RunStatus } from "../types.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import { makeSingleStepPlan } from "./helpers/fixtures.js";
import type { RunPlan } from "@sverka/workflow";
import type { StepDefinition } from "@sverka/workflow";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sverka-query-test-"));
}

/** A simple 3-step linear plan (build → test → deploy) without output export. */
function makeSimpleLinearPlan(): RunPlan {
  const build: StepDefinition = {
    id: "ci/build",
    runtime: {},
    operations: [{ kind: "shell", command: "echo build" }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
  const test: StepDefinition = {
    id: "ci/test",
    runtime: {},
    operations: [{ kind: "shell", command: "echo test" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/build" }],
  };
  const deploy: StepDefinition = {
    id: "ci/deploy",
    runtime: {},
    operations: [{ kind: "shell", command: "echo deploy" }],
    inputs: [],
    outputs: [],
    dependencies: [{ kind: "control", producer: "ci/test" }],
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-linear",
    graphId: "graph-linear",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [build, test, deploy],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

describe("Engine.query() — Spec 32", () => {
  it("test 1: query() before any run returns undefined", () => {
    const engine = createEngine({ drivers: [createMockDriver()] });
    expect(engine.query()).toBeUndefined();
  });

  it("test 2: query() during an active run returns RunState with status running", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({
        drivers: [createMockDriver({ delayMs: 50 })],
      });
      const plan = makeSimpleLinearPlan(); // 3-step linear: build → test → deploy
      let captured: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "step-succeeded" && event.stepId === "ci/build") {
          // After build succeeds, test should be running, deploy pending.
          // Give a tick for the scheduler to launch test.
          await new Promise((r) => setTimeout(r, 10));
          captured = engine.query();
          break;
        }
      }

      expect(captured).toBeDefined();
      expect(captured!.status).toBe("running");
      expect(captured!.runId).toBeTruthy();
      expect(captured!.planId).toBe(plan.id);
      expect(captured!.startedAt).toBeGreaterThan(0);
      expect(captured!.steps).toHaveLength(3);

      const buildStep = captured!.steps.find((s) => s.stepId === "ci/build");
      expect(buildStep?.state).toBe("succeeded");
      expect(buildStep?.durationMs).toBeDefined();

      const testStep = captured!.steps.find((s) => s.stepId === "ci/test");
      expect(testStep?.state).toMatch(/running|pending|ready/);

      const deployStep = captured!.steps.find((s) => s.stepId === "ci/deploy");
      expect(deployStep?.state).toBe("pending");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 3: query(activeRunId) returns the same state as query()", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({
        drivers: [createMockDriver({ delayMs: 50 })],
      });
      const plan = makeSingleStepPlan();
      let activeRunId: string | undefined;
      let capturedById: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "run-started") {
          activeRunId = event.runId;
        }
        if (event.type === "step-started") {
          capturedById = engine.query(activeRunId);
          break;
        }
      }

      expect(capturedById).toBeDefined();
      expect(capturedById!.runId).toBe(activeRunId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 4: query(unknown-id) during active run returns undefined", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({
        drivers: [createMockDriver({ delayMs: 50 })],
      });
      const plan = makeSingleStepPlan();
      let result: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "step-started") {
          result = engine.query("unknown-id-12345");
          break;
        }
      }

      expect(result).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 5: query() after run-completed returns undefined", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({ drivers: [createMockDriver()] });
      const plan = makeSingleStepPlan();

      for await (const _event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        // consume all events
      }

      expect(engine.query()).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 6: RunState.steps reflects mid-run snapshot with correct states", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({
        drivers: [createMockDriver({ delayMs: 50 })],
      });
      const plan = makeSimpleLinearPlan();
      let captured: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "step-succeeded" && event.stepId === "ci/build") {
          await new Promise((r) => setTimeout(r, 10));
          captured = engine.query();
          break;
        }
      }

      expect(captured).toBeDefined();
      const states = new Map(captured!.steps.map((s) => [s.stepId, s.state]));
      expect(states.get("ci/build")).toBe("succeeded");
      // test should be running or ready (scheduler launched it)
      expect(["running", "ready", "pending"]).toContain(states.get("ci/test"));
      expect(states.get("ci/deploy")).toBe("pending");

      const buildStep = captured!.steps.find((s) => s.stepId === "ci/build");
      expect(buildStep?.durationMs).toBeDefined();
      expect(buildStep!.durationMs!).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 7: query inside for-await on run-completed iteration returns terminal status", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({ drivers: [createMockDriver()] });
      const plan = makeSingleStepPlan();
      let terminalState: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "run-completed") {
          // Query before the generator resumes — currentRun should still be set
          // with the terminal status.
          terminalState = engine.query();
        }
      }

      expect(terminalState).toBeDefined();
      expect(terminalState!.status).toBe("success");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 8: a failed step appears with state failed and durationMs present", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({ drivers: [createMockDriver()] });
      const plan = makeSingleStepPlan("exit 1");
      let failedState: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "step-failed") {
          failedState = engine.query();
          break;
        }
      }

      expect(failedState).toBeDefined();
      const step = failedState!.steps.find((s) => s.stepId === "ci/hello");
      expect(step?.state).toBe("failed");
      expect(step?.durationMs).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 9: a skipped step appears with state skipped and no durationMs", async () => {
    const dir = await makeTempDir();
    try {
      const engine = createEngine({ drivers: [createMockDriver()] });
      // A plan with a step that has a "never" condition → skipped.
      const plan: RunPlan = {
        apiVersion: "sverka.dev/v1run",
        id: "rp-skip-test",
        graphId: "graph-skip-test",
        entry: { id: "ci/on-push", trigger: { kind: "push" } },
        inputs: {},
        steps: [
          {
            id: "ci/hello",
            runtime: {},
            operations: [{ kind: "shell", command: "echo hello" }],
            inputs: [],
            outputs: [],
            dependencies: [],
            condition: { kind: "status", status: "never" },
          },
        ],
        createdAt: "2026-08-13T00:00:00.000Z",
      };

      let skippedState: RunState | undefined;

      for await (const event of engine.run({
        plan,
        workspace: dir,
        artifactDir: join(dir, "artifacts"),
      })) {
        if (event.type === "step-skipped") {
          skippedState = engine.query();
          break;
        }
      }

      expect(skippedState).toBeDefined();
      const step = skippedState!.steps.find((s) => s.stepId === "ci/hello");
      expect(step?.state).toBe("skipped");
      expect(step?.durationMs).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 10: RunState is exported and assignable (type-level test)", () => {
    const state: RunState = {
      runId: "test-run",
      planId: "rp-test",
      status: "running",
      startedAt: Date.now(),
      steps: [
        { stepId: "ci/build", state: "succeeded", durationMs: 100 },
        { stepId: "ci/test", state: "running" },
        { stepId: "ci/deploy", state: "pending" },
      ],
    };
    expect(state.runId).toBe("test-run");
    expect(state.status).toBe("running");
    expect(state.steps).toHaveLength(3);

    // Verify RunStatus terminal values are assignable to status
    const terminal: RunStatus = "success";
    const terminalState: RunState = { ...state, status: terminal };
    expect(terminalState.status).toBe("success");
  });

  it("test 12: no any in RunState or query implementation", async () => {
    // Read the source files and verify no `any` appears in RunState or query.
    const { readFile } = await import("node:fs/promises");
    const typesSource = await readFile(
      join(import.meta.dirname, "..", "types.ts"),
      "utf-8",
    );
    const engineSource = await readFile(
      join(import.meta.dirname, "..", "engine.ts"),
      "utf-8",
    );

    // Check RunState definition block for `any`
    const runStateBlock = typesSource.slice(
      typesSource.indexOf("export interface RunState"),
      typesSource.indexOf("export interface Engine"),
    );
    expect(runStateBlock).not.toContain(" any");
    expect(runStateBlock).not.toContain(": any");

    // Check query method for `any`
    const queryBlock = engineSource.slice(
      engineSource.indexOf("query("),
      engineSource.indexOf("async *run("),
    );
    expect(queryBlock).not.toContain(": any");
    expect(queryBlock).not.toContain(" any ");
  });
});
