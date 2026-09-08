import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API", () => {
  it("exports runBenchmark function", () => {
    expect(typeof api.runBenchmark).toBe("function");
  });

  it("exports writeReport function", () => {
    expect(typeof api.writeReport).toBe("function");
  });

  it("exports BENCHMARK_TASKS array", () => {
    expect(Array.isArray(api.BENCHMARK_TASKS)).toBe(true);
  });

  it("exports DEFAULT_AGENTS array", () => {
    expect(Array.isArray(api.DEFAULT_AGENTS)).toBe(true);
  });

  it("exports collector functions", () => {
    expect(typeof api.readTranscript).toBe("function");
    expect(typeof api.transformStep).toBe("function");
    expect(typeof api.countLlmCalls).toBe("function");
    expect(typeof api.transformTranscript).toBe("function");
    expect(typeof api.buildTraceData).toBe("function");
    expect(typeof api.writeTraceData).toBe("function");
  });

  it("runtime exports are only functions and arrays (no classes)", () => {
    const runtimeKeys = Object.keys(api).filter(
      (k) => k !== "default" && !k.startsWith("_"),
    );
    for (const key of runtimeKeys) {
      const val = (api as Record<string, unknown>)[key];
      expect(typeof val === "function" || Array.isArray(val)).toBe(true);
    }
  });
});
