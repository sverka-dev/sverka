import { describe, it, expect } from "vitest";
import * as sdk from "../index.js";

describe("public API", () => {
  it("exports all expected functions", () => {
    expect(typeof sdk.sh).toBe("function");
    expect(typeof sdk.artifact).toBe("function");
    expect(typeof sdk.pipeline).toBe("function");
    expect(typeof sdk.when).toBe("function");
    expect(typeof sdk.image).toBe("function");
    expect(typeof sdk.images).toBe("object");
  });

  it("exports context namespaces", () => {
    expect(typeof sdk.env).toBe("object");
    expect(typeof sdk.secrets).toBe("object");
    expect(typeof sdk.git).toBe("object");
    expect(typeof sdk.change).toBe("object");
    expect(typeof sdk.event).toBe("object");
    expect(typeof sdk.run).toBe("object");
    expect(typeof sdk.inputs).toBe("object");
  });

  it("exports SdkError", () => {
    const err = new sdk.SdkError("test", "INVALID_INTERPOLATION");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("INVALID_INTERPOLATION");
  });
});
