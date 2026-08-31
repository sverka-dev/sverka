import { describe, it, expect } from "vitest";
import { PolicyError, type PolicyErrorCode } from "../errors.js";

describe("PolicyError", () => {
  it("constructs with message, code, and name", () => {
    const err = new PolicyError("bad policy", "INVALID_POLICY");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad policy");
    expect(err.name).toBe("PolicyError");
    expect(err.code).toBe("INVALID_POLICY");
  });

  it("chains a cause", () => {
    const cause = new Error("root");
    const err = new PolicyError("wrapped", "INVALID_SEVERITY", cause);
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new PolicyError("no cause", "INVALID_POLICY");
    expect(err.cause).toBeUndefined();
  });

  it("supports all PolicyErrorCode values", () => {
    const codes: PolicyErrorCode[] = ["INVALID_POLICY", "INVALID_SEVERITY"];
    for (const code of codes) {
      const err = new PolicyError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});
