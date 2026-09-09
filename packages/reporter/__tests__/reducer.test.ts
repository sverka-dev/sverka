import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../src/reducer.js";
import {
  runStarted, stepPending, stepReady, stepStarted, stepSucceeded,
  stepFailed, stepSkipped, stepCancelled, stepCacheHit, stepRetry,
  runCompleted, diagnostic,
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
    const state = reduceEvent(createInitialState(), runStarted("run-1", "plan-abc"));
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
    state = reduceEvent(state, diagnostic("ci/lint", "something happened", "warn"));
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]).toEqual({
      stepId: "ci/lint",
      message: "something happened",
      severity: "warn",
    });
  });

  it("reduceEvent does not mutate the input state (pure)", () => {
    const initial = createInitialState();
    const frozen = { ...initial, steps: new Map(initial.steps), diagnostics: [...initial.diagnostics] };
    reduceEvent(initial, stepPending("ci/lint"));
    // Original state should be unchanged
    expect(initial.steps.size).toBe(frozen.steps.size);
    expect(initial.diagnostics).toHaveLength(frozen.diagnostics.length);
    expect(initial.runId).toBe(frozen.runId);
  });
});
