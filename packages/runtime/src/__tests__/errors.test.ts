import { describe, it, expect } from "vitest";
import {
  RuntimeExecutionError,
  SchedulerError,
  ExecutorError,
} from "../errors.js";

describe("RuntimeExecutionError", () => {
  it("sets name, code, and context", () => {
    const err = new RuntimeExecutionError("boom", "BOOM", { key: "value" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RuntimeExecutionError");
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("boom");
    expect(err.context).toEqual({ key: "value" });
  });

  it("context is optional", () => {
    const err = new RuntimeExecutionError("boom", "BOOM");
    expect(err.context).toBeUndefined();
  });
});

describe("SchedulerError", () => {
  it("extends RuntimeExecutionError with code SCHEDULER_ERROR", () => {
    const err = new SchedulerError("no executor", { op: "x" });
    expect(err).toBeInstanceOf(RuntimeExecutionError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SchedulerError");
    expect(err.code).toBe("SCHEDULER_ERROR");
    expect(err.context).toEqual({ op: "x" });
  });

  it("context is optional", () => {
    const err = new SchedulerError("cycle");
    expect(err.context).toBeUndefined();
  });
});

describe("ExecutorError", () => {
  it("extends RuntimeExecutionError with code EXECUTOR_ERROR", () => {
    const err = new ExecutorError("executor threw", { executor: "docker" });
    expect(err).toBeInstanceOf(RuntimeExecutionError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExecutorError");
    expect(err.code).toBe("EXECUTOR_ERROR");
    expect(err.context).toEqual({ executor: "docker" });
  });

  it("context is optional", () => {
    const err = new ExecutorError("executor threw");
    expect(err.context).toBeUndefined();
  });
});
