import { describe, it, expect } from "vitest";
import {
  SdkError,
  type SdkErrorCode,
  type SverkaOptions,
  type PlanResult,
  type ExecutionResult,
  type WorkflowDefinition,
  type Sverka,
} from "../index.js";

describe("public API — SdkError", () => {
  it("creates an error with message, code, and optional cause", () => {
    const err = new SdkError("config not found", "CONFIG_NOT_FOUND");
    expect(err.message).toBe("config not found");
    expect(err.code).toBe("CONFIG_NOT_FOUND");
    expect(err.name).toBe("SdkError");
    expect(err.cause).toBeUndefined();
  });

  it("preserves cause when provided", () => {
    const cause = new Error("inner");
    const err = new SdkError("load failed", "CONFIG_LOAD_FAILED", cause);
    expect(err.cause).toBe(cause);
  });

  it("all error codes are constructible", () => {
    const codes: SdkErrorCode[] = [
      "CONFIG_NOT_FOUND",
      "CONFIG_INVALID",
      "CONFIG_LOAD_FAILED",
      "EXECUTION_FAILED",
    ];
    for (const code of codes) {
      const err = new SdkError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});

describe("public API — types (compile-time check)", () => {
  it("all spec types are importable", () => {
    const _opts: SverkaOptions = {};
    const _sverka: Sverka = {} as never;
    const _wf: WorkflowDefinition = {
      name: "x",
      workflow: {} as never,
    };
    const _plan: PlanResult = {
      context: {} as never,
      operations: [],
      proposal: null,
    };
    const _exec: ExecutionResult = {
      findings: [],
      policyResult: {} as never,
      verdict: "pass",
      status: "success",
      outcomes: new Map(),
      durationMs: 0,
    };
    // Touch all to avoid unused warnings.
    expect(_opts).toBeDefined();
    expect(_sverka).toBeDefined();
    expect(_wf.name).toBe("x");
    expect(_plan.operations).toEqual([]);
    expect(_exec.verdict).toBe("pass");
  });
});
