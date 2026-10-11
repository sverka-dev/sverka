import { describe, it, expect } from "vitest";
import * as api from "../index.js";
import { validPlan } from "./helpers/fixtures.js";

// Compile-time coverage for public type exports. These assignments ensure
// the types are importable and usable; they are erased at runtime but
// caught by `tsc --noEmit`.
import type {
  Plan,
  PlanOperation,
  PlanMetadata,
  ExecutorSpec,
  RemoteExecutorRef,
  ResourceLimits,
  NetworkPolicy,
  CredentialDeclaration,
  CacheDeclaration,
  ArtifactDeclaration,
  RetryPolicy,
  PlanValidator,
  ValidationResult,
  ValidationErrorDetail,
} from "../index.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeCoverage(
  _p: Plan,
  _op: PlanOperation,
  _m: PlanMetadata,
  _e: ExecutorSpec,
  _r: RemoteExecutorRef,
  _rl: ResourceLimits,
  _np: NetworkPolicy,
  _cd: CredentialDeclaration,
  _cache: CacheDeclaration,
  _art: ArtifactDeclaration,
  _retry: RetryPolicy,
  _pv: PlanValidator,
  _vr: ValidationResult,
  _ved: ValidationErrorDetail,
): void {
  // This function exists solely to use every exported type at compile time.
}

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
