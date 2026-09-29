import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../src/reducer.js";
import {
  runStarted,
  stepPending,
  stepReady,
  stepStarted,
  stepSucceeded,
  stepFailed,
  stepSkipped,
  stepCancelled,
  stepCacheHit,
  stepRetry,
  runCompleted,
  diagnostic,
} from "./helpers/fixtures.js";

describe("EventReducer", () => {
  it("createInitialState returns empty state with null fields", () => {
    const state = createInitialState();
    expect(state.runId).toBeNull();
    expect(state.planId).toBeNull();
    expect(state.status).toBeNull();
    expect(state.durationMs).toBeNull();
    expect(state.steps.size).toBe(0);
    expect(state.diagnostics).toHaveLength(0);
  });

  it("run-started sets runId and planId", () => {
    const state = reduceEvent(
      createInitialState(),
      runStarted("run-1", "plan-abc"),
    );
    expect(state.runId).toBe("run-1");
    expect(state.planId).toBe("plan-abc");
  });

  it("step lifecycle: pending → ready → started → succeeded", () => {
    let state = createInitialState();
    state = reduceEvent(state, stepPending("ci/lint"));
    expect(state.steps.get("ci/lint")?.state).toBe("pending");

    state = reduceEvent(state, stepReady("ci/lint"));
    expect(state.steps.get("ci/lint")?.state).toBe("ready");

    state = reduceEvent(state, stepStarted("ci/lint"));
    expect(state.steps.get("ci/lint")?.state).toBe("running");

    state = reduceEvent(state, stepSucceeded("ci/lint", 120));
    expect(state.steps.get("ci/lint")?.state).toBe("succeeded");
    expect(state.steps.get("ci/lint")?.durationMs).toBe(120);
  });

  it("step-failed sets state, error, and durationMs", () => {
    let state = createInitialState();
    state = reduceEvent(state, stepFailed("ci/test", "exit code 1", 340));
    const step = state.steps.get("ci/test");
    expect(step?.state).toBe("failed");
    expect(step?.error).toBe("exit code 1");
    expect(step?.durationMs).toBe(340);
  });

  it("step-skipped and step-cancelled set appropriate state", () => {
    let state = createInitialState();
    state = reduceEvent(state, stepSkipped("ci/deploy"));
    expect(state.steps.get("ci/deploy")?.state).toBe("skipped");

    state = reduceEvent(state, stepCancelled("ci/deploy2"));
    expect(state.steps.get("ci/deploy2")?.state).toBe("cancelled");
  });

  it("step-cache-hit sets state to cache-hit", () => {
    let state = createInitialState();
    state = reduceEvent(state, stepCacheHit("ci/lint", "abc123"));
    expect(state.steps.get("ci/lint")?.state).toBe("cache-hit");
  });

  it("step-retry stores attempt number", () => {
    let state = createInitialState();
    state = reduceEvent(state, stepStarted("ci/lint"));
    state = reduceEvent(state, stepRetry("ci/lint", 2, 1000));
    const step = state.steps.get("ci/lint");
    expect(step?.state).toBe("running");
    expect(step?.attempt).toBe(2);
  });

  it("run-completed sets status and durationMs", () => {
    let state = createInitialState();
    state = reduceEvent(state, runCompleted("run-1", "success", 560));
    expect(state.status).toBe("success");
    expect(state.durationMs).toBe(560);
  });

  it("diagnostic appends to diagnostics array", () => {
    let state = createInitialState();
    state = reduceEvent(
      state,
      diagnostic("ci/lint", "something happened", "warn"),
    );
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toEqual({
      stepId: "ci/lint",
      message: "something happened",
      severity: "warn",
    });
  });

  it("reduceEvent does not mutate the input state (pure)", () => {
    const initial = createInitialState();
    const frozen = {
      ...initial,
      steps: new Map(initial.steps),
      diagnostics: [...initial.diagnostics],
    };
    reduceEvent(initial, stepPending("ci/lint"));
    // Original state should be unchanged
    expect(initial.steps.size).toBe(frozen.steps.size);
    expect(initial.diagnostics).toHaveLength(frozen.diagnostics.length);
    expect(initial.runId).toBe(frozen.runId);
  });

  it("captures run/step timestamps from event `at`", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      type: "run-started",
      runId: "r",
      planId: "p",
      at: 1000,
    });
    state = reduceEvent(state, {
      type: "step-started",
      stepId: "a",
      at: 1100,
    });
    state = reduceEvent(state, {
      type: "step-succeeded",
      stepId: "a",
      durationMs: 400,
      at: 1500,
    });
    state = reduceEvent(state, {
      type: "run-completed",
      runId: "r",
      status: "success",
      durationMs: 500,
      at: 1500,
    });
    expect(state.startedAt).toBe(1000);
    expect(state.finishedAt).toBe(1500);
    expect(state.steps.get("a")?.startedAt).toBe(1100);
    expect(state.steps.get("a")?.finishedAt).toBe(1500);
  });

  it("terminal event preserves startedAt from earlier events", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      type: "step-started",
      stepId: "a",
      at: 1100,
    });
    state = reduceEvent(state, {
      type: "step-failed",
      stepId: "a",
      error: "boom",
      durationMs: 40,
      at: 1200,
    });
    const step = state.steps.get("a");
    expect(step?.startedAt).toBe(1100);
    expect(step?.finishedAt).toBe(1200);
    expect(step?.state).toBe("failed");
  });

  it("captures stdout/stderr tails and exit code", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      type: "step-failed",
      stepId: "a",
      error: "boom",
      durationMs: 40,
      stdout: "hello out",
      stderr: "hello err",
      exitCode: 2,
    });
    const step = state.steps.get("a");
    expect(step?.stdout).toBe("hello out");
    expect(step?.stderr).toBe("hello err");
    expect(step?.exitCode).toBe(2);
  });

  it("stdout tail is bounded to the last 64 KiB", () => {
    let state = createInitialState();
    const big = "x".repeat(70 * 1024) + "TAILMARK";
    state = reduceEvent(state, {
      type: "step-succeeded",
      stepId: "a",
      durationMs: 1,
      stdout: big,
    });
    const out = state.steps.get("a")?.stdout ?? "";
    expect(out.length).toBeLessThanOrEqual(64 * 1024);
    expect(out.endsWith("TAILMARK")).toBe(true);
  });
});
