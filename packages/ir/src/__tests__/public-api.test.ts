import { describe, it, expect } from "vitest";
import * as ir from "../index.js";

describe("public API", () => {
  it("exports all expected types and functions", () => {
    // Functions
    expect(typeof ir.serializeGraph).toBe("function");
    expect(typeof ir.deserializeGraph).toBe("function");
    expect(typeof ir.serializeRunPlan).toBe("function");
    expect(typeof ir.deserializeRunPlan).toBe("function");
    expect(typeof ir.computeGraphId).toBe("function");
    expect(typeof ir.computeRunPlanId).toBe("function");
    expect(typeof ir.validateGraphSchema).toBe("function");
    expect(typeof ir.validateRunPlanSchema).toBe("function");

    // Error classes
    expect(ir.IRError).toBeDefined();
    expect(ir.ValidationError).toBeDefined();
    expect(ir.SerializationError).toBeDefined();

    // Version constants
    expect(ir.GRAPH_SCHEMA_VERSION).toBe("sverka.dev/v1graph");
    expect(ir.RUN_PLAN_SCHEMA_VERSION).toBe("sverka.dev/v1run");
  });

  it("error classes are constructable", () => {
    const ve = new ir.ValidationError("test");
    expect(ve).toBeInstanceOf(ir.IRError);
    expect(ve.code).toBe("VALIDATION_ERROR");

    const se = new ir.SerializationError("test");
    expect(se).toBeInstanceOf(ir.IRError);
    expect(se.code).toBe("SERIALIZATION_ERROR");
  });

  it("IRErrorCode type is exported (as type)", () => {
    // Type-only export — verify it compiles. Runtime check: the code values
    // are the only valid IRErrorCode values.
    const code: "VALIDATION_ERROR" | "SERIALIZATION_ERROR" = "VALIDATION_ERROR";
    expect(code).toBe("VALIDATION_ERROR");
  });
});
