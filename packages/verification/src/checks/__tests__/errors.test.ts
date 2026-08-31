import { describe, it, expect } from "vitest";
import { CheckError, type CheckErrorCode } from "../errors.js";

describe("CheckError", () => {
  it("sets name, code, and override cause", () => {
    const cause = new Error("inner");
    const err = new CheckError("bad", "EXTRACTION_FAILED", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CheckError");
    expect(err.message).toBe("bad");
    expect(err.code).toBe("EXTRACTION_FAILED");
    expect(err.cause).toBe(cause);
  });

  it("cause is undefined when not provided", () => {
    const err = new CheckError("bad", "RESOLUTION_FAILED");
    expect(err.cause).toBeUndefined();
  });

  it("supports all CheckErrorCode values", () => {
    const codes: CheckErrorCode[] = ["RESOLUTION_FAILED", "EXTRACTION_FAILED"];
    for (const code of codes) {
      const err = new CheckError("msg", code);
      expect(err.code).toBe(code);
    }
  });
});
