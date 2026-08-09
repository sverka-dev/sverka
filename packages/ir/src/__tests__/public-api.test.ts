import { describe, it, expect } from "vitest";
import * as api from "../index.js";
import { validPlan } from "./helpers/fixtures.js";

describe("public API surface", () => {
  it("exports every spec-listed value symbol", () => {
    expect(typeof api.validatePlan).toBe("function");
    expect(typeof api.serializePlan).toBe("function");
    expect(typeof api.deserializePlan).toBe("function");
    expect(typeof api.computePlanId).toBe("function");
    expect(typeof api.computeOperationId).toBe("function");
    expect(typeof api.IRError).toBe("function");
    expect(typeof api.ValidationError).toBe("function");
    expect(typeof api.SerializationError).toBe("function");
    expect(api.PLAN_SCHEMA_VERSION).toBe("sverka.dev/v1");
  });

  it("IRError is a constructor extending Error", () => {
    const err = new api.IRError("m", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CODE");
  });

  it("ValidationError and SerializationError extend IRError", () => {
    expect(new api.ValidationError("m")).toBeInstanceOf(api.IRError);
    expect(new api.SerializationError("m")).toBeInstanceOf(api.IRError);
  });

  it("computePlanId produces a plan- prefixed id", () => {
    const body = {
      apiVersion: "sverka.dev/v1" as const,
      name: "ci",
      sourceContextHash: "x",
      operations: [],
      metadata: { sverkaVersion: "0.0.0", generatedBy: "planner" as const },
    };
    expect(api.computePlanId(body).startsWith("plan-")).toBe(true);
  });

  it("validatePlan + serializePlan + deserializePlan interoperate", () => {
    const plan = validPlan();
    expect(api.validatePlan(plan).valid).toBe(true);
    const json = api.serializePlan(plan);
    const restored = api.deserializePlan(json);
    expect(restored).toEqual(plan);
  });

  it("internal modules are not re-exported from the public entry", () => {
    const publicNames = Object.keys(api);
    const internalLeaked = publicNames.filter((n) =>
      ["canonicalStringify", "findCycle"].includes(n),
    );
    expect(internalLeaked).toEqual([]);
  });
});
