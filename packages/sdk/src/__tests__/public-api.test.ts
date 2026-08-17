import { describe, it, expect } from "vitest";
import * as sdk from "../index.js";
import type { StepBuilder, PipelineConfig, ImageRef, SdkErrorCode } from "../index.js";

// Compile-time guard: the public type surface must stay exported.
type _TypeSurface = [StepBuilder, PipelineConfig, ImageRef, SdkErrorCode];

describe("public API", () => {
  it("exports all expected functions", () => {
    expect(typeof sdk.$).toBe("function");
    expect(typeof sdk.shell).toBe("function");
    expect(typeof sdk.artifact).toBe("function");
    expect(typeof sdk.pipeline).toBe("function");
    expect(typeof sdk.when).toBe("function");
    expect(typeof sdk.image).toBe("function");
    expect(typeof sdk.images).toBe("object");
    expect(typeof sdk.pipelineV0).toBe("function");
    expect(typeof sdk.whenV0).toBe("function");
  });

  it("exports context namespaces", () => {
    expect(typeof sdk.env).toBe("object");
    expect(typeof sdk.secrets).toBe("object");
    expect(typeof sdk.git).toBe("object");
    expect(typeof sdk.change).toBe("object");
    expect(typeof sdk.event).toBe("object");
    expect(typeof sdk.runContext).toBe("object");
    expect(typeof sdk.inputs).toBe("object");
  });

  it("exports SdkError", () => {
    const err = new sdk.SdkError("test", "INVALID_INTERPOLATION");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("INVALID_INTERPOLATION");
  });
});
