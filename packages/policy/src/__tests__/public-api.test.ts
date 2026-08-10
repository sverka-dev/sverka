import { describe, it, expect } from "vitest";
import { PolicyError } from "../index.js";

describe("PolicyError", () => {
  it("sets message, code, and context", () => {
    const err = new PolicyError("policy violation", "VIOLATION", { rule: "no-secrets" });
    expect(err.message).toBe("policy violation");
    expect(err.code).toBe("VIOLATION");
    expect(err.context).toEqual({ rule: "no-secrets" });
  });

  it("sets name to PolicyError", () => {
    const err = new PolicyError("fail", "FAIL");
    expect(err.name).toBe("PolicyError");
  });

  it("is an instance of Error", () => {
    const err = new PolicyError("fail", "FAIL");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PolicyError);
  });

  it("context is optional", () => {
    const err = new PolicyError("fail", "FAIL");
    expect(err.context).toBeUndefined();
  });
});
