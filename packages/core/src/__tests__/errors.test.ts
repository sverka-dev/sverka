import { describe, it, expect } from "vitest";
import { CoreError, PlanningError, CompositionError } from "../errors.js";

describe("CoreError", () => {
  it("sets name, code, and context", () => {
    const err = new CoreError("boom", "BOOM", { key: "value" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CoreError");
    expect(err.code).toBe("BOOM");
    expect(err.message).toBe("boom");
    expect(err.context).toEqual({ key: "value" });
  });

  it("context is optional", () => {
    const err = new CoreError("boom", "BOOM");
    expect(err.context).toBeUndefined();
  });
});

describe("PlanningError", () => {
  it("extends CoreError with code PLANNING_ERROR", () => {
    const err = new PlanningError("side effect", { op: "x" });
    expect(err).toBeInstanceOf(CoreError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PlanningError");
    expect(err.code).toBe("PLANNING_ERROR");
    expect(err.context).toEqual({ op: "x" });
  });
});

describe("CompositionError", () => {
  it("extends CoreError with code COMPOSITION_ERROR", () => {
    const err = new CompositionError("cycle", { nodes: ["a", "b"] });
    expect(err).toBeInstanceOf(CoreError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CompositionError");
    expect(err.code).toBe("COMPOSITION_ERROR");
    expect(err.context).toEqual({ nodes: ["a", "b"] });
  });
});
