import { describe, it, expect } from "vitest";
import { validatePlan } from "../validate.js";
import { computePlanId } from "../ids.js";
import type { PlanOperation } from "../plan.js";
import {
  validPlan,
  validPlanBody,
  validOperation,
  dockerOperation,
} from "./helpers/fixtures.js";

describe("validatePlan — positive", () => {
  it("accepts a valid plan", () => {
    const result = validatePlan(validPlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a valid docker plan with image digest", () => {
    const plan = validPlan({ operations: [dockerOperation()] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("never throws on garbage input", () => {
    expect(() => validatePlan(null)).not.toThrow();
    expect(() => validatePlan(undefined)).not.toThrow();
    expect(() => validatePlan("not a plan")).not.toThrow();
    expect(() => validatePlan(42)).not.toThrow();
    expect(() => validatePlan({})).not.toThrow();
    expect(() => validatePlan([])).not.toThrow();
  });
});

describe("validatePlan — rule 1 (apiVersion)", () => {
  it("rejects wrong apiVersion with INVALID_API_VERSION", () => {
    const plan = { ...validPlan(), apiVersion: "sverka.dev/v2" };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_API_VERSION");
    expect(err).toBeDefined();
    expect(err?.field).toBe("apiVersion");
  });

  it("rejects missing apiVersion", () => {
    const { apiVersion: _omit, ...rest } = validPlan();
    const result = validatePlan(rest);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "INVALID_API_VERSION"),
    ).toBe(true);
  });
});

describe("validatePlan — rule 2 (id matches recomputed)", () => {
  it("rejects a mismatched id with ID_MISMATCH", () => {
    const plan = { ...validPlan(), id: "plan-wrong" };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "ID_MISMATCH");
    expect(err).toBeDefined();
    expect(err?.field).toBe("id");
  });

  it("rejects an empty id", () => {
    const plan = { ...validPlan(), id: "" };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ID_MISMATCH")).toBe(true);
  });

  it("accepts a plan with an extra top-level field", () => {
    const planWithExtra = { ...validPlan(), extraField: "value" };
    const plan = { ...planWithExtra, id: computePlanId(planWithExtra) };
    const result = validatePlan(plan);
    expect(result.errors.some((e) => e.code === "ID_MISMATCH")).toBe(false);
    expect(result.valid).toBe(true);
  });
});

describe("validatePlan — rule 3 (non-empty operations)", () => {
  it("rejects empty operations with EMPTY_OPERATIONS", () => {
    const plan = validPlan({ operations: [] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "EMPTY_OPERATIONS");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations");
  });
});

describe("validatePlan — rule 4 (dependsOn references exist)", () => {
  it("rejects a dependsOn referencing an unknown id", () => {
    const plan = validPlan({
      operations: [
        validOperation({ id: "op-a", dependsOn: ["op-missing"] }),
      ],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "UNKNOWN_DEPENDENCY");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].dependsOn");
    expect(err?.operationId).toBe("op-a");
  });
});

describe("validatePlan — rule 5 (acyclic)", () => {
  it("rejects a cycle with CYCLE_DETECTED and the cycle path in message", () => {
    const a = validOperation({ id: "op-a", dependsOn: ["op-c"] });
    const b = validOperation({ id: "op-b", dependsOn: ["op-a"] });
    const c = validOperation({ id: "op-c", dependsOn: ["op-b"] });
    const plan = validPlan({ operations: [a, b, c] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "CYCLE_DETECTED");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].dependsOn");
    // message contains the cycle path, e.g. "op-a -> op-c -> op-b -> op-a"
    expect(err?.message).toContain("op-a");
    expect(err?.message).toContain("->");
  });

  it("treats a self-loop as a cycle (length 1)", () => {
    const plan = validPlan({
      operations: [validOperation({ id: "op-a", dependsOn: ["op-a"] })],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "CYCLE_DETECTED");
    expect(err).toBeDefined();
    expect(err?.message).toContain("op-a");
  });
});

describe("validatePlan — rule 6 (unique operation ids)", () => {
  it("rejects duplicate operation ids with DUPLICATE_OPERATION_ID", () => {
    const a = validOperation({ id: "op-a" });
    const b = validOperation({ id: "op-a", name: "test" });
    const plan = validPlan({ operations: [a, b] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "DUPLICATE_OPERATION_ID");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].id");
  });
});

describe("validatePlan — rule 7 (imageDigest for containers)", () => {
  it("rejects docker executor without imageDigest", () => {
    const op = validOperation({
      id: "op-d",
      executor: { type: "docker", image: "img:1" },
    });
    const plan = validPlan({ operations: [op] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "MISSING_IMAGE_DIGEST");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].executor.imageDigest");
  });

  it("rejects podman executor with malformed digest", () => {
    const op = validOperation({
      id: "op-p",
      executor: { type: "podman", image: "img:1", imageDigest: "not-a-digest" },
    });
    const plan = validPlan({ operations: [op] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.code === "MISSING_IMAGE_DIGEST"),
    ).toBe(true);
  });

  it("accepts a host executor without imageDigest", () => {
    const plan = validPlan({ operations: [validOperation()] });
    expect(validatePlan(plan).valid).toBe(true);
  });
});

describe("validatePlan — rule 8 (timeoutSeconds > 0)", () => {
  it("rejects timeoutSeconds <= 0 with INVALID_TIMEOUT", () => {
    const plan = validPlan({
      operations: [validOperation({ timeoutSeconds: 0 })],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_TIMEOUT");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].timeoutSeconds");
  });

  it("rejects negative timeoutSeconds", () => {
    const plan = validPlan({
      operations: [validOperation({ timeoutSeconds: -5 })],
    });
    expect(validatePlan(plan).valid).toBe(false);
    expect(
      result_of(plan).some((e) => e.code === "INVALID_TIMEOUT"),
    ).toBe(true);
  });
});

// helper to keep the negative-timeout test concise
function result_of(plan: unknown) {
  return validatePlan(plan).errors;
}

describe("validatePlan — rule 9 (resources parseable)", () => {
  it("rejects empty cpu with INVALID_RESOURCES", () => {
    const plan = validPlan({
      operations: [validOperation({ resources: { cpu: "", memory: "512Mi" } })],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_RESOURCES");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].resources");
  });

  it("rejects non-numeric cpu", () => {
    const plan = validPlan({
      operations: [validOperation({ resources: { cpu: "fast", memory: "512Mi" } })],
    });
    expect(validatePlan(plan).valid).toBe(false);
    expect(
      validatePlan(plan).errors.some((e) => e.code === "INVALID_RESOURCES"),
    ).toBe(true);
  });

  it("rejects malformed memory", () => {
    const plan = validPlan({
      operations: [validOperation({ resources: { cpu: "1", memory: "big" } })],
    });
    expect(validatePlan(plan).valid).toBe(false);
    expect(
      validatePlan(plan).errors.some((e) => e.code === "INVALID_RESOURCES"),
    ).toBe(true);
  });

  it("accepts fractional cpu and suffixed memory", () => {
    const plan = validPlan({
      operations: [
        validOperation({ resources: { cpu: "0.5", memory: "2Gi" } }),
      ],
    });
    expect(validatePlan(plan).valid).toBe(true);
  });
});

describe("validatePlan — rule 10 (retry policy)", () => {
  it("rejects maxAttempts < 1 with INVALID_RETRY_POLICY", () => {
    const plan = validPlan({
      operations: [
        validOperation({ retry: { maxAttempts: 0, backoffSeconds: 0, retryOn: ["failure"] } }),
      ],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_RETRY_POLICY");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].retry");
  });

  it("rejects negative backoffSeconds", () => {
    const plan = validPlan({
      operations: [
        validOperation({ retry: { maxAttempts: 1, backoffSeconds: -1, retryOn: ["failure"] } }),
      ],
    });
    expect(validatePlan(plan).valid).toBe(false);
    expect(
      validatePlan(plan).errors.some((e) => e.code === "INVALID_RETRY_POLICY"),
    ).toBe(true);
  });

  it("rejects unknown retryOn values", () => {
    const plan = validPlan({
      operations: [
        validOperation({
          retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: ["failure", "unknown"] as readonly ("failure" | "timeout")[] },
        }),
      ],
    });
    expect(validatePlan(plan).valid).toBe(false);
    expect(
      validatePlan(plan).errors.some((e) => e.code === "INVALID_RETRY_POLICY"),
    ).toBe(true);
  });
});

describe("validatePlan — rule 11 (network policy)", () => {
  it("rejects unknown network value with INVALID_NETWORK_POLICY", () => {
    const plan = validPlan({
      operations: [validOperation({ network: "open" as never })],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_NETWORK_POLICY");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].network");
  });
});

describe("validatePlan — rule 12 (cache.key required)", () => {
  it("rejects a cache without key with MISSING_CACHE_KEY", () => {
    const plan = validPlan({
      operations: [
        validOperation({
          cache: { inputs: ["src"], outputs: ["out"], key: "" },
        }),
      ],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "MISSING_CACHE_KEY");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].cache.key");
  });
});

describe("validatePlan — rule 13 (credential envVar non-empty)", () => {
  it("rejects an empty credential envVar with EMPTY_CREDENTIAL_ENVVAR", () => {
    const plan = validPlan({
      operations: [
        validOperation({
          credentials: [{ name: "token", envVar: "", required: true }],
        }),
      ],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "EMPTY_CREDENTIAL_ENVVAR");
    expect(err).toBeDefined();
    expect(err?.field).toBe("operations[].credentials[].envVar");
  });
});

describe("validatePlan — collects all errors (no short-circuit)", () => {
  it("reports multiple independent errors", () => {
    // Valid apiVersion + shape so the id recompute runs and reports
    // ID_MISMATCH; the operation also has timeout and network violations.
    const plan = {
      ...validPlanBody(),
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "plan-wrong",
      operations: [
        validOperation({ timeoutSeconds: 0, network: "open" as never }),
      ],
    };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("ID_MISMATCH");
    expect(codes).toContain("INVALID_TIMEOUT");
    expect(codes).toContain("INVALID_NETWORK_POLICY");
  });

  it("does not recompute id when shape is invalid (rule-1 reported first)", () => {
    const plan = {
      ...validPlanBody(),
      apiVersion: "wrong",
      id: "plan-wrong",
    };
    const result = validatePlan(plan);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("INVALID_API_VERSION");
    expect(codes).not.toContain("ID_MISMATCH");
  });
});

describe("validatePlan — rule 14 (metadata fields)", () => {
  it("rejects missing sverkaVersion with INVALID_METADATA", () => {
    // sverkaVersion="" is a string so it passes — test with missing field
    const { metadata: _metadata, ...rest } = validPlan();
    const planMissing = { ...rest, metadata: { generatedBy: "planner" } };
    const result = validatePlan(planMissing);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "INVALID_METADATA");
    expect(err).toBeDefined();
    expect(err?.field).toBe("metadata.sverkaVersion");
  });

  it("rejects non-string sverkaVersion with INVALID_METADATA", () => {
    const { metadata: _metadata, ...rest } = validPlan();
    const plan = { ...rest, metadata: { sverkaVersion: 42, generatedBy: "planner" } };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_METADATA" && e.field === "metadata.sverkaVersion",
      ),
    ).toBe(true);
  });

  it("rejects invalid generatedBy union with INVALID_METADATA", () => {
    const { metadata: _metadata, ...rest } = validPlan();
    const plan = { ...rest, metadata: { sverkaVersion: "0.0.0", generatedBy: "unknown" } };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    const err = result.errors.find(
      (e) => e.code === "INVALID_METADATA" && e.field === "metadata.generatedBy",
    );
    expect(err).toBeDefined();
  });

  it("rejects missing generatedBy with INVALID_METADATA", () => {
    const { metadata: _metadata, ...rest } = validPlan();
    const plan = { ...rest, metadata: { sverkaVersion: "0.0.0" } };
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_METADATA" && e.field === "metadata.generatedBy",
      ),
    ).toBe(true);
  });

  it("accepts all valid generatedBy values", () => {
    for (const g of ["planner", "manual", "compiler"] as const) {
      const plan = validPlan({
        metadata: { sverkaVersion: "0.0.0", generatedBy: g },
      });
      expect(validatePlan(plan).valid).toBe(true);
    }
  });
});

describe("validatePlan — rule 15 (operation shape)", () => {
  it("rejects missing operation id with INVALID_OPERATION", () => {
    const { id: _omit, ...opWithoutId } = validOperation();
    const plan = validPlan({ operations: [opWithoutId as unknown as PlanOperation] });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].id",
      ),
    ).toBe(true);
  });

  it("rejects non-string operation name with INVALID_OPERATION", () => {
    const op = validOperation();
    const plan = validPlan({
      operations: [{ ...op, name: 42 } as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].name",
      ),
    ).toBe(true);
  });

  it("rejects missing executor with INVALID_OPERATION", () => {
    const { executor: _omit, ...opWithoutExecutor } = validOperation();
    const plan = validPlan({
      operations: [opWithoutExecutor as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].executor",
      ),
    ).toBe(true);
  });

  it("rejects missing dependsOn (null) with INVALID_OPERATION", () => {
    const op = validOperation();
    const plan = validPlan({
      operations: [{ ...op, dependsOn: null } as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].dependsOn",
      ),
    ).toBe(true);
  });

  it("rejects missing dependsOn (undefined) with INVALID_OPERATION", () => {
    const { dependsOn: _omit, ...opWithoutDeps } = validOperation();
    const plan = validPlan({
      operations: [opWithoutDeps as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].dependsOn",
      ),
    ).toBe(true);
  });

  it("rejects non-array credentials with INVALID_OPERATION", () => {
    const op = validOperation();
    const plan = validPlan({
      operations: [{ ...op, credentials: "not-array" } as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].credentials",
      ),
    ).toBe(true);
  });

  it("rejects non-array artifacts with INVALID_OPERATION", () => {
    const op = validOperation();
    const plan = validPlan({
      operations: [{ ...op, artifacts: "not-array" } as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].artifacts",
      ),
    ).toBe(true);
  });

  it("rejects non-boolean continueOnError with INVALID_OPERATION", () => {
    const op = validOperation();
    const plan = validPlan({
      operations: [{ ...op, continueOnError: "yes" } as unknown as PlanOperation],
    });
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.code === "INVALID_OPERATION" && e.field === "operations[].continueOnError",
      ),
    ).toBe(true);
  });
});
