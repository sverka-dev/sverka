import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API", () => {
  it("exports all spec-required types and functions", () => {
    // Functions
    expect(typeof api.reduceEvent).toBe("function");
    expect(typeof api.createInitialState).toBe("function");
    expect(typeof api.collectFindings).toBe("function");
    expect(typeof api.evaluateGate).toBe("function");
    expect(typeof api.createTextRenderer).toBe("function");
    expect(typeof api.layoutDag).toBe("function");
    expect(typeof api.createHtmlRenderer).toBe("function");
    // Spec 45
    expect(typeof api.createInkRenderer).toBe("function");
    expect(typeof api.stepGlyph).toBe("function");
    expect(typeof api.buildStepTree).toBe("function");
    expect(typeof api.filterFindings).toBe("function");
    expect(api.FINDING_FILTERS).toEqual(["all", "critical", "high", "medium", "low", "new", "error"]);
    // Error class
    expect(typeof api.ReporterError).toBe("function");
  });

  it("ReporterError has code and cause with override", () => {
    const err = new api.ReporterError("boom", "COLLECTION_FAILED", { x: 1 });
    expect(err.code).toBe("COLLECTION_FAILED");
    expect(err.cause).toEqual({ x: 1 });
    expect(err.message).toBe("boom");
    expect(err.name).toBe("ReporterError");
    // override on cause: the property descriptor should exist on the instance
    expect(Object.getOwnPropertyDescriptor(err, "cause")).toBeDefined();
  });

  it("type-only exports are importable", () => {
    // These are type-only imports — just verify they don't throw
    const _types: typeof api = api;
    expect(_types).toBeDefined();
  });
});
