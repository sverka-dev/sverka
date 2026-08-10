import { describe, it, expect } from "vitest";
import {
  NormalizationError,
  BaselineError,
  type NormalizationErrorCode,
  type BaselineErrorCode,
} from "../errors.js";

describe("NormalizationError", () => {
  it("constructs with message, code, and name", () => {
    const err = new NormalizationError("bad sarif", "INVALID_SARIF");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("bad sarif");
    expect(err.name).toBe("NormalizationError");
    expect(err.code).toBe("INVALID_SARIF");
  });

  it("chains a cause", () => {
    const cause = new Error("root");
    const err = new NormalizationError("wrapped", "MISSING_LOCATION", cause);
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new NormalizationError("no cause", "INVALID_FINGERPRINT_INPUT");
    expect(err.cause).toBeUndefined();
  });

  it("supports all NormalizationErrorCode values", () => {
    const codes: NormalizationErrorCode[] = [
      "INVALID_SARIF",
      "MISSING_LOCATION",
      "INVALID_FINGERPRINT_INPUT",
    ];
    for (const code of codes) {
      const err = new NormalizationError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});

describe("BaselineError", () => {
  it("constructs with message, code, and name", () => {
    const err = new BaselineError("not found", "BASELINE_NOT_FOUND");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("not found");
    expect(err.name).toBe("BaselineError");
    expect(err.code).toBe("BASELINE_NOT_FOUND");
  });

  it("chains a cause", () => {
    const cause = new Error("enoent");
    const err = new BaselineError("wrapped", "BASELINE_INVALID", cause);
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new BaselineError("no cause", "BASELINE_WRITE_FAILED");
    expect(err.cause).toBeUndefined();
  });

  it("supports all BaselineErrorCode values", () => {
    const codes: BaselineErrorCode[] = [
      "BASELINE_NOT_FOUND",
      "BASELINE_INVALID",
      "BASELINE_WRITE_FAILED",
    ];
    for (const code of codes) {
      const err = new BaselineError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});
