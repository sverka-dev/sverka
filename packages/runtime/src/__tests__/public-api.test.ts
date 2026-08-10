import { describe, it, expect } from "vitest";
import { RuntimeError } from "../index.js";

describe("RuntimeError", () => {
  it("sets message, code, and context", () => {
    const err = new RuntimeError("execution failed", "EXEC_FAILED", { operationId: "op-123" });
    expect(err.message).toBe("execution failed");
    expect(err.code).toBe("EXEC_FAILED");
    expect(err.context).toEqual({ operationId: "op-123" });
  });

  it("sets name to RuntimeError", () => {
    const err = new RuntimeError("fail", "FAIL");
    expect(err.name).toBe("RuntimeError");
  });

  it("is an instance of Error", () => {
    const err = new RuntimeError("fail", "FAIL");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RuntimeError);
  });

  it("context is optional", () => {
    const err = new RuntimeError("fail", "FAIL");
    expect(err.context).toBeUndefined();
  });
});
