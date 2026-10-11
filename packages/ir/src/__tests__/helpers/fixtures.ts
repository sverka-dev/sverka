import type { Plan, PlanOperation } from "../../plan.js";
import { computePlanId, computeOperationId } from "../../ids.js";

/**
 * A single valid operation. All fields satisfy the 13 validation rules.
 * `id` is set to the deterministic id computed from kind/name/context so the
 * enclosing plan's rule-2 check passes.
 */
export function validOperation(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  const base: PlanOperation = {
    id: "op-a",
    kind: "run",
    name: "build",
    dependsOn: [],
    executor: { type: "host" },
    resources: { cpu: "1", memory: "512Mi" },
    network: "deny",
    credentials: [],
    artifacts: [],
    retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: ["failure"] },
    timeoutSeconds: 60,
    continueOnError: false,
  };
  const merged = { ...base, ...overrides };
  // If the caller didn't override the id, compute it from the operation
  // content so it reflects the deterministic operation-ID behavior.
  if (overrides.id === undefined) {
    const computedId = computeOperationId(merged.kind, merged.name, {
      command: merged.command,
    });
    return { ...merged, id: computedId };
  }
  return merged;
}

/** A docker executor operation with a valid sha256 image digest. */
export function dockerOperation(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  return validOperation({
    id: "op-docker",
    name: "container-build",
    executor: {
      type: "docker",
      image: "sverka/builder:1.0",
      imageDigest: "sha256:" + "a".repeat(64),
    },
    ...overrides,
  });
}

/**
 * A valid plan body (no id/createdAt). Use `validPlan` to get a complete Plan
 * with the deterministic id attached.
 */
export function validPlanBody(
  overrides: Partial<Omit<Plan, "id" | "createdAt">> = {},
): Omit<Plan, "id" | "createdAt"> {
  return {
    apiVersion: "sverka.dev/v1",
    name: "ci",
    sourceContextHash: "abc123",
    operations: [validOperation()],
    metadata: { sverkaVersion: "0.0.0", generatedBy: "planner" },
    ...overrides,
  };
}

/** A complete, valid Plan with the deterministic id and a fixed createdAt. */
export function validPlan(overrides: Partial<Omit<Plan, "id" | "createdAt">> = {}): Plan {
  const body = validPlanBody(overrides);
  const id = computePlanId(body);
  return { ...body, id, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** A two-operation plan with a real dependency edge (a → b). */
export function twoOpPlan(): Plan {
  const opA = validOperation({ name: "build", dependsOn: [] });
  const opB = validOperation({
    name: "test",
    dependsOn: [opA.id],
  });
  return validPlan({ operations: [opA, opB] });
}
