import { describe, it, expect } from "vitest";
import * as api from "../index.js";

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
});
