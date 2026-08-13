import { describe, it, expect } from "vitest";
import { SdkError } from "../errors.js";

describe("SdkError", () => {
  it("extends Error with code and cause", () => {
    const err = new SdkError("test", "INVALID_INTERPOLATION");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test");
    expect(err.code).toBe("INVALID_INTERPOLATION");
    expect(err.cause).toBeUndefined();
  });

  it("stores cause when provided", () => {
    const cause = new Error("root");
    const err = new SdkError("test", "INVALID_IMAGE", cause);
    expect(err.cause).toBe(cause);
    expect(err.code).toBe("INVALID_IMAGE");
  });
});
