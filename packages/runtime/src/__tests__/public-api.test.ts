import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API surface", () => {
  it("exports the error classes as constructors", () => {
    expect(typeof api.RuntimeExecutionError).toBe("function");
    expect(typeof api.SchedulerError).toBe("function");
    expect(typeof api.ExecutorError).toBe("function");
  });

  it("error classes extend Error / RuntimeExecutionError", () => {
    const base = new api.RuntimeExecutionError("m", "CODE");
    expect(base).toBeInstanceOf(Error);
    expect(base.code).toBe("CODE");

    const sched = new api.SchedulerError("m");
    expect(sched).toBeInstanceOf(api.RuntimeExecutionError);
    expect(sched.code).toBe("SCHEDULER_ERROR");

    const exec = new api.ExecutorError("m");
    expect(exec).toBeInstanceOf(api.RuntimeExecutionError);
    expect(exec.code).toBe("EXECUTOR_ERROR");
  });

  it("internal modules are not re-exported from the public entry", () => {
    const publicNames = Object.keys(api);
    const internalLeaked = publicNames.filter((n) =>
      [
        "topoSort",
        "dependentsOf",
        "ResourcePool",
        "parseCpu",
        "parseMemory",
      ].includes(n),
    );
    expect(internalLeaked).toEqual([]);
  });
});
