import { describe, it, expect } from "vitest";
import * as api from "../index.js";
import type { RunEvent, RunStatus, RunState } from "../index.js";

describe("public API", () => {
  it("exports createEngine, createValueStore, createArtifactStore", () => {
    expect(typeof api.createEngine).toBe("function");
    expect(typeof api.createValueStore).toBe("function");
    expect(typeof api.createArtifactStore).toBe("function");
  });

  it("exports error classes", () => {
    expect(api.EngineError).toBeDefined();
    expect(api.SchedulerError).toBeDefined();
    expect(api.StepExecError).toBeDefined();
  });

  it("exports scheduler helpers", () => {
    expect(typeof api.topoSortSteps).toBe("function");
    expect(typeof api.transitiveDependents).toBe("function");
    expect(typeof api.isStepReady).toBe("function");
  });

  it("exports RunEvent and RunStatus types (Spec 21 item 7)", () => {
    // Type-only exports — verify they compile as types by constructing values.
    const event: RunEvent = { type: "run-started", runId: "r1", planId: "p1" };
    const status: RunStatus = "success";
    expect(event.type).toBe("run-started");
    expect(status).toBe("success");
  });

  it("exports RunState type (Spec 32 item 10)", () => {
    // Type-only export — verify it compiles as a type by constructing a value.
    const state: RunState = {
      runId: "r1",
      planId: "p1",
      status: "running",
      startedAt: 0,
      steps: [{ stepId: "ci/build", state: "pending" }],
    };
    expect(state.runId).toBe("r1");
    expect(state.status).toBe("running");
  });
});
