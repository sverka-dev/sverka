import { describe, it, expect } from "vitest";
import { EngineError, SchedulerError, StepExecError } from "../errors.js";

describe("EngineError", () => {
  it("extends Error with code and cause", () => {
    const err = new EngineError("test", "SCHEDULER_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test");
    expect(err.code).toBe("SCHEDULER_ERROR");
    expect(err.cause).toBeUndefined();
  });

  it("stores cause when provided", () => {
    const cause = new Error("root");
    const err = new EngineError("test", "STEP_EXEC_ERROR", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("SchedulerError", () => {
  it("extends EngineError with SCHEDULER_ERROR code", () => {
    const err = new SchedulerError("cycle");
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("SCHEDULER_ERROR");
  });
});

describe("StepExecError", () => {
  it("extends EngineError with custom code", () => {
    const err = new StepExecError("failed", "TIMEOUT");
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("TIMEOUT");
  });
});
